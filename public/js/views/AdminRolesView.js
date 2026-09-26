// AdminRolesView (/admin/roles) — who may see which admin screens. Admin-only
// (managing roles is a meta-permission; the server gate is requireRole('admin')).
//
// Rebuilt 2026-09-26 (harvest 2 lane 3; the pattern of icelandicstore #421's
// customer-roles page — ported as a pattern, the data here is the engine's
// admin views, not ice's company permissions):
//
//   • Roles tab = ONE grid, admin screens × roles, so every role can be compared
//     at a glance. Rows are the grantable views of switched-on modules (the
//     server's `grantableViews` = offeredViewIds()), grouped like the sidebar;
//     `roles` is never a row (never grantable). The administrator column is
//     all-on and locked; User — the floor every account holds — is all-off and
//     locked (the server refuses to widen it). Changes are collected and saved
//     together from a sticky save bar that says how many people they reach,
//     one PATCH per changed role through the audited update endpoint.
//   • On a phone (≤ 600px) the grid shows one role column at a time, chosen
//     with a Combobox.
//   • A role is created from a free-text name ("Bókari"); the server derives
//     the slug. The name is editable later; the slug never changes.
//   • Members tab (who holds which role) is unchanged in shape.
import { isAuthenticated, isAdmin } from '../services/auth.js';
import { listRoles, createRole, updateRole, deleteRole,
         listMembers, addMember, removeMember, searchUsers } from '../services/adminRoles.js';
import { escHtml } from '../utils/escHtml.js';
import { avatarPathByName } from '../utils/avatar.js';
import { t, href, plural } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell, ADMIN_NAV } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { attachCombobox } from '../components/Combobox.js';
import { attachStickyHScroll } from '../utils/stickyHScroll.js';
import { roleLabel } from '../utils/roleLabel.js';

// The two columns nobody edits: the administrator holds every view (the
// resolver answers '*'), and User is the floor every account holds.
export const LOCKED_ON  = 'admin';
export const LOCKED_OFF = 'user';

// Map each admin view id → its sidebar group (i18n key + nav order) and its own
// label key, so the grid presents views grouped and named as the sidebar does.
const VIEW_META = (() => {
  const m = new Map();
  ADMIN_NAV.forEach((g, order) => g.items.forEach(it => m.set(it.id, { groupKey: g.group, order, labelKey: it.labelKey })));
  return m;
})();

export function viewLabel(id) {
  const key = VIEW_META.get(id)?.labelKey || `admin.nav.${id}`;
  const text = t(key);
  return text === key ? id : text;
}

// Group view ids into [{ groupKey, order, ids[] }] in sidebar order.
export function groupViews(ids) {
  const buckets = new Map();
  ids.forEach(id => {
    // A grantable id with no sidebar line is a PERMISSION (e.g. `allaccounts`
    // widens the account scope) — shown under its own heading, after the screens.
    const g = VIEW_META.get(id) || { groupKey: 'adminRoles.permissions', order: 99 };
    if (!buckets.has(g.groupKey)) buckets.set(g.groupKey, { groupKey: g.groupKey, order: g.order, ids: [] });
    buckets.get(g.groupKey).ids.push(id);
  });
  return [...buckets.values()].sort((a, b) => a.order - b.order);
}

// Column order: administrator, moderator, the named roles alphabetically,
// User last (it can only ever be all-off).
export function orderRoles(roles) {
  const rank = (r) => (r.name === LOCKED_ON ? 0 : r.name === 'moderator' ? 1 : r.name === LOCKED_OFF ? 3 : 2);
  return [...roles].sort((a, b) => rank(a) - rank(b) || roleLabel(a).localeCompare(roleLabel(b), 'is'));
}

export const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

// Everyone a change to these roles reaches: the DISTINCT people holding any of
// them (a person may hold several roles — summing the columns would count them
// twice). `members` is the Members board payload: [{ name, members: [{ id }] }].
export function reachOf(roleNames, members) {
  const want = new Set(roleNames);
  const ids = new Set();
  for (const r of members || []) {
    if (!want.has(r.name)) continue;
    for (const m of r.members || []) ids.add(String(m.id));
  }
  return ids.size;
}

// People-board accents: tokens only (invariant 15), no colour literal.
const ROLE_ACCENT = { admin: 'var(--gold)', moderator: 'var(--nav-tint-teal)', user: 'var(--text-secondary)' };
function roleAccent(name) { return ROLE_ACCENT[name] || 'var(--text-muted)'; }

