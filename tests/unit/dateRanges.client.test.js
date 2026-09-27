'use strict';

// public/js/utils/dateRanges.js — the admin sales report's period presets.
// Every window is half-open [from, to) in UTC (= Atlantic/Reykjavik, which
// keeps UTC all year), and each preset knows the window it is compared against.
// Ported from icelandicstore #414 (harvest 2 lane 5); the Icelandic labels are
// built by hand in the engine (no Icelandic ICU in Chrome) and pinned below.
const {
  PRESETS, DEFAULT_PRESET, resolvePreset, granularity, fillSeries,
  formatRange, bucketLabel, percentChange, spanDays,
} = require('../../public/js/utils/dateRanges.js');

// Wednesday 23 September 2026, mid-afternoon.
const NOW = Date.UTC(2026, 8, 23, 15, 30);

describe('resolvePreset', () => {
  // [from, to, prevFrom, prevTo, prevCut]. A window that runs to the end of
  // today is compared only up to the same moment (15:30) of the matching day.
  const cases = {
    today:     ['2026-09-23', '2026-09-24', '2026-09-22', '2026-09-23', '2026-09-22T15:30'],
    yesterday: ['2026-09-22', '2026-09-23', '2026-09-21', '2026-09-22', '2026-09-22T00:00'],
    // Monday 21 Sept → Thursday exclusive; the same Mon–Wed a week earlier.
    thisWeek:  ['2026-09-21', '2026-09-24', '2026-09-14', '2026-09-17', '2026-09-16T15:30'],
    last7:     ['2026-09-17', '2026-09-24', '2026-09-10', '2026-09-17', '2026-09-16T15:30'],
    // Month to date is compared with the SAME days of last month.
    thisMonth: ['2026-09-01', '2026-09-24', '2026-08-01', '2026-08-24', '2026-08-23T15:30'],
    lastMonth: ['2026-08-01', '2026-09-01', '2026-07-01', '2026-08-01', '2026-08-01T00:00'],
    last30:    ['2026-08-25', '2026-09-24', '2026-07-26', '2026-08-25', '2026-08-24T15:30'],
    last90:    ['2026-06-26', '2026-09-24', '2026-03-28', '2026-06-26', '2026-06-25T15:30'],
    ytd:       ['2026-01-01', '2026-09-24', '2025-01-01', '2025-09-24', '2025-09-23T15:30'],
    // Twelve calendar months, this one included — the first bar is a whole month.
    last12m:   ['2025-10-01', '2026-09-24', '2024-10-01', '2025-09-24', '2025-09-23T15:30'],
  };
  test.each(Object.entries(cases))('%s', (preset, [from, to, prevFrom, prevTo, cut]) => {
    expect(resolvePreset(preset, NOW)).toEqual({
      preset, from, to, prevFrom, prevTo, prevCut: `${cut}:00.000Z`,
    });
  });

  test('all time has no comparison window', () => {
    expect(resolvePreset('all', NOW)).toEqual({
      preset: 'all', from: '2000-01-01', to: '2026-09-24', prevFrom: null, prevTo: null, prevCut: null,
    });
  });

  test('an unknown preset falls back to the default', () => {
    expect(resolvePreset('bogus', NOW).preset).toBe(DEFAULT_PRESET);
    expect(PRESETS).toContain(DEFAULT_PRESET);
  });

  test('month to date on the 31st never runs past the start of this month', () => {
    // 31 March: 1–31 Mar is compared with February, which has no 29th–31st.
    const r = resolvePreset('thisMonth', Date.UTC(2026, 2, 31, 12));
    expect(r).toMatchObject({ from: '2026-03-01', to: '2026-04-01', prevFrom: '2026-02-01', prevTo: '2026-03-01' });
    // Already shortened to all of February: compared in full, not cut at 12:00.
    expect(r.prevCut).toBe('2026-03-01T00:00:00.000Z');
  });

  test('this week on a Monday is just that day, a Sunday closes the week', () => {
    expect(resolvePreset('thisWeek', Date.UTC(2026, 8, 21, 9))).toMatchObject({ from: '2026-09-21', to: '2026-09-22' });
    expect(resolvePreset('thisWeek', Date.UTC(2026, 8, 27, 9))).toMatchObject({ from: '2026-09-21', to: '2026-09-28' });
  });

  test('every comparison window is as long as its window, or shorter only at a month end', () => {
    for (const p of PRESETS.filter(x => x !== 'all' && x !== 'thisMonth' && x !== 'lastMonth' && x !== 'ytd' && x !== 'last12m')) {
      const r = resolvePreset(p, NOW);
      expect(spanDays(r.prevFrom, r.prevTo)).toBe(spanDays(r.from, r.to));
    }
  });
});

