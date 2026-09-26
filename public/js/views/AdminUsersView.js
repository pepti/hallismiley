import { isAuthenticated, isAdmin, getUser, adminGetUsers, adminUpdateUser, adminDeleteUser, adminApproveUser, adminResetTotp, adminNewPassword } from '../services/auth.js';
import { credentialsPanelHtml, wireCredentialsPanel } from '../components/OneTimeCredentials.js';
import { showToast }     from '../components/Toast.js';
import { escHtml }       from '../utils/escHtml.js';
import { avatarPathByName } from '../utils/avatar.js';
import { t, href }       from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { listRoles } from '../services/adminRoles.js';
import { sortableTh, cycleSort, bindSortable } from '../components/adminTable.js';
import { pagerHtml, bindPager } from '../components/adminPager.js';
import { readListState, syncListState, readPageSize, writePageSize } from '../utils/listState.js';
import { debounce } from '../utils/debounce.js';
import { expiryBadgeHtml, expiryFieldHtml, wireExpiryField, readExpiryField } from '../components/ExpiryPicker.js';
import { moduleEnabled } from '../utils/modules.js';

// Was a fixed 20 — a size the picker does not offer. The list remembers the
// admin's own choice now, defaulting to the nearest offered value.
const DEFAULT_SIZE = 25;
const VIEW_ID = 'users';

