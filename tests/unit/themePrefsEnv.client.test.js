'use strict';

/**
 * Unit tests for the TEST-chrome clamp in public/js/services/themePrefs.js.
 *
 * The blue TEST badge (body.is-test-env → test-env.css) is the operator's
 * proof that they are NOT on the live site, so it must be impossible for
 * per-browser state to paint it on PROD. getEffectiveEnv() is therefore a
 * one-way clamp: on TEST an admin may hide the chrome for a demo, but no
 * localStorage value can switch it on when the server says production.
 * Regression guard for the leftover 'test' override that showed the badge on
 * icelandicstore-prod-app (and handed an admin a change-request widget whose
 * submit endpoint 404s there — changeRequestGate).
 *
 * Since 2026-09-22 the chrome is also admin-only on TEST (Halli): a logged-out
 * visitor or a customer sees the TEST stack exactly as production. The admin
 * check comes from services/auth.js, mocked here so each test sets the role.
 *
 * The module is authored as ESM but Jest's babel-jest transform (babel.config.js
 * with @babel/preset-env) compiles it to CJS for require(). It reads `document`
 * and `localStorage`, which the node test environment lacks — both are stubbed.
 */

let store;
let admin;

beforeAll(() => {
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
});

afterAll(() => {
  delete global.localStorage;
  delete global.document;
});

// Stand in for the <meta name="app-env"> tag ssrMeta.js stamps per environment.
function setServerEnv(content) {
  global.document = {
    querySelector: (sel) => (sel === 'meta[name="app-env"]' ? { content } : null),
  };
}

beforeEach(() => {
  store = {};
  admin = true; // the pre-2026-09-22 cases below are an admin's view
  jest.resetModules();
});

function load() {
  jest.doMock('../../public/js/services/auth.js', () => ({
    getUser: () => (admin ? { roles: ['admin'] } : null),
    isAuthenticated: () => admin,
    isAdmin: () => admin,
    updateProfile: async () => {},
    updateCachedUser: () => {},
  }));
  return require('../../public/js/services/themePrefs');
}

describe('themePrefs.getEffectiveEnv — TEST chrome clamp', () => {
  test('TEST stack with no override → test', () => {
    setServerEnv('test');
    expect(load().getEffectiveEnv()).toBe('test');
  });

  test('TEST stack with a production override → production (demo hide)', () => {
    setServerEnv('test');
    store.ws_test_override = 'production';
    expect(load().getEffectiveEnv()).toBe('production');
  });

  test('PROD stack with no override → production', () => {
    setServerEnv('production');
    expect(load().getEffectiveEnv()).toBe('production');
  });

  test('PROD stack IGNORES a stale test override → production', () => {
    setServerEnv('production');
    store.ws_test_override = 'test';
    expect(load().getEffectiveEnv()).toBe('production');
  });

  test('a missing app-env meta tag is treated as production', () => {
    global.document = { querySelector: () => null };
    store.ws_test_override = 'test';
    expect(load().getEffectiveEnv()).toBe('production');
  });

  test('garbage in the override key is ignored on both stacks', () => {
    store.ws_test_override = 'yes-please';
    setServerEnv('test');
    expect(load().getEffectiveEnv()).toBe('test');
    jest.resetModules();
    setServerEnv('production');
    expect(load().getEffectiveEnv()).toBe('production');
  });
});

describe('themePrefs.getEffectiveEnv — TEST chrome is admin-only', () => {
  test('TEST stack, logged out → production (no badge, no widget)', () => {
    setServerEnv('test');
    admin = false;
    expect(load().getEffectiveEnv()).toBe('production');
  });

  test('TEST stack, non-admin with a leftover test override → still production', () => {
    setServerEnv('test');
    admin = false;
    store.ws_test_override = 'test';
    expect(load().getEffectiveEnv()).toBe('production');
  });

  test('TEST stack, admin with the switch on (no override) → test', () => {
    setServerEnv('test');
    admin = true;
    expect(load().getEffectiveEnv()).toBe('test');
  });
});
