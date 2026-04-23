import { resetPassword } from '../services/auth.js';
import { t, href } from '../i18n/i18n.js';
import { bindAllPasswordToggles } from '../utils/passwordToggle.js';

export class ResetPasswordView {
  constructor(queryString = '') {
    this._queryString = queryString;
  }

  async render() {
    const params = new URLSearchParams(this._queryString);
    const token  = params.get('token');

    const el = document.createElement('div');
    el.className = 'main auth-page';

    if (!token) {
      el.innerHTML = `
        <div class="auth-container">
          <div class="auth-card">
            <div class="auth-card__icon auth-card__icon--error">✗</div>
            <h1 class="auth-card__title">${t('resetPassword.error')}</h1>
            <p class="auth-card__text">${t('resetPassword.error')}</p>
            <a href="${href('/forgot-password')}" class="btn btn--primary">${t('forgotPassword.submit')}</a>
          </div>
        </div>`;
      return el;
    }

    el.innerHTML = `
      <div class="auth-container">
        <div class="auth-card">
          <h1 class="auth-card__title">${t('resetPassword.title')}</h1>

          <form class="auth-form" id="reset-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="reset-password">${t('resetPassword.newPassword')} <span class="req">*</span></label>
              <input class="form-input" id="reset-password" name="password" type="password"
                     autocomplete="new-password" required/>
              <div class="password-strength" id="reset-pw-strength" aria-live="polite"></div>
            </div>
            <div class="form-group">
              <label class="form-label" for="reset-confirm">${t('resetPassword.confirmPassword')} <span class="req">*</span></label>
              <input class="form-input" id="reset-confirm" name="confirm" type="password"
                     autocomplete="new-password" required/>
              <p class="form-field-status" id="reset-confirm-status"></p>
            </div>
            <p class="form-error" id="reset-error" aria-live="polite"></p>
            <button class="btn btn--primary btn--full" type="submit" id="reset-btn">${t('resetPassword.submit')}</button>
          </form>

          <div class="auth-success" id="reset-success" hidden>
            <div class="auth-success__icon">✓</div>
            <p class="auth-success__text">${t('resetPassword.success')}</p>
            <a href="${href('/login')}" class="btn btn--primary">${t('auth.signIn')}</a>
          </div>
        </div>
      </div>
    `;

    bindAllPasswordToggles(el);

    const pwInput      = el.querySelector('#reset-password');
    const confirmInput = el.querySelector('#reset-confirm');

    pwInput.addEventListener('input', () => {
      const val   = pwInput.value;
      const score = [val.length >= 8, /[A-Za-z]/.test(val), /\d/.test(val)].filter(Boolean).length;
      const pct   = score * 33;
      const cls   = score <= 1 ? 'weak' : score === 2 ? 'fair' : 'strong';
      el.querySelector('#reset-pw-strength').innerHTML = `
        <div class="pw-strength__bar">
          <div class="pw-strength__fill pw-strength__fill--${cls}" style="width:${pct}%"></div>
        </div>`;
    });

    confirmInput.addEventListener('input', () => {
      const statusEl = el.querySelector('#reset-confirm-status');
      if (!confirmInput.value) { statusEl.textContent = ''; return; }
      const match = confirmInput.value === pwInput.value;
      statusEl.textContent = match ? '✓' : '✗ ' + t('resetPassword.mismatch');
      statusEl.className   = 'form-field-status ' + (match ? 'status--ok' : 'status--err');
    });

    el.querySelector('#reset-form').addEventListener('submit', async e => {
      e.preventDefault();
      const form  = e.currentTarget;
      const errEl = el.querySelector('#reset-error');
      const btn   = el.querySelector('#reset-btn');
      const pw    = form.password.value;
      const conf  = form.confirm.value;

      errEl.textContent = '';
      if (pw.length < 8)        { errEl.textContent = t('signup.passwordTooShort'); return; }
      if (pw !== conf)          { errEl.textContent = t('resetPassword.mismatch'); return; }

      btn.disabled    = true;
      btn.textContent = t('form.saving');

      try {
        await resetPassword(token, pw);
        form.hidden = true;
        el.querySelector('#reset-success').hidden = false;
      } catch (err) {
        errEl.textContent = err.message || t('resetPassword.error');
        btn.disabled    = false;
        btn.textContent = t('resetPassword.submit');
      }
    });

    return el;
  }
}
