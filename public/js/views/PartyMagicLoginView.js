import { partyMagicLogin } from '../services/auth.js';
import { t, href } from '../i18n/i18n.js';
import { showToast } from '../components/Toast.js';

// Landing view for the magic link in the party invite email
// (/<locale>/party/login?token=...). Consumes the token, signs the guest in,
// and hands off to the (now unlocked) party hub.
export class PartyMagicLoginView {
  constructor(queryString = '') {
    this._queryString = queryString;
  }

  async render() {
    const el = document.createElement('div');
    el.className = 'main auth-page';
    el.innerHTML = `
      <div class="auth-container">
        <div class="auth-card">
          <div class="auth-card__icon" id="magic-icon">🎉</div>
          <h1 class="auth-card__title" id="magic-title">${t('party.magicSigningIn')}</h1>
          <p class="auth-card__text" id="magic-text">${t('form.loading')}</p>
          <div id="magic-actions"></div>
        </div>
      </div>
    `;

    const token = new URLSearchParams(this._queryString).get('token');
    if (!token) { this._fail(el); return el; }

    try {
      // Pre-point the URL at the party hub BEFORE signing in. partyMagicLogin
      // dispatches 'authchange', which makes the router re-navigate; pointing at
      // /party first means it renders PartyView (unlocked) instead of re-running
      // this view, so the magic token is consumed exactly once.
      history.replaceState(null, '', href('/party'));
      await partyMagicLogin(token);
      showToast(t('party.magicWelcome'), 'success');
    } catch {
      history.replaceState(null, '', href('/party/login'));
      this._fail(el);
    }
    return el;
  }

  _fail(el) {
    const icon = el.querySelector('#magic-icon');
    icon.textContent = '✗';
    icon.className = 'auth-card__icon auth-card__icon--error';
    el.querySelector('#magic-title').textContent = t('common.error');
    el.querySelector('#magic-text').textContent  = t('party.magicLinkInvalid');
    el.querySelector('#magic-actions').innerHTML =
      `<a href="${href('/party')}" class="btn btn--primary" data-route="/party">${t('party.backToParty')}</a>`;
  }
}
