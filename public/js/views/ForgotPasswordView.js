import { forgotPassword } from '../services/auth.js';
import { t, href } from '../i18n/i18n.js';

export class ForgotPasswordView {
  async render() {
    const el = document.createElement('div');
    el.className = 'main auth-page';
    el.innerHTML = `
      <div class="auth-container">
        <div class="auth-card">
          <div class="auth-card__eyebrow">${t('forgotPassword.title')}</div>
          <h1 class="auth-card__title">${t('forgotPassword.title')}</h1>
          <p class="auth-card__text">${t('forgotPassword.subtitle')}</p>

          <form class="auth-form" id="forgot-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="forgot-email">${t('forgotPassword.emailLabel')}</label>
              <input class="form-input" id="forgot-email" name="email" type="email"
                     autocomplete="email" required placeholder="${t('auth.emailPlaceholder')}"/>
            </div>
            <p class="form-error" id="forgot-error" aria-live="polite"></p>
            <button class="btn btn--primary btn--full" type="submit" id="forgot-btn">${t('forgotPassword.submit')}</button>
          </form>

          <div class="auth-success" id="forgot-success" hidden>
            <div class="auth-success__icon">✉</div>
            <p class="auth-success__text">${t('forgotPassword.success')}</p>
          </div>

          <p class="auth-footer-links">
            <a href="${href('/login')}" class="signup-link" data-route="/login">${t('forgotPassword.backToSignIn')}</a>
          </p>
        </div>
      </div>
    `;

    el.querySelector('#forgot-form').addEventListener('submit', async e => {
      e.preventDefault();
      const form  = e.currentTarget;
      const errEl = el.querySelector('#forgot-error');
      const btn   = el.querySelector('#forgot-btn');
      const email = form.email.value.trim();

      errEl.textContent = '';
      if (!email) { errEl.textContent = t('forgotPassword.emailLabel') + ' ' + t('auth.required'); return; }

      btn.disabled    = true;
      btn.textContent = t('form.loading');

      try {
        await forgotPassword(email);
        form.hidden = true;
        el.querySelector('#forgot-success').hidden = false;
      } catch {
        form.hidden = true;
        el.querySelector('#forgot-success').hidden = false;
      }
    });

    return el;
  }
}
