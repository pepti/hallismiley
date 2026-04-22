import { signup, checkUsername, checkEmail, resendVerification } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';

const TOTAL_AVATARS = 40;
const pad = n => String(n).padStart(2, '0');

function avatarPath(n) {
  return `/assets/avatars/avatar-${pad(n)}.svg`;
}

function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Za-z]/.test(pw)) score++;
  if (/\d/.test(pw))        score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  return { score, label: labels[score] || 'Very Strong' };
}

let _usernameTimer = null;
let _emailTimer    = null;

export class SignupView {
  async render() {
    const el = document.createElement('div');
    el.className = 'main signup-page';
    el.innerHTML = `
      <div class="signup-container">
        <div class="signup-card">
          <div class="signup-card__header">
            <p class="signup-eyebrow">${t('signup.eyebrow')}</p>
            <h1 class="signup-title">${t('signup.title')}</h1>
            <p class="signup-subtitle">${t('signup.alreadyHaveAccount')} <a href="${href('/login')}" class="signup-link" data-route="/login">${t('nav.signIn')}</a></p>
          </div>

          <a class="btn btn--outline btn--full btn--google" href="/auth/google"
             data-testid="signup-google">
            <img src="/assets/icons/google.svg" alt="" aria-hidden="true" class="btn__icon"/>
            <span>${t('signup.continueWithGoogle')}</span>
          </a>
          <a class="btn btn--outline btn--full btn--facebook" href="/auth/facebook"
             data-testid="signup-facebook">
            <img src="/assets/icons/facebook.svg" alt="" aria-hidden="true" class="btn__icon"/>
            <span>${t('signup.continueWithFacebook')}</span>
          </a>
          <div class="login-modal__divider signup-divider"><span>${t('signup.orEmail')}</span></div>

          <form class="signup-form" id="signup-form" novalidate data-testid="signup-form">

            <!-- Avatar picker -->
            <div class="form-group">
              <span class="form-label">${t('signup.chooseAvatar')}</span>
              <div class="avatar-picker" id="avatar-picker" data-testid="avatar-picker"></div>
              <input type="hidden" id="signup-avatar" name="avatar" value=""/>
            </div>

            <!-- Email + Username -->
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="signup-email">${t('checkout.email')} <span class="req">*</span></label>
                <input class="form-input" id="signup-email" name="email" type="email"
                       autocomplete="email" required placeholder="${t('auth.emailPlaceholder')}"/>
                <p class="form-field-status" id="email-status"></p>
              </div>
              <div class="form-group">
                <label class="form-label" for="signup-username">${t('adminUsers.username')} <span class="req">*</span></label>
                <input class="form-input" id="signup-username" name="username" type="text"
                       autocomplete="username" required placeholder="${t('auth.usernamePlaceholder')}"
                       minlength="3" maxlength="32"/>
                <p class="form-field-status" id="username-status"></p>
              </div>
            </div>

            <!-- Display name + Phone -->
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="signup-displayname">
                  ${t('signup.displayName')} <span class="form-hint">(${t('form.optional')})</span>
                </label>
                <input class="form-input" id="signup-displayname" name="displayName" type="text"
                       autocomplete="name" placeholder="${t('auth.displayNamePlaceholder')}"/>
              </div>
              <div class="form-group">
                <label class="form-label" for="signup-phone">
                  ${t('checkout.phone')} <span class="form-hint">(${t('form.optional')})</span>
                </label>
                <input class="form-input" id="signup-phone" name="phone" type="tel"
                       autocomplete="tel" placeholder="${t('auth.phonePlaceholder')}"/>
              </div>
            </div>

            <!-- Password -->
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="signup-password">${t('signup.password')} <span class="req">*</span></label>
                <input class="form-input" id="signup-password" name="password" type="password"
                       autocomplete="new-password" required/>
                <div class="password-strength" id="pw-strength" aria-live="polite"></div>
                <ul class="pw-requirements">
                  <li id="req-length">${t('signup.req8chars')}</li>
                  <li id="req-letter">${t('signup.req1letter')}</li>
                  <li id="req-number">${t('signup.req1number')}</li>
                </ul>
              </div>
              <div class="form-group">
                <label class="form-label" for="signup-confirm">${t('signup.confirmPassword')} <span class="req">*</span></label>
                <input class="form-input" id="signup-confirm" name="confirm" type="password"
                       autocomplete="new-password" required/>
                <p class="form-field-status" id="confirm-status"></p>
              </div>
            </div>

            <p class="form-error" id="signup-error" aria-live="polite"></p>
            <button class="btn btn--primary btn--full" type="submit" id="signup-btn">${t('signup.title')}</button>
          </form>

          <div class="signup-success" id="signup-success" hidden>
            <div class="signup-success__icon">✉</div>
            <h2 class="signup-success__title">${t('signup.checkEmail')}</h2>
            <p class="signup-success__text">
              ${t('signup.emailSentTo')} <strong id="signup-success-email"></strong>.
              ${t('signup.clickLink')}
            </p>
            <p class="signup-resend" id="signup-resend-wrap">
              ${t('signup.didntReceive')}
              <button type="button" class="signup-resend__btn" id="signup-resend-btn">${t('signup.resend')}</button>
              <span class="signup-resend__countdown" id="signup-resend-countdown" hidden></span>
            </p>
            <p class="signup-resend__msg" id="signup-resend-msg" aria-live="polite"></p>
            <a href="${href('/login')}" class="btn btn--outline" data-route="/login">${t('signup.goToSignIn')}</a>
          </div>
        </div>
      </div>
    `;

    this._buildAvatarPicker(el);
    this._bindForm(el);
    return el;
  }

