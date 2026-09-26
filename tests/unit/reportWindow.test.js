'use strict';

// server/utils/reportWindow.js — the ?from&to(&compare_*)(&bucket) the admin
// sales / insights / marketing reports take (harvest 2 lane 5).
const { parseReportWindow, bucketFor } = require('../../server/utils/reportWindow');

const NOW = new Date('2026-09-26T15:30:00Z');

describe('parseReportWindow', () => {
  test('a bare date is UTC midnight (Reykjavík); the window is half-open', () => {
    const w = parseReportWindow({ from: '2026-09-01', to: '2026-09-27' }, NOW);
    expect(w).toMatchObject({ ok: true, compare: null, bucket: 'day' });
    expect(w.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-09-27T00:00:00.000Z');
  });

  test('defaults: to = now, from = 30 days before', () => {
    const w = parseReportWindow({}, NOW);
    expect(w.to).toBe(NOW);
    expect(w.from.toISOString()).toBe('2026-08-27T15:30:00.000Z');
  });

  test('a comparison window may end at an instant (the part-day cut)', () => {
    const w = parseReportWindow({
      from: '2026-09-26', to: '2026-09-27', compare_from: '2026-09-25', compare_to: '2026-09-25T15:30:00.000Z',
    }, NOW);
    expect(w.ok).toBe(true);
    expect(w.compare.to.toISOString()).toBe('2026-09-25T15:30:00.000Z');
    expect(w.bucket).toBe('hour');
  });

  test.each([
    [{ from: '2026-09-10', to: '2026-09-10' }],
    [{ from: '2026-09-10', to: '2026-09-01' }],
    [{ from: 'soon', to: '2026-09-01' }],
    [{ from: ['2026-09-01', '2026-09-02'], to: '2026-09-10' }],
    [{ from: '2026-09-01', to: '2026-09-10', compare_from: '2026-08-10' }],
    [{ from: '2026-09-01', to: '2026-09-10', compare_from: '2026-08-10', compare_to: '2026-08-01' }],
  ])('invalid: %j', (q) => {
    expect(parseReportWindow(q, NOW)).toEqual({ ok: false });
  });

  test('an explicit bucket wins; an unknown one follows the span', () => {
    expect(parseReportWindow({ from: '2026-01-01', to: '2026-09-27', bucket: 'week' }, NOW).bucket).toBe('week');
    expect(parseReportWindow({ from: '2026-01-01', to: '2026-09-27', bucket: 'fortnight' }, NOW).bucket).toBe('month');
  });
});

test('bucketFor mirrors the client granularity()', () => {
  const d = s => new Date(`${s}T00:00:00Z`);
  expect(bucketFor(d('2026-09-23'), d('2026-09-24'))).toBe('hour');
  expect(bucketFor(d('2026-09-01'), d('2026-09-24'))).toBe('day');
  expect(bucketFor(d('2026-06-26'), d('2026-09-24'))).toBe('week');
  expect(bucketFor(d('2025-09-24'), d('2026-09-24'))).toBe('month');
});
