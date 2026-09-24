'use strict';

// public/js/utils/format.js — formatDate / formatDateTime.
//
// QA 2026-09-13: Icelandic admin pages read "14 Sept 2026". The helpers asked
// toLocaleDateString for 'is-IS', and Chrome ships no Icelandic ICU data, so it
// silently answers in English. Icelandic dates are now built by hand; these
// tests hold the hand-built output to what a full-ICU runtime (Node) gives.

const RealDateTimeFormat = Intl.DateTimeFormat;
const realToLocaleString = Date.prototype.toLocaleString;
const realToLocaleDateString = Date.prototype.toLocaleDateString;

const DATE = { year: 'numeric', month: 'short', day: 'numeric' };
const DATETIME = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };

function load(locale) {
  jest.resetModules();
  global.window = { __locale: locale };
  return require('../../public/js/utils/format.js');
}

// Full-ICU is-IS output for the same instant, options and (default) zone.
const icuIs = (d, opts) => new RealDateTimeFormat('is-IS', opts).format(d);

// A spread of instants: every month, one- and two-digit days, midnight, noon,
// the last minute of a day, and both sides of the EU DST switches (Iceland
// keeps UTC all year, but the runtime zone of whoever runs this may not).
function sampleDates() {
  const out = [];
  for (let m = 0; m < 12; m++) {
    out.push(new Date(2026, m, 1, 0, 0));
    out.push(new Date(2026, m, 9, 12, 0));
    out.push(new Date(2026, m, 14, 9, 5));
    out.push(new Date(2026, m, 28, 23, 59));
  }
  out.push(new Date('2026-03-29T00:30:00Z'), new Date('2026-03-29T01:30:00Z'));
  out.push(new Date('2026-10-25T00:30:00Z'), new Date('2026-10-25T01:30:00Z'));
  out.push(new Date('2025-12-31T23:59:00Z'), new Date('2027-01-01T00:00:00Z'));
  return out;
}

afterEach(() => {
  Intl.DateTimeFormat = RealDateTimeFormat;
  Date.prototype.toLocaleString = realToLocaleString;
  Date.prototype.toLocaleDateString = realToLocaleDateString;
});

afterAll(() => {
  delete global.window;
});

describe('formatDate / formatDateTime in Icelandic', () => {
  test('the default shapes read as Icelandic', () => {
    const { formatDate, formatDateTime } = load('is');
    const d = new Date(2026, 8, 14, 9, 5);
    expect(formatDate(d.toISOString())).toBe('14. sep. 2026');
    expect(formatDateTime(d.toISOString())).toBe('14. sep. 2026, 09:05');
    expect(formatDate(new Date(2026, 4, 3).toISOString())).toBe('3. maí 2026');
  });

  test('the default shapes match full-ICU is-IS for every month, day and hour', () => {
    const { formatDate, formatDateTime } = load('is');
    for (const d of sampleDates()) {
      const iso = d.toISOString();
      expect(formatDate(iso)).toBe(icuIs(d, DATE));
      expect(formatDateTime(iso)).toBe(icuIs(d, DATETIME));
    }
  });

  test('the other shapes the app passes match full-ICU is-IS', () => {
    const { formatDate, formatDateTime } = load('is');
    const shapes = [
      { day: '2-digit', month: 'short', year: 'numeric' }, // admin company/customer/user pages, order history
      { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }, // customer notes
      { year: 'numeric', month: 'long', day: 'numeric' },
      { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
    ];
    for (const opts of shapes) {
      for (const d of sampleDates()) {
        expect(formatDate(d.toISOString(), opts)).toBe(icuIs(d, opts));
        expect(formatDateTime(d.toISOString(), opts)).toBe(icuIs(d, opts));
      }
    }
  });

  test('an explicit timeZone is honoured', () => {
    const { formatDateTime } = load('is');
    const d = new Date('2026-09-14T23:30:00Z');
    for (const timeZone of ['UTC', 'Atlantic/Reykjavik', 'America/New_York', 'Asia/Tokyo']) {
      const opts = { ...DATETIME, timeZone };
      expect(formatDateTime(d.toISOString(), opts)).toBe(icuIs(d, opts));
    }
    expect(formatDateTime(d.toISOString(), { ...DATETIME, timeZone: 'Asia/Tokyo' })).toBe('15. sep. 2026, 08:30');
  });

  test('does not depend on the runtime having Icelandic ICU data', () => {
    // Simulate the browser that produced the bug: every locale resolves to en-GB.
    Intl.DateTimeFormat = function (_locale, opts) { return new RealDateTimeFormat('en-GB', opts); };
    Intl.DateTimeFormat.prototype = RealDateTimeFormat.prototype;
    Date.prototype.toLocaleString = function (_l, o) { return realToLocaleString.call(this, 'en-GB', o); };
    Date.prototype.toLocaleDateString = function (_l, o) { return realToLocaleDateString.call(this, 'en-GB', o); };
    const { formatDate, formatDateTime } = load('is');
    const d = new Date(2026, 8, 14, 0, 0);
    expect(formatDate(d.toISOString())).toBe('14. sep. 2026');
    expect(formatDateTime(d.toISOString())).toBe('14. sep. 2026, 00:00');
  });

  test('a shape it does not build falls through to the runtime', () => {
    const { formatDateTime } = load('is');
    const d = new Date(2026, 8, 14, 9, 5, 7);
    const opts = { ...DATETIME, second: '2-digit' };
    expect(formatDateTime(d.toISOString(), opts)).toBe(realToLocaleString.call(d, 'is-IS', opts));
  });

  test('empty and invalid input keep their old behaviour', () => {
    const { formatDate, formatDateTime } = load('is');
    expect(formatDate(null)).toBe('—');
    expect(formatDateTime('')).toBe('—');
    expect(formatDate('not a date')).toBe('Invalid Date');
  });
});

describe('formatDate / formatDateTime in English are unchanged', () => {
  test('en-GB output comes straight from the runtime', () => {
    const { formatDate, formatDateTime } = load('en');
    for (const d of sampleDates()) {
      const iso = d.toISOString();
      expect(formatDate(iso)).toBe(realToLocaleDateString.call(d, 'en-GB', DATE));
      expect(formatDateTime(iso)).toBe(realToLocaleString.call(d, 'en-GB', DATETIME));
    }
  });
});
