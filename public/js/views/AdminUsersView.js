import { isAuthenticated, isAdmin, adminGetUsers, adminUpdateUser, adminDeleteUser } from '../services/auth.js';
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
            <th>Party</th>
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
                ${u.display_name ? `<span class="user-displayname">${escHtml(u.display_name)}</span>` : ''}
              </td>
              <td class="user-email">${escHtml(u.email)}</td>
              <td>
                <select class="form-input form-input--sm role-select" data-user-id="${escHtml(String(u.id))}" data-action="role">
                  <option value="user"      ${u.role === 'user'      ? 'selected' : ''}>User</option>
                  <option value="moderator" ${u.role === 'moderator' ? 'selected' : ''}>Moderator</option>
                  <option value="admin"     ${u.role === 'admin'     ? 'selected' : ''}>Admin</option>
                </select>
              </td>
              <td>
                ${u.email_verified
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
              <td>
                <label class="toggle-label" title="${u.party_access ? 'Revoke party access' : 'Grant party access'}">
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
                        title="Delete user">Delete</button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;

    // Wire role changes
    wrap.querySelectorAll('[data-action=role]').forEach(sel => {
      sel.dataset.prevRole = sel.value;
      sel.addEventListener('change', () => this._onRoleChange(sel));
    });

    // Wire enable/disable toggles
    wrap.querySelectorAll('[data-action=toggle-disabled]').forEach(chk => {
      chk.addEventListener('change', () => this._onToggleDisabled(chk));
    });

    // Wire party-access toggles
    wrap.querySelectorAll('[data-action=toggle-party]').forEach(chk => {
      chk.addEventListener('change', () => this._onTogglePartyAccess(chk));
    });

    // Wire delete buttons
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
      showToast(enabled ? 'Party access granted' : 'Party access revoked', 'success');
    } catch (err) {
      showToast(err.message, 'error');
      checkbox.checked = !checkbox.checked; // revert
    }
  }

  async _onRoleChange(select) {
    const userId   = select.dataset.userId;
    const newRole  = select.value;
    const prevRole = select.dataset.prevRole;
    try {
      await adminUpdateUser(userId, { role: newRole });
      select.dataset.prevRole = newRole;
      showToast(`Role updated to ${newRole}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
      select.value = prevRole;
    }
  }

  async _onDeleteUser(btn) {
    const userId   = btn.dataset.userId;
    const username = btn.dataset.username;
    if (!confirm(`Permanently delete user "${username}"? This cannot be undone.`)) return;
    try {
      await adminDeleteUser(userId);
      showToast(`User "${username}" deleted`, 'success');
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
      if (textEl) textEl.textContent = disabled ? 'Disabled' : 'Active';
      showToast(disabled ? 'User disabled' : 'User enabled', 'success');
    } catch (err) {
      showToast(err.message, 'error');
      checkbox.checked = !checkbox.checked; // revert
    }
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
