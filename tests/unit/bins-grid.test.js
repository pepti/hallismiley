// Unit tests for the BIN System's pure derivation logic (server/models/Bin.js):
// bin-code parsing, the zone chip rollup, and the per-zone grid with "free" gap
// fill. No DB — these are the functions that turn a flat list of assigned bins
// into the visual board, so they're tested directly.
const Bin = require('../../server/models/Bin');

describe('Bin.parseBin', () => {
  test('parses <letters>-<digits>, upper-casing the zone', () => {
    expect(Bin.parseBin('A-001')).toEqual({ zone: 'A', sep: '-', num: 1, width: 3 });
    expect(Bin.parseBin('BK-6')).toEqual({ zone: 'BK', sep: '-', num: 6, width: 1 });
  });

  test('tolerates no separator, lower case, and surrounding whitespace', () => {
    expect(Bin.parseBin('a19')).toEqual({ zone: 'A', sep: '', num: 19, width: 2 });
    expect(Bin.parseBin('  D-042 ')).toEqual({ zone: 'D', sep: '-', num: 42, width: 3 });
  });

  test('returns null for malformed / empty / nullish codes', () => {
    expect(Bin.parseBin('ZZZ')).toBeNull();      // no digits
    expect(Bin.parseBin('12')).toBeNull();       // no zone letters
    expect(Bin.parseBin('A-1-2')).toBeNull();    // extra segment
    expect(Bin.parseBin('')).toBeNull();
    expect(Bin.parseBin(null)).toBeNull();
    expect(Bin.parseBin(undefined)).toBeNull();
  });
});

describe('Bin.buildZoneCells (free-gap fill)', () => {
  const rows = [
    { bin: 'A-001', item_count: 1 },
    { bin: 'A-002', item_count: 1 },
    { bin: 'A-005', item_count: 2 },
    { bin: 'B-010', item_count: 1 }, // other zone — must be ignored for zone A
  ];

  test('spans min..max and marks gaps free, singles occupied, >1 multi', () => {
    const { zone, min, max, cells } = Bin.buildZoneCells('A', rows);
    expect(zone).toBe('A');
    expect(min).toBe(1);
    expect(max).toBe(5);
    expect(cells).toEqual([
      { bin: 'A-001', count: 1, kind: 'occupied' },
      { bin: 'A-002', count: 1, kind: 'occupied' },
      { bin: 'A-003', count: 0, kind: 'free' },     // reconstructed, zero-padded
      { bin: 'A-004', count: 0, kind: 'free' },
      { bin: 'A-005', count: 2, kind: 'multi' },
    ]);
  });

  test('is case-insensitive on the zone argument', () => {
    expect(Bin.buildZoneCells('a', rows).cells).toHaveLength(5);
  });

  test('empty zone yields no cells', () => {
    expect(Bin.buildZoneCells('Z', rows)).toEqual({ zone: 'Z', min: null, max: null, cells: [] });
  });

  test('reproduces a zone with no separator and no zero-pad', () => {
    const cells = Bin.buildZoneCells('M', [
      { bin: 'M1', item_count: 1 },
      { bin: 'M3', item_count: 1 },
    ]).cells;
    expect(cells).toEqual([
      { bin: 'M1', count: 1, kind: 'occupied' },
      { bin: 'M2', count: 0, kind: 'free' },
      { bin: 'M3', count: 1, kind: 'occupied' },
    ]);
  });
});

describe('Bin.summariseZones', () => {
  test('rolls bins/items per zone and counts malformed bins as mismatches', () => {
    const { zones, bins, items, mismatches } = Bin.summariseZones([
      { bin: 'A-001', item_count: 1 },
      { bin: 'A-002', item_count: 1 },
      { bin: 'A-005', item_count: 2 },
      { bin: 'B-010', item_count: 1 },
      { bin: 'ZZZ',   item_count: 3 }, // malformed
    ]);
    expect(zones).toEqual([
      { zone: 'A', bins: 3, items: 4 },
      { zone: 'B', bins: 1, items: 1 },
    ]);
    expect(bins).toBe(4);        // distinct occupied (well-formed) bins
    expect(items).toBe(5);       // stocked rows in well-formed bins
    expect(mismatches).toBe(3);  // items sitting in malformed bins
  });

  test('empty input yields empty board', () => {
    expect(Bin.summariseZones([])).toEqual({ zones: [], bins: 0, items: 0, mismatches: 0 });
  });
});
