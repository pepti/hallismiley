// Icelandic VSK settlement periods (bi-monthly). Boundary arithmetic here decides
// which return a transaction lands on, so the month-edge cases are tested
// explicitly rather than trusted.
const {
  periodForDate,
  parsePeriod,
  periodBounds,
  previousPeriod,
  nextPeriod,
  samePeriodLastYear,
  listPeriods,
  periodsInYear,
  PeriodError,
  PERIODS_PER_YEAR,
} = require('../../server/utils/vatPeriod');

describe('periodForDate', () => {
  it.each([
    ['2026-01-01', '2026-P1'],
    ['2026-02-28', '2026-P1'],
    ['2026-03-01', '2026-P2'],
    ['2026-04-30', '2026-P2'],
    ['2026-05-01', '2026-P3'],
    ['2026-07-15', '2026-P4'],
    ['2026-09-30', '2026-P5'],
    ['2026-11-01', '2026-P6'],
    ['2026-12-31', '2026-P6'],
  ])('%s falls in %s', (date, expected) => {
    expect(periodForDate(date)).toBe(expected);
  });

  it('puts a New Year boundary in the right year', () => {
    expect(periodForDate('2025-12-31')).toBe('2025-P6');
    expect(periodForDate('2026-01-01')).toBe('2026-P1');
  });

  it('accepts a Date object', () => {
    expect(periodForDate(new Date(Date.UTC(2026, 6, 15)))).toBe('2026-P4');
  });

  it('rejects an unparseable date rather than returning a wrong period', () => {
    expect(() => periodForDate('not-a-date')).toThrow(PeriodError);
  });
});

describe('periodBounds', () => {
  it('spans two whole months, inclusive', () => {
    expect(periodBounds('2026-P1')).toMatchObject({
      starts_on: '2026-01-01', ends_on: '2026-02-28', year: 2026, index: 1,
    });
    expect(periodBounds('2026-P6')).toMatchObject({
      starts_on: '2026-11-01', ends_on: '2026-12-31',
    });
  });

  it('gets February right in a leap year', () => {
    // 2028 is a leap year: P1 must end on the 29th, not the 28th, or a transaction
    // dated 29 Feb falls into no period at all and the period-lock trigger,
    // which matches on BETWEEN starts_on AND ends_on, would let it through.
    expect(periodBounds('2028-P1').ends_on).toBe('2028-02-29');
  });

  it('agrees with the fiscal_periods rows seeded by migration 072', () => {
    // Same values as the seed, so a change in one and not the other is caught here
    // rather than by a mis-filed VAT return.
    expect(periodBounds('2026-P2')).toMatchObject({ starts_on: '2026-03-01', ends_on: '2026-04-30' });
    expect(periodBounds('2026-P3')).toMatchObject({ starts_on: '2026-05-01', ends_on: '2026-06-30' });
    expect(periodBounds('2026-P4')).toMatchObject({ starts_on: '2026-07-01', ends_on: '2026-08-31' });
    expect(periodBounds('2026-P5')).toMatchObject({ starts_on: '2026-09-01', ends_on: '2026-10-31' });
  });

  it('covers every day of the year with exactly one period', () => {
    // No gaps, no overlaps — otherwise a date either escapes the period lock or
    // gets counted on two returns.
    const seen = new Map();
    for (let m = 0; m < 12; m += 1) {
      const daysInMonth = new Date(Date.UTC(2026, m + 1, 0)).getUTCDate();
      for (let d = 1; d <= daysInMonth; d += 1) {
        const iso = `2026-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const p = periodForDate(iso);
        const b = periodBounds(p);
        expect(iso >= b.starts_on && iso <= b.ends_on).toBe(true);
        seen.set(p, (seen.get(p) || 0) + 1);
      }
    }
    expect(seen.size).toBe(PERIODS_PER_YEAR);
    expect([...seen.values()].reduce((a, b) => a + b, 0)).toBe(365);
  });
});

describe('parsePeriod', () => {
  it('parses a well-formed key', () => {
    expect(parsePeriod('2026-P3')).toEqual({ year: 2026, index: 3 });
  });

  it.each(['2026-P0', '2026-P7', '26-P1', '2026P1', '2026-p1', 'P1', '', null])(
    'rejects malformed key %p', (bad) => {
      expect(() => parsePeriod(bad)).toThrow(PeriodError);
    });

  it('lowercase p is rejected, so a typo cannot silently target another period', () => {
    expect(() => parsePeriod('2026-p4')).toThrow(PeriodError);
  });
});

describe('navigation', () => {
  it('steps backwards across the year boundary', () => {
    expect(previousPeriod('2026-P1')).toBe('2025-P6');
    expect(previousPeriod('2026-P4')).toBe('2026-P3');
  });

  it('steps forwards across the year boundary', () => {
    expect(nextPeriod('2026-P6')).toBe('2027-P1');
    expect(nextPeriod('2026-P2')).toBe('2026-P3');
  });

  it('finds the same period a year earlier for year-on-year comparison', () => {
    expect(samePeriodLastYear('2026-P4')).toBe('2025-P4');
  });
});

describe('listPeriods', () => {
  it('lists an inclusive range oldest first', () => {
    expect(listPeriods('2026-P5', '2027-P2')).toEqual([
      '2026-P5', '2026-P6', '2027-P1', '2027-P2',
    ]);
  });

  it('returns a single period when from === to', () => {
    expect(listPeriods('2026-P3', '2026-P3')).toEqual(['2026-P3']);
  });

  it('rejects a reversed range instead of silently swapping it', () => {
    // Silently swapping means a user who mistypes a range gets numbers for a
    // window they did not ask for, and no indication of it.
    expect(() => listPeriods('2026-P4', '2026-P1')).toThrow(/reversed/);
  });

  it('refuses an absurdly wide range', () => {
    expect(() => listPeriods('2000-P1', '2099-P6')).toThrow(/too wide/);
  });
});

describe('periodsInYear', () => {
  it('returns the six periods of a year', () => {
    expect(periodsInYear(2026)).toEqual([
      '2026-P1', '2026-P2', '2026-P3', '2026-P4', '2026-P5', '2026-P6',
    ]);
  });

  it('rejects a nonsense year', () => {
    expect(() => periodsInYear('abc')).toThrow(PeriodError);
    expect(() => periodsInYear(1900)).toThrow(PeriodError);
  });
});
