import { tryRestoreSession } from './services/auth.js';
import { NavBar } from './components/NavBar.js';
import { Router } from './router.js';
import { showToast } from './components/Toast.js';
import { installRateLimitGuard } from './api/rateLimitGuard.js';
import {
  loadLocale, getLocaleFromHash, getPreferredLocale, t,
} from './i18n/i18n.js';

// ── 1. Restore session before anything renders ────────────────────────────────
await tryRestoreSession();
installRateLimitGuard();

// ── 2. Determine and load the active locale ───────────────────────────────────
// Priority: locale in the URL hash → user's saved preference → Accept-Language
const initialLocale = getLocaleFromHash() || getPreferredLocale();
await loadLocale(initialLocale);

// ── 3. Render NavBar + mount Router ──────────────────────────────────────────
const navBar = new NavBar();
const navEl  = navBar.render();
document.body.insertBefore(navEl, document.getElementById('app'));

// ── 4. OAuth redirect landing — show toast for ?welcome or ?error ─────────────
(function handleOAuthLanding() {
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx < 0) return;

  const params  = new URLSearchParams(hash.slice(qIdx + 1));
  const welcome = params.get('welcome');
  const error   = params.get('error');
  if (!welcome && !error) return;

  const OAUTH_ERROR_KEYS = {
    invalid_state:            'auth.errors.invalidState',
    oauth_failed:             'auth.errors.oauthFailed',
    account_disabled:         'auth.errors.accountDisabled',
    google_profile_invalid:   'auth.errors.googleProfileInvalid',
    google_not_configured:    'auth.errors.googleNotConfigured',
    facebook_profile_invalid: 'auth.errors.facebookProfileInvalid',
    facebook_not_configured:  'auth.errors.facebookNotConfigured',
  };

  if (welcome === 'google') {
    showToast(t('auth.oauthSuccess.google'), 'success');
  } else if (welcome === 'facebook') {
    showToast(t('auth.oauthSuccess.facebook'), 'success');
  } else if (error && OAUTH_ERROR_KEYS[error]) {
    showToast(t(OAUTH_ERROR_KEYS[error]), 'error', 5000);
  }

  params.delete('welcome');
  params.delete('error');
  const rest    = params.toString();
  const path    = hash.slice(1, qIdx);
  const cleaned = '#' + path + (rest ? '?' + rest : '');
  window.history.replaceState(null, '', cleaned || '#/');
})();

const router = new Router(document.getElementById('app'), navBar);
router.init();
