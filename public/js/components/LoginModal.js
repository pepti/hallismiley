import { login, loginTotp } from '../services/auth.js';
import { decideTotpFailure } from './totpFailure.js';
import { showToast } from './Toast.js';
import { t, href }   from '../i18n/i18n.js';
import { bindAllPasswordToggles } from '../utils/passwordToggle.js';

export class LoginModal {
  constructor() {
    this._overlay = null;
  }

  mount() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay login-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'login-title');
    // After OAuth, return the user to the page they opened the modal from.
    const returnTo = window.location.pathname;
    const rtParam  = `?returnTo=${encodeURIComponent(returnTo)}`;
    overlay.innerHTML = `
      <div class="modal login-modal">
        <button class="modal__close" aria-label="${t('login.close')}">&times;</button>
        <h2 class="modal__title" id="login-title">${t('login.title')}</h2>

        <a class="btn btn--outline btn--full btn--google" href="/auth/google${rtParam}"
           data-testid="login-google">
          <img src="/assets/icons/google.svg" alt="" aria-hidden="true" class="btn__icon"/>
          <span>${t('login.continueWithGoogle')}</span>
        </a>
        <div class="login-modal__divider"><span>${t('login.orSignInWithEmail')}</span></div>

        <form class="login-form" novalidate data-testid="login-form">
          <div class="form-group">
            <label class="form-label" for="login-username">${t('login.email')}</label>
            <input class="form-input" id="login-username" name="username"
              type="text" autocomplete="username"
              inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false"
              required />
          </div>
          <div class="form-group">
            <label class="form-label" for="login-password">${t('login.password')}</label>
            <input class="form-input" id="login-password" name="password"
              type="password" autocomplete="current-password" required />
          </div>
          <p class="form-error" aria-live="polite"></p>
          <button class="btn btn--primary btn--full" type="submit" data-testid="login-submit">${t('login.submit')}</button>
          <div class="login-modal__footer">
            <a href="${href('/forgot-password')}" class="login-modal__link" data-route="/forgot-password"
               id="login-forgot-link">${t('login.forgotPassword')}</a>
            <span class="login-modal__sep">·</span>
            <a href="${href('/signup')}" class="login-modal__link" data-route="/signup"
               id="login-signup-link">${t('login.signUp')}</a>
          </div>
        </form>
      </div>
    `;

    overlay.querySelector('.modal__close').addEventListener('click', () => this.close());
    overlay.addEventListener('click', e => { if (e.target === overlay) this.close(); });
    overlay.querySelector('.login-form').addEventListener('submit', e => this._onSubmit(e));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });

    overlay.querySelector('#login-forgot-link').addEventListener('click', () => this.close());
    overlay.querySelector('#login-signup-link').addEventListener('click', () => this.close());

    document.body.appendChild(overlay);
    this._overlay = overlay;

    bindAllPasswordToggles(overlay);
  }

  open() {
    if (!this._overlay) this.mount();
    // The code step replaces the modal's innards, so a reopen after an abandoned
    // 2FA attempt would otherwise find no password form (and throw on focus()).
    if (!this._overlay.querySelector('#login-username')) this._resetToPasswordStep();
    // Refresh OAuth returnTo on every open — the modal mounts once but the
    // user's current path may have changed since the last open.
    this._refreshOAuthReturnTo();
    requestAnimationFrame(() => this._overlay.classList.add('open'));
    this._overlay.querySelector('#login-username').focus();
  }

  // Rebuild the password step when the modal is reopened after a swapped-out DOM.
  _resetToPasswordStep() {
    if (!this._overlay) return;
    this._overlay.remove();
    this._overlay = null;
    this.mount();
  }

  _refreshOAuthReturnTo() {
    const rtParam = `?returnTo=${encodeURIComponent(window.location.pathname)}`;
    const g = this._overlay.querySelector('[data-testid="login-google"]');
    if (g) g.href = `/auth/google${rtParam}`;
  }

  close() {
    if (!this._overlay) return;
    this._overlay.classList.remove('open');
    const errEl = this._overlay.querySelector('.form-error');
    if (errEl) errEl.textContent = '';
    this._overlay.querySelector('.login-form')?.reset();
  }

  async _onSubmit(e) {
    e.preventDefault();
    const form     = e.currentTarget;
    const errEl    = form.querySelector('.form-error');
    const btn      = form.querySelector('[type=submit]');
    const username = form.username.value.trim();
    const password = form.password.value;

    errEl.textContent = '';
    btn.disabled    = true;
    btn.textContent = t('login.signingIn');

    try {
      const result = await login(username, password);
      // Protected account: the password was right but nothing is signed in yet.
      if (result?.mfaRequired) {
        this._showTotpStep(result.challengeId);
        return;
      }
      this.close();
      showToast(t('auth.signIn'), 'success');
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled    = false;
      btn.textContent = t('login.submit');
    }
  }

  // Swap the password form for the code step. The password form is replaced
  // rather than hidden so a stale password can't sit in the DOM, and so there is
  // no way to submit step one again while a challenge is open.
  _showTotpStep(challengeId) {
    const modal = this._overlay.querySelector('.login-modal');
    modal.innerHTML = `
      <button class="modal__close" aria-label="${t('login.close')}">&times;</button>
      <h2 class="modal__title" id="login-title">${t('login.totpTitle')}</h2>
      <p class="login-modal__hint">${t('login.totpHint')}</p>
      <form class="login-form" novalidate data-testid="login-totp-form">
        <div class="form-group">
          <label class="form-label" for="login-totp">${t('login.totpLabel')}</label>
          <input class="form-input" id="login-totp" name="code" type="text"
                 inputmode="numeric" autocomplete="one-time-code"
                 autocapitalize="off" spellcheck="false"
                 placeholder="123456" required data-testid="login-totp-input" />
        </div>
        <div class="form-error" role="alert"></div>
        <button class="btn btn--primary btn--full" type="submit" data-testid="login-totp-submit">${t('login.totpSubmit')}</button>
        <div class="login-modal__footer">
          <button type="button" class="login-modal__link" id="login-totp-recovery">${t('login.totpUseRecovery')}</button>
        </div>
      </form>
    `;

    modal.querySelector('.modal__close').addEventListener('click', () => this.close());
    // Recovery codes are longer and not numeric — relax the input so the field
    // stops fighting the user when they paste one off paper.
    modal.querySelector('#login-totp-recovery').addEventListener('click', () => {
      const input = modal.querySelector('#login-totp');
      input.removeAttribute('inputmode');
      input.placeholder = 'ABCDE-FGHJK';
      modal.querySelector('.login-modal__hint').textContent = t('login.totpRecoveryHint');
      input.value = '';
      input.focus();
    });
    modal.querySelector('.login-form').addEventListener('submit', e => this._onTotpSubmit(e, challengeId));
    modal.querySelector('#login-totp').focus();
  }

  async _onTotpSubmit(e, challengeId) {
    e.preventDefault();
    const form  = e.currentTarget;
    const errEl = form.querySelector('.form-error');
    const btn   = form.querySelector('[type=submit]');
    const code  = form.code.value.trim();

    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = t('login.signingIn');

    // Decided by totpFailure.js so the rule is testable without a DOM. A
    // mistyped code must always leave the form usable — the server allows five
    // attempts, so the UI has to let the user actually spend them.
    //
    // Default true so a success path (or an unexpected throw before the catch
    // assigns) still restores the button rather than stranding it.
    let reEnableSubmit = true;

    try {
      const data = await loginTotp(challengeId, code);
      this.close();
      showToast(t('auth.signIn'), 'success');
      // A recovery code just got burned — say so, and say how many are left.
      // For a single-admin site, running out silently is the failure mode
      // that ends with nobody able to sign in.
      if (data.usedRecoveryCode) {
        showToast(t('login.recoveryCodeUsed', { n: data.recoveryCodesRemaining }), 'warning', 9000);
      }
    } catch (err) {
      const decision = decideTotpFailure(err);

      // Say how many tries are left. Without it a wrong code looks identical to
      // the last wrong code, and the user has no idea they are one away from
      // being sent back to the start.
      // `err?.message` because decideTotpFailure deliberately tolerates a null
      // error; dereferencing it here anyway would throw inside the catch and
      // escape as an unhandled rejection, leaving a form that silently did
      // nothing. The two must agree about what they accept.
      const message = err?.message || t('login.totpGenericError');
      errEl.textContent = decision.attemptsRemaining !== null
        ? `${message} ${t('login.totpAttemptsLeft', { n: decision.attemptsRemaining })}`
        : message;

      // Read straight off the decision, so the property the tests assert is the
      // property that actually drives the button. Keeping a parallel local flag
      // meant the rule could be tested and the UI still broken.
      reEnableSubmit = decision.reEnableSubmit;

      if (decision.restart) {
        // The challenge is gone (expired or spent). Keeping the code box open
        // would just collect guesses against nothing — go back to step one.
        setTimeout(() => { this.close(); this.open(); }, 2500);
      }
      if (decision.clearInput) {
        // Ready for the next attempt without the user having to clear the field.
        form.code.value = '';
        form.code.focus();
      }
    } finally {
      if (reEnableSubmit) {
        btn.disabled = false;
        btn.textContent = t('login.totpSubmit');
      }
    }
  }
}
