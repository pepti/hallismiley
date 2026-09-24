'use strict';
/* global window */

// public/js/services/cookieConsent.js — the account side of the cookie banner.
// Harvested from icelandicstore #411 (harvest-ice-b-2026-09-24); the engine has
// no workshop tablet, so its refusal case is gone.

let mockUser = null;

jest.mock('../../public/js/services/auth.js', () => ({
  getUser:          () => mockUser,
  isAuthenticated:  () => !!mockUser,
  updateCachedUser: (partial) => { if (mockUser) mockUser = { ...mockUser, ...partial }; },
  getCSRFToken:     async () => null,
}));

const { syncCookieConsent, saveCookieConsent, initCookieConsent } = require('../../public/js/services/cookieConsent.js');

// A stand-in for what consent.js puts on window.
function fakeBanner(local = null) {
  const calls = [];
  return {
    calls,
    get: () => local,
    apply: (v) => { calls.push(['apply', v]); local = v; },
    reopen: () => calls.push(['reopen']),
    onChoice: null,
  };
}

beforeEach(() => {
  global.window = global.window || {};
  window.__cookieConsent = null;
  window.addEventListener = jest.fn();
  window.dispatchEvent = jest.fn();
  global.Event = global.Event || class { constructor(type) { this.type = type; } };
  global.fetch = jest.fn(async () => ({ ok: true }));
});
afterEach(() => { delete global.fetch; });

describe('syncCookieConsent', () => {
  test('the account already answered: adopt it, no request', () => {
    mockUser = { id: 'u1', role: 'admin', cookie_consent: 'accepted' };
    window.__cookieConsent = fakeBanner(null);
    syncCookieConsent();
    expect(window.__cookieConsent.calls).toEqual([['apply', 'accepted']]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('declined wins either way the two disagree', () => {
    mockUser = { id: 'u1', role: 'admin', cookie_consent: 'declined' };
    window.__cookieConsent = fakeBanner('accepted');
    syncCookieConsent();
    expect(window.__cookieConsent.calls).toEqual([['apply', 'declined']]);

    // An account "accepted" never overrides a browser where someone declined.
    mockUser = { id: 'u1', role: 'admin', cookie_consent: 'accepted' };
    window.__cookieConsent = fakeBanner('declined');
    syncCookieConsent();
    expect(window.__cookieConsent.calls).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('no answer on the account but one in this browser: saved up to the account', async () => {
    mockUser = { id: 'u1', role: 'admin', cookie_consent: null };
    window.__cookieConsent = fakeBanner('accepted');
    syncCookieConsent();
    await new Promise((r) => setImmediate(r));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/users/me/cookie-consent');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ value: 'accepted' });
    expect(mockUser.cookie_consent).toBe('accepted');
  });

  test('nobody signed in, or nothing answered anywhere: nothing happens', () => {
    mockUser = null;
    window.__cookieConsent = fakeBanner('accepted');
    syncCookieConsent();
    mockUser = { id: 'u1', role: 'admin', cookie_consent: null };
    window.__cookieConsent = fakeBanner(null);
    syncCookieConsent();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.__cookieConsent.calls).toEqual([]);
  });
});

describe('saveCookieConsent', () => {
  test('never signed out, never a bad value', async () => {
    mockUser = null;
    await expect(saveCookieConsent('accepted')).resolves.toBe(false);
    mockUser = { id: 'u1', role: 'user' };
    await expect(saveCookieConsent('maybe')).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a failed write leaves the cached user alone', async () => {
    mockUser = { id: 'u1', role: 'user', cookie_consent: null };
    global.fetch = jest.fn(async () => ({ ok: false }));
    await expect(saveCookieConsent('declined')).resolves.toBe(false);
    expect(mockUser.cookie_consent).toBeNull();
  });
});

describe('initCookieConsent', () => {
  test('hooks the banner, listens for sign-ins, then lets the banner show', async () => {
    mockUser = { id: 'u1', role: 'user', cookie_consent: null };
    const banner = fakeBanner(null);
    window.__cookieConsent = banner;
    initCookieConsent();
    expect(typeof banner.onChoice).toBe('function');
    expect(window.addEventListener).toHaveBeenCalledWith('authchange', expect.any(Function));
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(window.dispatchEvent.mock.calls[0][0].type).toBe('consent:ready');

    // A choice on the banner while signed in is saved to the account.
    banner.onChoice('accepted');
    await new Promise((r) => setImmediate(r));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ value: 'accepted' });
  });

  test('a later sign-in adopts the account answer', () => {
    mockUser = null;
    const banner = fakeBanner(null);
    window.__cookieConsent = banner;
    initCookieConsent();
    const onAuth = window.addEventListener.mock.calls.find(([type]) => type === 'authchange')[1];
    mockUser = { id: 'u1', role: 'user', cookie_consent: 'declined' };
    onAuth({ detail: { reason: 'login' } });
    expect(banner.calls).toEqual([['apply', 'declined']]);
    onAuth({ detail: { reason: 'update' } });   // a profile save is not a sign-in
    expect(banner.calls).toHaveLength(1);
  });
});
