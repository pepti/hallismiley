import { showToast } from '../components/Toast.js';
import { t } from '../i18n/i18n.js';
import { decideWarn } from './rateLimitDecide.js';

const MSG_KEY = 'rateLimit.lowQuotaWarning';

// null = never warned. Distinct from a numeric timestamp so the cooldown gate
// in decideWarn() doesn't falsely fire on the very first low-quota response.
let _lastWarnAt = null;

// The client error beacon (services/errorReporter.js) posts through this same
// wrapped window.fetch. Warning on ITS quota would be a feedback loop: low
// quota → error toast → the toast is beaconed → another beacon → lower quota.
// It would also blame the user for traffic they didn't cause. The guard exists
// to warn about interactive quota, so background diagnostics are excluded
// outright (ice #201 follow-up). Kept as a literal rather than importing the
// reporter: this module runs at boot, before auth/i18n have loaded.
const BEACON_PATH = '/api/v1/events/collect';

function inspect(res) {
  if (typeof res.url === 'string' && res.url.includes(BEACON_PATH)) return;
  const limit     = Number(res.headers.get('RateLimit-Limit'));
  const remaining = Number(res.headers.get('RateLimit-Remaining'));
  const decision  = decideWarn({
    limit, remaining, now: Date.now(), lastWarnAt: _lastWarnAt,
  });
  if (decision.action === 'rearm') { _lastWarnAt = null; return; }
  if (decision.action !== 'warn') return;

  // The guard wraps window.fetch at module load, so it can fire BEFORE
  // loadLocale() has populated the dictionary — and t() falls back to returning
  // the key itself, which puts the literal string "rateLimit.lowQuotaWarning"
  // on screen. This warning is purely advisory, so say nothing rather than
  // something untranslated. Deliberately do NOT set _lastWarnAt here: the
  // cooldown must stay un-armed so the next low-quota response still warns
  // once the dictionary has loaded.
  const msg = t(MSG_KEY, { remaining, limit });
  if (msg === MSG_KEY) return;

  _lastWarnAt = decision.at;
  showToast(msg, 'error', 6000);
}

export function installRateLimitGuard() {
  if (typeof window === 'undefined' || !window.fetch) return;
  if (window.__rateLimitGuardInstalled) return;
  window.__rateLimitGuardInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await originalFetch(...args);
    try { inspect(res); } catch { /* never break the caller */ }
    return res;
  };
}
