'use strict';

/**
 * Unit tests for the ACCOUNT half of public/js/services/themePrefs.js — the
 * theme following the login rather than the browser (users.theme, migration
 * 081_user_theme).
 *
 * Two directions, and they must not fight each other:
 *   • browser → account: setTheme() applies locally, then PATCHes /users/me;
 *   • account → browser: adoptAccountTheme() copies the server value down on
 *     login/session-restore, and does NOTHING when the account has never
 *     picked one (theme null) — otherwise every existing user's localStorage
 *     choice would be wiped on their first login after the migration.
 *
 * The module is authored as ESM but Jest's babel-jest transform (babel.config.js
 * with @babel/preset-env) compiles it to CJS for require(). It reads
 * `localStorage`, `document` and `window`, which the node test environment
 * lacks — all three are stubbed.
 */

let store;
let storageBroken;
let listeners;
let attrs;
let events;
let mockUser;
let mockUpdateProfile;
let mockUpdateCachedUser;

// Path inlined: babel-plugin-jest-hoist lifts this call above every const, so
// a shared path variable would be read before initialization.
jest.mock('../../public/js/services/auth.js', () => ({
  getUser:          () => mockUser,
  isAuthenticated:  () => !!mockUser,
  updateProfile:    (...args) => mockUpdateProfile(...args),
  updateCachedUser: (...args) => mockUpdateCachedUser(...args),
}));

beforeAll(() => {
  // `storageBroken` stands in for Safari private mode / blocked site data,
  // where every localStorage call throws and the module's try/catch swallows it.
  global.localStorage = {
    getItem: (k) => { if (storageBroken) throw new Error('storage disabled'); return k in store ? store[k] : null; },
    setItem: (k, v) => { if (storageBroken) throw new Error('storage disabled'); store[k] = String(v); },
    removeItem: (k) => { if (storageBroken) throw new Error('storage disabled'); delete store[k]; },
  };
  global.CustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  };
  global.document = {
    documentElement: {
      setAttribute: (k, v) => { attrs[k] = v; },
      removeAttribute: (k) => { delete attrs[k]; },
    },
    querySelector: () => null,
  };
  // A real listener registry, so a test can dispatch 'authchange' the way
  // auth.js does on login / session restore / logout.
  global.window = {
    dispatchEvent: (e) => {
      events.push(e);
      (listeners[e.type] || []).slice().forEach((fn) => fn(e));
      return true;
    },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: (type, fn) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
  };
});

afterAll(() => {
  delete global.localStorage;
  delete global.CustomEvent;
  delete global.document;
  delete global.window;
});

beforeEach(() => {
  store = {};
  storageBroken = false;
  listeners = {};
  attrs = {};
  events = [];
  mockUser = null;
  mockUpdateProfile = jest.fn().mockResolvedValue({});
  mockUpdateCachedUser = jest.fn((partial) => { mockUser = { ...mockUser, ...partial }; });
  jest.resetModules();
});

function load() {
  return require('../../public/js/services/themePrefs');
}

// Let the save debounce (400ms) fire and its promise chain settle. Real
// timers: the module reads setTimeout at call time, and the waits here are
// bounded by that one timer.
function flushSave() {
  return new Promise((r) => setTimeout(r, 600));
}

