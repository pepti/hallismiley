import {
  isAuthenticated, getProfile, updateProfile, changePassword,
  getSessions, revokeSession, revokeAllSessions,
  getFavorites, removeFavorite,
} from '../services/auth.js';
import { showToast }           from '../components/Toast.js';
import { escHtml }             from '../utils/escHtml.js';
import { avatarPath, avatarPathByName } from '../utils/avatar.js';

const TOTAL_AVATARS = 40;
const pad = n => String(n).padStart(2, '0');

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(str) {
  if (!str) return '—';
  return new Date(str).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(str) {
  if (!str) return 'never';
  const diff = Date.now() - new Date(str).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins} minutes ago`;
  if (hours < 24) return `${hours} hours ago`;
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function parseUA(ua) {
  if (!ua) return 'Unknown device';
  const browsers = [
    [/Edg\//, 'Edge'],
    [/OPR\//, 'Opera'],
    [/Chrome\//, 'Chrome'],
    [/Firefox\//, 'Firefox'],
    [/Safari\//, 'Safari'],
  ];
  const oses = [
    [/Windows NT/, 'Windows'],
    [/Macintosh/, 'macOS'],
    [/Linux/, 'Linux'],
    [/Android/, 'Android'],
    [/iPhone|iPad/, 'iOS'],
  ];
  const browser = browsers.find(([re]) => re.test(ua))?.[1] || 'Browser';
  const os      = oses.find(([re]) => re.test(ua))?.[1]      || 'Unknown OS';
  return `${browser} on ${os}`;
}

function calcCompleteness(profile) {
  const checks = [
    { label: 'Set a custom avatar',   met: profile.avatar && profile.avatar !== 'avatar-01.svg' },
    { label: 'Write a bio',           met: !!profile.bio },
    { label: 'Set a display name',    met: !!profile.display_name },
    { label: 'Verify your email',     met: !!profile.email_verified },
    { label: 'Add a phone number',    met: !!profile.phone },
  ];
  const pct  = Math.round((checks.filter(c => c.met).length / checks.length) * 100);
  const tips = checks.filter(c => !c.met).map(c => c.label);
  return { pct, tips };
}

function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('theme-light', t === 'light');
  localStorage.setItem('theme', t);
}

// Apply stored theme on load (called from main.js is ideal, but also here as fallback)
(function () {
  const stored = localStorage.getItem('theme');
  if (stored === 'light') document.body.classList.add('theme-light');
})();

export class ProfileView {
  constructor() {
    this._favorites = [];
  }

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
      const [profile, sessions, favorites] = await Promise.all([
        getProfile(),
        getSessions(),
        getFavorites(),
      ]);
      this._favorites = favorites || [];
      wrap.innerHTML = this._buildHTML(profile, sessions, this._favorites);
      this._bindEdit(el, profile);
      this._bindPassword(el);
      this._bindSessions(el, sessions);
      this._bindThemeToggle(el, profile);
      this._bindNotifications(el, profile);
      this._bindFavorites(el);
    } catch (err) {
      wrap.innerHTML = `<p class="profile-error">Failed to load profile: ${escHtml(err.message)}</p>`;
    }
  }

  _buildHTML(profile, sessions, favorites) {
    const avatarName  = profile.avatar || 'avatar-01.svg';
    const roleBadge   = profile.role === 'admin'
      ? `<span class="badge badge--admin">Admin</span>`
      : `<span class="badge badge--user">User</span>`;
    const verified = profile.email_verified
      ? `<span class="verified-badge">✓ Verified</span>`
      : `<span class="unverified-badge">✗ Unverified</span>`;

    const { pct, tips } = calcCompleteness(profile);
    const completenessBar = `
      <div class="profile-completeness">
        <div class="profile-completeness__header">
          <span class="profile-completeness__label">Profile completeness</span>
          <span class="profile-completeness__pct">${pct}%</span>
        </div>
        <div class="profile-completeness__track">
          <div class="profile-completeness__fill" style="width:${pct}%"></div>
        </div>
        ${tips.length > 0 ? `<ul class="profile-completeness__tips">${tips.map(t => `<li>${escHtml(t)}</li>`).join('')}</ul>` : ''}
      </div>`;

    const lastLogin = profile.last_login_at
      ? `<p class="profile-header__last-login">
           Last login: ${timeAgo(profile.last_login_at)}
           ${profile.last_login_ua ? `from <em>${escHtml(parseUA(profile.last_login_ua))}</em>` : ''}
         </p>`
      : '';

    const sessionRows = (Array.isArray(sessions) ? sessions : []).map(s => `
      <tr data-session-id="${escHtml(s.id)}">
        <td class="session-device">
          <span class="session-device__icon">${s.is_current ? '●' : '○'}</span>
          ${escHtml(parseUA(s.user_agent || ''))}
          ${s.is_current ? '<span class="session-current-badge">Current</span>' : ''}
        </td>
        <td class="session-ip">${escHtml(s.ip_address || '—')}</td>
        <td class="session-date">${formatDateTime(s.created_at)}</td>
        <td>
          ${!s.is_current ? `<button class="btn btn--sm btn--danger" data-action="revoke" data-id="${escHtml(s.id)}">Revoke</button>` : '—'}
        </td>
      </tr>`).join('');

    const favCards = favorites.map(p => `
      <div class="fav-card" data-project-id="${p.id}">
        <div class="fav-card__img">
          ${p.image_url ? `<img src="${escHtml(p.image_url)}" alt="${escHtml(p.title)}" loading="lazy">` : ''}
        </div>
        <div class="fav-card__body">
          <h4 class="fav-card__title">${escHtml(p.title)}</h4>
          <span class="fav-card__category">${escHtml(p.category)}</span>
        </div>
        <button class="btn btn--sm btn--danger fav-remove-btn" data-project-id="${p.id}" title="Remove favorite">♥ Remove</button>
      </div>`).join('');

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
          ${profile.display_name ? `<p class="profile-header__displayname">${escHtml(profile.display_name)}</p>` : ''}
          <p class="profile-header__email">${escHtml(profile.email)}</p>
          <p class="profile-header__joined">Member since ${formatDate(profile.created_at)}</p>
          ${lastLogin}
          ${profile.bio ? `<p class="profile-header__bio">${escHtml(profile.bio)}</p>` : ''}
        </div>
        <button class="btn btn--outline profile-edit-btn" id="profile-edit-btn">Edit Profile</button>
      </div>

      <!-- Profile completeness -->
      ${completenessBar}

      <!-- Edit panel (hidden by default) -->
      <section class="profile-section" id="edit-section" hidden>
        <h2 class="profile-section__title">Edit Profile</h2>
        <form class="profile-form" id="profile-form" novalidate>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="edit-displayname">Display Name</label>
              <input class="form-input" id="edit-displayname" name="display_name" type="text"
                     value="${escHtml(profile.display_name || '')}" placeholder="Your display name"/>
            </div>
            <div class="form-group">
              <label class="form-label" for="edit-phone">Phone</label>
              <input class="form-input" id="edit-phone" name="phone" type="tel"
                     value="${escHtml(profile.phone || '')}" placeholder="+1 555 000 0000"/>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="edit-bio">Bio <span class="form-label__hint">(max 500 chars)</span></label>
            <textarea class="form-input form-textarea" id="edit-bio" name="bio"
                      maxlength="500" rows="3"
                      placeholder="Tell us about yourself…">${escHtml(profile.bio || '')}</textarea>
            <p class="form-field-status" id="bio-char-count">${(profile.bio || '').length}/500</p>
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

      <!-- Theme preference -->
      <section class="profile-section" id="theme-section">
        <h2 class="profile-section__title">Appearance</h2>
        <div class="profile-toggle-row">
          <span class="profile-toggle-label">Theme</span>
          <label class="toggle-switch" aria-label="Toggle light theme">
            <input type="checkbox" id="theme-toggle"
                   ${profile.theme === 'light' ? 'checked' : ''}/>
            <span class="toggle-switch__track"></span>
          </label>
          <span class="profile-toggle-value" id="theme-label">${profile.theme === 'light' ? 'Light' : 'Dark'}</span>
        </div>
      </section>

      <!-- Notification preferences -->
      <section class="profile-section" id="notifications-section">
        <h2 class="profile-section__title">Notifications</h2>
        <div class="profile-toggle-row">
          <span class="profile-toggle-label">Comment notifications</span>
          <label class="toggle-switch" aria-label="Toggle comment notifications">
            <input type="checkbox" id="notify-comments-toggle"
                   ${profile.notify_comments !== false ? 'checked' : ''}/>
            <span class="toggle-switch__track"></span>
          </label>
        </div>
        <div class="profile-toggle-row">
          <span class="profile-toggle-label">Update notifications</span>
          <label class="toggle-switch" aria-label="Toggle update notifications">
            <input type="checkbox" id="notify-updates-toggle"
                   ${profile.notify_updates !== false ? 'checked' : ''}/>
            <span class="toggle-switch__track"></span>
          </label>
        </div>
      </section>

      <!-- Connected accounts -->
      <section class="profile-section" id="connected-section">
        <h2 class="profile-section__title">Connected Accounts</h2>
        <form class="profile-form" id="connected-form" novalidate>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="edit-github">
                <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                GitHub username
              </label>
              <div class="form-input-icon-wrap">
                <input class="form-input" id="edit-github" name="github_username" type="text"
                       value="${escHtml(profile.github_username || '')}" placeholder="octocat"/>
                ${profile.github_username
                  ? `<a class="form-input-icon-link" href="https://github.com/${escHtml(profile.github_username)}" target="_blank" rel="noopener" title="Visit GitHub profile">↗</a>`
                  : ''}
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" for="edit-linkedin">
                <svg class="icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                LinkedIn username
              </label>
              <div class="form-input-icon-wrap">
                <input class="form-input" id="edit-linkedin" name="linkedin_username" type="text"
                       value="${escHtml(profile.linkedin_username || '')}" placeholder="yourname"/>
                ${profile.linkedin_username
                  ? `<a class="form-input-icon-link" href="https://linkedin.com/in/${escHtml(profile.linkedin_username)}" target="_blank" rel="noopener" title="Visit LinkedIn profile">↗</a>`
                  : ''}
              </div>
            </div>
          </div>
          <p class="form-error" id="connected-error" aria-live="polite"></p>
          <div class="form-actions">
            <button type="submit" class="btn btn--primary" id="connected-save-btn">Save</button>
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

      <!-- My Favorites -->
      <section class="profile-section" id="favorites-section">
        <h2 class="profile-section__title">My Favorites</h2>
        <div class="fav-grid" id="fav-grid">
          ${favorites.length > 0 ? favCards : '<p class="empty-state">No favorites yet. Heart a project to save it here.</p>'}
        </div>
      </section>

      <!-- Comments placeholder -->
      <section class="profile-section">
        <h2 class="profile-section__title">Comments</h2>
        <p class="empty-state coming-soon">Coming soon — comment history will appear here once the comment system launches.</p>
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

  _bindEdit(el, profile) {
    const editBtn   = el.querySelector('#profile-edit-btn');
    const section   = el.querySelector('#edit-section');
    const cancelBtn = el.querySelector('#edit-cancel-btn');

    editBtn.addEventListener('click', () => {
      section.hidden = false;
      editBtn.hidden = true;
      this._buildAvatarPicker(el, profile.avatar || 'avatar-01.svg');
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    cancelBtn.addEventListener('click', () => {
      section.hidden = true;
      editBtn.hidden = false;
    });

    // Bio char counter
    const bioTextarea = el.querySelector('#edit-bio');
    const bioCount    = el.querySelector('#bio-char-count');
    bioTextarea.addEventListener('input', () => {
      bioCount.textContent = `${bioTextarea.value.length}/500`;
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
          display_name: form.display_name.value.trim() || null,
          phone:        form.phone.value.trim() || null,
          avatar:       form.avatar.value,
          bio:          form.bio.value.trim() || null,
        });
        const avatarName = updated.avatar || form.avatar.value;
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

    // Connected accounts form
    el.querySelector('#connected-form').addEventListener('submit', async e => {
      e.preventDefault();
      const form    = e.currentTarget;
      const errEl   = el.querySelector('#connected-error');
      const saveBtn = el.querySelector('#connected-save-btn');
      errEl.textContent = '';
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await updateProfile({
          github_username:   form.github_username.value.trim() || null,
          linkedin_username: form.linkedin_username.value.trim() || null,
        });
        showToast('Connected accounts updated', 'success');
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });
  }

  _bindThemeToggle(el, _profile) {
    const toggle    = el.querySelector('#theme-toggle');
    const themeLabel = el.querySelector('#theme-label');
    if (!toggle) return;

    toggle.addEventListener('change', async () => {
      const newTheme = toggle.checked ? 'light' : 'dark';
      themeLabel.textContent = toggle.checked ? 'Light' : 'Dark';
      applyTheme(newTheme);
      try {
        await updateProfile({ theme: newTheme });
      } catch {
        // non-critical — preference is in localStorage already
      }
    });
  }

  _bindNotifications(el, _profile) {
    const save = async (field, checked) => {
      try {
        await updateProfile({ [field]: checked });
      } catch {
        showToast('Failed to save notification preference', 'error');
      }
    };

    const commentsToggle = el.querySelector('#notify-comments-toggle');
    const updatesToggle  = el.querySelector('#notify-updates-toggle');
    commentsToggle?.addEventListener('change', () => save('notify_comments', commentsToggle.checked));
    updatesToggle?.addEventListener('change',  () => save('notify_updates',  updatesToggle.checked));
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
      const form  = e.currentTarget;
      const errEl = el.querySelector('#pw-error');
      const btn   = el.querySelector('#pw-save-btn');
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

  _bindFavorites(el) {
    const grid = el.querySelector('#fav-grid');
    if (!grid) return;

    grid.addEventListener('click', async e => {
      const btn = e.target.closest('.fav-remove-btn');
      if (!btn) return;
      const projectId = btn.dataset.projectId;
      btn.disabled = true;
      btn.textContent = 'Removing…';
      try {
        await removeFavorite(projectId);
        btn.closest('.fav-card').remove();
        if (grid.querySelectorAll('.fav-card').length === 0) {
          grid.innerHTML = '<p class="empty-state">No favorites yet. Heart a project to save it here.</p>';
        }
        showToast('Removed from favorites', 'success');
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = '♥ Remove';
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
        tbody.querySelectorAll('tr').forEach(row => {
          if (!row.querySelector('.session-current-badge')) row.remove();
        });
        showToast('All other sessions revoked', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  destroy() {
    // No window/document listeners to remove; all listeners are on child elements.
  }
}
