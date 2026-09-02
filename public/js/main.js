import { installGlobalErrorReporting } from './services/errorReporter.js';
import { tryRestoreSession, isAdmin } from './services/auth.js';
import { NavBar } from './components/NavBar.js';
import { Router } from './router.js';
import { showToast } from './components/Toast.js';
import { installRateLimitGuard } from './api/rateLimitGuard.js';
import { installSessionGuard } from './services/sessionGuard.js';
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

// ── 1. Restore session before anything renders ────────────────────────────────
await tryRestoreSession();

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

// ── The in-app feedback (change-request) widget ──────────────────────────────
// On TEST it's on for everyone; admins can hide the chrome per browser from the
// theme switcher, and the override can never switch it ON (getEffectiveEnv), so
// the blue TEST badge only ever appears on the real TEST stack. Outside TEST it
// mounts only when an admin switched it on (Admin → Feedback) AND the current
// user is an admin — customers must never see it, and the submit route
// re-checks the role anyway (ice #206). Lazy-loaded either way, so a normal
// production visitor never even fetches the module (or html2canvas). Mounted
// via the module-scoped singleton so the ThemeSwitcher's TEST toggle controls
// the same instance.
const IS_TEST = getEffectiveEnv() === 'test';
if (IS_TEST) {
  document.body.classList.add('is-test-env');
  if (getDemoMode()) document.body.classList.add('is-demo-mode');
  import('./components/ChangeRequestWidget.js')
    .then((m) => m.mountChangeRequestWidget())
    .catch((err) => console.error('[test-env] change-request widget failed to load', err));
} else {
  let crEnabled = null;   // null = not asked yet; it's a per-deploy setting, so ask once
  let crModule  = null;   // only ever loaded for an admin on a site that has it on

  const syncChangeRequests = async () => {
    if (!isAdmin()) { crModule?.syncChangeRequestWidget(); return; } // sign-out tears it down
    if (crEnabled === null) {
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
    if (!crEnabled) { crModule?.syncChangeRequestWidget(); return; }
    crModule = await import('./components/ChangeRequestWidget.js');
    crModule.setChangeRequestsEnabled(true);
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
