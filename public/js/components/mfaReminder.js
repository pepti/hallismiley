// mfaReminder — the dismissible two-step reminder (mfa-reminder-2026-09-23).
//
// Halli, 2026-09-23: two-factor enrolment is optional, "but put a reminder
// somewhere, and a checkmark not to see the reminder again". Shown atop the
// admin shell (AdminSidebar.renderAdminShell) and the seller area
// (SellerAreaView) when the session says `mfa_reminder` — the server's call:
// enrolment `optional`, a protected account (admin, `accounts` holder,
// published seller) without TOTP, not dismissed (authController.roleFields).
// Under `required` the forced flow applies instead and the flag is false.
//
// Two ways out, deliberately different:
//   • ✕ hides it until the page is next loaded (a module flag — in memory,
//     so moving between admin screens does not bring it back, a reload does).
//   • Ticking "Ekki sýna þetta aftur" saves at once — per account, on the
//     server (POST /auth/mfa-reminder/dismiss) — and the notice closes with a
//     toast that says where two-step lives. Nothing to confirm afterwards: the
//     tick IS the choice. On failure the box unticks and the error shows.
//
// DRAFT (2026-09-23): the mfaReminder.* copy, IS first with an EN mirror, is
// awaiting Halli's approval.
//
// Tokens only (invariant 15) — mfa-reminder.css.
import { t, href } from '../i18n/i18n.js';
import { mfaReminderDue, dismissMfaReminder } from '../services/auth.js';
import { showToast } from './Toast.js';

let closedThisPage = false;

/**
 * The reminder element, or null when it is not due. The caller inserts it
 * above its content; the element removes itself when closed.
 */
export function renderMfaReminder() {
  if (closedThisPage || !mfaReminderDue()) return null;

  const el = document.createElement('section');
  el.className = 'mfa-reminder';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-labelledby', 'mfa-reminder-title');
  el.dataset.testid = 'mfa-reminder';
  el.innerHTML = `
    <div class="mfa-reminder__body">
      <p class="mfa-reminder__title" id="mfa-reminder-title">${t('mfaReminder.title')}</p>
      <p class="mfa-reminder__text">${t('mfaReminder.text')}</p>
      <div class="mfa-reminder__actions">
        <a class="btn btn--primary btn--sm" href="${href('/profile')}?focus=2fa"
           data-testid="mfa-reminder-setup">${t('mfaReminder.setUp')}</a>
        <label class="mfa-reminder__never">
          <input type="checkbox" data-testid="mfa-reminder-never"/>
          <span>${t('mfaReminder.dontShowAgain')}</span>
        </label>
      </div>
      <p class="mfa-reminder__error" role="alert" hidden></p>
    </div>
    <button type="button" class="mfa-reminder__close" data-testid="mfa-reminder-close"
            aria-label="${t('mfaReminder.close')}" title="${t('mfaReminder.close')}">
      <span aria-hidden="true">✕</span>
    </button>
  `;

  const box = el.querySelector('input[type="checkbox"]');
  const errEl = el.querySelector('.mfa-reminder__error');

  // Focus would otherwise fall to <body> when the notice leaves the DOM; hand
  // it to the page's own heading, the next thing a keyboard user wants.
  // (Asked before anything is disabled: a disabled control drops focus.)
  function remove(hadFocus) {
    const scope = el.parentElement;
    el.remove();
    if (!hadFocus || !scope) return;
    const heading = scope.querySelector('h1, h2');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
  }

  el.querySelector('.mfa-reminder__close').addEventListener('click', () => {
    const hadFocus = el.contains(document.activeElement);
    closedThisPage = true;
    remove(hadFocus);
  });

  box.addEventListener('change', async () => {
    if (!box.checked) return;
    const hadFocus = el.contains(document.activeElement);
    box.disabled = true;
    errEl.hidden = true;
    try {
      await dismissMfaReminder();
      closedThisPage = true;
      remove(hadFocus);
      showToast(t('mfaReminder.dismissed'));
    } catch (err) {
      box.checked = false;
      box.disabled = false;
      errEl.textContent = err.message || t('mfaReminder.saveError');
      errEl.hidden = false;
    }
  });

  return el;
}
