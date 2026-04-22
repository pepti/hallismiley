import { isAuthenticated, isAdmin, adminGetUsers, adminUpdateUser, adminDeleteUser } from '../services/auth.js';
import { showToast }     from '../components/Toast.js';
import { escHtml }       from '../utils/escHtml.js';
import { avatarPathByName } from '../utils/avatar.js';
import { t, href }       from '../i18n/i18n.js';

const PAGE_SIZE = 20;

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export class AdminUsersView {
  constructor() {
    this._page  = 1;
    this._total = 0;
  }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      window.location.hash = href('/');
      return document.createTextNode('');
    }

    const el = document.createElement('div');
    el.className = 'main admin-page';
    el.innerHTML = `
      <div class="admin-header">
        <div>
          <p class="admin-eyebrow">${t('admin.dashboard')}</p>
          <h1 class="admin-title">${t('adminUsers.title')}</h1>
        </div>
        <a href="${href('/admin')}" class="btn btn--outline" data-route="/admin">← ${t('admin.projects')}</a>
      </div>
      <div class="admin-table-wrap" id="users-table-wrap">
        <div class="admin-loading">${t('form.loading')}</div>
      </div>
      <div class="pagination" id="pagination"></div>
    `;

    this._el = el;
    await this._load();
    return el;
  }

  async _load() {
    const wrap = this._el.querySelector('#users-table-wrap');
    wrap.innerHTML = `<div class="admin-loading">${t('form.loading')}</div>`;
    try {
      const data  = await adminGetUsers({ page: this._page, limit: PAGE_SIZE });
      const users = Array.isArray(data) ? data : (data.users || []);
      this._total = data.total || users.length;
      this._renderTable(users);
      this._renderPagination();
    } catch (err) {
      wrap.innerHTML = `<p class="admin-error">${t('form.error')}: ${escHtml(err.message)}</p>`;
    }
  }

  _renderTable(users) {
    const wrap = this._el.querySelector('#users-table-wrap');

    if (!users.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">👤</div>
          <p>${t('adminUsers.title')}: ${t('admin.noUsers')}</p>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="admin-table admin-users-table">
        <thead>
          <tr>
            <th>${t('adminUsers.username')}</th>
            <th>${t('adminUsers.email')}</th>
            <th>${t('adminUsers.role')}</th>
            <th>${t('adminUsers.verified')}</th>
            <th>${t('adminUsers.status')}</th>
            <th>Party</th>
            <th>${t('orders.date')}</th>
            <th class="admin-table__actions-col">${t('adminUsers.actions')}</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr data-user-id="${escHtml(String(u.id))}">
              <td class="user-cell">
                <img class="user-avatar-sm" src="${avatarPathByName(u.avatar)}"
                     alt="${escHtml(u.username)}" loading="lazy"/>
                <span class="user-username">${escHtml(u.username)}</span>
                ${u.display_name ? `<span class="user-displayname">${escHtml(u.display_name)}</span>` : ''}
              </td>
              <td class="user-email">${escHtml(u.email)}</td>
              <td>
                <select class="form-input form-input--sm role-select" data-user-id="${escHtml(String(u.id))}" data-action="role">
                  <option value="user"      ${u.role === 'user'      ? 'selected' : ''}>${t('adminUsers.setRole')} — user</option>
                  <option value="moderator" ${u.role === 'moderator' ? 'selected' : ''}>moderator</option>
                  <option value="admin"     ${u.role === 'admin'     ? 'selected' : ''}>admin</option>
                </select>
              </td>
              <td>
                ${u.email_verified
                  ? `<span class="verified-badge">✓ ${t('adminUsers.verified')}</span>`
                  : `<span class="unverified-badge">✗ ${t('adminUsers.unverified')}</span>`}
              </td>
              <td>
                <label class="toggle-label" title="${u.disabled ? t('adminUsers.enable') : t('adminUsers.disable')}">
                  <input type="checkbox" class="toggle-input" data-action="toggle-disabled"
                         data-user-id="${escHtml(String(u.id))}" ${u.disabled ? '' : 'checked'}/>
                  <span class="toggle-track"></span>
                  <span class="toggle-text">${u.disabled ? t('adminUsers.disabled') : t('adminUsers.active')}</span>
                </label>
              </td>
              <td>
                <label class="toggle-label" title="${u.party_access ? t('adminUsers.revokePartyAccess') : t('adminUsers.grantPartyAccess')}">
                  <input type="checkbox" class="toggle-input" data-action="toggle-party"
                         data-user-id="${escHtml(String(u.id))}" ${u.party_access ? 'checked' : ''}/>
                  <span class="toggle-track"></span>
                  <span class="toggle-text">${u.party_access ? '🎂 On' : 'Off'}</span>
                </label>
              </td>
              <td class="user-joined">${formatDate(u.created_at)}</td>
              <td class="admin-table__actions">
                <span class="user-id-badge">#${escHtml(String(u.id))}</span>
                ${u.role !== 'admin' ? `
                <button class="btn btn--sm btn--danger delete-user-btn"
                        data-user-id="${escHtml(String(u.id))}"
                        data-username="${escHtml(u.username)}"
                        title="${t('admin.delete')}">${t('admin.delete')}</button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll('[data-action=role]').forEach(sel => {
      sel.dataset.prevRole = sel.value;
      sel.addEventListener('change', () => this._onRoleChange(sel));
    });

    wrap.querySelectorAll('[data-action=toggle-disabled]').forEach(chk => {
      chk.addEventListener('change', () => this._onToggleDisabled(chk));
    });

    wrap.querySelectorAll('[data-action=toggle-party]').forEach(chk => {
      chk.addEventListener('change', () => this._onTogglePartyAccess(chk));
    });

    wrap.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', () => this._onDeleteUser(btn));
    });
  }

  async _onTogglePartyAccess(checkbox) {
    const userId  = checkbox.dataset.userId;
    const enabled = checkbox.checked;
    const textEl  = checkbox.closest('label').querySelector('.toggle-text');
    try {
      await adminUpdateUser(userId, { party_access: enabled });
      if (textEl) textEl.textContent = enabled ? '🎂 On' : 'Off';
      showToast(t('form.success'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
      checkbox.checked = !checkbox.checked;
    }
  }

  async _onRoleChange(select) {
    const userId   = select.dataset.userId;
    const newRole  = select.value;
    const prevRole = select.dataset.prevRole;
    try {
      await adminUpdateUser(userId, { role: newRole });
      select.dataset.prevRole = newRole;
      showToast(t('form.success'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
      select.value = prevRole;
    }
  }

  async _onDeleteUser(btn) {
    const userId   = btn.dataset.userId;
    const username = btn.dataset.username;
    if (!confirm(`${t('admin.confirmDelete')} "${escHtml(username)}"?`)) return;
    try {
      await adminDeleteUser(userId);
      showToast(t('form.success'), 'success');
      await this._load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async _onToggleDisabled(checkbox) {
    const userId   = checkbox.dataset.userId;
    const disabled = !checkbox.checked;
    const textEl   = checkbox.closest('label').querySelector('.toggle-text');
    try {
      await adminUpdateUser(userId, { disabled });
      if (textEl) textEl.textContent = disabled ? t('adminUsers.disabled') : t('adminUsers.active');
      showToast(t('form.success'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
      checkbox.checked = !checkbox.checked;
    }
  }

  _renderPagination() {
    const pages = Math.ceil(this._total / PAGE_SIZE);
    const pag   = this._el.querySelector('#pagination');
    if (pages <= 1) { pag.innerHTML = ''; return; }

    pag.innerHTML = '';
    const prev = document.createElement('button');
    prev.className   = 'btn btn--sm btn--ghost';
    prev.textContent = `← ${t('form.previous')}`;
    prev.disabled    = this._page <= 1;
    prev.addEventListener('click', () => { this._page--; this._load(); });

    const info = document.createElement('span');
    info.className   = 'pagination__info';
    info.textContent = `${this._page} / ${pages}`;

    const next = document.createElement('button');
    next.className   = 'btn btn--sm btn--ghost';
    next.textContent = `${t('form.next')} →`;
    next.disabled    = this._page >= pages;
    next.addEventListener('click', () => { this._page++; this._load(); });

    pag.appendChild(prev);
    pag.appendChild(info);
    pag.appendChild(next);
  }
}
