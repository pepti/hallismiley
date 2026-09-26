// Ported from icelandicstore #8 (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26).
// Natural-order comparator — drives the delivery-note pick-list sort and the
// admin/quick-order BIN sort ("B-2" must precede "B-10"). compareBin is an alias.
const { compareSku, compareBin, naturalCompare } = require('../../server/utils/skuCompare');

describe('compareSku', () => {
  test('numeric runs compare as numbers, not lexicographically', () => {
    expect(compareSku('B-2', 'B-10')).toBeLessThan(0);
    expect(compareSku('B-10', 'B-2')).toBeGreaterThan(0);
    expect(compareSku('9', '10')).toBeLessThan(0);
    expect(compareSku('A9', 'A10')).toBeLessThan(0);
  });

  test('alphabetic runs compare case-insensitively', () => {
    expect(compareSku('abc-1', 'ABD-1')).toBeLessThan(0);
    expect(compareSku('ABC-1', 'abc-1')).toBe(0);
  });

  test('equal SKUs return 0', () => {
    expect(compareSku('THOR-01', 'THOR-01')).toBe(0);
  });

  test('prefix sorts before its extensions', () => {
    expect(compareSku('A-1', 'A-1-B')).toBeLessThan(0);
  });

  test('missing/empty SKUs sort last', () => {
    expect(compareSku(null, 'A-1')).toBeGreaterThan(0);
    expect(compareSku('A-1', null)).toBeLessThan(0);
    expect(compareSku('', 'A-1')).toBeGreaterThan(0);
    expect(compareSku(null, undefined)).toBe(0);
    expect(compareSku('  ', null)).toBe(0);
  });

  test('same numeric value with different zero-padding is deterministic', () => {
    expect(compareSku('007', '7')).toBeGreaterThan(0); // shorter first
    expect(compareSku('A-007-X', 'A-7-Y')).toBeGreaterThan(0); // padding decides before X/Y
  });

  test('digits sort before letters at the same position', () => {
    expect(compareSku('1A', 'A1')).toBeLessThan(0);
    expect(compareSku('A1', 'AA')).toBeLessThan(0);
  });

  test('sorts a realistic pick list into walking order', () => {
    const skus = ['10-200', 'B-10', null, 'A-2', '2-10', 'a-10', 'B-9', 'A-2'];
    const sorted = skus.slice().sort(compareSku);
    expect(sorted).toEqual(['2-10', '10-200', 'A-2', 'A-2', 'a-10', 'B-9', 'B-10', null]);
  });

  test('compareBin / naturalCompare are aliases of the same natural-order sort', () => {
    // BIN ids ("F-77" before "F-100") walk the shelves the same way SKUs sort.
    expect(compareBin).toBe(compareSku);
    expect(naturalCompare).toBe(compareSku);
    expect(compareBin('F-77', 'F-100')).toBeLessThan(0);
    expect(['F-100', 'F-9', 'F-77'].slice().sort(compareBin)).toEqual(['F-9', 'F-77', 'F-100']);
  });
});
