import { isAuthenticated, getProfile, updateProfile, uploadAvatar, changePassword, getSessions, revokeSession, revokeAllSessions } from '../services/auth.js';
import { showToast } from '../components/Toast.js';
import { escHtml } from '../utils/escHtml.js';
import { formatDate, formatDateTime } from '../utils/format.js';
import { t, href, switchLocale, SUPPORTED_LOCALES } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { bindAllPasswordToggles } from '../utils/passwordToggle.js';

const TOTAL_AVATARS = 40;
const pad = n => String(n).padStart(2, '0');
const avatarPath = n => `/assets/avatars/avatar-${pad(n)}.svg`;
const avatarPathByName = name => `/assets/avatars/${name}`;

export class ProfileView {
  async render() {
    if (!isAuthenticated()) {
      navigateReplace(href('/login'));
      return document.createTextNode('');
    }

    const el = document.createElement('div');
    el.className = 'main profile-page';
    el.innerHTML = `
      <div class="profile-container">
        <div class="profile-loading">${t('profile.loading')}</div>
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
      this._bindLangPref(el);
      this._bindPassword(el);
      this._bindSessions(el, sessions);
    } catch (err) {
      wrap.innerHTML = `<p class="profile-error">Failed to load profile: ${escHtml(err.message)}</p>`;
    }
  }

  _buildHTML(profile, sessions) {
    const avatarName = profile.avatar || 'avatar-01.svg';
    const roleBadge  = profile.role === 'admin'
      ? `<span class="badge badge--admin">${t('adminUsers.setRole')} — admin</span>`
      : `<span class="badge badge--user">${t('adminUsers.setRole')} — user</span>`;
    const verified = profile.emailVerified
      ? `<span class="verified-badge">✓ ${t('adminUsers.verified')}</span>`
      : `<span class="unverified-badge">✗ ${t('adminUsers.unverified')}</span>`;

    const sessionRows = (Array.isArray(sessions) ? sessions : []).map(s => `
      <tr data-session-id="${escHtml(s.id)}">
        <td class="session-device">
          <span class="session-device__icon">${s.is_current ? '●' : '○'}</span>
          ${escHtml(s.user_agent || 'Unknown device')}
          ${s.is_current ? `<span class="session-current-badge">${t('profile.current')}</span>` : ''}
        </td>
        <td class="session-ip">${escHtml(s.ip_address || '—')}</td>
        <td class="session-date">${formatDateTime(s.created_at)}</td>
        <td>
          ${!s.is_current ? `<button class="btn btn--sm btn--danger" data-action="revoke" data-id="${escHtml(s.id)}">${t('profile.revoke')}</button>` : '—'}
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
          <p class="profile-header__joined">${t('profile.memberSince')} ${formatDate(profile.createdAt)}</p>
        </div>
        <button class="btn btn--outline profile-edit-btn" id="profile-edit-btn" data-testid="edit-profile-btn">${t('profile.editProfile')}</button>
      </div>

      <!-- Edit panel (hidden by default) -->
      <section class="profile-section" id="edit-section" hidden>
        <h2 class="profile-section__title">${t('profile.editProfile')}</h2>
        <form class="profile-form" id="profile-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="edit-username">${t('signup.username')}</label>
            <input class="form-input" id="edit-username" name="username" type="text"
                   value="${escHtml(profile.username || '')}"
                   placeholder="${t('profile.usernamePlaceholder')}"
                   minlength="3" maxlength="40" autocomplete="username"/>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="edit-displayname">${t('signup.displayName')}</label>
              <input class="form-input" id="edit-displayname" name="displayName" type="text"
                     value="${escHtml(profile.displayName || '')}" placeholder="${t('profile.displayNamePlaceholder')}"/>
            </div>
            <div class="form-group">
              <label class="form-label" for="edit-phone">${t('checkout.phone')}</label>
              <input class="form-input" id="edit-phone" name="phone" type="tel"
                     value="${escHtml(profile.phone || '')}" placeholder="${t('profile.phonePlaceholder')}"/>
            </div>
          </div>

          <!-- Custom avatar upload -->
          <div class="form-group">
            <span class="form-label">${t('profile.uploadAvatar')}</span>
            <div class="avatar-upload">
              <img class="avatar-upload__preview" id="avatar-upload-preview"
                   src="${avatarPathByName(avatarName)}" alt="Avatar preview"/>
              <div class="avatar-upload__controls">
                <input type="file" id="avatar-upload-input" accept="image/jpeg,image/png,image/webp" hidden/>
                <button type="button" class="btn btn--outline" id="avatar-upload-btn">${t('profile.chooseImage')}</button>
                <p class="avatar-upload__hint">${t('profile.avatarHint')}</p>
                <p class="form-error" id="avatar-upload-error" aria-live="polite"></p>
              </div>
            </div>
          </div>

          <!-- Avatar picker in edit mode -->
          <div class="form-group">
            <span class="form-label">${t('signup.chooseAvatar')}</span>
            <div class="avatar-picker" id="edit-avatar-picker"></div>
            <input type="hidden" id="edit-avatar" name="avatar" value="${escHtml(avatarName)}"/>
          </div>

          <p class="form-error" id="edit-error" aria-live="polite"></p>
          <div class="form-actions">
            <button type="button" class="btn btn--ghost" id="edit-cancel-btn">${t('admin.cancel')}</button>
            <button type="submit" class="btn btn--primary" id="edit-save-btn">${t('profile.saveChanges')}</button>
          </div>
        </form>
      </section>

<!-- Language preference -->
      <section class="profile-section" id="lang-section">
        <h2 class="profile-section__title">${t('profile.languagePreference')}</h2>
        <p class="profile-lang-description">${t('profile.languageDescription')}</p>
        <div class="form-group profile-lang-section">
          <select class="form-input" id="lang-select">
            ${SUPPORTED_LOCALES.map(lc => `
              <option value="${lc}" ${lc === (profile.preferredLocale || profile.preferred_locale || 'en') ? 'selected' : ''}>
                ${lc === 'en' ? t('nav.switchToEn') : t('nav.switchToIs')}
              </option>`).join('')}
          </select>
          <p class="form-error profile-lang-error" id="lang-error" aria-live="polite"></p>
        </div>
        <div class="form-actions profile-lang-actions">
          <button class="btn btn--primary" id="lang-save-btn">${t('profile.saveChanges')}</button>
        </div>
      </section>

      <!-- Change password -->
      <section class="profile-section">
        <h2 class="profile-section__title">${t('profile.changePassword')}</h2>
        <form class="profile-form" id="pw-form" novalidate data-testid="change-password-form">
          <div class="form-group">
            <label class="form-label" for="pw-current">${t('profile.currentPassword')}</label>
            <input class="form-input" id="pw-current" name="currentPassword" type="password"
                   autocomplete="current-password" required/>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="pw-new">${t('profile.newPassword')}</label>
              <input class="form-input" id="pw-new" name="newPassword" type="password"
                     autocomplete="new-password" required/>
              <div class="password-strength" id="pw-strength-edit" aria-live="polite"></div>
              <ul class="pw-requirements">
                <li id="edit-req-length">${t('signup.req8chars')}</li>
                <li id="edit-req-letter">${t('signup.req1letter')}</li>
                <li id="edit-req-number">${t('signup.req1number')}</li>
              </ul>
            </div>
            <div class="form-group">
              <label class="form-label" for="pw-confirm">${t('profile.confirmNewPassword')}</label>
              <input class="form-input" id="pw-confirm" name="confirmPassword" type="password"
                     autocomplete="new-password" required/>
              <p class="form-field-status" id="pw-confirm-status"></p>
            </div>
          </div>
          <p class="form-error" id="pw-error" aria-live="polite"></p>
          <div class="form-actions">
            <button type="submit" class="btn btn--primary" id="pw-save-btn">${t('profile.updatePassword')}</button>
          </div>
        </form>
      </section>

      <!-- Active sessions -->
      <section class="profile-section">
        <div class="profile-section__header-row">
          <h2 class="profile-section__title">${t('profile.activeSessions')}</h2>
          <button class="btn btn--sm btn--danger" id="revoke-all-btn">${t('profile.revokeAllOthers')}</button>
        </div>
        <div class="admin-table-wrap" id="sessions-wrap" data-testid="sessions-list">
          <table class="admin-table">
            <thead>
              <tr>
                <th>${t('profile.device')}</th>
                <th>${t('profile.ipAddress')}</th>
                <th>${t('profile.started')}</th>
                <th>${t('adminUsers.actions')}</th>
              </tr>
            </thead>
            <tbody id="sessions-tbody">
              ${sessionRows || `<tr><td colspan="4" class="empty-state">${t('profile.noSessions')}</td></tr>`}
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
      const name = `avatar-${pad(i)}.svg`;
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

  _bindAvatarUpload(el, profile) {
    const btn     = el.querySelector('#avatar-upload-btn');
    const input   = el.querySelector('#avatar-upload-input');
    const preview = el.querySelector('#avatar-upload-preview');
    const errEl   = el.querySelector('#avatar-upload-error');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', () => input.click());

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      errEl.textContent = '';

      // Client-side guard — server enforces the same limits authoritatively.
      const MAX = 5 * 1024 * 1024;
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.type)) {
        errEl.textContent = t('profile.avatarTypeError');
        input.value = ''; return;
      }
      if (file.size > MAX) {
        errEl.textContent = t('profile.avatarSizeError');
        input.value = ''; return;
      }

