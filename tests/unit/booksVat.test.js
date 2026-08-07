// VSK arithmetic. These are the tests that decide whether the books are right,
// so they are written against stated expectations rather than against whatever
// the implementation happens to return.
const {
  resolveVatRate,
  splitVatInclusive,
  addVat,
  allocateProportional,
  summariseByRate,
  assertIntegerIsk,
  VatError,
  STANDARD_VAT_RATE,
} = require('../../server/utils/vat');

describe('resolveVatRate', () => {
  // THE regression test for this module. The system this replaces used
  // `Number(candidate)` to resolve a rate, and because Number(null) === 0 while 0
  // is a legitimate Icelandic rate, every line with an absent rate silently booked
  // at 0% VAT — under-declaring output VAT on every counter sale, with its own
  // test suite asserting the wrong totals as correct.
  it.each([null, undefined, ''])('refuses absent rate %p instead of coercing it to 0%%', (bad) => {
    expect(() => resolveVatRate(bad)).toThrow(VatError);
    expect(() => resolveVatRate(bad)).toThrow(/required/i);
  });

  it('accepts an explicit 0 for zero-rated turnover', () => {
    expect(resolveVatRate(0)).toBe(0);
  });

  it('accepts the two real Icelandic rates', () => {
    expect(resolveVatRate(24)).toBe(24);
    expect(resolveVatRate(11)).toBe(11);
  });

  it('accepts numeric strings, since query params arrive as strings', () => {
    expect(resolveVatRate('24')).toBe(24);
  });

  it.each([7, 20, 25, 1, -24, 24.5, 'abc', NaN, Infinity])('rejects unsupported rate %p', (bad) => {
    expect(() => resolveVatRate(bad)).toThrow(VatError);
  });

  // The same coercion trap as the null case, one type further out: Number([]) is
  // 0, so an empty array walked past the absent-rate guard above and booked the
  // line at 0% VAT. Number([24]) === 24 is the other half — a rate that happens
  // to be correct by accident is still a rate nobody validated.
  it.each([[[]], [[24]], [['24']], [[0]], [{}], [{ rate: 24 }]])(
    'refuses non-scalar rate %p rather than coercing it',
    (bad) => {
      expect(() => resolveVatRate(bad)).toThrow(VatError);
    }
  );

  it('does not let an array rate turn a real sale into zero-rated turnover', () => {
    // Before the guard: splitVatInclusive(5000, []) returned net 5000, vat 0.
    expect(() => splitVatInclusive(5000, [])).toThrow(VatError);
  });
});

