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

const { IDENTITY_DEFAULTS } = require('../../public/js/utils/identity.js');

// The engine's theme trio (utils/identity.js falls back to it in node, where no
// <script id="identity"> exists): DEFAULT is what a visitor gets with nothing
// stored, ROOT the theme whose tokens are :root, THIRD any other picker entry.
const DEFAULT = IDENTITY_DEFAULTS.theme.default;
const ROOT    = IDENTITY_DEFAULTS.theme.root;
const THIRD   = IDENTITY_DEFAULTS.theme.picker.find((id) => id !== DEFAULT && id !== ROOT);

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

    expect(setTheme(DEFAULT)).toBe(DEFAULT);
    expect(store.ws_theme).toBe(DEFAULT);
    expect(attrs['data-theme']).toBe(DEFAULT);
    expect(events.map(e => e.type)).toContain('themechange');
    // The repaint must not wait on the network — the PATCH is still pending here.
    expect(mockUpdateProfile).not.toHaveBeenCalled();

    await flushSave();
    expect(mockUpdateProfile).toHaveBeenCalledWith({ theme: DEFAULT });
  });

  test('classic clears the key and the attribute (it is the :root default)', () => {
    store.ws_theme = DEFAULT;
    attrs['data-theme'] = DEFAULT;
    const { setTheme } = load();

    setTheme(ROOT);
    expect(store.ws_theme).toBe(ROOT);
    expect(attrs['data-theme']).toBeUndefined();
  });

  test('an unknown theme falls back to the default and the bad value is never sent to the server', async () => {
    mockUser = { id: 'u1', theme: THIRD };
    const { setTheme } = load();

    expect(setTheme('neon-hotdog')).toBe(DEFAULT);
    await flushSave();
    expect(mockUpdateProfile).toHaveBeenCalledWith({ theme: DEFAULT });
  });

  test('anonymous visitors stay browser-local — no account write', async () => {
    const { setTheme } = load();

    setTheme(DEFAULT);
    expect(store.ws_theme).toBe(DEFAULT);
    await flushSave();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('persist:false applies without touching the account', async () => {
    mockUser = { id: 'u1', theme: null };
    const { setTheme } = load();

    setTheme(DEFAULT, { persist: false });
    expect(attrs['data-theme']).toBe(DEFAULT);
    await flushSave();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('saveThemeToAccount refreshes the cached user so the next authchange does not revert it', async () => {
    mockUser = { id: 'u1', theme: ROOT };
    const { saveThemeToAccount } = load();

    await expect(saveThemeToAccount(DEFAULT, { delay: 0 })).resolves.toBe(true);
    // Silent: a dispatched authchange makes the router re-navigate, tearing
    // down the view the user is on just to repaint an already-applied theme.
    expect(mockUpdateCachedUser).toHaveBeenCalledWith({ theme: DEFAULT }, { silent: true });
  });

  test('saveThemeToAccount skips the request when the account already has that theme', async () => {
    mockUser = { id: 'u1', theme: DEFAULT };
    const { saveThemeToAccount } = load();

    await expect(saveThemeToAccount(DEFAULT, { delay: 0 })).resolves.toBe(true);
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('saveThemeToAccount resolves false (never throws) on a failed write', async () => {
    mockUser = { id: 'u1', theme: null };
    mockUpdateProfile = jest.fn().mockRejectedValue(new Error('offline'));
    const { saveThemeToAccount } = load();

    await expect(saveThemeToAccount(DEFAULT, { delay: 0 })).resolves.toBe(false);
  });

  // A held arrow key in the radiogroup auto-repeats at ~30/s. One PATCH per
  // keypress would burn the app-wide 400-req/15-min limiter in seconds and
  // 429 the whole site, so a burst has to collapse into a single write.
  test('a burst of changes collapses into ONE write, for the theme landed on', async () => {
    mockUser = { id: 'u1', theme: null };
    const { setTheme } = load();

    [DEFAULT, ROOT, DEFAULT, ROOT].forEach((id) => setTheme(id));
    await flushSave();

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile).toHaveBeenCalledWith({ theme: ROOT });
    expect(mockUpdateCachedUser).toHaveBeenCalledWith({ theme: ROOT }, { silent: true });
  });

  // Arrow-keying the Appearance radios walks THROUGH themes. If the user lands
  // back on the one the account already holds, the fast path returns early —
  // and used to leave the write armed by the theme they passed through, so the
  // account silently ended up on a theme they had rejected (and adopted it at
  // the next session restore, while the UI had said "Saved").
  test('returning to the account theme inside the window cancels the pending write', async () => {
    mockUser = { id: 'u1', theme: DEFAULT };
    const { saveThemeToAccount } = load();

    const passedThrough = saveThemeToAccount(ROOT);
    const backToCurrent = saveThemeToAccount(DEFAULT);

    await expect(backToCurrent).resolves.toBe(true);
    await expect(passedThrough).resolves.toBe(true);
    await flushSave();

    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
  test('every caller in a burst resolves with the surviving write\'s outcome', async () => {
    mockUser = { id: 'u1', theme: null };
    const { saveThemeToAccount } = load();

    const results = await Promise.all([
      saveThemeToAccount(DEFAULT),
      saveThemeToAccount(DEFAULT),
      saveThemeToAccount(DEFAULT),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile).toHaveBeenCalledWith({ theme: DEFAULT });
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
      setTimeout(() => { order.push(theme); resolve({}); }, theme === DEFAULT ? 60 : 0);
    }));
    const { saveThemeToAccount } = load();

    const first = saveThemeToAccount(DEFAULT, { delay: 0 });
    // Let the first debounce fire so its PATCH is genuinely in flight — a
    // second call in the same tick would simply be collapsed into it.
    await new Promise((r) => setTimeout(r, 10));
    const second = saveThemeToAccount(ROOT, { delay: 0 });
    await Promise.all([first, second]);

    expect(order).toEqual([DEFAULT, ROOT]);
    expect(mockUpdateCachedUser).toHaveBeenLastCalledWith({ theme: ROOT }, { silent: true });
  });
});

describe('themePrefs — account → browser', () => {
  test('adoptAccountTheme applies the theme saved on the account', () => {
    mockUser = { id: 'u1', theme: THIRD };
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(getTheme()).toBe(THIRD);
    expect(attrs['data-theme']).toBe(THIRD);
  });

  test('adopting does NOT write back to the server', async () => {
    mockUser = { id: 'u1', theme: DEFAULT };
    const { adoptAccountTheme } = load();

    adoptAccountTheme();
    await flushSave();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('a null account theme leaves the browser choice alone', () => {
    store.ws_theme = DEFAULT;
    mockUser = { id: 'u1', theme: null };
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(getTheme()).toBe(DEFAULT);
  });

  test('logged out (no cached user) is a no-op', () => {
    store.ws_theme = DEFAULT;
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(getTheme()).toBe(DEFAULT);
  });

  test('an unknown value from the server is ignored', () => {
    store.ws_theme = DEFAULT;
    mockUser = { id: 'u1', theme: 'neon-hotdog' };
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(getTheme()).toBe(DEFAULT);
  });

  // Storage is the pre-paint cache, not the source of truth. With it disabled
  // the theme still paints from the account, so getTheme() must report what is
  // actually on screen — otherwise the pickers highlight the wrong swatch.
  test('the applied theme is reported even when storage is unavailable', () => {
    storageBroken = true;
    mockUser = { id: 'u1', theme: THIRD };
    const { adoptAccountTheme, getTheme } = load();

    adoptAccountTheme();
    expect(attrs['data-theme']).toBe(THIRD);
    expect(getTheme()).toBe(THIRD);
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
    store.ws_theme = ROOT; // this browser's own choice, made while signed out
    const { initTheme, getTheme } = load();
    initTheme();

    // The account theme must differ from the browser one, or this asserts nothing.
    login({ id: 'a', theme: DEFAULT });
    expect(getTheme()).toBe(DEFAULT);

    login(null);
    expect(getTheme()).toBe(ROOT);
  });

  test('a theme picked while signed in does not carry into the next account', () => {
    store.ws_theme = ROOT;
    const { initTheme, setTheme, getTheme } = load();
    initTheme();

    // User A has never picked (theme null), so nothing is adopted — then picks
    // light during the session. It must differ from the browser theme, or the
    // assertions below pass whatever the logout path does.
    login({ id: 'a', theme: null });
    setTheme(DEFAULT, { persist: false });
    expect(getTheme()).toBe(DEFAULT);

    login(null);
    expect(getTheme()).toBe(ROOT);

    // User B, also with no saved theme, gets the browser's own theme — not A's.
    login({ id: 'b', theme: null });
    expect(getTheme()).toBe(ROOT);
  });

  test('an anonymous visitor is untouched by the logout path', () => {
    store.ws_theme = DEFAULT;
    const { initTheme, getTheme } = load();
    initTheme();

    global.window.dispatchEvent(new CustomEvent('authchange')); // never logged in
    expect(getTheme()).toBe(DEFAULT);
  });
});