  _buildAvatarPicker(el) {
    const picker = el.querySelector('#avatar-picker');
    const defaultIndex = Math.floor(Math.random() * TOTAL_AVATARS) + 1;
    el.querySelector('#signup-avatar').value = `avatar-${pad(defaultIndex)}`;
    for (let i = 1; i <= TOTAL_AVATARS; i++) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'avatar-picker__item' + (i === defaultIndex ? ' avatar-picker__item--selected' : '');
      item.dataset.avatar = `avatar-${pad(i)}`;
      item.setAttribute('aria-label', `Avatar ${i}`);
      item.innerHTML = `<img src="${avatarPath(i)}" alt="Avatar ${i}" loading="lazy"/>`;
      item.addEventListener('click', () => {
        picker.querySelectorAll('.avatar-picker__item').forEach(b => b.classList.remove('avatar-picker__item--selected'));
        item.classList.add('avatar-picker__item--selected');
        el.querySelector('#signup-avatar').value = item.dataset.avatar;
      });
      picker.appendChild(item);
    }
  }

  _bindForm(el) {
    const usernameInput = el.querySelector('#signup-username');
    const emailInput    = el.querySelector('#signup-email');
    const pwInput       = el.querySelector('#signup-password');
    const confirmInput  = el.querySelector('#signup-confirm');

    // Real-time username check (debounced 500ms)
    usernameInput.addEventListener('input', () => {
      clearTimeout(_usernameTimer);
      const val = usernameInput.value.trim();
      const statusEl = el.querySelector('#username-status');
      if (val.length < 3) { statusEl.textContent = ''; return; }
      statusEl.textContent = 'Checking…';
      statusEl.className = 'form-field-status';
      _usernameTimer = setTimeout(async () => {
        try {
          const { available } = await checkUsername(val);
          statusEl.textContent = available ? `✓ ${t('signup.available')}` : `✗ ${t('signup.taken')}`;
          statusEl.className   = 'form-field-status ' + (available ? 'status--ok' : 'status--err');
        } catch { statusEl.textContent = ''; }
      }, 500);
    });

    // Real-time email check (debounced 500ms)
    emailInput.addEventListener('input', () => {
      clearTimeout(_emailTimer);
      const val = emailInput.value.trim();
      const statusEl = el.querySelector('#email-status');
      if (!val.includes('@')) { statusEl.textContent = ''; return; }
      statusEl.textContent = 'Checking…';
      statusEl.className = 'form-field-status';
      _emailTimer = setTimeout(async () => {
        try {
          const { available } = await checkEmail(val);
          statusEl.textContent = available ? `✓ ${t('signup.available')}` : `✗ ${t('signup.emailTaken')}`;
          statusEl.className   = 'form-field-status ' + (available ? 'status--ok' : 'status--err');
        } catch { statusEl.textContent = ''; }
      }, 500);
    });

    // Password strength indicator
    pwInput.addEventListener('input', () => {
      const val = pwInput.value;
      const { score, label } = passwordStrength(val);
      const strengthEl = el.querySelector('#pw-strength');
      const pct = Math.min(100, score * 20);
      const cls = score <= 1 ? 'weak' : score <= 2 ? 'fair' : score <= 3 ? 'good' : 'strong';
      strengthEl.innerHTML = `
        <div class="pw-strength__bar">
          <div class="pw-strength__fill pw-strength__fill--${cls}" style="width:${pct}%"></div>
        </div>
        ${label ? `<span class="pw-strength__label pw-strength__label--${cls}">${escHtml(label)}</span>` : ''}
      `;
      // Update requirement checklist
      el.querySelector('#req-length').classList.toggle('req--met', val.length >= 8);
      el.querySelector('#req-letter').classList.toggle('req--met', /[A-Za-z]/.test(val));
      el.querySelector('#req-number').classList.toggle('req--met', /\d/.test(val));
    });

    // Confirm password match
    confirmInput.addEventListener('input', () => {
      const statusEl = el.querySelector('#confirm-status');
      if (!confirmInput.value) { statusEl.textContent = ''; return; }
      const match = confirmInput.value === pwInput.value;
      statusEl.textContent = match ? `✓ ${t('signup.passwordsMatch')}` : `✗ ${t('signup.passwordsMismatch')}`;
      statusEl.className   = 'form-field-status ' + (match ? 'status--ok' : 'status--err');
    });

    // Form submit
    el.querySelector('#signup-form').addEventListener('submit', e => this._onSubmit(e, el));
  }

  async _onSubmit(e, el) {
    e.preventDefault();
    const form    = e.currentTarget;
    const errEl   = el.querySelector('#signup-error');
    const btn     = el.querySelector('#signup-btn');
    const email   = form.email.value.trim();
    const username = form.username.value.trim();
    const password = form.password.value;
    const confirm  = form.confirm.value;

    errEl.textContent = '';

    // Client-side validation
    if (!email || !username || !password) {
      errEl.textContent = t('form.requiredFields'); return;
    }
    if (password.length < 8) {
      errEl.textContent = t('signup.pwMinLength'); return;
    }
    if (!/[A-Za-z]/.test(password)) {
      errEl.textContent = t('signup.pwNeedsLetter'); return;
    }
    if (!/\d/.test(password)) {
      errEl.textContent = t('signup.pwNeedsNumber'); return;
    }
    if (password !== confirm) {
      errEl.textContent = t('signup.passwordsMismatch'); return;
    }

    btn.disabled = true;
    btn.textContent = t('signup.creating');

    try {
      await signup({
        email,
        username,
        password,
        displayName: form.displayName?.value.trim() || undefined,
        phone:       form.phone?.value.trim() || undefined,
        avatar:      (form.avatar?.value || 'avatar-01') + '.svg',
      });

      // Show success state
      el.querySelector('#signup-success-email').textContent = email;
      el.querySelector('#signup-form').hidden = true;
      el.querySelector('#signup-success').hidden = false;
      this._bindResend(el, email);

    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = t('signup.title');
    }
  }

  _bindResend(el, email) {
    const btn         = el.querySelector('#signup-resend-btn');
    const countdown   = el.querySelector('#signup-resend-countdown');
    const msgEl       = el.querySelector('#signup-resend-msg');
    let   _timer      = null;

    const startCountdown = () => {
      let secs = 60;
      btn.disabled = true;
      countdown.hidden = false;
      countdown.textContent = `(${secs}s)`;
      _timer = setInterval(() => {
        secs--;
        if (secs <= 0) {
          clearInterval(_timer);
          btn.disabled = false;
          countdown.hidden = true;
          countdown.textContent = '';
        } else {
          countdown.textContent = `(${secs}s)`;
        }
      }, 1000);
    };

    btn.addEventListener('click', async () => {
      msgEl.textContent = '';
      try {
        await resendVerification(email);
        msgEl.textContent = t('signup.emailResent');
        startCountdown();
      } catch (err) {
        msgEl.textContent = err.message || t('signup.resendFailed');
      }
    });
  }
}
