import { verifyEmail } from '../services/auth.js';

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
          <h1 class="auth-card__title" id="verify-title">Verifying Email</h1>
          <p class="auth-card__text" id="verify-text">Please wait…</p>
          <div id="verify-actions"></div>
        </div>
      </div>
    `;

    // Auto-submit on load
    const params = new URLSearchParams(this._queryString);
    const token  = params.get('token');

    if (!token) {
      this._setResult(el, false, 'No verification token found. Please check your email link.');
      return el;
    }

    try {
      await verifyEmail(token);
      this._setResult(el, true, 'Your email has been verified! You can now sign in.');
    } catch (err) {
      this._setResult(el, false, err.message || 'Verification failed. The link may have expired.');
    }

    return el;
  }

  _setResult(el, success, message) {
    el.querySelector('#verify-icon').textContent  = success ? '✓' : '✗';
    el.querySelector('#verify-title').textContent = success ? 'Email Verified!' : 'Verification Failed';
    el.querySelector('#verify-text').textContent  = message;

    const actions = el.querySelector('#verify-actions');
    if (success) {
      actions.innerHTML = `<a href="#/login" class="btn btn--primary" data-route="/login">Sign In</a>`;
    } else {
      actions.innerHTML = `
        <a href="#/signup" class="btn btn--outline" data-route="/signup">Sign Up Again</a>
        <a href="#/" class="btn btn--ghost" data-route="/" style="margin-left:8px">Go Home</a>
      `;
    }

    // Style the icon
    const icon = el.querySelector('#verify-icon');
    icon.className = 'auth-card__icon ' + (success ? 'auth-card__icon--success' : 'auth-card__icon--error');
  }
}
