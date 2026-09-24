'use strict';

// public/js/i18n/i18n.js — plural(n, oneKey, manyKey).
//
// Sweep 2026-09-21: "1 pantanir", "2 lína(r)", "21 verslanir". Icelandic agrees
// with the LAST digit: 1, 21, 101 are singular, but 11 and 111 are plural (the
// teens are their own words). English is plain n === 1.

const MESSAGES = {
  is: { 'x.one': '{n} pöntun', 'x.many': '{n} pantanir', 'y.one': '{count} notandi', 'y.many': '{count} notendur' },
  en: { 'x.one': '{n} order', 'x.many': '{n} orders', 'y.one': '{count} user', 'y.many': '{count} users' },
};

async function load(locale) {
  jest.resetModules();
  global.window = { __locale: locale, dispatchEvent: () => true };
  global.document = { documentElement: {}, querySelector: () => null, cookie: '' };
  global.Event = class Event { constructor(type) { this.type = type; } };
  global.fetch = jest.fn(async (url) => {
    const name = String(url).match(/\/(\w+)\.json/)[1];
    return { ok: true, json: async () => MESSAGES[name] };
  });
  const mod = require('../../public/js/i18n/i18n.js');
  await mod.loadLocale(locale);
  return mod;
}

describe('isSingular', () => {
  let i18n;
  beforeAll(async () => { i18n = await load('is'); });

  test.each([
    [1, true], [2, false], [11, false], [21, true], [101, true], [111, false],
    [0, false], [31, true], [211, false], [1001, true], [-1, true], [-11, false],
  ])('Icelandic %p → singular %p', (n, want) => {
    expect(i18n.isSingular(n, 'is')).toBe(want);
  });

  test.each([[1, true], [2, false], [11, false], [21, false], [101, false], [0, false]])(
    'English %p → singular %p', (n, want) => {
      expect(i18n.isSingular(n, 'en')).toBe(want);
    });

  test('a decimal or a non-number is plural in both languages', () => {
    for (const loc of ['is', 'en']) {
      expect(i18n.isSingular(1.5, loc)).toBe(false);
      expect(i18n.isSingular(21.5, loc)).toBe(false);
      expect(i18n.isSingular(NaN, loc)).toBe(false);
    }
  });
});

describe('plural() under the active locale', () => {
  test('Icelandic picks the key by the last digit and fills {n}', async () => {
    const { plural } = await load('is');
    expect(plural(1, 'x.one', 'x.many')).toBe('1 pöntun');
    expect(plural(2, 'x.one', 'x.many')).toBe('2 pantanir');
    expect(plural(11, 'x.one', 'x.many')).toBe('11 pantanir');
    expect(plural(21, 'x.one', 'x.many')).toBe('21 pöntun');
    expect(plural(101, 'x.one', 'x.many')).toBe('101 pöntun');
    expect(plural(111, 'x.one', 'x.many')).toBe('111 pantanir');
  });

  test('English is singular only at exactly one', async () => {
    const { plural } = await load('en');
    expect(plural(1, 'x.one', 'x.many')).toBe('1 order');
    expect(plural(21, 'x.one', 'x.many')).toBe('21 orders');
    expect(plural(11, 'x.one', 'x.many')).toBe('11 orders');
  });

  test('extra params are interpolated too, and may override {n}', async () => {
    const { plural } = await load('is');
    expect(plural(21, 'y.one', 'y.many', { count: 21 })).toBe('21 notandi');
    expect(plural(3, 'y.one', 'y.many', { count: 3 })).toBe('3 notendur');
    expect(plural(1000, 'x.one', 'x.many', { n: '1.000' })).toBe('1.000 pantanir');
  });
});
