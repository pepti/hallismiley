import { isAuthenticated, isAdmin, adminGetUsers, adminUpdateUser } from '../services/auth.js';
import { showToast } from '../components/Toast.js';
import { escHtml } from '../utils/escHtml.js';
import { avatarPathByName } from '../utils/avatar.js';

const PAGE_SIZE = 20;

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export class AdminUsersView {
  constructor() {
    this._page = 1;
    this._total = 0;
  }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      window.location.hash = '#/';
      return document.createTextNode('');
    }

    const el = document.createElement('div');
    el.className = 'main admin-page';
    el.innerHTML = `
      <div class="admin-header">
        <div>
          <p class="admin-eyebrow">Admin</p>
          <h1 class="admin-title">User Management</h1>
        </div>
        <a href="#/admin" class="btn btn--outline" data-route="/admin">← Projects</a>
      </div>
      <div class="admin-table-wrap" id="users-table-wrap">
        <div class="admin-loading">Loading users…</div>
      </div>
      <div class="pagination" id="pagination"></div>
    `;

    this._el = el;
    await this._load();
    return el;
  }

  async _load() {
    const wrap = this._el.querySelector('#users-table-wrap');
    wrap.innerHTML = '<div class="admin-loading">Loading users…</div>';
    try {
      const data = await adminGetUsers({ page: this._page, limit: PAGE_SIZE });
      const users = Array.isArray(data) ? data : (data.users || []);
      this._total = data.total || users.length;
      this._renderTable(users);
      this._renderPagination();
    } catch (err) {
      wrap.innerHTML = `<p class="admin-error">Failed to load users: ${escHtml(err.message)}</p>`;
    }
  }

  _renderTable(users) {
    const wrap = this._el.querySelector('#users-table-wrap');

    if (!users.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">👤</div>
          <p>No users found.</p>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="admin-table admin-users-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Email</th>
            <th>Role</th>
            <th>Verified</th>
            <th>Status</th>
            <th>Joined</th>
            <th class="admin-table__actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr data-user-id="${escHtml(String(u.id))}">
              <td class="user-cell">
                <img class="user-avatar-sm" src="${avatarPathByName(u.avatar)}"
                     alt="${escHtml(u.username)}" loading="lazy"/>
                <span class="user-username">${escHtml(u.username)}</span>
                ${u.displayName ? `<span class="user-displayname">${escHtml(u.displayName)}</span>` : ''}
              </td>
              <td class="user-email">${escHtml(u.email)}</td>
              <td>
                <select class="form-input form-input--sm role-select" data-user-id="${escHtml(String(u.id))}" data-action="role">
                  <option value="user"  ${u.role === 'user'  ? 'selected' : ''}>User</option>
                  <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
              </td>
              <td>
                ${u.emailVerified
                  ? '<span class="verified-badge">✓ Verified</span>'
                  : '<span class="unverified-badge">✗ Unverified</span>'}
              </td>
              <td>
                <label class="toggle-label" title="${u.disabled ? 'Enable user' : 'Disable user'}">
                  <input type="checkbox" class="toggle-input" data-action="toggle-disabled"
                         data-user-id="${escHtml(String(u.id))}" ${u.disabled ? '' : 'checked'}/>
                  <span class="toggle-track"></span>
                  <span class="toggle-text">${u.disabled ? 'Disabled' : 'Active'}</span>
                </label>
              </td>
              <td class="user-joined">${formatDate(u.createdAt)}</td>
              <td class="admin-table__actions">
                <span class="user-id-badge">#${escHtml(String(u.id))}</span>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;

    // Wire role changes
    wrap.querySelectorAll('[data-action=role]').forEach(sel => {
      sel.addEventListener('change', () => this._onRoleChange(sel));
    });

    // Wire enable/disable toggles
    wrap.querySelectorAll('[data-action=toggle-disabled]').forEach(chk => {
      chk.addEventListener('change', () => this._onToggleDisabled(chk));
    });
  }

  async _onRoleChange(select) {
    const userId  = select.dataset.userId;
    const newRole = select.value;
    const orig    = newRole === 'admin' ? 'user' : 'admin';
    try {
      await adminUpdateUser(userId, { role: newRole });
      showToast(`Role updated to ${newRole}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
      select.value = orig;
    }
  }

  async _onToggleDisabled(checkbox) {
    const userId   = checkbox.dataset.userId;
    const disabled = !checkbox.checked;
    const textEl   = checkbox.closest('label').querySelector('.toggle-text');
    try {
      await adminUpdateUser(userId, { disabled });
      if (textEl) textEl.textContent = disabled ? 'Disabled' : 'Active';
      showToast(disabled ? 'User disabled' : 'User enabled', 'success');
    } catch (err) {
      showToast(err.message, 'error');
      checkbox.checked = !checkbox.checked; // revert
    }
  }

  destroy() {
    // No window/document listeners to remove; all listeners are on child elements.
  }

  _renderPagination() {
    const pages = Math.ceil(this._total / PAGE_SIZE);
    const pag   = this._el.querySelector('#pagination');
    if (pages <= 1) { pag.innerHTML = ''; return; }

    pag.innerHTML = '';
    const prev = document.createElement('button');
    prev.className = 'btn btn--sm btn--ghost';
    prev.textContent = '← Prev';
    prev.disabled = this._page <= 1;
    prev.addEventListener('click', () => { this._page--; this._load(); });

    const info = document.createElement('span');
    info.className = 'pagination__info';
    info.textContent = `Page ${this._page} of ${pages}`;

    const next = document.createElement('button');
    next.className = 'btn btn--sm btn--ghost';
    next.textContent = 'Next →';
    next.disabled = this._page >= pages;
    next.addEventListener('click', () => { this._page++; this._load(); });

    pag.appendChild(prev);
    pag.appendChild(info);
    pag.appendChild(next);
  }
}