// A cancelled confirm() SAYS so. A bare `return` is indistinguishable from a
// dead button — and confirm() returns false with no dialog at all once the
// browser has been told to block further dialogs for the page. Ported from
// icelandicstore #199, where an approval that silently did nothing on PROD
// read as a broken save.
function cancelled() {
  showToast(t('admin.actionCancelled'), 'info');
}

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export class AdminUsersView {
  constructor() {
    // Seeded from the query string, so a reload — or a link pasted to a
    // colleague — lands on the same page, sort and search.
    const st = readListState({ page: 1, q: '', sort: 'created_at', dir: 'desc' });
    this._page  = Math.max(1, st.page);
    this._total = 0;
    this._roles = [];
    this._sort  = { field: st.sort, dir: st.dir === 'asc' ? 'asc' : 'desc' }; // default matches the server order
    this._q     = st.q;
    this._limit = readPageSize(VIEW_ID, DEFAULT_SIZE);
    this._detach = [];
  }

  // Page, sort and search are shareable; page SIZE is a personal habit, so it
  // lives in localStorage and is deliberately absent from the URL.
  _syncUrl() {
    syncListState(href('/admin/users'),
      { page: this._page, q: this._q, sort: this._sort.field, dir: this._sort.dir },
      { page: 1, q: '', sort: 'created_at', dir: 'desc' });
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
        <a href="${href('/admin')}" class="btn btn--outline" data-route="/admin">← ${t('admin.nav.dashboard')}</a>
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

    // Both bind to elements that survive _load()'s innerHTML repaint — the
    // table WRAP (the thead inside it is rebuilt every load) and the pager host.
    this._detach.push(bindSortable(el.querySelector('#users-table-wrap'), (field) => {
      this._sort = cycleSort(this._sort, field);
      this._page = 1;
      this._syncUrl();
      this._load();
    }));
    this._detach.push(bindPager(el.querySelector('#pagination'), {
      onPage: (n) => { this._page = n; this._syncUrl(); this._load(); },
      onPageSize: (n) => {
        this._limit = n; this._page = 1;
        writePageSize(VIEW_ID, n);
        this._syncUrl(); this._load();
      },
    }));
    await this._load();
    return renderAdminShell({ activePath: '/admin/users', content: el });
  }

  async _load() {
    const wrap = this._el.querySelector('#users-table-wrap');
    wrap.innerHTML = `<div class="admin-loading">${t('form.loading')}</div>`;
    try {
      const [data, rolesData] = await Promise.all([
        adminGetUsers({
          offset: (this._page - 1) * this._limit,
          limit:  this._limit,
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

    // The Party column belongs to the party module (moduleCatalog: party). An
    // instance without it has no party guests, so the toggle would offer a
    // switch that leads nowhere: header and cells are left out. Server-side
    // the route still answers (party_access is a plain user column).
    const partyOn = moduleEnabled('party');

    wrap.innerHTML = `
      <table class="admin-table admin-users-table">
        <thead>
          <tr>
            ${sortableTh(t('adminUsers.username'), 'username', this._sort)}
            ${sortableTh(t('adminUsers.email'), 'email', this._sort)}
            ${sortableTh(t('adminUsers.role'), 'role', this._sort)}
            ${sortableTh(t('adminUsers.verified'), 'verified', this._sort)}
            ${sortableTh(t('adminUsers.status'), 'status', this._sort)}
            <th>${t('adminUsers.validUntil')}</th>
            ${partyOn ? sortableTh(t('adminUsers.party'), 'party', this._sort) : ''}
            ${sortableTh(t('orders.date'), 'created_at', this._sort)}
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
              <td class="user-email">${u.no_email ? `<span class="users-no-email">${t('adminUsers.noEmail')}</span>` : escHtml(u.email)}</td>
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
                ${u.totp_enabled
                  ? `<span class="users-2sa-badge" title="${t('adminUsers.twoStepOn')}">${t('adminUsers.twoStepShort')}</span>` : ''}
              </td>
              <td>
                <label class="toggle-label" title="${u.disabled ? t('adminUsers.enable') : t('adminUsers.disable')}">
                  <input type="checkbox" class="toggle-input" data-action="toggle-disabled"
                         data-user-id="${escHtml(String(u.id))}" ${u.disabled ? '' : 'checked'}/>
                  <span class="toggle-track"></span>
                  <span class="toggle-text">${u.disabled ? t('adminUsers.disabled') : t('adminUsers.active')}</span>
                </label>
              </td>
              <td class="users-expiry-cell">
                <div class="users-expiry">
                  ${u.expires_at ? expiryBadgeHtml(u.expires_at) : '<span class="users-expiry__none">—</span>'}
                  ${String(u.id) !== String(getUser()?.id) && !u.admin_powers ? `
                  <button type="button" class="btn btn--sm btn--ghost expiry-user-btn"
                          data-user-id="${escHtml(String(u.id))}"
                          data-username="${escHtml(u.username)}"
                          data-expires-at="${escHtml(u.expires_at || '')}"
                          aria-label="${escHtml(t('adminUsers.expiryEdit', { name: u.username }))}"
                          title="${escHtml(t('adminUsers.expiryEdit', { name: u.username }))}">${t('admin.edit')}</button>` : ''}
                </div>
              </td>
              ${partyOn ? `<td>
                <label class="toggle-label" title="${u.party_access ? t('adminUsers.revokePartyAccess') : t('adminUsers.grantPartyAccess')}">
                  <input type="checkbox" class="toggle-input" data-action="toggle-party"
                         data-user-id="${escHtml(String(u.id))}" ${u.party_access ? 'checked' : ''}/>
                  <span class="toggle-track"></span>
                  <span class="toggle-text">${u.party_access ? '🎂 On' : 'Off'}</span>
                </label>
              </td>` : ''}
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
                ${u.no_email && u.role === 'user' ? `
                <button class="btn btn--sm btn--outline new-password-btn"
                        data-user-id="${escHtml(String(u.id))}"
                        data-username="${escHtml(u.username)}"
                        title="${t('adminUsers.newPasswordHint')}">${t('adminUsers.newPassword')}</button>` : ''}
                ${u.totp_enabled && String(u.id) !== String(getUser()?.id) ? `
                <button class="btn btn--sm btn--outline reset-totp-btn"
                        data-user-id="${escHtml(String(u.id))}"
                        data-username="${escHtml(u.username)}"
                        title="${t('adminUsers.twoStepResetHint')}">${t('adminUsers.twoStepReset')}</button>` : ''}
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

    wrap.querySelectorAll('.new-password-btn').forEach(btn => {
      btn.addEventListener('click', () => this._onNewPassword(btn));
    });

    wrap.querySelectorAll('.reset-totp-btn').forEach(btn => {
      btn.addEventListener('click', () => this._onResetTotp(btn));
    });

    wrap.querySelectorAll('.expiry-user-btn').forEach(btn => {
      btn.addEventListener('click', () => this._onEditExpiry(btn));
    });

  }

  // Debounced search: one request after the user pauses typing, not per
  // keystroke. The input lives in the persistent shell so it keeps focus
  // across the table re-render.
  _bindSearch() {
    const input = this._el.querySelector('#users-search');
    if (!input) return;
    this._search = debounce(() => {
      const next = input.value.trim();
      if (next === this._q) return;
      this._q    = next;
      this._page = 1;
      this._syncUrl();
      this._load();
    });
    input.addEventListener('input', this._search);
  }

  destroy() {
    // A queued search must not fire against a torn-down DOM, and the delegated
    // listeners go with the view.
    if (this._search) this._search.cancel();
    this._detach.forEach((off) => off());
    this._detach = [];
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
    if (!confirm(`${t('admin.confirmDelete')} "${escHtml(username)}"?`)) return cancelled();
    try {
      await adminDeleteUser(userId);
      showToast(t('form.success'), 'success');
      await this._load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Reset another user's two-step verification (ice #396). A plain customer
  // account resets after a confirm(); a staff account (any admin view) needs
  // the acting admin's own password, which the server asks for with
  // reason 'password_required' — so the page never has to know who is staff.
  async _onResetTotp(btn) {
    const userId   = btn.dataset.userId;
    const username = btn.dataset.username;
    if (!confirm(t('adminUsers.twoStepResetConfirm', { name: username }))) return cancelled();
    btn.disabled = true;
    try {
      try {
        await adminResetTotp(userId);
      } catch (err) {
        if (err.reason !== 'password_required') throw err;
        const password = await this._askOwnPassword(username);
        if (!password) return;
        await adminResetTotp(userId, password);
      }
      showToast(t('adminUsers.twoStepResetDone', { name: username }), 'success');
      await this._load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // A login with no mailbox lost its password: mint a new one and show it
  // ONCE (ice #382/#397). The old one stops working and its sessions end.
  async _onNewPassword(btn) {
    const username = btn.dataset.username;
    if (!confirm(t('adminUsers.newPasswordConfirm', { name: username }))) return cancelled();
    btn.disabled = true;
    try {
      const res = await adminNewPassword(btn.dataset.userId);
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${credentialsPanelHtml({
        username: res.username, password: res.password, idPrefix: 'users-otc',
        actionsHtml: `<button type="button" class="btn btn--primary" data-otc-done>${t('adminUsers.passwordDone')}</button>`,
      })}</div>`;
      document.body.appendChild(overlay);
      wireCredentialsPanel(overlay);
      overlay.querySelector('[data-otc-done]').addEventListener('click', () => overlay.remove());
      overlay.querySelector('[data-otc]')?.focus();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // A small modal asking for the ACTING admin's password. Resolves the typed
  // value, or null on cancel / Escape / a click outside. Never stored.
  _askOwnPassword(username) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      overlay.innerHTML = `
        <form class="modal users-totp-modal" role="dialog" aria-modal="true" aria-labelledby="users-totp-title">
          <h2 class="modal__title" id="users-totp-title">${t('adminUsers.twoStepReset')}</h2>
          <p class="modal__desc">${escHtml(t('adminUsers.twoStepPasswordHint', { name: username }))}</p>
          <label class="form-label" for="users-totp-pw">${t('adminUsers.twoStepYourPassword')}</label>
          <input class="form-input" id="users-totp-pw" type="password" autocomplete="current-password" required/>
          <div class="users-totp-modal__actions">
            <button type="button" class="btn btn--ghost" data-cancel>${t('form.cancel')}</button>
            <button type="submit" class="btn btn--primary">${t('adminUsers.twoStepReset')}</button>
          </div>
        </form>`;
      const done = (value) => {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(value);
      };
      const onKey = (e) => { if (e.key === 'Escape') done(null); };
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
      overlay.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      overlay.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        done(overlay.querySelector('#users-totp-pw').value || null);
      });
      document.body.appendChild(overlay);
      overlay.querySelector('#users-totp-pw').focus();
    });
  }

  // "Gildir til" for another account (migration 114): 7 / 14 / 30 days, a
  // date, or none. The server refuses your own account and a past date; the
  // modal shows its message and stays open.
  _onEditExpiry(btn) {
    const userId   = btn.dataset.userId;
    const username = btn.dataset.username;
    const prefix   = 'users-expiry';
    const overlay  = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <form class="modal users-expiry-modal" role="dialog" aria-modal="true" aria-labelledby="users-expiry-title">
        <h2 class="modal__title" id="users-expiry-title">${t('adminUsers.expiryTitle')}</h2>
        <p class="modal__desc"><strong>${escHtml(username)}</strong> — ${escHtml(t('adminUsers.expiryHint'))}</p>
        ${expiryFieldHtml({ idPrefix: prefix, current: btn.dataset.expiresAt || null })}
        <p class="users-expiry-modal__error" role="alert" data-expiry-error></p>
        <div class="users-expiry-modal__actions">
          <button type="button" class="btn btn--ghost" data-cancel>${t('form.cancel')}</button>
          <button type="submit" class="btn btn--primary">${t('form.save')}</button>
        </div>
      </form>`;
    const close = () => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-cancel]').addEventListener('click', close);
    wireExpiryField(overlay, prefix);
    const errorEl = overlay.querySelector('[data-expiry-error]');
    overlay.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const picked = readExpiryField(overlay, prefix);
      if (!picked.ok) { errorEl.textContent = picked.message; return; }
      const submit = overlay.querySelector('button[type=submit]');
      submit.disabled = true;
      try {
        await adminUpdateUser(userId, { expires_at: picked.value });
        close();
        showToast(t('form.success'), 'success');
        await this._load();
      } catch (err) {
        errorEl.textContent = err.message;
        submit.disabled = false;
      }
    });
    document.body.appendChild(overlay);
    overlay.querySelector(`input[name="${prefix}-choice"]:checked`)?.focus();
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
    this._el.querySelector('#pagination').innerHTML = pagerHtml({
      page: this._page, total: this._total, pageSize: this._limit, showSizePicker: true,
    });
  }
}
