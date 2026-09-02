'use strict';

/**
 * Unit tests for the ACCOUNT half of public/js/services/themePrefs.js — the
 * theme following the login rather than the browser (users.theme, migration
 * 083_user_theme).
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

    expect(setTheme('ember')).toBe('ember');
    expect(store.ws_theme).toBe('ember');
    expect(attrs['data-theme']).toBe('ember');
    expect(events.map(e => e.type)).toContain('themechange');
    // The repaint must not wait on the network — the PATCH is still pending here.
    expect(mockUpdateProfile).not.toHaveBeenCalled();

    await flushSave();
    expect(mockUpdateProfile).toHaveBeenCalledWith({ theme: 'ember' });
  });

  test('classic clears the key and the attribute (it is the :root default)', () => {
    store.ws_theme = 'ember';
    attrs['data-theme'] = 'ember';
    const { setTheme } = load();

    setTheme('classic');
    expect(store.ws_theme).toBe('classic');
    expect(attrs['data-theme']).toBeUndefined();
  });

  test('an unknown theme falls back to the default and the bad value is never sent to the server', async () => {
    mockUser = { id: 'u1', theme: 'midnight' };
    const { setTheme } = load();

    expect(setTheme('neon-hotdog')).toBe('ember');
    await flushSave();
    expect(mockUpdateProfile).toHaveBeenCalledWith({ theme: 'ember' });
  });

  test('anonymous visitors stay browser-local — no account write', async () => {
    const { setTheme } = load();

    setTheme('ember');
    expect(store.ws_theme).toBe('ember');
    await flushSave();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('persist:false applies without touching the account', async () => {
    mockUser = { id: 'u1', theme: null };
    const { setTheme } = load();

    setTheme('ember', { persist: false });
    expect(attrs['data-theme']).toBe('ember');
    await flushSave();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('saveThemeToAccount refreshes the cached user so the next authchange does not revert it', async () => {
    mockUser = { id: 'u1', theme: 'classic' };
    const { saveThemeToAccount } = load();

    await expect(saveThemeToAccount('ember', { delay: 0 })).resolves.toBe(true);
    // Silent: a dispatched authchange makes the router re-navigate, tearing
    // down the view the user is on just to repaint an already-applied theme.
    expect(mockUpdateCachedUser).toHaveBeenCalledWith({ theme: 'ember' }, { silent: true });
  });

  test('saveThemeToAccount skips the request when the account already has that theme', async () => {
    mockUser = { id: 'u1', theme: 'ember' };
    const { saveThemeToAccount } = load();

    await expect(saveThemeToAccount('ember', { delay: 0 })).resolves.toBe(true);
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('saveThemeToAccount resolves false (never throws) on a failed write', async () => {
    mockUser = { id: 'u1', theme: null };
    mockUpdateProfile = jest.fn().mockRejectedValue(new Error('offline'));
    const { saveThemeToAccount } = load();

    await expect(saveThemeToAccount('ember', { delay: 0 })).resolves.toBe(false);
  });

  // A held arrow key in the radiogroup auto-repeats at ~30/s. One PATCH per
  // keypress would burn the app-wide 400-req/15-min limiter in seconds and
  // 429 the whole site, so a burst has to collapse into a single write.
  test('a burst of changes collapses into ONE write, for the theme landed on', async () => {
    mockUser = { id: 'u1', theme: null };
    const { setTheme } = load();

    ['ember', 'classic', 'ember', 'classic'].forEach((id) => setTheme(id));
    await flushSave();

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile).toHaveBeenCalledWith({ theme: 'classic' });
    expect(mockUpdateCachedUser).toHaveBeenCalledWith({ theme: 'classic' }, { silent: true });
  });

  // Arrow-keying the Appearance radios walks THROUGH themes. If the user lands
  // back on the one the account already holds, the fast path returns early —
  // and used to leave the write armed by the theme they passed through, so the
  // account silently ended up on a theme they had rejected (and adopted it at
  // the next session restore, while the UI had said "Saved").
  test('returning to the account theme inside the window cancels the pending write', async () => {
    mockUser = { id: 'u1', theme: 'ember' };
    const { saveThemeToAccount } = load();

    const passedThrough = saveThemeToAccount('classic');
    const backToCurrent = saveThemeToAccount('ember');

    await expect(backToCurrent).resolves.toBe(true);
    await expect(passedThrough).resolves.toBe(true);
    await flushSave();

    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
  test('every caller in a burst resolves with the surviving write\'s outcome', async () => {
    mockUser = { id: 'u1', theme: null };
    const { saveThemeToAccount } = load();

    const results = await Promise.all([
      saveThemeToAccount('ember'),
      saveThemeToAccount('ember'),
      saveThemeToAccount('ember'),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile).toHaveBeenCalledWith({ theme: 'ember' });
  });

  // Overlapping writes that survive the debounce must still commit in order:
  // two in-flight PATCHes could otherwise land reversed, leaving the account
  // on a theme the user had already moved off.
  test('writes that outlive the debounce are serialised, last call wins', async () => {
    mockUser = { id: 'u1', theme: null };
    const order = [];
    mockUpdateProfile = jest.fn(({ theme }) => new Promise((resolve) => {
      // The FIRST write is slow and the second instant, so unchained writes
      // would resolve reversed and land the account on the theme the user
      // already moved off. The two themes must differ for that to be visible.
      setTimeout(() => { order.push(theme); resolve({}); }, theme === 'ember' ? 60 : 0);
    }));
    const { saveThemeToAccount } = load();

    const first = saveThemeToAccount('ember', { delay: 0 });
    // Let the first debounce fire so its PATCH is genuinely in flight — a
    // second call in the same tick would simply be collapsed into it.
    await new Promise((r) => setTimeout(r, 10));
    const second = saveThemeToAccount('classic', { delay: 0 });
    await Promise.all([first, second]);

    expect(order).toEqual(['ember', 'classic']);
    expect(mockUpdateCachedUser).toHaveBeenLastCalledWith({ theme: 'classic' }, { silent: true });
  });
});

describe('themePrefs — account → browser', () => {
  test('adoptAccountTheme applies the theme saved on the account', () => {
    mockUser = { id: 'u1', theme: 'midnight' };
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(getTheme()).toBe('midnight');
    expect(attrs['data-theme']).toBe('midnight');
  });

  test('adopting does NOT write back to the server', async () => {
    mockUser = { id: 'u1', theme: 'ember' };
    const { adoptAccountTheme } = load();

    adoptAccountTheme();
    await flushSave();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('a null account theme leaves the browser choice alone', () => {
    store.ws_theme = 'ember';
    mockUser = { id: 'u1', theme: null };
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(getTheme()).toBe('ember');
  });

  test('logged out (no cached user) is a no-op', () => {
    store.ws_theme = 'ember';
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(getTheme()).toBe('ember');
  });

  test('an unknown value from the server is ignored', () => {
    store.ws_theme = 'ember';
    mockUser = { id: 'u1', theme: 'neon-hotdog' };
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(getTheme()).toBe('ember');
  });

  // Storage is the pre-paint cache, not the source of truth. With it disabled
  // the theme still paints from the account, so getTheme() must report what is
  // actually on screen — otherwise the pickers highlight the wrong swatch.
  test('the applied theme is reported even when storage is unavailable', () => {
    storageBroken = true;
    mockUser = { id: 'u1', theme: 'midnight' };
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(attrs['data-theme']).toBe('midnight');
    expect(getTheme()).toBe('midnight');
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
    store.ws_theme = 'classic'; // this browser's own choice, made while signed out
    const { initTheme, getTheme } = load();
    initTheme();

    // The account theme must differ from the browser one, or this asserts nothing.
    login({ id: 'a', theme: 'ember' });
    expect(getTheme()).toBe('ember');

    login(null);
    expect(getTheme()).toBe('classic');
  });

  test('a theme picked while signed in does not carry into the next account', () => {
    store.ws_theme = 'classic';
    const { initTheme, setTheme, getTheme } = load();
    initTheme();

    // User A has never picked (theme null), so nothing is adopted — then picks
    // light during the session. It must differ from the browser theme, or the
    // assertions below pass whatever the logout path does.
    login({ id: 'a', theme: null });
    setTheme('ember', { persist: false });
    expect(getTheme()).toBe('ember');

    login(null);
    expect(getTheme()).toBe('classic');

    // User B, also with no saved theme, gets the browser's own theme — not A's.
    login({ id: 'b', theme: null });
    expect(getTheme()).toBe('classic');
  });

  test('an anonymous visitor is untouched by the logout path', () => {
    store.ws_theme = 'ember';
    const { initTheme, getTheme } = load();
    initTheme();

    global.window.dispatchEvent(new CustomEvent('authchange')); // never logged in
    expect(getTheme()).toBe('ember');
  });
});
