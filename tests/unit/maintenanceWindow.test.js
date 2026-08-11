const { isWithinWindow, nextWindowStart } = require('../../server/utils/maintenanceWindow');

// Reykjavík is UTC+0 all year (Iceland does not observe DST), so UTC instants
// read straight across — which keeps these cases legible. The DST block below
// uses a zone that does shift, to prove the arithmetic is not secretly UTC.
const RVK = { days: ['tue', 'wed', 'thu'], fromHour: 3, toHour: 5, tz: 'Atlantic/Reykjavik' };

const at = iso => new Date(iso);

describe('isWithinWindow', () => {
  // 2026-08-11 is a Tuesday.
  test('open inside the hours on a named day', () => {
    expect(isWithinWindow(at('2026-08-11T03:00:00Z'), RVK)).toBe(true);
    expect(isWithinWindow(at('2026-08-11T04:59:00Z'), RVK)).toBe(true);
  });

  test('half-open: the closing hour is already outside', () => {
    expect(isWithinWindow(at('2026-08-11T05:00:00Z'), RVK)).toBe(false);
  });

  test('closed before the opening hour', () => {
    expect(isWithinWindow(at('2026-08-11T02:59:00Z'), RVK)).toBe(false);
  });

  test('closed on a day that is not named', () => {
    // 2026-08-10 is a Monday.
    expect(isWithinWindow(at('2026-08-10T03:30:00Z'), RVK)).toBe(false);
  });

  test('a zero-length or empty window is never open', () => {
    expect(isWithinWindow(at('2026-08-11T03:00:00Z'), { ...RVK, toHour: 3 })).toBe(false);
    expect(isWithinWindow(at('2026-08-11T03:00:00Z'), { ...RVK, days: [] })).toBe(false);
  });
});

describe('isWithinWindow — windows that wrap midnight', () => {
  const NIGHT = { days: ['sat'], fromHour: 23, toHour: 2, tz: 'Atlantic/Reykjavik' };

  test('open late on the named day', () => {
    // 2026-08-15 is a Saturday.
    expect(isWithinWindow(at('2026-08-15T23:30:00Z'), NIGHT)).toBe(true);
  });

  test('still open after midnight — the window belongs to the day it OPENED', () => {
    expect(isWithinWindow(at('2026-08-16T01:30:00Z'), NIGHT)).toBe(true);   // Sunday clock time
  });

  test('closed at the wrap-around end', () => {
    expect(isWithinWindow(at('2026-08-16T02:00:00Z'), NIGHT)).toBe(false);
  });

  test('the small hours of a day whose PREVIOUS day was not named stay closed', () => {
    expect(isWithinWindow(at('2026-08-12T01:00:00Z'), NIGHT)).toBe(false);  // Wednesday
  });
});

describe('nextWindowStart', () => {
  test('returns now when the window is already open', () => {
    const now = at('2026-08-11T03:30:00Z');
    expect(nextWindowStart(now, RVK).toISOString()).toBe(now.toISOString());
  });

  test('finds the opening hour later the same day', () => {
    expect(nextWindowStart(at('2026-08-11T00:10:00Z'), RVK).toISOString())
      .toBe('2026-08-11T03:00:00.000Z');
  });

  test('rolls forward to the next named day', () => {
    // Monday → the Tuesday window.
    expect(nextWindowStart(at('2026-08-10T12:00:00Z'), RVK).toISOString())
      .toBe('2026-08-11T03:00:00.000Z');
  });

  test('rolls across the weekend to the following week', () => {
    // Thursday after the window closes → the next Tuesday.
    expect(nextWindowStart(at('2026-08-13T06:00:00Z'), RVK).toISOString())
      .toBe('2026-08-18T03:00:00.000Z');
  });

  test('a window nothing can match returns null instead of spinning', () => {
    expect(nextWindowStart(at('2026-08-10T12:00:00Z'), { ...RVK, days: [] })).toBeNull();
    expect(nextWindowStart(at('2026-08-10T12:00:00Z'), { ...RVK, toHour: 3 })).toBeNull();
    expect(nextWindowStart(at('2026-08-10T12:00:00Z'), { ...RVK, days: ['funday'] })).toBeNull();
  });
});

describe('nextWindowStart — the zone is real, not assumed UTC', () => {
  // Reykjavík never shifts, so a zone that does is the only way to prove the
  // window tracks LOCAL 03:00 rather than a fixed offset.
  const NY = { days: ['tue'], fromHour: 3, toHour: 5, tz: 'America/New_York' };

  test('winter: 03:00 New York is 08:00 UTC', () => {
    // 2027-01-05 is a Tuesday, EST (UTC-5).
    expect(nextWindowStart(at('2027-01-05T00:00:00Z'), NY).toISOString())
      .toBe('2027-01-05T08:00:00.000Z');
  });

  test('summer: the same window is 07:00 UTC, an hour earlier', () => {
    // 2027-07-06 is a Tuesday, EDT (UTC-4). Same local hour, different instant —
    // which is the entire point of storing a zone rather than an offset.
    expect(nextWindowStart(at('2027-07-06T00:00:00Z'), NY).toISOString())
      .toBe('2027-07-06T07:00:00.000Z');
  });
});
