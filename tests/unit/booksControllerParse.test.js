// Request-parsing guards for the books endpoints.
//
// These are the reason a malformed request is a 400 with an explanation rather
// than a Postgres error surfacing as a 500. The HTTP suite covers them through
// real requests; this pins the edge cases that are tedious to reach that way —
// and the module exported them "for unit tests" long before any test imported it.
const { _internals } = require('../../server/controllers/adminBookkeepingController');

const { parsePagination, parseRange, parseAmount, parseEnum, parseId, parseText } = _internals;

describe('parsePagination', () => {
  it('defaults sensibly when nothing is given', () => {
    expect(parsePagination({})).toEqual({ limit: 50, offset: 0 });
  });

  it('accepts numeric strings, since query params arrive as strings', () => {
    expect(parsePagination({ limit: '25', offset: '100' })).toEqual({ limit: 25, offset: 100 });
  });

  // Bounded on BOTH ends. `Math.min(Number(x) || d, cap)` — the idiom in the system
  // this replaces — clamps only the top, so ?limit=-1 became `LIMIT -1` and a 500.
  it.each([-1, 0, 201, 1.5, NaN, Infinity])('rejects limit %p', (limit) => {
    expect(() => parsePagination({ limit })).toThrow(/limit/);
  });

  it.each([-5, 1.5, 2_000_000])('rejects offset %p', (offset) => {
    expect(() => parsePagination({ offset })).toThrow(/offset/);
  });

  it('rejects an array, which is what ?limit=1&limit=2 would otherwise become', () => {
    expect(() => parsePagination({ limit: ['1', '2'] })).toThrow(/limit/);
  });
});

describe('parseRange', () => {
  it('defaults to a bounded window rather than scanning all of history', () => {
    const { from, to } = parseRange({}, { defaultDays: 60 });
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(from < to).toBe(true);
  });

  it('honours an explicit range', () => {
    expect(parseRange({ from: '2026-01-01', to: '2026-02-28' }))
      .toEqual({ from: '2026-01-01', to: '2026-02-28' });
  });

  it('derives the missing end of a half-open range', () => {
    expect(parseRange({ to: '2026-03-01' }, { defaultDays: 10 }).from).toBe('2026-02-19');
    expect(parseRange({ from: '2026-01-01' }).to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('REJECTS a reversed range instead of silently swapping it', () => {
    // Swapping hands the user numbers for a window they did not ask for, with no
    // indication that it happened.
    expect(() => parseRange({ from: '2026-08-01', to: '2026-01-01' })).toThrow(/after/);
  });

  it.each(['abc', '2026-13-01', '2026-02-30', '01/02/2026'])('rejects unusable date %s', (bad) => {
    expect(() => parseRange({ from: bad })).toThrow();
  });

  it('allows a future date on a read filter', () => {
    // Read filters legitimately look forward (an invoice due next month); only
    // accounting dates are barred from the future.
    expect(parseRange({ from: '2026-01-01', to: '2099-01-01' }).to).toBe('2099-01-01');
  });
});

describe('parseAmount', () => {
  it('accepts a whole number of ISK', () => {
    expect(parseAmount(12400, 'amount')).toBe(12400);
    expect(parseAmount('12400', 'amount')).toBe(12400);
  });

  it.each([0, -100, 1.5, 'abc', '', null, undefined, true, NaN, Infinity, 1e20])(
    'rejects %p', (bad) => {
      expect(() => parseAmount(bad, 'amount')).toThrow(/amount/);
    });

  it('rejects an array, which Number() would otherwise coerce', () => {
    // Number([]) === 0 and Number([1000]) === 1000, so an array walks past a naive
    // guard and lands in a BIGINT money column as a figure nobody validated.
    expect(() => parseAmount([], 'amount')).toThrow(/amount/);
    expect(() => parseAmount([1000], 'amount')).toThrow(/amount/);
  });

  it('names the field, so the error tells the caller what to fix', () => {
    expect(() => parseAmount(-1, 'amount_gross')).toThrow(/amount_gross/);
  });
});

describe('parseEnum', () => {
  it('accepts a listed value and returns null for an absent one', () => {
    expect(parseEnum('paid', ['paid', 'issued'], 'status')).toBe('paid');
    expect(parseEnum(undefined, ['paid'], 'status')).toBeNull();
    expect(parseEnum('', ['paid'], 'status')).toBeNull();
  });

  it('rejects anything unlisted, including an injection attempt', () => {
    expect(() => parseEnum('bogus', ['paid'], 'status')).toThrow(/status/);
    expect(() => parseEnum('total; DROP TABLE invoices', ['total'], 'sort')).toThrow(/sort/);
  });

  it('lists the allowed values in the error', () => {
    expect(() => parseEnum('x', ['a', 'b'], 'field')).toThrow(/a, b/);
  });
});

describe('parseId', () => {
  it('accepts a canonical uuid in either case', () => {
    const id = '167f21cb-0c21-47d0-9b89-a1862e555aa8';
    expect(parseId(id, 'invoice id')).toBe(id);
    expect(parseId(id.toUpperCase(), 'invoice id')).toBe(id.toUpperCase());
  });

  it.each([
    'not-a-uuid',
    '167f21cb0c2147d09b89a1862e555aa8',                 // unhyphenated
    '167f21cb-0c21-47d0-9b89-a1862e555aa',              // too short
    '167f21cb-0c21-47d0-9b89-a1862e555aa8x',            // trailing junk
    '167f21cb-0c21-47d0-9b89-a1862e555aa8\n',           // trailing newline
    "' OR 1=1--",
    '',
  ])('rejects %p', (bad) => {
    expect(() => parseId(bad, 'invoice id')).toThrow(/invoice id/);
  });
});

describe('parseText', () => {
  it('trims and returns the value', () => {
    expect(parseText('  Byko  ', 'supplier')).toBe('Byko');
  });

  it('returns empty for an absent optional field', () => {
    expect(parseText(undefined, 'note')).toBe('');
    expect(parseText(null, 'note')).toBe('');
  });

  it('enforces required', () => {
    expect(() => parseText('', 'reason', { required: true })).toThrow(/reason/);
    expect(() => parseText('   ', 'reason', { required: true })).toThrow(/reason/);
    expect(() => parseText(undefined, 'reason', { required: true })).toThrow(/reason/);
  });

  it('enforces a maximum length', () => {
    expect(() => parseText('x'.repeat(201), 'reference', { maxLen: 200 })).toThrow(/200/);
    expect(parseText('x'.repeat(200), 'reference', { maxLen: 200 })).toHaveLength(200);
  });

  it('rejects a non-string rather than stringifying it', () => {
    expect(() => parseText(42, 'note')).toThrow(/note/);
    expect(() => parseText({}, 'note')).toThrow(/note/);
    expect(() => parseText(['a'], 'note')).toThrow(/note/);
  });
});