describe('themePrefs — browser → account', () => {
  test('setTheme applies locally and saves to the account when logged in', async () => {
    mockUser = { id: 'u1', theme: null };
    const { setTheme } = load();

    expect(setTheme('lava')).toBe('lava');
    expect(store.ws_theme).toBe('lava');
    expect(attrs['data-theme']).toBe('lava');
    expect(events.map(e => e.type)).toContain('themechange');
    // The repaint must not wait on the network — the PATCH is still pending here.
    expect(mockUpdateProfile).not.toHaveBeenCalled();

    await flushSave();
    expect(mockUpdateProfile).toHaveBeenCalledWith({ theme: 'lava' });
  });

  test('classic clears the key and the attribute (it is the :root default)', () => {
    store.ws_theme = 'lava';
    attrs['data-theme'] = 'lava';
    const { setTheme } = load();

    setTheme('classic');
    expect(store.ws_theme).toBeUndefined();
    expect(attrs['data-theme']).toBeUndefined();
  });

  test('an unknown theme falls back to classic and is never sent to the server', async () => {
    mockUser = { id: 'u1', theme: 'moss' };
    const { setTheme } = load();

    expect(setTheme('neon-hotdog')).toBe('classic');
    await flushSave();
    expect(mockUpdateProfile).toHaveBeenCalledWith({ theme: 'classic' });
  });

  test('anonymous visitors stay browser-local — no account write', async () => {
    const { setTheme } = load();

    setTheme('glacier');
    expect(store.ws_theme).toBe('glacier');
    await flushSave();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('persist:false applies without touching the account', async () => {
    mockUser = { id: 'u1', theme: null };
    const { setTheme } = load();

    setTheme('aurora', { persist: false });
    expect(attrs['data-theme']).toBe('aurora');
    await flushSave();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('saveThemeToAccount refreshes the cached user so the next authchange does not revert it', async () => {
    mockUser = { id: 'u1', theme: 'moss' };
    const { saveThemeToAccount } = load();

    await expect(saveThemeToAccount('lava', { delay: 0 })).resolves.toBe(true);
    // Silent: a dispatched authchange makes the router re-navigate, tearing
    // down the view the user is on just to repaint an already-applied theme.
    expect(mockUpdateCachedUser).toHaveBeenCalledWith({ theme: 'lava' }, { silent: true });
  });

  test('saveThemeToAccount skips the request when the account already has that theme', async () => {
    mockUser = { id: 'u1', theme: 'lava' };
    const { saveThemeToAccount } = load();

    await expect(saveThemeToAccount('lava', { delay: 0 })).resolves.toBe(true);
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('saveThemeToAccount resolves false (never throws) on a failed write', async () => {
    mockUser = { id: 'u1', theme: null };
    mockUpdateProfile = jest.fn().mockRejectedValue(new Error('offline'));
    const { saveThemeToAccount } = load();

    await expect(saveThemeToAccount('moss', { delay: 0 })).resolves.toBe(false);
  });

  // A held arrow key in the radiogroup auto-repeats at ~30/s. One PATCH per
  // keypress would burn the app-wide 400-req/15-min limiter in seconds and
  // 429 the whole site, so a burst has to collapse into a single write.
  test('a burst of changes collapses into ONE write, for the theme landed on', async () => {
    mockUser = { id: 'u1', theme: null };
    const { setTheme } = load();

    ['glacier', 'moss', 'lava', 'aurora'].forEach((id) => setTheme(id));
    await flushSave();

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile).toHaveBeenCalledWith({ theme: 'aurora' });
    expect(mockUpdateCachedUser).toHaveBeenCalledWith({ theme: 'aurora' }, { silent: true });
  });

  test('every caller in a burst resolves with the surviving write\'s outcome', async () => {
    mockUser = { id: 'u1', theme: null };
    const { saveThemeToAccount } = load();

    const results = await Promise.all([
      saveThemeToAccount('glacier'),
      saveThemeToAccount('moss'),
      saveThemeToAccount('lava'),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile).toHaveBeenCalledWith({ theme: 'lava' });
  });

  // Overlapping writes that survive the debounce must still commit in order:
  // two in-flight PATCHes could otherwise land reversed, leaving the account
  // on a theme the user had already moved off.
  test('writes that outlive the debounce are serialised, last call wins', async () => {
    mockUser = { id: 'u1', theme: null };
    const order = [];
    mockUpdateProfile = jest.fn(({ theme }) => new Promise((resolve) => {
      // First write is slow, second is instant — parallel writes would
      // finish reversed.
      setTimeout(() => { order.push(theme); resolve({}); }, theme === 'moss' ? 60 : 0);
    }));
    const { saveThemeToAccount } = load();

    const first = saveThemeToAccount('moss', { delay: 0 });
    // Let the first debounce fire so its PATCH is genuinely in flight — a
    // second call in the same tick would simply be collapsed into it.
    await new Promise((r) => setTimeout(r, 10));
    const second = saveThemeToAccount('lava', { delay: 0 });
    await Promise.all([first, second]);

    expect(order).toEqual(['moss', 'lava']);
    expect(mockUpdateCachedUser).toHaveBeenLastCalledWith({ theme: 'lava' }, { silent: true });
  });
});

describe('themePrefs — account → browser', () => {
  test('adoptAccountTheme applies the theme saved on the account', () => {
    mockUser = { id: 'u1', theme: 'glacier' };
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(getTheme()).toBe('glacier');
    expect(attrs['data-theme']).toBe('glacier');
  });

  test('adopting does NOT write back to the server', async () => {
    mockUser = { id: 'u1', theme: 'moss' };
    const { adoptAccountTheme } = load();

    adoptAccountTheme();
    await flushSave();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('a null account theme leaves the browser choice alone', () => {
    store.ws_theme = 'lava';
    mockUser = { id: 'u1', theme: null };
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(getTheme()).toBe('lava');
  });

  test('logged out (no cached user) is a no-op', () => {
    store.ws_theme = 'aurora';
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(getTheme()).toBe('aurora');
  });

  test('an unknown value from the server is ignored', () => {
    store.ws_theme = 'moss';
    mockUser = { id: 'u1', theme: 'neon-hotdog' };
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(getTheme()).toBe('moss');
  });

  // Storage is the pre-paint cache, not the source of truth. With it disabled
  // the theme still paints from the account, so getTheme() must report what is
  // actually on screen — otherwise the pickers highlight the wrong swatch.
  test('the applied theme is reported even when storage is unavailable', () => {
    storageBroken = true;
    mockUser = { id: 'u1', theme: 'moss' };
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(attrs['data-theme']).toBe('moss');
    expect(getTheme()).toBe('moss');
  });
});

// Shared terminals are real here — the POS and scan surfaces are exactly that —
// so an account's theme must not outlive the session that brought it in.
describe('themePrefs — logout', () => {
  function login(user) {
    mockUser = user;
    global.window.dispatchEvent(new CustomEvent("authchange"));
  }

  test('logout hands the browser back the theme it had before the login', () => {
    store.ws_theme = 'lava'; // this browser's own choice, made while signed out
    const { initTheme, getTheme } = load();
    initTheme();

    login({ id: 'a', theme: 'moss' });
    expect(getTheme()).toBe('moss');

    login(null);
    expect(getTheme()).toBe('lava');
  });

  test('a theme picked while signed in does not carry into the next account', () => {
    store.ws_theme = 'lava';
    const { initTheme, setTheme, getTheme } = load();
    initTheme();

    // User A has never picked (theme null), so nothing is adopted — then picks
    // aurora during the session.
    login({ id: 'a', theme: null });
    setTheme('aurora', { persist: false });
    expect(getTheme()).toBe('aurora');

    login(null);
    expect(getTheme()).toBe('lava');

    // User B, also with no saved theme, gets the browser's own theme — not A's.
    login({ id: 'b', theme: null });
    expect(getTheme()).toBe('lava');
  });

  test('an anonymous visitor is untouched by the logout path', () => {
    store.ws_theme = 'glacier';
    const { initTheme, getTheme } = load();
    initTheme();

    global.window.dispatchEvent(new CustomEvent('authchange')); // never logged in
    expect(getTheme()).toBe('glacier');
  });
});
