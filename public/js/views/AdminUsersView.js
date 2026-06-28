import { isAuthenticated, isAdmin, adminGetUsers, adminUpdateUser, adminDeleteUser, adminApproveUser } from '../services/auth.js';
import { showToast }     from '../components/Toast.js';
import { escHtml }       from '../utils/escHtml.js';
import { avatarPathByName } from '../utils/avatar.js';
import { t, href }       from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { listRoles } from '../services/adminRoles.js';

const PAGE_SIZE = 20;

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export class AdminUsersView {
  constructor() {
    this._page  = 1;
    this._total = 0;
    this._roles = [];
    this._sort  = { field: 'created_at', dir: 'desc' }; // matches the default server order
    this._q     = '';
  }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      navigateReplace(href('/'));
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
      <div class="admin-toolbar">
        <input type="search" id="users-search" class="form-input admin-search"
               placeholder="${t('adminUsers.searchPlaceholder')}"
               aria-label="${t('adminUsers.searchPlaceholder')}"
               autocomplete="off" value="${escHtml(this._q)}" />
      </div>
      <div class="admin-table-wrap" id="users-table-wrap">
        <div class="admin-loading">${t('form.loading')}</div>
      </div>
      <div class="pagination" id="pagination"></div>
    `;

    this._el = el;
    this._bindSearch();
    await this._load();
    return renderAdminShell({ activePath: '/admin/users', content: el });
  }

  async _load() {
    const wrap = this._el.querySelector('#users-table-wrap');
    wrap.innerHTML = `<div class="admin-loading">${t('form.loading')}</div>`;
    try {
      const [data, rolesData] = await Promise.all([
        adminGetUsers({
          offset: (this._page - 1) * PAGE_SIZE,
          limit:  PAGE_SIZE,
          sort:   this._sort.field,
          order:  this._sort.dir,
          ...(this._q ? { q: this._q } : {}),
        }),
        listRoles().catch(() => ({ roles: [] })),
      ]);
      const users = Array.isArray(data) ? data : (data.users || []);
      this._roles = rolesData.roles || [];
      this._total = data.total || users.length;
      this._renderTable(users);
      this._renderPagination();
    } catch (err) {
      wrap.innerHTML = `<p class="admin-error">${t('form.error')}: ${escHtml(err.message)}</p>`;
    }
  }

  // Role <option>s from the live roles table (falls back to the built-ins if the
  // roles API failed to load). The user's current role stays selected.
  _roleOptions(current) {
    const roles = this._roles.length ? this._roles : [{ name: 'user' }, { name: 'moderator' }, { name: 'admin' }];
    const known = roles.some(r => r.name === current);
    const list  = known ? roles : [...roles, { name: current }];
    return list.map(r =>
      `<option value="${escHtml(r.name)}" ${current === r.name ? 'selected' : ''}>${escHtml(r.name)}</option>`
    ).join('');
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
            ${this._sortableTh('username',   t('adminUsers.username'))}
            ${this._sortableTh('email',      t('adminUsers.email'))}
            ${this._sortableTh('role',       t('adminUsers.role'))}
            ${this._sortableTh('verified',   t('adminUsers.verified'))}
            ${this._sortableTh('status',     t('adminUsers.status'))}
            ${this._sortableTh('party',      t('adminUsers.party'))}
            ${this._sortableTh('created_at', t('orders.date'))}
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
                  ${this._roleOptions(u.role)}
                </select>
              </td>
              <td>
                ${u.email_verified
                  ? `<span class="verified-badge">✓ ${t('adminUsers.verified')}</span>`
                  : `<span class="unverified-badge">✗ ${t('adminUsers.unverified')}</span>`}
                ${u.approval_status === 'pending'
                  ? `<span class="approval-badge approval-badge--pending">${t('adminUsers.pending')}</span>` : ''}
                ${u.approval_status === 'declined'
                  ? `<span class="approval-badge approval-badge--declined">${t('adminUsers.declined')}</span>` : ''}
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
                ${u.approval_status === 'pending' ? `
                <button class="btn btn--sm btn--primary approve-user-btn"
                        data-user-id="${escHtml(String(u.id))}" data-approve-action="approve"
                        title="${t('adminUsers.approve')}">${t('adminUsers.approve')}</button>
                <button class="btn btn--sm btn--ghost approve-user-btn"
                        data-user-id="${escHtml(String(u.id))}" data-approve-action="decline"
                        title="${t('adminUsers.decline')}">${t('adminUsers.decline')}</button>` : ''}
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

    wrap.querySelectorAll('.approve-user-btn').forEach(btn => {
      btn.addEventListener('click', () => this._onApproveUser(btn));
    });

    this._bindSort();
  }

  // Render a sortable <th>. The arrow is always present (opacity hidden until
  // active) so column widths don't jump as the user clicks around.
  _sortableTh(field, label) {
    const isActive = this._sort.field === field;
    const arrow    = isActive && this._sort.dir === 'desc' ? '▼' : '▲';
    const ariaSort = !isActive ? 'none' : (this._sort.dir === 'asc' ? 'ascending' : 'descending');
    const cls      = 'sortable' + (isActive ? ' is-active' : '');
    return `<th data-sort-field="${escHtml(field)}" class="${cls}" aria-sort="${ariaSort}" tabindex="0">${escHtml(label)}<span class="admin-table__sort-arrow" aria-hidden="true">${arrow}</span></th>`;
  }

  // Click cycle on a column: new column → asc, same column toggles asc ↔ desc.
  // Two-state (no "clear") so the default Date column can also be inverted to
  // ascending instead of being stuck on its initial desc.
  _cycleSort(field) {
    if (this._sort.field !== field) return { field, dir: 'asc' };
    return { field, dir: this._sort.dir === 'asc' ? 'desc' : 'asc' };
  }

  // Delegated sort handler on the table head. Sorting is server-side, so a
  // click resets to page 1 and re-fetches the whole (re-ordered) list.
  _bindSort() {
    const thead = this._el.querySelector('.admin-users-table thead');
    if (!thead) return;
    const handler = (e) => {
      const th = e.target.closest('th[data-sort-field]');
      if (!th || !thead.contains(th)) return;
      if (e.type === 'keydown') {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
      }
      this._sort = this._cycleSort(th.dataset.sortField);
      this._page = 1;
      this._load();
    };
    thead.addEventListener('click', handler);
    thead.addEventListener('keydown', handler);
  }

  // Debounced search: one request after the user pauses typing, not per
  // keystroke. The input lives in the persistent shell so it keeps focus
  // across the table re-render.
  _bindSearch() {
    const input = this._el.querySelector('#users-search');
    if (!input) return;
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = input.value.trim();
        if (next === this._q) return;
        this._q    = next;
        this._page = 1;
        this._load();
      }, 250);
    });
  }

  async _onApproveUser(btn) {
    const userId = btn.dataset.userId;
    const action = btn.dataset.approveAction === 'decline' ? 'decline' : 'approve';
    btn.disabled = true;
    try {
      await adminApproveUser(userId, action);
      showToast(t('form.success'), 'success');
      await this._load(); // refresh so the row reflects the new status
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
    }
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
