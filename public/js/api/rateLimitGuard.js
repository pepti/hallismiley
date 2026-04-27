import { showToast } from '../components/Toast.js';
import { t } from '../i18n/i18n.js';

let _lastWarnedReset = null;

function inspect(res) {
  const limit     = Number(res.headers.get('RateLimit-Limit'));
  const remaining = Number(res.headers.get('RateLimit-Remaining'));
  const reset     = res.headers.get('RateLimit-Reset');
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0) return;
  if (remaining / limit > 0.15) return;
  if (_lastWarnedReset === reset) return;
  _lastWarnedReset = reset;
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
