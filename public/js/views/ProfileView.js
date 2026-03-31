import { isAuthenticated, getUser, getProfile, updateProfile, changePassword, getSessions, revokeSession, revokeAllSessions } from '../services/auth.js';
import { showToast } from '../components/Toast.js';
import { escHtml } from '../utils/escHtml.js';

const TOTAL_AVATARS = 40;
const pad = n => String(n).padStart(2, '0');
const avatarPath = n => `/assets/avatars/avatar-${pad(n)}.svg`;
const avatarPathByName = name => `/assets/avatars/${name}.svg`;

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(str) {
  if (!str) return '—';
  return new Date(str).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export class ProfileView {
  async render() {
    if (!isAuthenticated()) {
      window.location.hash = '#/login';
      return document.createTextNode('');
    }

    const el = document.createElement('div');
    el.className = 'main profile-page';
    el.innerHTML = `
      <div class="profile-container">
        <div class="profile-loading">Loading profile…</div>
      </div>
    `;

    this._load(el);
    return el;
  }

  async _load(el) {
    const wrap = el.querySelector('.profile-container');
    try {
      const [profile, sessions] = await Promise.all([getProfile(), getSessions()]);
      wrap.innerHTML = this._buildHTML(profile, sessions);
      this._bindEdit(el, profile);
      this._bindPassword(el);
      this._bindSessions(el, sessions);
    } catch (err) {
      wrap.innerHTML = `<p class="profile-error">Failed to load profile: ${escHtml(err.message)}</p>`;
    }
  }

  _buildHTML(profile, sessions) {
    const avatarName = profile.avatar || 'avatar-01';
    const roleBadge  = profile.role === 'admin'
      ? `<span class="badge badge--admin">Admin</span>`
      : `<span class="badge badge--user">User</span>`;
    const verified = profile.emailVerified
      ? `<span class="verified-badge">✓ Verified</span>`
      : `<span class="unverified-badge">✗ Unverified</span>`;

    const sessionRows = (Array.isArray(sessions) ? sessions : []).map(s => `
      <tr data-session-id="${escHtml(s.id)}">
        <td class="session-device">
          <span class="session-device__icon">${s.isCurrent ? '●' : '○'}</span>
          ${escHtml(s.userAgent || 'Unknown device')}
          ${s.isCurrent ? '<span class="session-current-badge">Current</span>' : ''}
        </td>
        <td class="session-ip">${escHtml(s.ip || '—')}</td>
        <td class="session-date">${formatDateTime(s.createdAt)}</td>
        <td>
          ${!s.isCurrent ? `<button class="btn btn--sm btn--danger" data-action="revoke" data-id="${escHtml(s.id)}">Revoke</button>` : '—'}
        </td>
      </tr>`).join('');

    return `
      <!-- Profile header -->
      <div class="profile-header">
        <img class="profile-header__avatar" src="${avatarPathByName(avatarName)}"
             alt="${escHtml(profile.username)}'s avatar" id="profile-avatar-img"/>
        <div class="profile-header__info">
          <div class="profile-header__name-row">
            <h1 class="profile-header__username">${escHtml(profile.username)}</h1>
            ${roleBadge}
            ${verified}
          </div>
          ${profile.displayName ? `<p class="profile-header__displayname">${escHtml(profile.displayName)}</p>` : ''}
          <p class="profile-header__email">${escHtml(profile.email)}</p>
          <p class="profile-header__joined">Member since ${formatDate(profile.createdAt)}</p>
        </div>
        <button class="btn btn--outline profile-edit-btn" id="profile-edit-btn">Edit Profile</button>
      </div>

      <!-- Edit panel (hidden by default) -->
      <section class="profile-section" id="edit-section" hidden>
        <h2 class="profile-section__title">Edit Profile</h2>
        <form class="profile-form" id="profile-form" novalidate>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="edit-displayname">Display Name</label>
              <input class="form-input" id="edit-displayname" name="displayName" type="text"
                     value="${escHtml(profile.displayName || '')}" placeholder="Your display name"/>
            </div>
            <div class="form-group">
              <label class="form-label" for="edit-phone">Phone</label>
              <input class="form-input" id="edit-phone" name="phone" type="tel"
                     value="${escHtml(profile.phone || '')}" placeholder="+1 555 000 0000"/>
            </div>
          </div>

          <!-- Avatar picker in edit mode -->
          <div class="form-group">
            <span class="form-label">Avatar</span>
            <div class="avatar-picker" id="edit-avatar-picker"></div>
            <input type="hidden" id="edit-avatar" name="avatar" value="${escHtml(avatarName)}"/>
          </div>

          <p class="form-error" id="edit-error" aria-live="polite"></p>
          <div class="form-actions">
            <button type="button" class="btn btn--ghost" id="edit-cancel-btn">Cancel</button>
            <button type="submit" class="btn btn--primary" id="edit-save-btn">Save Changes</button>
          </div>
        </form>
      </section>

      <!-- Change password -->
      <section class="profile-section">
        <h2 class="profile-section__title">Change Password</h2>
        <form class="profile-form" id="pw-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="pw-current">Current Password</label>
            <input class="form-input" id="pw-current" name="currentPassword" type="password"
                   autocomplete="current-password" required/>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="pw-new">New Password</label>
              <input class="form-input" id="pw-new" name="newPassword" type="password"
                     autocomplete="new-password" required/>
              <div class="password-strength" id="pw-strength-edit" aria-live="polite"></div>
              <ul class="pw-requirements">
                <li id="edit-req-length">At least 8 characters</li>
                <li id="edit-req-letter">At least 1 letter</li>
                <li id="edit-req-number">At least 1 number</li>
              </ul>
            </div>
            <div class="form-group">
              <label class="form-label" for="pw-confirm">Confirm New Password</label>
              <input class="form-input" id="pw-confirm" name="confirmPassword" type="password"
                     autocomplete="new-password" required/>
              <p class="form-field-status" id="pw-confirm-status"></p>
            </div>
          </div>
          <p class="form-error" id="pw-error" aria-live="polite"></p>
          <div class="form-actions">
            <button type="submit" class="btn btn--primary" id="pw-save-btn">Update Password</button>
          </div>
        </form>
      </section>

      <!-- Active sessions -->
      <section class="profile-section">
        <div class="profile-section__header-row">
          <h2 class="profile-section__title">Active Sessions</h2>
          <button class="btn btn--sm btn--danger" id="revoke-all-btn">Revoke All Others</button>
        </div>
        <div class="admin-table-wrap" id="sessions-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Device / Browser</th>
                <th>IP Address</th>
                <th>Started</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="sessions-tbody">
              ${sessionRows || '<tr><td colspan="4" class="empty-state">No sessions found.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  _buildAvatarPicker(el, currentAvatar) {
    const picker = el.querySelector('#edit-avatar-picker');
    if (!picker) return;
    for (let i = 1; i <= TOTAL_AVATARS; i++) {
      const name = `avatar-${pad(i)}`;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'avatar-picker__item' + (name === currentAvatar ? ' avatar-picker__item--selected' : '');
      item.dataset.avatar = name;
      item.setAttribute('aria-label', `Avatar ${i}`);
      item.innerHTML = `<img src="${avatarPath(i)}" alt="Avatar ${i}" loading="lazy"/>`;
      item.addEventListener('click', () => {
        picker.querySelectorAll('.avatar-picker__item').forEach(b => b.classList.remove('avatar-picker__item--selected'));
        item.classList.add('avatar-picker__item--selected');
        el.querySelector('#edit-avatar').value = name;
      });
      picker.appendChild(item);
    }
  }

  _bindEdit(el, profile) {
    const editBtn    = el.querySelector('#profile-edit-btn');
    const section    = el.querySelector('#edit-section');
    const cancelBtn  = el.querySelector('#edit-cancel-btn');

    editBtn.addEventListener('click', () => {
      section.hidden = false;
      editBtn.hidden = true;
      this._buildAvatarPicker(el, profile.avatar || 'avatar-01');
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    cancelBtn.addEventListener('click', () => {
      section.hidden = true;
      editBtn.hidden = false;
    });

    el.querySelector('#profile-form').addEventListener('submit', async e => {
      e.preventDefault();
      const form    = e.currentTarget;
      const errEl   = el.querySelector('#edit-error');
      const saveBtn = el.querySelector('#edit-save-btn');
      errEl.textContent = '';
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const updated = await updateProfile({
          displayName: form.displayName.value.trim() || null,
          phone:       form.phone.value.trim() || null,
          avatar:      form.avatar.value,
        });
        // Update header avatar + display name
        const avatarName = updated.user?.avatar || form.avatar.value;
        el.querySelector('#profile-avatar-img').src = avatarPathByName(avatarName);
        section.hidden = true;
        editBtn.hidden = false;
        showToast('Profile updated', 'success');
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });
  }

  _bindPassword(el) {
    const pwNew     = el.querySelector('#pw-new');
    const pwConfirm = el.querySelector('#pw-confirm');

    pwNew.addEventListener('input', () => {
      const val = pwNew.value;
      const score = [val.length >= 8, /[A-Za-z]/.test(val), /\d/.test(val)].filter(Boolean).length;
      const pct   = score * 33;
      const cls   = score <= 1 ? 'weak' : score === 2 ? 'fair' : 'strong';
      el.querySelector('#pw-strength-edit').innerHTML = `
        <div class="pw-strength__bar">
          <div class="pw-strength__fill pw-strength__fill--${cls}" style="width:${pct}%"></div>
        </div>`;
      el.querySelector('#edit-req-length').classList.toggle('req--met', val.length >= 8);
      el.querySelector('#edit-req-letter').classList.toggle('req--met', /[A-Za-z]/.test(val));
      el.querySelector('#edit-req-number').classList.toggle('req--met', /\d/.test(val));
    });

    pwConfirm.addEventListener('input', () => {
      const statusEl = el.querySelector('#pw-confirm-status');
      if (!pwConfirm.value) { statusEl.textContent = ''; return; }
      const match = pwConfirm.value === pwNew.value;
      statusEl.textContent = match ? '✓ Passwords match' : '✗ Do not match';
      statusEl.className   = 'form-field-status ' + (match ? 'status--ok' : 'status--err');
    });

    el.querySelector('#pw-form').addEventListener('submit', async e => {
      e.preventDefault();
      const form    = e.currentTarget;
      const errEl   = el.querySelector('#pw-error');
      const btn     = el.querySelector('#pw-save-btn');
      errEl.textContent = '';

      if (form.newPassword.value !== form.confirmPassword.value) {
        errEl.textContent = 'Passwords do not match.'; return;
      }
      if (form.newPassword.value.length < 8) {
        errEl.textContent = 'New password must be at least 8 characters.'; return;
      }

      btn.disabled = true;
      btn.textContent = 'Updating…';
      try {
        await changePassword(form.currentPassword.value, form.newPassword.value);
        form.reset();
        el.querySelector('#pw-strength-edit').innerHTML = '';
        el.querySelector('#pw-confirm-status').textContent = '';
        ['edit-req-length', 'edit-req-letter', 'edit-req-number'].forEach(id => {
          el.querySelector('#' + id).classList.remove('req--met');
        });
        showToast('Password updated', 'success');
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Update Password';
      }
    });
  }

  _bindSessions(el, sessions) {
    const tbody = el.querySelector('#sessions-tbody');

    tbody.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action=revoke]');
      if (!btn) return;
      const id = btn.dataset.id;
      btn.disabled = true;
      btn.textContent = 'Revoking…';
      try {
        await revokeSession(id);
        btn.closest('tr').remove();
        showToast('Session revoked', 'success');
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Revoke';
      }
    });

    el.querySelector('#revoke-all-btn').addEventListener('click', async () => {
      if (!confirm('Revoke all other sessions? You will remain logged in here.')) return;
      try {
        await revokeAllSessions();
        // Remove all non-current rows
        tbody.querySelectorAll('tr').forEach(row => {
          if (!row.querySelector('.session-current-badge')) row.remove();
        });
        showToast('All other sessions revoked', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
}
