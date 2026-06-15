// AdminRolesView (/admin/roles) — create/edit dynamic roles + choose which admin
// views each role may access. Admin-only (managing roles is a meta-permission).
// Mirrors AdminCollectionsView (list + modal CRUD + admin shell).
import { isAuthenticated, isAdmin } from '../services/auth.js';
import { listRoles, createRole, updateRole, deleteRole } from '../services/adminRoles.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';

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

  _viewsLabel(role) {
    const ids = Array.isArray(role.view_access) ? role.view_access : [];
    if (ids.includes('*')) return t('adminRoles.allViews');
    if (!ids.length) return '—';
    return ids.map(id => t('admin.nav.' + id)).join(', ');
  }

  _paint() {
    const body = this._el.querySelector('#role-body');
    body.innerHTML = `
      <table class="admin-table disc-table">
        <thead><tr>
          <th>${t('adminRoles.name')}</th>
          <th>${t('adminRoles.views')}</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${this._roles.map(r => `
            <tr data-name="${escHtml(r.name)}">
              <td><code>${escHtml(r.name)}</code>${r.is_system ? ` <span class="disc-title">(${t('adminRoles.system')})</span>` : ''}${r.description ? `<div class="disc-title">${escHtml(r.description)}</div>` : ''}</td>
              <td>${escHtml(this._viewsLabel(r))}</td>
              <td>
                <button type="button" class="btn btn--sm btn--ghost" data-edit="${escHtml(r.name)}">${t('admin.edit')}</button>
                ${r.is_system ? '' : `<button type="button" class="btn btn--sm btn--danger" data-del="${escHtml(r.name)}">${t('admin.delete')}</button>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      const r = this._roles.find(x => x.name === b.dataset.edit);
      if (r) this._openForm(r);
    }));
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => this._confirmDelete(b.dataset.del)));
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
              : this._views.map(id => `
                <label class="admin-shop__checkbox">
                  <input type="checkbox" name="view" value="${escHtml(id)}" ${checked.has(id) ? 'checked' : ''}/>
                  ${escHtml(t('admin.nav.' + id))}
                </label>`).join('')}
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