export class AdminRolesView {
  constructor() {
    this._el = null; this._roles = []; this._views = [];
    this._tab = 'roles';                 // 'roles' | 'members'
    this._members = [];                  // [{ name, label, members: [...] }] — board + reach counts
    this._draft = new Map();             // role name → Set of view ids, only for edited roles
    this._saveErrors = new Map();        // role name → message, from the last save
    this._saving = false;
    this._editor = null;                 // { mode: 'new' } | { mode: 'edit', name }
    this._narrowRole = null;             // the one column shown on a phone
    this._detachNarrow = null;           // the phone role picker (Combobox)
    this._hscroll = null;                // the grid's sticky sideways scrollbar
    this._searchResults = [];            // add-panel search hits
    this._filter = '';                   // client-side board filter text
    this._dragUserId = null;
    this._searchSeq = 0;                 // guards against out-of-order search responses
    this._detachSearch = null;           // the member-search Combobox
    this._persisting = false;            // ignore overlapping assigns during a reconcile
    this._seq = 0;                       // stale-paint guard for _load
    this._onBeforeUnload = (e) => {
      if (!this._dirtyRoles().length) return;
      e.preventDefault();
      e.returnValue = '';
    };
  }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page disc-page';
    this._el.innerHTML = `
      <div class="disc-head">
        <h1 class="admin-title">${t('adminRoles.title')}</h1>
        <button type="button" class="btn btn--primary" id="role-new">${t('adminRoles.new')}</button>
      </div>
      <div class="role-tabs" role="tablist">
        <button type="button" class="role-tab is-active" data-tab="roles" role="tab" aria-selected="true">${t('adminRoles.tabRoles')}</button>
        <button type="button" class="role-tab" data-tab="members" role="tab" aria-selected="false">${t('adminRoles.tabMembers')}</button>
      </div>
      <p class="admin-shop__hint" id="role-hint">${t('adminRoles.hint')}</p>
      <div id="role-editor"></div>
      <div id="role-body"><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el.querySelector('#role-new').addEventListener('click', () => this._openEditor({ mode: 'new' }));
    this._el.querySelectorAll('.role-tab').forEach(btn =>
      btn.addEventListener('click', () => this._switchTab(btn.dataset.tab)));
    // One delegated listener pair on #role-body, which outlives every repaint
    // of the grid (the kit contract: repaint innerHTML, bind once).
    const body = this._el.querySelector('#role-body');
    body.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"][data-view]');
      if (cb && this._tab === 'roles') this._toggle(cb);
    });
    body.addEventListener('click', (e) => {
      if (this._tab !== 'roles') return;
      const edit = e.target.closest('[data-edit]');
      if (edit) { this._openEditor({ mode: 'edit', name: edit.dataset.edit }); return; }
      if (e.target.closest('#role-discard')) { this._draft.clear(); this._saveErrors.clear(); this._renderGrid(); return; }
      if (e.target.closest('#role-save')) this._saveAll();
    });
    window.addEventListener('beforeunload', this._onBeforeUnload);
    await this._load();
    return renderAdminShell({ activePath: '/admin/roles', content: this._el });
  }

  // Switch between the Roles (grid) and Members (assignment board) tabs.
  // "New role" + the roles hint only apply to the Roles tab.
  async _switchTab(tab) {
    if (tab === this._tab) return;
    if (this._tab === 'roles' && this._dirtyRoles().length && !confirm(t('adminRoles.unsavedLeave'))) {
      showToast(t('admin.actionCancelled'), 'info');
      return;
    }
    if (this._tab === 'roles') { this._draft.clear(); this._saveErrors.clear(); }
    this._tab = tab;
    this._editor = null;
    this._renderEditor();
    this._el.querySelectorAll('.role-tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    this._el.querySelector('#role-new').style.display = tab === 'roles' ? '' : 'none';
    this._el.querySelector('#role-hint').textContent =
      tab === 'roles' ? t('adminRoles.hint') : t('adminRoles.membersHint');
    if (tab === 'roles') await this._load();
    else await this._loadMembers();
  }

  async _load() {
    const seq = ++this._seq;
    const body = this._el.querySelector('#role-body');
    try {
      // Holders come from the Members payload: the column headers and the save
      // bar's "reaches N people" count them.
      const [data, members] = await Promise.all([listRoles(), listMembers()]);
      if (seq !== this._seq || !this._el) return;
      this._roles = orderRoles(data.roles || []);
      this._views = (data.grantableViews || []).filter(id => id !== 'roles');
      this._members = members.roles || [];
    } catch (err) {
      if (seq === this._seq) body.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
      return;
    }
    // A draft that now matches what the server holds is no longer a change.
    for (const [name, set] of this._draft) {
      const role = this._role(name);
      if (!role || sameSet(set, new Set(role.view_access || []))) this._draft.delete(name);
    }
    if (!this._narrowRole || !this._role(this._narrowRole)) {
      this._narrowRole = (this._roles.find(r => r.name !== LOCKED_ON && r.name !== LOCKED_OFF) || this._roles[0])?.name || null;
    }
    this._renderEditor();
    if (this._tab === 'roles') this._renderGrid();
  }

  _role(name) { return this._roles.find(r => r.name === name) || null; }
  _label(name) { return roleLabel(this._role(name) || name); }
  _holders(name) { return (this._members.find(r => r.name === name)?.members || []).length; }

  _current(name) {
    return this._draft.get(name) || new Set(this._role(name)?.view_access || []);
  }

  _dirtyRoles() {
    return this._roles.filter(r => this._draft.has(r.name) && !sameSet(this._draft.get(r.name), new Set(r.view_access || [])));
  }

  // ── the grid ───────────────────────────────────────────────────────────────

  _cell(role, view) {
    const cls = ['role-cell'];
    if (role.name !== this._narrowRole) cls.push('role-hide-narrow');
    const aria = t('adminRoles.cellLabel', { role: this._label(role.name), view: viewLabel(view) });
    if (role.name === LOCKED_ON) {
      return `<td class="${cls.join(' ')} role-cell--locked" data-role="${escHtml(role.name)}">
        <span class="role-lock" role="img" aria-label="${escHtml(aria)}: ${escHtml(t('adminRoles.lockedOn'))}" title="${escHtml(t('adminRoles.lockedOn'))}">✓<sup>1</sup></span></td>`;
    }
    if (role.name === LOCKED_OFF) {
      return `<td class="${cls.join(' ')} role-cell--locked" data-role="${escHtml(role.name)}">
        <span class="role-lock role-lock--off" role="img" aria-label="${escHtml(aria)}: ${escHtml(t('adminRoles.lockedOff'))}" title="${escHtml(t('adminRoles.lockedOff'))}">–<sup>1</sup></span></td>`;
    }
    const on = this._current(role.name).has(view);
    const saved = (role.view_access || []).includes(view);
    if (on !== saved) cls.push('role-cell--dirty');
    return `<td class="${cls.join(' ')}" data-role="${escHtml(role.name)}">
      <label class="role-cell__hit">
        <input type="checkbox" data-role="${escHtml(role.name)}" data-view="${escHtml(view)}" ${on ? 'checked' : ''}
          ${this._saving ? 'disabled' : ''} aria-label="${escHtml(aria)}"/>
      </label></td>`;
  }

  _colHeader(role) {
    const cls = ['role-col'];
    if (role.name !== this._narrowRole) cls.push('role-hide-narrow');
    if (this._editor?.mode === 'edit' && this._editor.name === role.name) cls.push('role-col--editing');
    const name = this._label(role.name);
    const meta = [
      role.is_system ? t('adminRoles.system') : '',
      plural(this._holders(role.name), 'adminRoles.nMembersOne', 'adminRoles.nMembers'),
    ].filter(Boolean).join(' · ');
    return `<th scope="col" class="${cls.join(' ')}" data-role="${escHtml(role.name)}">
      <span class="role-col__name">${escHtml(name)}</span>
      <span class="role-col__meta">${escHtml(meta)}</span>
      <button type="button" class="role-col__edit" data-edit="${escHtml(role.name)}"
        aria-label="${escHtml(t('adminRoles.editRole', { name }))}" title="${escHtml(t('adminRoles.editRole', { name }))}">✎</button>
    </th>`;
  }

  _renderGrid() {
    const body = this._el?.querySelector('#role-body');
    if (!body) return;
    const roles = this._roles;
    const cols = roles.length;
    const head = `<tr><th scope="col" class="role-grid__corner role-grid__sticky">${t('adminRoles.viewColumn')}</th>
      ${roles.map(r => this._colHeader(r)).join('')}</tr>`;
    const groups = groupViews(this._views).map(g => `<tbody>
      <tr class="role-grid__group"><th scope="rowgroup" class="role-grid__sticky">${escHtml(t(g.groupKey))}</th><td colspan="${cols}"></td></tr>
      ${g.ids.map(view => `<tr>
        <th scope="row" class="role-grid__sticky role-view-h">${escHtml(viewLabel(view))}</th>
        ${roles.map(r => this._cell(r, view)).join('')}
      </tr>`).join('')}
    </tbody>`).join('');

    if (this._detachNarrow) { this._detachNarrow(); this._detachNarrow = null; }
    if (this._hscroll) { this._hscroll.detach(); this._hscroll = null; }
    body.innerHTML = `
      <div class="role-narrow-pick">
        <label class="role-narrow-pick__label" for="role-narrow-input">${t('adminRoles.showRole')}</label>
        <input type="text" class="form-input" id="role-narrow-input" autocomplete="off"
               value="${escHtml(this._narrowRole ? this._label(this._narrowRole) : '')}"/>
      </div>
      <div class="role-grid-wrap" id="role-grid-wrap">
        <table class="role-grid"><thead>${head}</thead>${groups}</table>
      </div>
      <p class="role-grid__note"><sup>1</sup> ${t('adminRoles.lockFootnote')}</p>
      <div class="role-savebar" id="role-savebar" hidden>
        <div class="role-savebar__text">
          <span class="role-savebar__msg" id="role-savebar-msg" role="status" aria-live="polite"></span>
          <ul class="role-savebar__errors" id="role-savebar-errors" role="alert"></ul>
        </div>
        <div class="role-savebar__actions">
          <button type="button" class="btn btn--sm btn--ghost" id="role-discard">${t('adminRoles.discard')}</button>
          <button type="button" class="btn btn--sm btn--primary" id="role-save" ${this._saving ? 'disabled' : ''}>${t('adminRoles.saveChanges')}</button>
        </div>
      </div>`;

    // Phone: one role column at a time, picked from a Combobox (the kit picker).
    const narrow = body.querySelector('#role-narrow-input');
    this._detachNarrow = attachCombobox(
      narrow,
      () => this._roles.map(r => ({ value: r.name, label: this._label(r.name) })),
      { onPick: (entry) => this._showNarrow(entry.value) },
    );
    // Typing a name that is not a role must not leave the field lying about
    // which column is on screen.
    narrow.addEventListener('blur', () => {
      narrow.value = this._narrowRole ? this._label(this._narrowRole) : '';
    });
    this._hscroll = attachStickyHScroll(body.querySelector('#role-grid-wrap'), { label: t('adminRoles.title') });
    this._paintSaveBar();
  }

  _showNarrow(name) {
    if (!this._role(name)) return;
    this._narrowRole = name;
    this._el.querySelectorAll('#role-body [data-role]').forEach(node => {
      if (node.tagName === 'TD' || node.tagName === 'TH') {
        node.classList.toggle('role-hide-narrow', node.dataset.role !== name);
      }
    });
  }

  _toggle(cb) {
    const name = cb.dataset.role;
    if (name === LOCKED_ON || name === LOCKED_OFF) return;
    const set = new Set(this._current(name));
    if (cb.checked) set.add(cb.dataset.view); else set.delete(cb.dataset.view);
    this._draft.set(name, set);
    const saved = (this._role(name)?.view_access || []).includes(cb.dataset.view);
    cb.closest('td').classList.toggle('role-cell--dirty', cb.checked !== saved);
    this._paintSaveBar();
  }

  _paintSaveBar() {
    const bar = this._el?.querySelector('#role-savebar');
    if (!bar) return;
    const dirty = this._dirtyRoles();
    bar.hidden = dirty.length === 0 && this._saveErrors.size === 0;
    const changes = dirty.reduce((n, r) => {
      const a = this._draft.get(r.name); const b = new Set(r.view_access || []);
      return n + [...a].filter(x => !b.has(x)).length + [...b].filter(x => !a.has(x)).length;
    }, 0);
    const changesText = plural(changes, 'adminRoles.nChangesOne', 'adminRoles.nChanges');
    const peopleText = plural(reachOf(dirty.map(r => r.name), this._members), 'adminRoles.nPeopleOne', 'adminRoles.nPeople');
    bar.querySelector('#role-savebar-msg').textContent = !dirty.length ? ''
      : dirty.length === 1
        ? t('adminRoles.saveBarOne', { changes: changesText, role: this._label(dirty[0].name), people: peopleText })
        : t('adminRoles.saveBar', { changes: changesText, roles: dirty.length, people: peopleText });
    bar.querySelector('#role-savebar-errors').innerHTML = [...this._saveErrors]
      .map(([name, msg]) => `<li>${escHtml(t('adminRoles.saveFailed', { role: this._label(name), error: msg }))}</li>`).join('');
  }

  // One PATCH per changed role, through the existing (audited, role.updated)
  // update endpoint. A role's full set is sent — including any view of a
  // switched-off module it already held, which the grid does not show and so
  // could never have changed (the grant sleeps until the module is back).
  async _saveAll() {
    const dirty = this._dirtyRoles();
    if (!dirty.length || this._saving) return;
    this._saving = true;
    this._saveErrors.clear();
    this._renderGrid(); // disables the boxes: a tick during the save would be lost
    for (const r of dirty) {
      const offered = this._views.filter(v => this._draft.get(r.name).has(v));
      const kept = (r.view_access || []).filter(v => !this._views.includes(v));
      try {
        await updateRole(r.name, { view_access: [...kept, ...offered] });
        this._draft.delete(r.name);
      } catch (err) {
        this._saveErrors.set(r.name, err.message);
      }
    }
    this._saving = false;
    if (!this._saveErrors.size) showToast(t('form.saved'), 'success');
    await this._load(); // keeps the failed roles' drafts (see _load)
  }

  // ── new / edit ─────────────────────────────────────────────────────────────

  _openEditor(editor) {
    this._editor = editor;
    this._renderEditor();
    if (this._tab === 'roles') this._renderGrid();
    const box = this._el.querySelector('#role-editor');
    (box.querySelector('input') || box.querySelector('.role-editor__title'))?.focus();
  }

  _closeEditor() {
    const back = this._editor?.mode === 'edit' ? this._editor.name : null;
    this._editor = null;
    this._renderEditor();
    if (this._tab === 'roles') this._renderGrid();
    const target = back
      ? this._el.querySelector(`[data-edit="${CSS.escape(back)}"]`)
      : this._el.querySelector('#role-new');
    target?.focus();
  }

  _renderEditor() {
    const box = this._el?.querySelector('#role-editor');
    if (!box) return;
    if (!this._editor) { box.innerHTML = ''; return; }
    const isNew = this._editor.mode === 'new';
    const role = isNew ? null : this._role(this._editor.name);
    if (!isNew && !role) { this._editor = null; box.innerHTML = ''; return; }
    const title = isNew ? t('adminRoles.new') : t('adminRoles.editTitle', { name: this._label(role.name) });
    // The built-in roles are named by i18n in both languages — their name is
    // not editable (the server refuses it too).
    const nameField = isNew || !role.is_system
      ? `<label class="role-editor__field"><span>${t('adminRoles.name')}</span>
           <input class="form-input" id="role-ed-label" type="text" maxlength="30" autocomplete="off"
             placeholder="${escHtml(t('adminRoles.namePlaceholder'))}" value="${escHtml(isNew ? '' : (role.label || ''))}"
             aria-describedby="role-ed-name-hint"/></label>
         <p class="role-editor__note" id="role-ed-name-hint">${t('adminRoles.nameHint')}</p>`
      : `<p class="role-editor__note">${t('adminRoles.builtInNameNote')}</p>`;
    const held = role ? this._holders(role.name) : 0;
    const del = !isNew && !role.is_system ? `
      <button type="button" class="btn btn--sm btn--danger" id="role-ed-delete"${held ? ' disabled aria-describedby="role-ed-del-note"' : ''}>${t('admin.delete')}</button>
      ${held ? `<span class="role-editor__note" id="role-ed-del-note">${escHtml(t('adminRoles.deleteBlocked', { n: held }))}</span>` : ''}` : '';
    box.innerHTML = `
      <section class="role-editor" role="group" aria-label="${escHtml(title)}">
        <h2 class="role-editor__title" tabindex="-1">${escHtml(title)}</h2>
        ${nameField}
        <label class="role-editor__field"><span>${t('adminRoles.description')}</span>
          <input class="form-input" id="role-ed-desc" type="text" maxlength="200" value="${escHtml(isNew ? '' : (role.description || ''))}"/></label>
        <p class="admin-shop__error" id="role-ed-error" role="alert"></p>
        <div class="role-editor__actions">
          ${del}
          <span class="role-editor__spacer"></span>
          <button type="button" class="btn btn--sm btn--ghost" id="role-ed-cancel">${t('admin.cancel')}</button>
          <button type="button" class="btn btn--sm btn--primary" id="role-ed-save">${isNew ? t('adminRoles.create') : t('form.save')}</button>
        </div>
      </section>`;
    box.querySelector('#role-ed-cancel').addEventListener('click', () => this._closeEditor());
    box.querySelector('.role-editor').addEventListener('keydown', (e) => { if (e.key === 'Escape') this._closeEditor(); });
    box.querySelector('#role-ed-save').addEventListener('click', () => (isNew ? this._create(box) : this._saveEdit(box, role)));
    box.querySelector('#role-ed-delete')?.addEventListener('click', () => this._delete(box, role));
  }

  async _create(box) {
    const label = box.querySelector('#role-ed-label').value.trim();
    const description = box.querySelector('#role-ed-desc').value.trim();
    const errEl = box.querySelector('#role-ed-error');
    errEl.textContent = '';
    try {
      const role = await createRole({ label, description, view_access: [] });
      // The server's cleaned name, not the typed one (it drops invisible characters).
      showToast(t('adminRoles.created', { name: role?.label || label }), 'success');
      this._editor = null;
      this._narrowRole = role?.name || this._narrowRole;
      await this._load();
      if (role) this._el.querySelector(`[data-edit="${CSS.escape(role.name)}"]`)?.focus();
    } catch (err) { errEl.textContent = err.message; }
  }

  async _saveEdit(box, role) {
    const payload = { description: box.querySelector('#role-ed-desc').value.trim() };
    // Only a changed name is sent: re-sending an unchanged one would be judged
    // (and could be refused) as a new name.
    const labelEl = box.querySelector('#role-ed-label');
    if (labelEl && labelEl.value.trim() && labelEl.value.trim() !== (role.label || '')) payload.label = labelEl.value.trim();
    const errEl = box.querySelector('#role-ed-error');
    errEl.textContent = '';
    try {
      await updateRole(role.name, payload);
      showToast(t('form.saved'), 'success');
      this._editor = null;
      await this._load();
      this._el.querySelector(`[data-edit="${CSS.escape(role.name)}"]`)?.focus();
    } catch (err) { errEl.textContent = err.message; }
  }

  async _delete(box, role) {
    if (!confirm(t('adminRoles.confirmDelete', { name: this._label(role.name) }))) {
      showToast(t('admin.actionCancelled'), 'info');
      return;
    }
    const errEl = box.querySelector('#role-ed-error');
    errEl.textContent = '';
    try {
      await deleteRole(role.name);
      showToast(t('form.success'), 'success');
      this._editor = null;
      this._draft.delete(role.name);
      await this._load();
      this._el.querySelector('#role-new')?.focus();
    } catch (err) { errEl.textContent = err.message; }
  }

  // ── Members tab (multi-role assignment board) ─────────────────────────────────

  async _loadMembers() {
    const body = this._el.querySelector('#role-body');
    if (this._detachNarrow) { this._detachNarrow(); this._detachNarrow = null; }
    if (this._hscroll) { this._hscroll.detach(); this._hscroll = null; }
    body.innerHTML = `<div class="admin-loading">${t('form.loading')}</div>`;
    try {
      const data = await listMembers();
      this._members = orderRoles(data.roles || []);
      this._paintMembers();
    } catch (err) {
      body.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }

  // Build the static Members shell once (search panel + filter + board host) and
  // bind its handlers. Re-rendering only swaps the board's columns (_renderBoard),
  // so the search box keeps its value/focus across assignments.
  _paintMembers() {
    const body = this._el.querySelector('#role-body');
    body.innerHTML = `
      <div class="role-members" id="role-members">
        <div class="role-members__search">
          <input type="search" id="member-search" class="form-input" autocomplete="off"
                 placeholder="${escHtml(t('adminRoles.searchPlaceholder'))}"/>
          <div class="role-search__results" id="member-search-results"></div>
        </div>
        <div class="role-members__filter">
          <input type="search" id="member-filter" class="form-input" autocomplete="off"
                 placeholder="${escHtml(t('adminRoles.filterPlaceholder'))}" value="${escHtml(this._filter)}"/>
        </div>
        <p class="role-members__hint">${t('adminRoles.dragHint')}</p>
        <div class="role-board" id="role-board"></div>
      </div>`;
    this._bindMembers(body.querySelector('#role-members'));
    this._renderBoard();
  }

  _renderBoard() {
    const board = this._el.querySelector('#role-board');
    if (!board) return;
    board.innerHTML = this._members.map(r => this._column(r)).join('');
  }

  _column(role) {
    const members = this._filteredMembers(role.members);
    return `
      <section class="role-column" data-role-name="${escHtml(role.name)}" style="--role-accent:${roleAccent(role.name)}">
        <header class="role-column__head">
          <span class="role-column__name">${escHtml(roleLabel(role))}</span>
          <span class="role-column__count">${escHtml(t('adminRoles.memberCount', { n: role.members.length }))}</span>
        </header>
        <div class="role-column__body">
          ${members.length
            ? members.map(m => this._memberCard(role.name, m)).join('')
            : `<p class="role-column__empty">${t('adminRoles.noMembers')}</p>`}
        </div>
      </section>`;
  }

  _memberCard(roleName, m) {
    const name = m.display_name || m.username || m.id;
    return `
      <div class="role-member" draggable="true" data-user-id="${escHtml(String(m.id))}">
        <img class="role-member__avatar" src="${escHtml(avatarPathByName(m.avatar))}" alt="" loading="lazy"/>
        <div class="role-member__info">
          <span class="role-member__name">${escHtml(name)}${m.is_primary ? ` <span class="role-member__primary">${t('adminRoles.primary')}</span>` : ''}</span>
          <span class="role-member__email">${escHtml(m.email || '')}</span>
        </div>
        <button type="button" class="role-member__remove" data-remove="${escHtml(roleName)}" data-user="${escHtml(String(m.id))}"
                aria-label="${escHtml(t('adminRoles.removeMember'))}" title="${escHtml(t('adminRoles.removeMember'))}">✕</button>
      </div>`;
  }

  _searchChip(u) {
    const name = u.display_name || u.username || u.id;
    return `
      <div class="role-chip-user" draggable="true" data-user-id="${escHtml(String(u.id))}" title="${escHtml(u.email || '')}">
        <img class="role-chip-user__avatar" src="${escHtml(avatarPathByName(u.avatar))}" alt="" loading="lazy"/>
        <span class="role-chip-user__name">${escHtml(name)}</span>
      </div>`;
  }

  _filteredMembers(members) {
    const q = this._filter.trim().toLowerCase();
    if (!q) return members;
    return members.filter(m =>
      String(m.display_name || '').toLowerCase().includes(q) ||
      String(m.username || '').toLowerCase().includes(q) ||
      String(m.email || '').toLowerCase().includes(q) ||
      String(m.id || '').toLowerCase().includes(q));
  }

  _bindMembers(root) {
    // Server search → the shared Combobox (a real listbox with arrow keys and
    // aria-activedescendant instead of a bare div of chips; Ported from
    // icelandicstore #351 — async source, debounceMs, minQuery, meta). Picking a
    // person puts them in the panel as ONE draggable chip, which is dropped on a
    // role column exactly as before.
    if (this._detachSearch) this._detachSearch();
    this._detachSearch = attachCombobox(
      root.querySelector('#member-search'),
      (query) => this._runSearch(query),
      {
        debounceMs: 250,
        minQuery: 1,
        onPick: (entry) => this._showPicked(entry.value),
      },
    );
    // minQuery means an emptied field never reaches the source, so clear a
    // stale "no results" / error note here (and outrun any search in flight).
    root.querySelector('#member-search').addEventListener('input', (e) => {
      if (String(e.target.value || '').trim()) return;
      this._searchSeq += 1;
      const box = this._el.querySelector('#member-search-results');
      if (box && !box.querySelector('[data-user-id]')) box.innerHTML = '';
    });

    // Client-side board filter (debounced) — narrows cards already shown.
    root.querySelector('#member-filter').addEventListener('input', (e) => {
      clearTimeout(this._filterDebounce);
      const v = e.target.value;
      this._filterDebounce = setTimeout(() => { this._filter = v; this._renderBoard(); }, 200);
    });

    // Remove (✕) — delegated.
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (btn) this._remove(btn.dataset.remove, btn.dataset.user);
    });

    // Drag-and-drop: member cards + search chips are sources; role columns are
    // drop targets. Dropping onto a column ADDS that role (removal is the ✕).
    root.addEventListener('dragstart', (e) => {
      const item = e.target.closest('[data-user-id]');
      if (!item) return;
      this._dragUserId = item.dataset.userId;
      e.dataTransfer.effectAllowed = 'copy';
      try { e.dataTransfer.setData('text/plain', this._dragUserId); } catch { /* ignore */ }
      item.classList.add('is-dragging');
    });
    root.addEventListener('dragend', (e) => {
      e.target.closest?.('[data-user-id]')?.classList.remove('is-dragging');
      this._clearDropMarks(root);
      this._dragUserId = null;
    });
    root.addEventListener('dragover', (e) => {
      if (!this._dragUserId) return;
      const col = e.target.closest('.role-column');
      if (!col) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this._clearDropMarks(root);
      col.classList.add('role-column--drop');
    });
    root.addEventListener('drop', (e) => {
      if (!this._dragUserId) return;
      const col = e.target.closest('.role-column');
      this._clearDropMarks(root);
      if (!col) return;
      e.preventDefault();
      const userId = this._dragUserId;
      this._dragUserId = null;
      this._assign(col.dataset.roleName, userId);
    });
  }

  _clearDropMarks(root) {
    root.querySelectorAll('.role-column--drop').forEach(c => c.classList.remove('role-column--drop'));
  }

  // The Combobox source: the server's hits as { value: id, label: name, meta:
  // email }. The server matches on name, username and email, and the combobox
  // re-ranks on the label, so username and email ride along as hidden keywords
  // or an email-only hit would be dropped. The combobox discards a stale answer
  // itself; the sequence guard covers the side effects here (results cache, the
  // empty/error note).
  async _runSearch(q) {
    const box = this._el.querySelector('#member-search-results');
    const term = String(q || '').trim();
    if (!term) { this._searchResults = []; if (box) box.innerHTML = ''; return []; }
    const seq = ++this._searchSeq; // a newer search supersedes this one
    try {
      const results = await searchUsers(term);
      if (seq !== this._searchSeq) return []; // stale response — discard
      this._searchResults = results;
      if (box) {
        box.innerHTML = results.length
          ? ''
          : `<p class="role-search__empty">${t('adminRoles.searchNoResults')}</p>`;
      }
      return results.map(u => ({
        value: String(u.id),
        label: u.display_name || u.username || String(u.id),
        meta: u.email || '',
        keywords: [u.username, u.email, String(u.id)].filter(Boolean),
      }));
    } catch (err) {
      if (seq !== this._searchSeq) return [];
      if (box) box.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
      return [];
    }
  }

  // The picked person as one draggable chip, the drag source for a role column.
  // Bumping the sequence first makes any search still in flight (a newer query
  // waiting on its debounce or its response) stale, so it cannot wipe the chip.
  _showPicked(userId) {
    this._searchSeq += 1;
    const box = this._el.querySelector('#member-search-results');
    const user = this._searchResults.find(u => String(u.id) === String(userId));
    if (box && user) box.innerHTML = this._searchChip(user);
  }

  _findUser(userId) {
    const id = String(userId);
    for (const r of this._members) {
      const hit = r.members.find(m => String(m.id) === id);
      if (hit) return hit;
    }
    return this._searchResults.find(u => String(u.id) === id) || null;
  }

  async _assign(roleName, userId) {
    const role = this._members.find(r => r.name === roleName);
    if (!role) return;
    if (role.members.some(m => String(m.id) === String(userId))) {
      showToast(t('adminRoles.alreadyMember'), 'info');
      return;
    }
    const user = this._findUser(userId);
    if (!user) return;
    await this._persist(
      () => { role.members.push({ ...user, is_primary: false }); },
      () => addMember(roleName, userId),
      t('adminRoles.added', { role: roleLabel(role) }),
    );
  }

  async _remove(roleName, userId) {
    const role = this._members.find(r => r.name === roleName);
    if (!role) return;
    await this._persist(
      () => { role.members = role.members.filter(m => String(m.id) !== String(userId)); },
      () => removeMember(roleName, userId),
      t('adminRoles.removed', { role: roleLabel(role) }),
    );
  }

  // Optimistically apply `mutate`, persist via `api`, then reconcile from the
  // server (primary-repoint + counts). Rolls back to the snapshot on failure.
  // Ignores overlapping calls while a reconcile is in flight so a second drop
  // can't snapshot a half-updated board (the reconcile converges either way).
  async _persist(mutate, api, successMsg) {
    if (this._persisting) return;
    this._persisting = true;
    const snapshot = JSON.parse(JSON.stringify(this._members));
    mutate();
    this._renderBoard();
    try {
      await api();
      const data = await listMembers();
      this._members = orderRoles(data.roles || []);
      this._renderBoard();
      if (successMsg) showToast(successMsg, 'success');
    } catch (err) {
      this._members = snapshot;
      this._renderBoard();
      showToast(err.message, 'error');
    } finally {
      this._persisting = false;
    }
  }

  destroy() {
    this._seq += 1;
    this._searchSeq += 1;
    clearTimeout(this._filterDebounce);
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    if (this._detachSearch) { this._detachSearch(); this._detachSearch = null; }
    if (this._detachNarrow) { this._detachNarrow(); this._detachNarrow = null; }
    if (this._hscroll) { this._hscroll.detach(); this._hscroll = null; }
  }
}
