import { showToast } from '../components/Toast.js';
import { t } from '../i18n/i18n.js';
import { decideWarn } from './rateLimitDecide.js';

// null = never warned. Distinct from a numeric timestamp so the cooldown gate
// in decideWarn() doesn't falsely fire on the very first low-quota response.
let _lastWarnAt = null;

function inspect(res) {
  const limit     = Number(res.headers.get('RateLimit-Limit'));
  const remaining = Number(res.headers.get('RateLimit-Remaining'));
  const decision  = decideWarn({
    limit, remaining, now: Date.now(), lastWarnAt: _lastWarnAt,
  });
  if (decision.action === 'rearm') { _lastWarnAt = null; return; }
  if (decision.action !== 'warn') return;
  _lastWarnAt = decision.at;
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
