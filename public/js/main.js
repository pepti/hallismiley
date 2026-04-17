import { tryRestoreSession } from './services/auth.js';
import { NavBar } from './components/NavBar.js';
import { Router } from './router.js';
import { showToast } from './components/Toast.js';
import { installDirtyGuard } from './utils/dirtyGuard.js';

// Warn before navigating away if any contentEditable edit is in flight.
installDirtyGuard();

// Silently try to restore session from refresh token cookie before first render
await tryRestoreSession();

const navBar = new NavBar();
const navEl  = navBar.render();
document.body.insertBefore(navEl, document.getElementById('app'));

// ── OAuth redirect landing — show a toast for ?welcome or ?error, then strip the
// query string from the hash so refresh doesn't re-fire the toast. Must run
// BEFORE router.init(): the /login route redirects to /#/ on match, which
// would erase our query params before we get to read them.
(function handleOAuthLanding() {
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx < 0) return;

  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const welcome = params.get('welcome');
  const error   = params.get('error');
  if (!welcome && !error) return;

  const OAUTH_ERRORS = {
    invalid_state:             'Sign-in was interrupted. Please try again.',
    oauth_failed:              'Sign-in failed. Please try again.',
    account_disabled:          'This account has been disabled.',
    google_profile_invalid:    'Your Google account did not return a verified email.',
    google_not_configured:     'Google sign-in is not configured on this site.',
    facebook_profile_invalid:  'Your Facebook account did not return an email. Please use a different sign-in method.',
    facebook_not_configured:   'Facebook sign-in is not configured on this site.',
  };

  if (welcome === 'google') {
    showToast('Signed in with Google', 'success');
  } else if (welcome === 'facebook') {
    showToast('Signed in with Facebook', 'success');
  } else if (error && OAUTH_ERRORS[error]) {
    showToast(OAUTH_ERRORS[error], 'error', 5000);
  }

  // Strip welcome/error from the hash without triggering a hashchange (which
  // would re-fire navigation and wipe the toast on re-render).
  params.delete('welcome');
  params.delete('error');
  const rest = params.toString();
  const path = hash.slice(1, qIdx); // strip leading '#'
  const cleaned = '#' + path + (rest ? '?' + rest : '');
  window.history.replaceState(null, '', cleaned || '#/');
})();

const router = new Router(document.getElementById('app'), navBar);
router.init();
