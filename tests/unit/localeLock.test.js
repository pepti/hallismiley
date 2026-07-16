'use strict';
/*
 * The party pages are published in Icelandic only. server/config/i18n.js owns
 * that rule (forcedLocaleFor) and every consumer — the app.js redirect, the SSR
 * <head>, the sitemap, the locale middleware — reads it from there, so these
 * tests pin the rule itself rather than each consumer's copy of it.
 */

const { forcedLocaleFor, isPartyPath, PARTY_FORCED_LOCALE } = require('../../server/config/i18n');
const { resolveLocale } = require('../../server/middleware/locale');

describe('forcedLocaleFor', () => {
  test.each([
    '/party',
    '/en/party',
    '/is/party',
    '/party/admin',
    '/en/party/admin',
    '/party/login',
    '/en/party/login',
    '/party/approve',
    '/en/party/approve',
  ])('locks the page route %s to Icelandic', (p) => {
    expect(forcedLocaleFor(p)).toBe('is');
    expect(isPartyPath(p)).toBe(true);
  });

  // The API's ?locale= picks which content row to read/write — locking it would
  // let a stray ?locale=en overwrite the Icelandic source copy, and would stamp
  // preferred_locale='is' on guests signing up through an English link. It gets
  // the soft Icelandic default instead (see resolveLocale below).
  test.each([
    '/api/v1/party',
    '/api/v1/party/info',
    '/api/v1/party/guests',
  ])('does NOT lock the API path %s', (p) => {
    expect(forcedLocaleFor(p)).toBeNull();
    expect(isPartyPath(p)).toBe(true);
  });

  test.each([
    '/',
    '/en/',
    '/projects',
    '/en/projects',
    '/is/shop',
    '/api/v1/news',
    '/contact',
  ])('leaves %s unlocked', (p) => {
    expect(forcedLocaleFor(p)).toBeNull();
    expect(isPartyPath(p)).toBe(false);
  });

  test('does not match routes that merely start with the word party', () => {
    // Guards the startsWith('/party/') branch against '/partyoke'-style paths.
    expect(forcedLocaleFor('/partygoers')).toBeNull();
    expect(forcedLocaleFor('/en/party-supplies')).toBeNull();
  });

  test('handles empty / missing input', () => {
    expect(forcedLocaleFor('')).toBeNull();
    expect(isPartyPath(undefined)).toBe(false);
  });

  test('PARTY_FORCED_LOCALE is the locale the party pages are authored in', () => {
    expect(PARTY_FORCED_LOCALE).toBe('is');
  });
});

describe('resolveLocale — on party PAGE routes the lock outranks everything', () => {
  const req = (path, extra = {}) => ({
    path,
    query: {},
    headers: {},
    cookies: {},
    ...extra,
  });

  test('ignores ?locale=en', () => {
    expect(resolveLocale(req('/party', { query: { locale: 'en' } }))).toBe('is');
  });

  test('ignores an X-Locale: en header', () => {
    expect(resolveLocale(req('/en/party', { headers: { 'x-locale': 'en' } }))).toBe('is');
  });

  test('ignores an explicit locale_choice=en cookie', () => {
    expect(resolveLocale(req('/is/party', { cookies: { locale_choice: 'en' } }))).toBe('is');
  });

  test("ignores a signed-in user's saved preferred_locale", () => {
    expect(resolveLocale(req('/party/admin', { user: { preferred_locale: 'en' } }))).toBe('is');
  });

  test('ignores Accept-Language', () => {
    expect(resolveLocale(req('/party', { headers: { 'accept-language': 'en-GB,en;q=0.9' } }))).toBe('is');
  });
});

describe('resolveLocale — the party API keeps a soft Icelandic default', () => {
  const req = (path, extra = {}) => ({
    path,
    query: {},
    headers: {},
    cookies: {},
    ...extra,
  });

  test('defaults to Icelandic for a visitor who never chose a language', () => {
    expect(resolveLocale(req('/api/v1/party/info'))).toBe('is');
  });

  test('beats an English Accept-Language', () => {
    expect(resolveLocale(req('/api/v1/party/info', {
      headers: { 'accept-language': 'en-GB,en;q=0.9' },
    }))).toBe('is');
  });

  // These three are what a lock would have broken: authoring the EN row and
  // honouring an English sign-up link.
  test('an explicit ?locale=en still selects the English row', () => {
    expect(resolveLocale(req('/api/v1/party/info', { query: { locale: 'en' } }))).toBe('en');
  });

  test('an explicit X-Locale: en still selects the English row', () => {
    expect(resolveLocale(req('/api/v1/party/info', { headers: { 'x-locale': 'en' } }))).toBe('en');
  });

  test('an explicit locale_choice=en cookie still wins over the default', () => {
    expect(resolveLocale(req('/api/v1/party/info', { cookies: { locale_choice: 'en' } }))).toBe('en');
  });
});

describe('resolveLocale — ordinary routes are untouched', () => {
  const req = (path, extra = {}) => ({
    path, query: {}, headers: {}, cookies: {}, ...extra,
  });

  test('still honours every signal off the party routes', () => {
    expect(resolveLocale(req('/projects', { query: { locale: 'is' } }))).toBe('is');
    expect(resolveLocale(req('/projects', { cookies: { locale_choice: 'is' } }))).toBe('is');
    expect(resolveLocale(req('/projects', { user: { preferred_locale: 'is' } }))).toBe('is');
    expect(resolveLocale(req('/projects', { headers: { 'accept-language': 'is-IS,is;q=0.9' } }))).toBe('is');
    expect(resolveLocale(req('/projects'))).toBe('en');
  });
});
