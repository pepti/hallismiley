/**
 * format.formatRelative and utils/localPref — two of the admin kit's
 * foundations. Both are pure enough to test under testEnvironment: 'node'.
 *
 * babel-jest compiles the ESM modules to CJS for require() (see money.client.test.js).
 */
const { formatRelative, formatDate } = require('../../public/js/utils/format.js');
const { readPref, writePref, removePref } = require('../../public/js/utils/localPref.js');

const NOW = Date.parse('2026-09-07T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('formatRelative', () => {
  afterEach(() => { delete global.window; });
  const withLocale = (lc, fn) => { global.window = { __locale: lc }; try { return fn(); } finally { delete global.window; } };

  test('speaks Icelandic when the app language is Icelandic', () => {
    expect(withLocale('is', () => formatRelative(ago(3 * DAY), NOW))).toBe('fyrir 3 dögum');
  });

  test('and English when it is English — the OS locale never decides', () => {
    expect(withLocale('en', () => formatRelative(ago(3 * DAY), NOW))).toBe('3 days ago');
  });

  test('picks the largest unit that the gap clears', () => {
    const en = (iso) => withLocale('en', () => formatRelative(iso, NOW));
    expect(en(ago(90 * SEC))).toBe('2 minutes ago');
    expect(en(ago(2 * HOUR))).toBe('2 hours ago');
    expect(en(ago(8 * DAY))).toBe('last week');
    expect(en(ago(60 * DAY))).toBe('2 months ago');
    expect(en(ago(400 * DAY))).toBe('last year');
  });

  test('anything under 45 seconds reads as now, not as a countdown', () => {
    const en = (iso) => withLocale('en', () => formatRelative(iso, NOW));
    expect(en(ago(0))).toBe('now');
    expect(en(ago(44 * SEC))).toBe('now');
  });

  test('the 45–59 s gap rounds honestly to a minute rather than falling through', () => {
    expect(withLocale('en', () => formatRelative(ago(50 * SEC), NOW))).toBe('1 minute ago');
  });

  test('past and future round the same way — 90 s each way is 2 minutes', () => {
    const en = (iso) => withLocale('en', () => formatRelative(iso, NOW));
    expect(en(ago(90 * SEC))).toBe('2 minutes ago');
    expect(en(new Date(NOW + 90 * SEC).toISOString())).toBe('in 2 minutes');
  });

  test('future timestamps read as future', () => {
    const iso = new Date(NOW + 2 * DAY).toISOString();
    expect(withLocale('en', () => formatRelative(iso, NOW))).toBe('in 2 days');
  });

  test('missing and unparseable values give the em dash, matching the other formatters', () => {
    expect(formatRelative(null, NOW)).toBe('—');
    expect(formatRelative('', NOW)).toBe('—');
    expect(formatRelative('not a date', NOW)).toBe('—');
  });

  test('falls back to the absolute date when the browser has no RelativeTimeFormat', () => {
    const real = Intl.RelativeTimeFormat;
    delete Intl.RelativeTimeFormat;
    try {
      withLocale('is', () => {
        const iso = ago(3 * DAY);
        expect(formatRelative(iso, NOW)).toBe(formatDate(iso));
      });
    } finally {
      Intl.RelativeTimeFormat = real;
    }
  });
});

describe('localPref', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    global.window = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
    };
  });
  afterEach(() => { delete global.window; });

  test('round-trips a value under the house prefix', () => {
    expect(writePref('admin.leads.pageSize', 100)).toBe(true);
    expect(store.get('halli.admin.leads.pageSize')).toBe('100');
    expect(readPref('admin.leads.pageSize')).toBe(100);
  });

  test('an absent key returns the fallback, not undefined', () => {
    expect(readPref('nope', 50)).toBe(50);
    expect(readPref('nope')).toBe(null);
  });

  test('corrupt JSON returns the fallback instead of throwing', () => {
    store.set('halli.broken', '{not json');
    expect(readPref('broken', 'safe')).toBe('safe');
  });

  test('removePref forgets it', () => {
    writePref('gone', 1);
    expect(removePref('gone')).toBe(true);
    expect(readPref('gone', 'default')).toBe('default');
  });

  test('a THROWING accessor is survivable — private mode, blocked site data, quota', () => {
    // Not merely empty: reading window.localStorage itself can throw. An
    // unguarded read would take the whole admin view down.
    global.window = { get localStorage() { throw new Error('SecurityError'); } };
    expect(readPref('x', 'fallback')).toBe('fallback');
    expect(writePref('x', 1)).toBe(false);
    expect(removePref('x')).toBe(false);
  });

  test('a full quota reports failure rather than throwing', () => {
    global.window = { localStorage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => {} } };
    expect(writePref('big', 'x')).toBe(false);
  });

  test('stores objects and booleans, not just numbers', () => {
    writePref('cols', { sku: true, price: false });
    expect(readPref('cols')).toEqual({ sku: true, price: false });
    writePref('flag', false);
    expect(readPref('flag', true)).toBe(false); // stored false must beat the fallback
  });
});
