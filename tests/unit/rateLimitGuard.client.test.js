'use strict';

/**
 * Unit tests for the client-side rate-limit guard at
 * public/js/api/rateLimitGuard.js.
 *
 * The guard wraps window.fetch and toasts a warning when the server reports a
 * nearly-exhausted quota. The error-toast beacon (services/errorReporter.js) posts
 * through that same wrapped fetch, so a warning on the beacon's own quota would
 * feed back into itself: low quota → error toast → the toast is logged → another
 * beacon. These tests pin the exclusion that breaks that loop.
 *
 * The module is authored as ESM but Jest's babel-jest transform (configured via
 * babel.config.js with @babel/preset-env) compiles it to CJS for require().
 * `window` is referenced through a local alias so the node-env lint config
 * (tests/** has no browser globals) stays happy.
 */

const toasts = [];
jest.mock('../../public/js/components/Toast.js', () => ({
  showToast: (msg, type) => toasts.push({ msg, type }),
}));

// t() must return something other than the key, or the guard stays silent by
// design (it refuses to render an untranslated key — see the module comment).
jest.mock('../../public/js/i18n/i18n.js', () => ({
  t: (key, params) => `translated:${key}:${params.remaining}/${params.limit}`,
}));

// A response with a quota low enough that the guard would normally warn.
function lowQuotaResponse(url) {
  return {
    url,
    headers: {
      get: (name) => ({ 'RateLimit-Limit': '100', 'RateLimit-Remaining': '2' }[name] ?? null),
    },
  };
}

describe('rateLimitGuard (client) — beacon exclusion', () => {
  let win, originalFetch, installRateLimitGuard;

  beforeEach(() => {
    toasts.length = 0;
    global.window = global;
    win = global.window;
    originalFetch = jest.fn();
    win.fetch = originalFetch;
    delete win.__rateLimitGuardInstalled;
    // The guard keeps `_lastWarnAt` in module scope to enforce a warn cooldown.
    // Without a reset that state leaks between tests and a later test sees its
    // warning legitimately suppressed by an earlier one.
    jest.resetModules();
    ({ installRateLimitGuard } = require('../../public/js/api/rateLimitGuard'));
  });

  afterEach(() => {
    delete global.window.__rateLimitGuardInstalled;
    delete global.window;
  });

  test('warns on a normal API response with a nearly-exhausted quota', async () => {
    originalFetch.mockResolvedValue(lowQuotaResponse('http://localhost/api/v1/shop/products'));
    installRateLimitGuard();

    await win.fetch('/api/v1/shop/products');
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('error');
  });

  test('stays silent for the error-toast beacon — warning on it would loop', async () => {
    originalFetch.mockResolvedValue(lowQuotaResponse('http://localhost/api/v1/events/collect'));
    installRateLimitGuard();

    await win.fetch('/api/v1/events/collect', { method: 'POST' });
    expect(toasts).toHaveLength(0);
  });

  test('a beacon response never suppresses a later warning for real traffic', async () => {
    installRateLimitGuard();

    originalFetch.mockResolvedValue(lowQuotaResponse('http://localhost/api/v1/events/collect'));
    await win.fetch('/api/v1/events/collect', { method: 'POST' });
    expect(toasts).toHaveLength(0);

    originalFetch.mockResolvedValue(lowQuotaResponse('http://localhost/api/v1/shop/products'));
    await win.fetch('/api/v1/shop/products');
    expect(toasts).toHaveLength(1);
  });

  test('returns the original response to the caller either way', async () => {
    const res = lowQuotaResponse('http://localhost/api/v1/events/collect');
    originalFetch.mockResolvedValue(res);
    installRateLimitGuard();

    await expect(win.fetch('/api/v1/events/collect')).resolves.toBe(res);
  });
});
