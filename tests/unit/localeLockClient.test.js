'use strict';

/**
 * The party pages are locked to Icelandic. server/config/i18n.js owns the rule
 * and tests/unit/localeLock.test.js pins the server half; this pins the client
 * half of public/js/i18n/i18n.js, which the server tests cannot reach.
 *
 * The case that matters is the one a lock makes easy to get wrong. Rendering
 * the party page sets the module's active locale to 'is'. If href() built every
 * other link from that, an English reader who so much as opened the party page
 * would have the whole NavBar rewritten to /is/* and would be stranded on the
 * Icelandic site — their saved choice untouched but no longer consulted, since
 * getPreferredLocale only runs for URLs without a locale prefix.
 *
 * The module is ESM; babel-jest compiles it to CJS for require() (see
 * tests/unit/safeReturnTo.client.test.js for the same pattern). testEnvironment
 * is 'node', so the browser globals it touches are stubbed here.
 */

const i18n = require('../../public/js/i18n/i18n.js');

/** Point the stubbed browser at `pathname` with an optional saved choice. */
function browseTo(pathname, { savedChoice = null, search = '', languages = [] } = {}) {
  const store = new Map();
  if (savedChoice) store.set('locale_choice', savedChoice);

  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  global.navigator = { languages };
  global.window = {
    location: { pathname, search },
    __locale: undefined,
  };
  global.document = {
    documentElement: {},
    querySelector: () => null,
  };
}

beforeEach(() => {
  // loadLocale swallows fetch errors but still sets the active locale, which is
  // all these tests need — no locale JSON is required.
  global.fetch = () => Promise.reject(new Error('no network in unit tests'));
});

describe('forcedLocaleFor (client mirror of the server rule)', () => {
  test.each(['/party', '/en/party', '/is/party', '/party/admin', '/en/party/login'])(
    'locks %s to Icelandic',
    (p) => {
      browseTo(p);
      expect(i18n.forcedLocaleFor(p)).toBe('is');
    }
  );

  test.each(['/projects', '/en/projects', '/shop', '/party-supplies', '/partygoers'])(
    'leaves %s unlocked',
    (p) => {
      browseTo(p);
      expect(i18n.forcedLocaleFor(p)).toBeNull();
    }
  );
});

describe('href() while the visitor is on the locked party page', () => {
  beforeEach(async () => {
    browseTo('/is/party', { savedChoice: 'en' });
    await i18n.loadLocale('is'); // what the router does on arrival
    expect(i18n.getLocale()).toBe('is'); // guard: the active locale really is 'is'
  });

  test('links to unlocked routes use the visitor’s own locale, not the page’s', () => {
    expect(i18n.href('/projects')).toBe('/en/projects');
    expect(i18n.href('/shop')).toBe('/en/shop');
    expect(i18n.href('/')).toBe('/en/');
  });

  test('links back to the party page stay Icelandic', () => {
    expect(i18n.href('/party')).toBe('/is/party');
    expect(i18n.href('/party/admin')).toBe('/is/party/admin');
  });

  test('an Icelandic-preference visitor still gets Icelandic links', async () => {
    browseTo('/is/party', { savedChoice: 'is' });
    await i18n.loadLocale('is');
    expect(i18n.href('/projects')).toBe('/is/projects');
  });

  test('with no saved choice, Accept-Language decides — not the locked page', async () => {
    browseTo('/is/party', { languages: ['en-GB', 'en'] });
    await i18n.loadLocale('is');
    expect(i18n.href('/projects')).toBe('/en/projects');
  });
});

describe('href() while browsing normally', () => {
  test('uses the active locale for unlocked routes', async () => {
    browseTo('/is/projects', { savedChoice: 'is' });
    await i18n.loadLocale('is');
    expect(i18n.href('/shop')).toBe('/is/shop');
  });

  test('still points the party link at Icelandic from an English page', async () => {
    browseTo('/en/projects', { savedChoice: 'en' });
    await i18n.loadLocale('en');
    expect(i18n.href('/party')).toBe('/is/party');
    expect(i18n.href('/shop')).toBe('/en/shop');
  });
});

describe('getPreferredLocale', () => {
  test('returns the lock on a party URL even when the visitor chose English', () => {
    browseTo('/is/party', { savedChoice: 'en' });
    expect(i18n.getPreferredLocale()).toBe('is');
  });

  test('returns the saved choice off the party page', () => {
    browseTo('/projects', { savedChoice: 'en' });
    expect(i18n.getPreferredLocale()).toBe('en');
  });
});
