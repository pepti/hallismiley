'use strict';

// Inventory Watch classifier (server/utils/inventoryStatus.js). Ported from
// icelandicstore #13's tests/unit/inventoryStatus.test.js, plus the engine's
// report builder (one item per stocked unit, bucketed on Available) —
// harvest2-lane6a-2026-09-26.
const {
  classifyInventory, coverMonths, windowMonths, buildWatchReport,
  COVER_CRITICAL, COVER_LOW, COVER_WATCH, STATUSES,
} = require('../../server/utils/inventoryStatus');

describe('windowMonths', () => {
  test('converts a day window to months (30d = 1mo)', () => {
    expect(windowMonths(90)).toBe(3);
    expect(windowMonths(30)).toBe(1);
    expect(windowMonths()).toBe(3);
  });
});

describe('coverMonths', () => {
  test('qty / sold_per_month', () => {
    expect(coverMonths(40, 160)).toBeCloseTo(0.25);
    expect(coverMonths(100, 10)).toBeCloseTo(10);
  });
  test('null when not finite/positive', () => {
    expect(coverMonths(0, 10)).toBeNull();
    expect(coverMonths(-5, 10)).toBeNull();
    expect(coverMonths(50, 0)).toBeNull();
  });
});

describe('classifyInventory', () => {
  test("non-positive quantity is always 'out' regardless of velocity", () => {
    expect(classifyInventory(0, 0)).toBe('out');
    expect(classifyInventory(0, 999)).toBe('out');
    expect(classifyInventory(-11, 50)).toBe('out');
  });

  test("in stock with no recent sales is 'ok' (nothing at risk)", () => {
    expect(classifyInventory(5, 0)).toBe('ok');
    expect(classifyInventory(10000, 0)).toBe('ok');
  });

  test('cover bands: critical < 0.5 ≤ low < 1 ≤ watch < 2 ≤ ok', () => {
    expect(classifyInventory(4, 100)).toBe('critical');
    expect(classifyInventory(40, 160)).toBe('critical');
    expect(classifyInventory(7, 10)).toBe('low');
    expect(classifyInventory(15, 10)).toBe('watch');
    expect(classifyInventory(100, 10)).toBe('ok');
  });

  test('band boundaries are inclusive at the top of the lower band', () => {
    expect(classifyInventory(5, 10)).toBe('low');
    expect(classifyInventory(10, 10)).toBe('watch');
    expect(classifyInventory(20, 10)).toBe('ok');
  });

  test('threshold constants are the documented values', () => {
    expect([COVER_CRITICAL, COVER_LOW, COVER_WATCH]).toEqual([0.5, 1, 2]);
    expect(STATUSES).toEqual(['out', 'critical', 'low', 'watch', 'ok']);
  });
});

describe('buildWatchReport', () => {
  const rows = [
    // 10 on hand, 10 committed → Available 0 → out, whatever the shelf says.
    { product_id: 'p1', variant_id: null, name: 'Mug', sku: 'MUG', on_hand: 10, committed: 10, units_window: 30 },
    // 6 available, 30 sold in 90 days = 10/mo → 0.6 mo → low.
    { product_id: 'p2', variant_id: 'v2', name: 'Tee', attributes: { size: 'M' }, sku: 'TEE-M', on_hand: 8, committed: 2, units_window: 30 },
    // Nothing sold → ok.
    { product_id: 'p3', variant_id: null, name: 'Cap', on_hand: 4, committed: 0, units_window: 0 },
  ];

  test('buckets on Available, one item per unit, keyed by variant or product', () => {
    const r = buildWatchReport(rows);
    expect(r.total).toBe(3);
    expect(r.window_days).toBe(90);
    expect(r.items.map(i => [i.key, i.available, i.status])).toEqual([
      ['p:p1', 0, 'out'],
      ['v:v2', 6, 'low'],
      ['p:p3', 4, 'ok'],
    ]);
    expect(r.counts).toEqual({ out: 1, critical: 0, low: 1, watch: 0, ok: 1 });
    expect(r.items[1].sold_per_month).toBeCloseTo(10);
    expect(r.items[1].cover_months).toBeCloseTo(0.6);
    expect(r.items[0].cover_months).toBeNull();
  });

  test('an empty report is well-formed', () => {
    expect(buildWatchReport([])).toEqual({
      items: [], counts: { out: 0, critical: 0, low: 0, watch: 0, ok: 0 }, total: 0, window_days: 90,
    });
  });
});
