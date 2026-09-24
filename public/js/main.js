import { installGlobalErrorReporting } from './services/errorReporter.js';
import { tryRestoreSession, isAdmin } from './services/auth.js';
import { NavBar } from './components/NavBar.js';
import { Router } from './router.js';
import { showToast } from './components/Toast.js';
import { installRateLimitGuard } from './api/rateLimitGuard.js';
import { installSessionGuard } from './services/sessionGuard.js';
import { initCookieConsent } from './services/cookieConsent.js';
import { installBuildGuard } from './services/buildGuard.js';
import { ThemeSwitcher } from './components/ThemeSwitcher.js';
import { initTheme, getEffectiveEnv, getDemoMode } from './services/themePrefs.js';
import { syncBodyClass as syncAmbienceClass } from './services/ambiencePrefs.js';
import {
  loadLocale, getLocaleFromHash, getPreferredLocale, t,
} from './i18n/i18n.js';

// Install the fetch wrapper before any awaits so every subsequent fetch —
// including the one tryRestoreSession() may issue — is covered.
installRateLimitGuard();
installSessionGuard();
// Notice a deploy while this tab is open and reload onto the new release at the
// next navigation or refocus (services/buildGuard.js; icelandicstore #332).
installBuildGuard();

// ── 1. Restore session before anything renders ────────────────────────────────
await tryRestoreSession();
// The cookie banner waits for this: a signed-in user whose account already
// holds an answer is never shown it (services/cookieConsent.js, migration 111).
initCookieConsent();

// ── 2. Determine and load the active locale ───────────────────────────────────
// Priority: locale in the URL hash → user's saved preference → Icelandic.
// The browser's own language list is deliberately not consulted — see
// resolveUserLocale in ./i18n/i18n.js.
const initialLocale = getLocaleFromHash() || getPreferredLocale();
await loadLocale(initialLocale);

// Translate the static chrome that ships in index.html (the skip link) — it
// renders before any module runs, so its markup carries Icelandic defaults
// and gets re-translated here once messages are in.
for (const el of document.querySelectorAll('body > [data-i18n]')) {
  el.textContent = t(el.dataset.i18n);
}

// ── 3. Render NavBar + mount Router ──────────────────────────────────────────
const navBar = new NavBar();
const navEl  = navBar.render();
document.body.insertBefore(navEl, document.getElementById('app'));

// ── Floating theme switcher — mounted outside #app so it survives SPA nav ──
// theme-boot.js already applied the saved theme pre-paint; initTheme() re-syncs
// at runtime in case the boot script was blocked.
installGlobalErrorReporting(); // client failures → /api/v1/events/collect (ice #195)
initTheme();
syncAmbienceClass(); // body.amb-off mirrors the visitor's live-Iceland pref
document.body.appendChild(new ThemeSwitcher().render());

// ── The TEST chrome + in-app feedback (change-request) widget ────────────────
// Admins only, everywhere (Halli, 2026-09-22). On the TEST stack a signed-in
// admin gets the blue badge, the nav/footer glow and the widget, and can hide
// them per browser from the theme switcher; a logged-out visitor or a customer
// sees the site exactly as production (getEffectiveEnv). Outside TEST the
// widget mounts only when an admin switched it on (Admin → Feedback). The
// submit route re-checks the role either way (changeRequestGate, ice #206).
// Lazy-loaded, so a non-admin never even fetches the module (or html2canvas).
// Mounted via the module-scoped singleton so the ThemeSwitcher's TEST toggle
// controls the same instance. Re-run on every 'authchange': the session is
// restored after this runs, so the first pass always sees a logged-out user.
{
  let crEnabled = null;   // null = not asked yet; it's a per-deploy setting, so ask once
  let crModule  = null;   // only ever loaded for an admin

  const syncTestChrome = () => {
    const on = getEffectiveEnv() === 'test';
    document.body.classList.toggle('is-test-env', on);
    document.body.classList.toggle('is-demo-mode', on && getDemoMode());
    return on;
  };

  const syncChangeRequests = async () => {
    const testOn = syncTestChrome();
    if (!isAdmin()) {
      // Sign-out tears it down — including a widget the theme switcher's TEST
      // toggle mounted, which this closure never imported itself.
      if (!crModule && document.getElementById('cr-widget')) {
        crModule = await import('./components/ChangeRequestWidget.js');
      }
      crModule?.syncChangeRequestWidget();
      return;
    }
    if (!testOn && crEnabled === null) {
      try {
        // The admin-only settings endpoint, deliberately not a public config
        // route: whether the widget is on is nobody else's business, and only
        // an admin ever gets this far.
        const res = await fetch('/api/v1/admin/change-requests/settings', { credentials: 'include' });
        crEnabled = res.ok ? !!(await res.json())?.enabled : false;
      } catch {
        crEnabled = false; // endpoint unreachable → stay quiet
      }
    }
    if (!testOn && !crEnabled) { crModule?.syncChangeRequestWidget(); return; }
    crModule = await import('./components/ChangeRequestWidget.js');
    crModule.setChangeRequestsEnabled(!!crEnabled);
    crModule.syncChangeRequestWidget();
  };

  syncChangeRequests().catch((err) => console.error('[change-request] widget failed to load', err));
  // Mount on admin sign-in / tear down on sign-out, without a reload.
  window.addEventListener('authchange', () => { syncChangeRequests(); });
  // Flipping the switch in Admin → Feedback applies immediately — otherwise
  // turning it on looks like it did nothing until the next full page load.
  window.addEventListener('changerequestschange', (e) => {
    crEnabled = !!e.detail?.enabled;
    crModule?.setChangeRequestsEnabled(crEnabled);
    syncChangeRequests();
  });
}

// ── 4. OAuth redirect landing — show toast for ?error ────────────────────────
(function handleOAuthLanding() {
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx < 0) return;

  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const error  = params.get('error');
  if (!error) return;

  const OAUTH_ERROR_KEYS = {
    invalid_state:            'auth.errors.invalidState',
    oauth_failed:             'auth.errors.oauthFailed',
    account_disabled:         'auth.errors.accountDisabled',
    google_profile_invalid:   'auth.errors.googleProfileInvalid',
    google_not_configured:    'auth.errors.googleNotConfigured',
    signup_closed:            'auth.errors.signupClosed',
    email_already_registered: 'auth.errors.emailAlreadyRegistered',
    facebook_profile_invalid: 'auth.errors.facebookProfileInvalid',
    admin_oauth_blocked:      'auth.errors.adminOauthBlocked',
    facebook_not_configured:  'auth.errors.facebookNotConfigured',
  };

  if (OAUTH_ERROR_KEYS[error]) {
    showToast(t(OAUTH_ERROR_KEYS[error]), 'error', 5000);
  }

  params.delete('error');
  const rest    = params.toString();
  const path    = hash.slice(1, qIdx);
  const cleaned = '#' + path + (rest ? '?' + rest : '');
  window.history.replaceState(null, '', cleaned || '#/');
})();

const router = new Router(document.getElementById('app'), navBar);
router.init();
