// AdminRolesView (/admin/roles) — create/edit dynamic roles + choose which admin
// views each role may access. Admin-only (managing roles is a meta-permission).
// Mirrors AdminCollectionsView (list + modal CRUD + admin shell).
import { isAuthenticated, isAdmin } from '../services/auth.js';
import { listRoles, createRole, updateRole, deleteRole,
         listMembers, addMember, removeMember, searchUsers } from '../services/adminRoles.js';
import { escHtml } from '../utils/escHtml.js';
import { avatarPathByName } from '../utils/avatar.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell, ADMIN_NAV } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';

// Map each admin view id → its sidebar group (i18n key + nav order) so the roles
// page can present view-access grouped the same way as the sidebar.
const VIEW_GROUP = (() => {
  const m = new Map();
  ADMIN_NAV.forEach((g, order) => g.items.forEach(it => m.set(it.id, { groupKey: g.group, order })));
  return m;
})();

// Group view ids into [{ groupKey, order, ids[] }] in sidebar order.
function groupViews(ids) {
  const buckets = new Map();
  ids.forEach(id => {
    const g = VIEW_GROUP.get(id) || { groupKey: 'adminRoles.views', order: 99 };
    if (!buckets.has(g.groupKey)) buckets.set(g.groupKey, { groupKey: g.groupKey, order: g.order, ids: [] });
    buckets.get(g.groupKey).ids.push(id);
  });
  return [...buckets.values()].sort((a, b) => a.order - b.order);
}

// A subtle per-role accent for the card's left border + icon disc.
const ROLE_ACCENT = { admin: 'var(--gold)', moderator: '#5cb5e0', user: 'var(--text-secondary)' };
function roleAccent(name) { return ROLE_ACCENT[name] || 'var(--text-muted)'; }

export class AdminRolesView {
  constructor() {
    this._el = null; this._roles = []; this._views = [];
    this._tab = 'roles';                 // 'roles' | 'members'
    this._members = [];                  // [{ name, members: [...] }] for the board
    this._searchResults = [];            // add-panel search hits
    this._filter = '';                   // client-side board filter text
    this._dragUserId = null;
    this._searchSeq = 0;                 // guards against out-of-order search responses
    this._persisting = false;            // ignore overlapping assigns during a reconcile
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
        <button type="button" class="role-tab is-active" data-tab="roles" role="tab">${t('adminRoles.tabRoles')}</button>
        <button type="button" class="role-tab" data-tab="members" role="tab">${t('adminRoles.tabMembers')}</button>
      </div>
      <p class="admin-shop__hint" id="role-hint">${t('adminRoles.hint')}</p>
      <div id="role-body"><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el.querySelector('#role-new').addEventListener('click', () => this._openForm());
    this._el.querySelectorAll('.role-tab').forEach(btn =>
      btn.addEventListener('click', () => this._switchTab(btn.dataset.tab)));
    await this._load();
    return renderAdminShell({ activePath: '/admin/roles', content: this._el });
  }

  // Switch between the Roles (definitions) and Members (assignment board) tabs.
  // "New role" + the roles hint only apply to the Roles tab.
  _switchTab(tab) {
    if (tab === this._tab) return;
    this._tab = tab;
    this._el.querySelectorAll('.role-tab').forEach(b =>
      b.classList.toggle('is-active', b.dataset.tab === tab));
    this._el.querySelector('#role-new').style.display = tab === 'roles' ? '' : 'none';
    this._el.querySelector('#role-hint').textContent =
      tab === 'roles' ? t('adminRoles.hint') : t('adminRoles.membersHint');
    if (tab === 'roles') this._paint();
    else this._loadMembers();
  }

