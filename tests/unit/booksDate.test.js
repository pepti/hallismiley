// Accounting dates. Two classes of bug live here, and both were found by these
// tests during development rather than in production:
//   - pg returns DATE columns as Date objects, so String(x).slice(0,10) yields
//     "Wed Aug 05" instead of "2026-08-05".
//   - an ISO-SHAPED string is not necessarily a real day: '2026-08-99' matches the
//     pattern, and without a calendar check it flows through and compares as
//     "in the future".
const {
  toIsoDate,
  assertAccountingDate,
  assertRealCalendarDate,
  addDays,
  daysBetween,
  todayIso,
  DateError,
} = require('../../server/utils/booksDate');

describe('toIsoDate', () => {
  it('passes a well-formed ISO date through unchanged', () => {
    expect(toIsoDate('2026-08-05')).toBe('2026-08-05');
  });

  it('formats a Date object as ISO, not as "Wed Aug 05"', () => {
    // The exact regression: pg hands back Date objects for DATE columns.
    const d = new Date(2026, 7, 5); // local midnight, 5 Aug 2026
    expect(toIsoDate(d)).toBe('2026-08-05');
    expect(toIsoDate(d)).not.toMatch(/[A-Za-z]/);
  });

  it('reads the date part of a timestamp string without re-parsing it', () => {
    // Re-parsing risks a timezone shift moving the day; taking the literal prefix
    // cannot.
    expect(toIsoDate('2026-08-05T23:30:00.000Z')).toBe('2026-08-05');
    expect(toIsoDate('2026-08-05 00:15:00')).toBe('2026-08-05');
  });

  it('returns null for absent values so nullable columns pass through', () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
    expect(toIsoDate('')).toBeNull();
  });

  it.each(['2026-08-99', '2026-13-01', '2026-00-10', '2025-02-29'])(
    'rejects ISO-shaped but impossible date %s', (bad) => {
      // 2025-02-29 matters specifically: JS would roll it over to 1 March rather
      // than complain, silently moving a transaction into the next period.
      expect(() => toIsoDate(bad)).toThrow(DateError);
    });

  it('accepts 29 February in a real leap year', () => {
    expect(toIsoDate('2028-02-29')).toBe('2028-02-29');
  });

  it.each(['not-a-date', {}, 42, true])('rejects unusable input %p', (bad) => {
    expect(() => toIsoDate(bad)).toThrow(DateError);
  });
});

describe('assertRealCalendarDate', () => {
  it('accepts a real day', () => {
    expect(assertRealCalendarDate('2026-02-28')).toBe('2026-02-28');
  });

  it('rejects a day past the end of its month', () => {
    expect(() => assertRealCalendarDate('2026-04-31')).toThrow(DateError);
  });
});

describe('assertAccountingDate', () => {
  it('rejects a future date by default', () => {
    // A future-dated entry silently distorts every period between now and then.
    expect(() => assertAccountingDate('2099-01-01', 'entry_date')).toThrow(/in the future/);
  });

  it('allows a future date when explicitly permitted', () => {
    // Invoice due dates are legitimately in the future.
    expect(assertAccountingDate('2099-01-01', 'due_at', { allowFuture: true })).toBe('2099-01-01');
  });

  it('accepts today', () => {
    expect(assertAccountingDate(todayIso(), 'entry_date')).toBe(todayIso());
  });

  it('names the field in the error, so the message is actionable', () => {
    expect(() => assertAccountingDate('2099-01-01', 'expense_date')).toThrow(/expense_date/);
  });

  it('requires a value', () => {
    expect(() => assertAccountingDate(null, 'entry_date')).toThrow(/required/);
  });
});

describe('addDays', () => {
  it('computes an invoice due date from issue date plus terms', () => {
    expect(addDays('2026-08-05', 14)).toBe('2026-08-19');
  });

  it('crosses a month boundary', () => {
    expect(addDays('2026-08-25', 14)).toBe('2026-09-08');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-28', 10)).toBe('2027-01-07');
  });

  it('handles a leap day correctly', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('accepts zero and negative offsets', () => {
    expect(addDays('2026-08-05', 0)).toBe('2026-08-05');
    expect(addDays('2026-08-05', -5)).toBe('2026-07-31');
  });

  it('rejects a fractional number of days', () => {
    expect(() => addDays('2026-08-05', 1.5)).toThrow(DateError);
  });
});

describe('daysBetween', () => {
  it('counts whole days forward', () => {
    expect(daysBetween('2026-08-01', '2026-08-31')).toBe(30);
  });

  it('returns a negative count when the second date is earlier', () => {
    expect(daysBetween('2026-08-31', '2026-08-01')).toBe(-30);
  });

  it('returns zero for the same day', () => {
    expect(daysBetween('2026-08-05', '2026-08-05')).toBe(0);
  });

  it('is unaffected by a DST-style month boundary', () => {
    // Computed in UTC on purpose: a local-time subtraction across a DST change
    // yields 29.958 days, which rounds wrong and shifts an AR aging bucket.
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
  });

  it('produces the aging buckets AR reporting depends on', () => {
    const due = '2026-06-01';
    expect(daysBetween(due, '2026-06-01')).toBe(0);    // current
    expect(daysBetween(due, '2026-06-30')).toBe(29);   // 1-30
    expect(daysBetween(due, '2026-07-15')).toBe(44);   // 31-60
    expect(daysBetween(due, '2026-09-01')).toBe(92);   // 90+
  });
});