describe('splitVatInclusive', () => {
  // Prices in this system are VAT-inclusive, so VAT is extracted from the gross.
  // 12,400 gross at 24% is 10,000 net + 2,400 VAT.
  it('extracts 24% VAT from a gross amount', () => {
    expect(splitVatInclusive(12400, 24)).toEqual({ net: 10000, vat: 2400, gross: 12400, rate: 24 });
  });

  it('extracts 11% VAT from a gross amount', () => {
    expect(splitVatInclusive(11100, 11)).toEqual({ net: 10000, vat: 1100, gross: 11100, rate: 11 });
  });

  it('treats a zero-rated line as all net', () => {
    expect(splitVatInclusive(9999, 0)).toEqual({ net: 9999, vat: 0, gross: 9999, rate: 0 });
  });

  it('keeps net + vat === gross exactly, for every gross in a wide range', () => {
    // The property that matters: rounding may move a króna between net and VAT,
    // but it must never open a gap, or the invoice CHECK constraint rejects the row.
    for (let gross = 0; gross <= 5000; gross += 1) {
      for (const rate of [0, 11, 24]) {
        const s = splitVatInclusive(gross, rate);
        expect(s.net + s.vat).toBe(gross);
        expect(s.net).toBeGreaterThanOrEqual(0);
        expect(s.vat).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('rounds half-up on an amount that does not divide evenly', () => {
    // 100 gross at 24%: 100 * 24 / 124 = 19.35... -> 19
    expect(splitVatInclusive(100, 24)).toEqual({ net: 81, vat: 19, gross: 100, rate: 24 });
  });

  it('rejects a negative gross', () => {
    expect(() => splitVatInclusive(-1, 24)).toThrow(/negative/);
  });

  it('rejects a non-integer gross, since ISK has no subunit', () => {
    expect(() => splitVatInclusive(100.5, 24)).toThrow(/integer/);
  });

  it('rejects an absent rate rather than defaulting', () => {
    expect(() => splitVatInclusive(1000)).toThrow(VatError);
  });
});

describe('addVat', () => {
  // Used for reverse-charge self-assessment: the foreign supplier's invoice IS the
  // net figure and Icelandic VAT goes on top of it.
  it('adds 24% to a net amount', () => {
    expect(addVat(10000, 24)).toEqual({ net: 10000, vat: 2400, gross: 12400, rate: 24 });
  });

  it('is the inverse of splitVatInclusive for clean amounts', () => {
    const gross = addVat(10000, 24).gross;
    expect(splitVatInclusive(gross, 24).net).toBe(10000);
  });
});

describe('allocateProportional', () => {
  it('splits a total so the parts sum exactly to it', () => {
    const parts = allocateProportional(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    // 33.33 each: largest-remainder hands the two leftover units to the first two.
    expect(parts).toEqual([34, 33, 33]);
  });

  it('weights by size', () => {
    expect(allocateProportional(1000, [700, 300])).toEqual([700, 300]);
  });

  it('never loses or invents a unit, across many awkward splits', () => {
    // This is the property that protects an order-level discount from drifting
    // away from the line totals it was allocated across.
    for (let total = 0; total <= 300; total += 7) {
      for (const weights of [[1], [1, 2], [3, 3, 3], [1, 1, 1, 1, 1, 1, 1], [999, 1], [5, 0, 5]]) {
        const parts = allocateProportional(total, weights);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(parts).toHaveLength(weights.length);
      }
    }
  });

  it('handles a negative total (a discount) symmetrically', () => {
    const parts = allocateProportional(-100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-100);
  });

  it('returns all zeros for a zero total', () => {
    expect(allocateProportional(0, [5, 5])).toEqual([0, 0]);
  });

  it('does not divide by zero when every weight is zero', () => {
    const parts = allocateProportional(50, [0, 0]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(50);
  });

  it('rejects negative weights', () => {
    expect(() => allocateProportional(10, [5, -5])).toThrow(/negative/);
  });
});

describe('summariseByRate', () => {
  // The VSK return needs turnover per rate (RSK 10.01 boxes A and B), zero-rated
  // turnover separately (box C) and total output VAT (box D). That is only
  // possible if VAT was tracked per line all along, which is why the system this
  // replaces — posting one aggregate VAT leg — could not produce a real return.
  it('groups mixed-rate lines into per-rate totals', () => {
    const summary = summariseByRate([
      { vat_rate: 24, line_net: 10000, line_vat: 2400 },
      { vat_rate: 24, line_net: 5000, line_vat: 1200 },
      { vat_rate: 11, line_net: 2000, line_vat: 220 },
      { vat_rate: 0, line_net: 7000, line_vat: 0 },
    ]);
    expect(summary.rates).toEqual([
      { rate: 0, net: 7000, vat: 0, gross: 7000 },
      { rate: 11, net: 2000, vat: 220, gross: 2220 },
      { rate: 24, net: 15000, vat: 3600, gross: 18600 },
    ]);
    expect(summary.net_total).toBe(24000);
    expect(summary.vat_total).toBe(3820);
    expect(summary.gross_total).toBe(27820);
  });

  it('refuses a line with no rate rather than counting it as zero-rated', () => {
    expect(() => summariseByRate([{ line_net: 100, line_vat: 0 }])).toThrow(VatError);
  });
});

describe('assertIntegerIsk', () => {
  it('rejects values too large to represent exactly', () => {
    // BIGINT goes far higher than JS can represent, so refuse anything past the
    // safe-integer boundary instead of silently rounding it.
    expect(() => assertIntegerIsk(Number.MAX_SAFE_INTEGER + 2, 'amount')).toThrow(/too large|integer/);
  });

  it.each([NaN, Infinity, -Infinity, 1.5, '12a', null, undefined])('rejects %p', (bad) => {
    expect(() => assertIntegerIsk(bad, 'amount')).toThrow(VatError);
  });

  it('accepts a numeric string', () => {
    expect(assertIntegerIsk('1200', 'amount')).toBe(1200);
  });

  // Number([]) === 0 and Number([1000]) === 1000, so an array reached the BIGINT
  // money columns as a figure that passed no check at all.
  it.each([[[]], [[1000]], [['1000']], [{}], [{ amount: 1000 }]])(
    'rejects non-scalar %p rather than coercing it to a number',
    (bad) => {
      expect(() => assertIntegerIsk(bad, 'amount')).toThrow(VatError);
    }
  );
});

describe('constants', () => {
  it('uses 24% as the standard Icelandic rate', () => {
    expect(STANDARD_VAT_RATE).toBe(24);
  });
});