  async _load() {
    const body = this._el.querySelector('#role-body');
    try {
      const data = await listRoles();
      this._roles = data.roles || [];
      this._views = data.grantableViews || [];
      this._paint();
    } catch (err) {
      body.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }

  _paint() {
    const body = this._el.querySelector('#role-body');
    body.innerHTML = `<div class="role-cards">${this._roles.map(r => this._roleCard(r)).join('')}</div>`;
    body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      const r = this._roles.find(x => x.name === b.dataset.edit);
      if (r) this._openForm(r);
    }));
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => this._confirmDelete(b.dataset.del)));
  }

  // One collapsible card per role: summary (name, system badge, view count, chip
  // preview) + body (description, view-access grouped by sidebar section, actions).
  _roleCard(r) {
    const ids = Array.isArray(r.view_access) ? r.view_access : [];
    const all = ids.includes('*');
    const accent = roleAccent(r.name);
    const count = all
      ? t('adminRoles.allViews')
      : (ids.length ? t('adminRoles.viewCount', { n: ids.length }) : t('adminRoles.noViews'));
    const chips = all
      ? `<span class="role-chip role-chip--all">${escHtml(t('adminRoles.allViews'))}</span>`
      : ids.slice(0, 4).map(id => `<span class="role-chip">${escHtml(t('admin.nav.' + id))}</span>`).join('')
        + (ids.length > 4 ? `<span class="role-chip role-chip--more">+${ids.length - 4}</span>` : '');
    const grouped = groupViews(ids).map(g => `
      <div class="role-card__group">
        <p class="role-card__group-title">${escHtml(t(g.groupKey))}</p>
        <div class="role-card__group-views">
          ${g.ids.map(id => `<span class="role-chip">${escHtml(t('admin.nav.' + id))}</span>`).join('')}
        </div>
      </div>`).join('');
    const bodyViews = all
      ? `<p class="admin-shop__hint">${t('adminRoles.allViewsNote')}</p>`
      : (ids.length ? grouped : `<p class="admin-shop__hint">${t('adminRoles.noViews')}</p>`);
    return `
      <details class="role-card" data-name="${escHtml(r.name)}" style="--role-accent:${accent}">
        <summary class="role-card__summary">
          <span class="role-card__icon" aria-hidden="true">${escHtml(r.name.charAt(0).toUpperCase())}</span>
          <span class="role-card__name"><code>${escHtml(r.name)}</code>${r.is_system ? ` <span class="role-card__badge">${t('adminRoles.system')}</span>` : ''}</span>
          <span class="role-card__chips">${chips}</span>
          <span class="role-card__count">${escHtml(count)}</span>
        </summary>
        <div class="role-card__body">
          ${r.description ? `<p class="role-card__desc">${escHtml(r.description)}</p>` : ''}
          ${bodyViews}
          <div class="role-card__actions">
            <button type="button" class="btn btn--sm btn--ghost" data-edit="${escHtml(r.name)}">${t('admin.edit')}</button>
            ${r.is_system ? '' : `<button type="button" class="btn btn--sm btn--danger" data-del="${escHtml(r.name)}">${t('admin.delete')}</button>`}
          </div>
        </div>
      </details>`;
  }

  async _confirmDelete(name) {
    if (!confirm(t('adminRoles.confirmDelete', { name }))) return;
    try {
      await deleteRole(name);
      showToast(t('form.success'), 'success');
      await this._load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  _openForm(existing = null) {
    const isEdit = !!existing;
    const isAdminRole = existing?.name === 'admin';
    const allAccess = Array.isArray(existing?.view_access) && existing.view_access.includes('*');
    const checked = new Set(Array.isArray(existing?.view_access) ? existing.view_access : []);
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card">
        <header>
          <h2>${isEdit ? t('adminRoles.edit') : t('adminRoles.new')}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
        </header>
        <form class="admin-shop__form" id="role-form">
          <label>${t('adminRoles.name')}
            <input type="text" name="name" required maxlength="32" pattern="[a-z0-9_-]{2,32}"
                   value="${escHtml(existing?.name || '')}" ${isEdit ? 'disabled' : ''}/>
          </label>
          <label>${t('adminRoles.description')}
            <input type="text" name="description" maxlength="200" value="${escHtml(existing?.description || '')}"/>
          </label>
          <fieldset class="role-views">
            <legend>${t('adminRoles.views')}</legend>
            ${allAccess
              ? `<p class="admin-shop__hint">${t('adminRoles.allViewsNote')}</p>`
              : groupViews(this._views).map(g => `
                <div class="role-views__group">
                  <p class="role-views__group-title">${escHtml(t(g.groupKey))}</p>
                  ${g.ids.map(id => `
                    <label class="admin-shop__checkbox">
                      <input type="checkbox" name="view" value="${escHtml(id)}" ${checked.has(id) ? 'checked' : ''}/>
                      ${escHtml(t('admin.nav.' + id))}
                    </label>`).join('')}
                </div>`).join('')}
          </fieldset>
          <p class="admin-shop__error" id="role-error" role="alert"></p>
          <div class="admin-shop__form-actions">
            <button type="submit" class="btn btn--primary">${isEdit ? t('form.save') : t('form.create')}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    const errorEl = modal.querySelector('#role-error');

    modal.querySelector('#role-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const fd = new FormData(e.target);
      const body = { description: String(fd.get('description') || '').trim() };
      // The admin role's access is fixed at "all" — only its description is editable.
      if (!isAdminRole) body.view_access = fd.getAll('view');
      try {
        if (isEdit) await updateRole(existing.name, body);
        else        await createRole({ name: String(fd.get('name') || '').trim(), ...body });
        close();
        showToast(t('form.saved'), 'success');
        await this._load();
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  }

  // ── Members tab (multi-role assignment board) ─────────────────────────────────

  async _loadMembers() {
    const body = this._el.querySelector('#role-body');
    body.innerHTML = `<div class="admin-loading">${t('form.loading')}</div>`;
    try {
      const data = await listMembers();
      this._members = data.roles || [];
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
          <span class="role-column__name"><code>${escHtml(role.name)}</code></span>
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
    // Server search (debounced) → draggable result chips.
    root.querySelector('#member-search').addEventListener('input', (e) => {
      clearTimeout(this._searchDebounce);
      const v = e.target.value;
      this._searchDebounce = setTimeout(() => this._runSearch(v), 250);
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

  async _runSearch(q) {
    const box = this._el.querySelector('#member-search-results');
    if (!box) return;
    const term = q.trim();
    if (!term) { this._searchResults = []; box.innerHTML = ''; return; }
    const seq = ++this._searchSeq; // a newer search supersedes this one
    try {
      const results = await searchUsers(term);
      if (seq !== this._searchSeq) return; // stale response — discard
      this._searchResults = results;
      box.innerHTML = results.length
        ? results.map(u => this._searchChip(u)).join('')
        : `<p class="role-search__empty">${t('adminRoles.searchNoResults')}</p>`;
    } catch (err) {
      if (seq !== this._searchSeq) return;
      box.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
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
      t('adminRoles.added', { role: roleName }),
    );
  }

  async _remove(roleName, userId) {
    const role = this._members.find(r => r.name === roleName);
    if (!role) return;
    await this._persist(
      () => { role.members = role.members.filter(m => String(m.id) !== String(userId)); },
      () => removeMember(roleName, userId),
      t('adminRoles.removed', { role: roleName }),
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
      this._members = data.roles || [];
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

  destroy() {}
}
