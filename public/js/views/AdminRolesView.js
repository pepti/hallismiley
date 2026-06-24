// AdminRolesView (/admin/roles) — create/edit dynamic roles + choose which admin
// views each role may access. Admin-only (managing roles is a meta-permission).
// Mirrors AdminCollectionsView (list + modal CRUD + admin shell).
import { isAuthenticated, isAdmin } from '../services/auth.js';
import { listRoles, createRole, updateRole, deleteRole } from '../services/adminRoles.js';
import { escHtml } from '../utils/escHtml.js';
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
  constructor() { this._el = null; this._roles = []; this._views = []; }

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
      <p class="admin-shop__hint">${t('adminRoles.hint')}</p>
      <div id="role-body"><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el.querySelector('#role-new').addEventListener('click', () => this._openForm());
    await this._load();
    return renderAdminShell({ activePath: '/admin/roles', content: this._el });
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

  destroy() {}
}
