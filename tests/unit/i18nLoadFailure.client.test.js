'use strict';

// public/js/i18n/i18n.js — a locale file that cannot be fetched. Under
// release-stamped URLs the usual case is a tab from an older release switching
// language after a new one went live: /js/_<old>/i18n/en.json answers 404.
// The page must keep the strings it has (not render raw keys) and tell the
// build guard, which decides between "reload onto the new release" and "the
// network blinked" (services/buildGuard.js recoverFromAssetFailure).

async function boot(responder) {
  jest.resetModules();
  const events = [];
  global.window = { __locale: 'is', dispatchEvent: (e) => { events.push(e); return true; } };
  global.document = { documentElement: {}, querySelector: () => null, cookie: '' };
  global.fetch = jest.fn(async (url) => responder(String(url)));
  const i18n = require('../../public/js/i18n/i18n.js');
  return { i18n, events };
}

const ok = (messages) => ({ ok: true, status: 200, json: async () => messages });
const notFound = () => ({ ok: false, status: 404, json: async () => ({ error: 'Not found', code: 404 }) });

test('a 404 keeps the current strings and raises app:asset-load-failed', async () => {
  let gone = false;
  const { i18n, events } = await boot((url) => {
    if (gone) return notFound();
    return url.includes('is.json') ? ok({ 'nav.home': 'Heim' }) : ok({ 'nav.home': 'Home' });
  });
  await i18n.loadLocale('is');
  expect(i18n.t('nav.home')).toBe('Heim');

  gone = true;                       // a new release is live; this tab's tree is gone
  await i18n.loadLocale('en');
  expect(i18n.t('nav.home')).not.toBe('nav.home');   // never a raw key
  expect(i18n.t('nav.home')).not.toMatch(/Not found/);
  const failed = events.filter((e) => e.type === 'app:asset-load-failed');
  expect(failed).toHaveLength(1);
  expect(String(failed[0].detail.error.message)).toMatch(/404/);
});

test('locale files are fetched from the page’s own /js/ tree', async () => {
  const { i18n } = await boot(() => ok({}));
  await i18n.loadLocale('is');
  const urls = global.fetch.mock.calls.map(([u]) => String(u));
  expect(urls).toEqual(expect.arrayContaining(['/js/i18n/is.json', '/js/i18n/en.json']));
});
