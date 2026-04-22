import { verifyEmail } from '../services/auth.js';
import { t, href } from '../i18n/i18n.js';

export class VerifyEmailView {
  constructor(queryString = '') {
    this._queryString = queryString;
  }

  async render() {
    const el = document.createElement('div');
    el.className = 'main auth-page';
    el.innerHTML = `
      <div class="auth-container">
        <div class="auth-card">
          <div class="auth-card__icon" id="verify-icon">⏳</div>
          <h1 class="auth-card__title" id="verify-title">${t('verifyEmail.loading')}</h1>
          <p class="auth-card__text" id="verify-text">${t('form.loading')}</p>
          <div id="verify-actions"></div>
        </div>
      </div>
    `;

    const params = new URLSearchParams(this._queryString);
    const token  = params.get('token');

    if (!token) {
      this._setResult(el, false, t('verifyEmail.error'));
      return el;
    }

    try {
      await verifyEmail(token);
      this._setResult(el, true, t('verifyEmail.success'));
    } catch {
      this._setResult(el, false, t('verifyEmail.error'));
    }

    return el;
  }

  _setResult(el, success, message) {
    el.querySelector('#verify-icon').textContent  = success ? '✓' : '✗';
    el.querySelector('#verify-title').textContent = success ? t('verifyEmail.title') : t('common.error');
    el.querySelector('#verify-text').textContent  = message;

    const actions = el.querySelector('#verify-actions');
    if (success) {
      actions.innerHTML = `<a href="${href('/login')}" class="btn btn--primary" data-route="/login">${t('auth.signIn')}</a>`;
    } else {
      actions.innerHTML = `
        <a href="${href('/signup')}" class="btn btn--outline" data-route="/signup">${t('auth.signUp')}</a>
        <a href="${href('/')}" class="btn btn--ghost" data-route="/" style="margin-left:8px">${t('notFound.goHome')}</a>
      `;
    }

    const icon = el.querySelector('#verify-icon');
    icon.className = 'auth-card__icon ' + (success ? 'auth-card__icon--success' : 'auth-card__icon--error');
  }
}