describe('granularity', () => {
  test('hour for one day, then day, week, month', () => {
    expect(granularity('2026-09-23', '2026-09-24')).toBe('hour');
    expect(granularity('2026-09-01', '2026-09-24')).toBe('day');
    expect(granularity('2026-06-26', '2026-09-24')).toBe('week');
    expect(granularity('2025-09-24', '2026-09-24')).toBe('month');
  });
});

describe('fillSeries', () => {
  const fields = ['revenue_net', 'orders'];

  test('zero-fills every day in the window', () => {
    const out = fillSeries([{ day: '2026-09-02', revenue_net: 100, orders: 1 }],
      { from: '2026-09-01', to: '2026-09-04', gran: 'day', fields });
    expect(out).toEqual([
      { key: '2026-09-01', revenue_net: 0,   orders: 0 },
      { key: '2026-09-02', revenue_net: 100, orders: 1 },
      { key: '2026-09-03', revenue_net: 0,   orders: 0 },
    ]);
  });

  test('an hourly today stops at the current hour', () => {
    const out = fillSeries([], { from: '2026-09-23', to: '2026-09-24', gran: 'hour', fields, until: NOW });
    expect(out.map(b => b.key)).toHaveLength(16); // 00:00 … 15:00
    expect(out[out.length - 1].key).toBe('2026-09-23T15');
  });

  test('24 hourly buckets for one day', () => {
    const out = fillSeries([{ day: '2026-09-23T14', revenue_net: 5, orders: 1 }],
      { from: '2026-09-23', to: '2026-09-24', gran: 'hour', fields });
    expect(out).toHaveLength(24);
    expect(out[14]).toEqual({ key: '2026-09-23T14', revenue_net: 5, orders: 1 });
  });

  test('weeks start on Monday and sum their days', () => {
    const out = fillSeries([
      { day: '2026-09-21', revenue_net: 10, orders: 1 },
      { day: '2026-09-27', revenue_net: 5,  orders: 2 },
      { day: '2026-09-28', revenue_net: 1,  orders: 1 },
    ], { from: '2026-09-21', to: '2026-10-05', gran: 'week', fields });
    expect(out).toEqual([
      { key: '2026-09-21', revenue_net: 15, orders: 3 },
      { key: '2026-09-28', revenue_net: 1,  orders: 1 },
    ]);
  });

  test('all time trims the leading empty months', () => {
    const out = fillSeries([
      { day: '2026-07-15', revenue_net: 1, orders: 1 },
      { day: '2026-09-02', revenue_net: 2, orders: 1 },
    ], { from: '2000-01-01', to: '2026-09-24', gran: 'month', fields, trimLeading: true });
    expect(out.map(b => b.key)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(out[1]).toEqual({ key: '2026-08', revenue_net: 0, orders: 0 });
  });

  test('all time with no data is an empty series', () => {
    expect(fillSeries([], { from: '2000-01-01', to: '2026-09-24', gran: 'month', fields, trimLeading: true })).toEqual([]);
  });
});

describe('labels and change', () => {
  test('formatRange shows the last INCLUDED day', () => {
    expect(formatRange('2026-09-23', '2026-09-24', 'en')).toBe('23 Sept 2026');
    expect(formatRange('2026-09-01', '2026-09-24', 'en')).toMatch(/^1\D+23 Sept 2026$/);
  });

  test('bucketLabel', () => {
    expect(bucketLabel('2026-09-23T07', 'hour')).toBe('07:00');
    expect(bucketLabel('2026-09', 'month', 'en')).toBe('Sept 2026');
  });

  test('Icelandic labels are built by hand, not left to ICU', () => {
    expect(formatRange('2026-09-23', '2026-09-24', 'is')).toBe('23. sep. 2026');
    expect(formatRange('2026-09-01', '2026-09-24', 'is')).toBe('1.–23. sep. 2026');
    expect(formatRange('2026-08-28', '2026-09-04', 'is')).toBe('28. ágú.–3. sep. 2026');
    expect(formatRange('2025-12-28', '2026-01-04', 'is')).toBe('28. des. 2025 – 3. jan. 2026');
    expect(bucketLabel('2026-05', 'month', 'is')).toBe('maí 2026');
    expect(bucketLabel('2026-09-21', 'day', 'is')).toBe('21. sep.');
  });

  test('the server’s bucket keys fold straight in (a month key is its first day)', () => {
    const out = fillSeries([{ day: '2026-08-01', revenue_net: 7, orders: 1 }],
      { from: '2026-07-01', to: '2026-09-01', gran: 'month', fields: ['revenue_net', 'orders'] });
    expect(out).toEqual([
      { key: '2026-07', revenue_net: 0, orders: 0 },
      { key: '2026-08', revenue_net: 7, orders: 1 },
    ]);
  });

  test('percentChange has no base when the previous period was zero', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeNull();
  });
});