      btn.disabled = true;
      const originalLabel = btn.textContent;
      btn.textContent = t('form.uploading');
      try {
        const updated = await uploadAvatar(file);
        const newName = updated.avatar;
        // Update preview, hidden field, header avatar, and the in-memory profile
        // so a later Save Changes uses the uploaded avatar.
        const url = avatarPathByName(newName);
        preview.src = url;
        el.querySelector('#edit-avatar').value = newName;
        el.querySelector('#profile-avatar-img').src = url;
        profile.avatar = newName;
        // Deselect any picker swatch since the avatar is now custom.
        el.querySelectorAll('.avatar-picker__item--selected')
          .forEach(b => b.classList.remove('avatar-picker__item--selected'));
        showToast(t('profile.avatarUpdated'), 'success');
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
        input.value = '';
      }
    });
  }

  _bindEdit(el, profile) {
    const editBtn    = el.querySelector('#profile-edit-btn');
    const section    = el.querySelector('#edit-section');
    const cancelBtn  = el.querySelector('#edit-cancel-btn');

    editBtn.addEventListener('click', () => {
      section.hidden = false;
      editBtn.hidden = true;
      this._buildAvatarPicker(el, profile.avatar || 'avatar-01.svg');
      this._bindAvatarUpload(el, profile);
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
      saveBtn.textContent = t('form.saving');
      try {
        const newUsername = form.username.value.trim();
        const payload = {
          displayName: form.displayName.value.trim() || null,
          phone:       form.phone.value.trim() || null,
          avatar:      form.avatar.value,
        };
        if (newUsername && newUsername !== profile.username) {
          payload.username = newUsername;
        }
        const updated = await updateProfile(payload);
        // Update header avatar + username + cached profile
        const avatarName = updated.avatar || updated.user?.avatar || form.avatar.value;
        el.querySelector('#profile-avatar-img').src = avatarPathByName(avatarName);
        if (updated.username) {
          profile.username = updated.username;
          const headerName = el.querySelector('.profile-header__username');
          if (headerName) headerName.textContent = updated.username;
        }
        section.hidden = true;
        editBtn.hidden = false;
        showToast(t('profile.profileUpdated'), 'success');
      } catch (err) {
        // 409 from a username collision: surface a specific message near the
        // username field instead of the generic server error.
        if (err.status === 409) {
          const msg = t('signup.usernameTaken');
          errEl.textContent = msg;
          form.username.focus();
          form.username.select();
        } else {
          errEl.textContent = err.message;
        }
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = t('profile.saveChanges');
      }
    });
  }

  _bindPassword(el) {
    bindAllPasswordToggles(el.querySelector('#pw-form'));

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
      statusEl.textContent = match ? `✓ ${t('signup.passwordsMatch')}` : `✗ ${t('signup.passwordsMismatch')}`;
      statusEl.className   = 'form-field-status ' + (match ? 'status--ok' : 'status--err');
    });

    el.querySelector('#pw-form').addEventListener('submit', async e => {
      e.preventDefault();
      const form    = e.currentTarget;
      const errEl   = el.querySelector('#pw-error');
      const btn     = el.querySelector('#pw-save-btn');
      errEl.textContent = '';

      if (form.newPassword.value !== form.confirmPassword.value) {
        errEl.textContent = t('signup.passwordsMismatch'); return;
      }
      if (form.newPassword.value.length < 8) {
        errEl.textContent = t('signup.pwMinLength'); return;
      }

      btn.disabled = true;
      btn.textContent = t('profile.updating');
      try {
        await changePassword(form.currentPassword.value, form.newPassword.value);
        form.reset();
        el.querySelector('#pw-strength-edit').innerHTML = '';
        el.querySelector('#pw-confirm-status').textContent = '';
        ['edit-req-length', 'edit-req-letter', 'edit-req-number'].forEach(id => {
          el.querySelector('#' + id).classList.remove('req--met');
        });
        showToast(t('profile.passwordUpdated'), 'success');
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = t('profile.updatePassword');
      }
    });
  }

  _bindLangPref(el) {
    const select  = el.querySelector('#lang-select');
    const saveBtn = el.querySelector('#lang-save-btn');
    const errEl   = el.querySelector('#lang-error');
    if (!select || !saveBtn) return;

    saveBtn.addEventListener('click', async () => {
      const locale = select.value;
      errEl.textContent = '';
      saveBtn.disabled = true;
      saveBtn.textContent = t('profile.languageSaving');
      try {
        await updateProfile({ preferred_locale: locale });
        showToast(t('profile.languageSaved'), 'success');
        switchLocale(locale);
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = t('profile.saveChanges');
      }
    });
  }

  _bindSessions(el, _sessions) {
    const tbody = el.querySelector('#sessions-tbody');

    tbody.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action=revoke]');
      if (!btn) return;
      const id = btn.dataset.id;
      btn.disabled = true;
      btn.textContent = t('profile.revoking');
      try {
        await revokeSession(id);
        btn.closest('tr').remove();
        showToast(t('profile.sessionRevoked'), 'success');
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = t('profile.revoke');
      }
    });

    el.querySelector('#revoke-all-btn').addEventListener('click', async () => {
      if (!confirm(t('profile.confirmRevokeAll'))) return;
      try {
        await revokeAllSessions();
        // Remove all non-current rows
        tbody.querySelectorAll('tr').forEach(row => {
          if (!row.querySelector('.session-current-badge')) row.remove();
        });
        showToast(t('profile.allSessionsRevoked'), 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
}
