import { showToast } from '../components/Toast.js';
import { t } from '../i18n/i18n.js';

// Cooldown so a burst of low-quota responses produces one toast, not many.
// Time-based (not RateLimit-Reset-based) because draft-7 standard headers
// emit Reset as decrementing seconds, so successive responses inside a
// single window have different Reset values and string-equality dedupe
// would never trip.
const WARN_COOLDOWN_MS = 30 * 1000;
let _lastWarnAt = 0;

function inspect(res) {
  const limit     = Number(res.headers.get('RateLimit-Limit'));
  const remaining = Number(res.headers.get('RateLimit-Remaining'));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0) return;
  const ratio = remaining / limit;
  // Re-arm once quota recovers — a fresh window or a different tab's writes
  // refilling the bucket should let the next dip warn again.
  if (ratio > 0.5) { _lastWarnAt = 0; return; }
  if (ratio > 0.15) return;
  if (Date.now() - _lastWarnAt < WARN_COOLDOWN_MS) return;
  _lastWarnAt = Date.now();
  showToast(t('rateLimit.lowQuotaWarning', { remaining, limit }), 'error', 6000);
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
