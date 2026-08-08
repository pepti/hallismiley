// Payroll arithmetic, checked against worked examples.
//
// These are the calculations where an error is invisible: every wrong answer is still a
// plausible-looking number of krónur, and the person who finds out is Skatturinn, two
// years later, with interest. So each case here states the working, not just the
// expected figure.
//
// The RATES below are illustrative, chosen to make the arithmetic checkable by hand.
// They are NOT the real Icelandic rates for any year — the real ones live in
// payroll_rates and must be confirmed by a person before payroll will run, which is the
// whole design (see server/services/bookkeeping/payrollService.js).
const payroll = require('../../server/services/bookkeeping/payrollService');

// Three bands with thresholds at 0 / 500.000 / 1.200.000, at 30% / 40% / 45%. Rates are
// the COMBINED figure (tekjuskattur + útsvar) as published, which is what the service
// expects — see the note in the service header.
const BANDS = [
  { income_from: 0, rate_bp: 3000 },
  { income_from: 500_000, rate_bp: 4000 },
  { income_from: 1_200_000, rate_bp: 4500 },
];

const RATES = {
  year: 2099,
  personal_allowance: 60_000,
  municipal_rate_bp: 1450,
  social_security_bp: 635,       // 6.35%
  pension_employee_bp: 400,      // 4%
  pension_employer_bp: 1150,     // 11.5%
  bands: BANDS,
};

// Shaped like a row from `employees`: decimal NUMERIC rates, full_name, and NULL for
// "use the year's statutory rate".
const employee = (over = {}) => ({
  id: 'e1',
  full_name: 'Prófmaður',
  kennitala: '1203894599',
  employment_type: 'employee',
  monthly_salary: 600_000,
  allowance_factor: 1,
  pension_fund: 'Gildi',
  pension_employee_rate: null,
  pension_employer_rate: null,
  extra_pension_employee: 0,
  extra_pension_employer: 0,
  union_rate: 0,
  ended_on: null,
  ...over,
});

describe('toBp', () => {
  it('converts a decimal rate to whole basis points', () => {
    expect(payroll.toBp(0.0635)).toBe(635);
    expect(payroll.toBp('0.0400')).toBe(400);
    expect(payroll.toBp(0)).toBe(0);
    expect(payroll.toBp(1)).toBe(10_000);
  });

  it('refuses a rate above 1, which is always a units mistake', () => {
    // 6.35 where 0.0635 was meant would withhold 635% of the gross. Refusing beats
    // producing a number nobody can explain.
    expect(() => payroll.toBp(6.35)).toThrow(/6.35% is 0.0635/);
    expect(() => payroll.toBp(31.49)).toThrow(/units|Rates are decimals/);
  });
});

describe('applyBp', () => {
  it('rounds to whole ISK once, at the end', () => {
    // 6.35% of 613.000 is exactly 38.925,5. Rounded once here; a float chain gives
    // 38925.499999999996 and rounds the other way.
    expect(payroll.applyBp(613_000, 635)).toBe(38_926);
    expect(payroll.applyBp(100, 400)).toBe(4);
    expect(payroll.applyBp(0, 635)).toBe(0);
    expect(payroll.applyBp(1_000_000, 10_000)).toBe(1_000_000);
  });

  it('refuses a fractional or negative rate rather than coercing it', () => {
    expect(() => payroll.applyBp(100_000, 4.5)).toThrow(/basis points/);
    expect(() => payroll.applyBp(100_000, -400)).toThrow(/basis points/);
  });
});

describe('computeTax', () => {
  it('slices income across the bands rather than picking one', () => {
    // 800.000:
    //   0 – 500.000       at 30% = 150.000
    //   500.000 – 800.000 at 40% = 120.000
    //                            = 270.000
    // The intuitive misreading — "this person is in the 40% band, so 800.000 × 40%" —
    // gives 320.000, over-withholding by 50.000 a month.
    const { total, slices } = payroll.computeTax(800_000, BANDS);
    expect(total).toBe(270_000);
    expect(slices).toEqual([
      { from: 0, to: 500_000, amount: 500_000, rate_bp: 3000, tax: 150_000 },
      { from: 500_000, to: 1_200_000, amount: 300_000, rate_bp: 4000, tax: 120_000 },
    ]);
  });

  it('uses only the first band below its threshold', () => {
    const { total, slices } = payroll.computeTax(400_000, BANDS);
    expect(total).toBe(120_000);
    expect(slices).toHaveLength(1);
  });

  it('reaches the top band and leaves it open-ended', () => {
    // 1.500.000:  500.000×30% + 700.000×40% + 300.000×45%
    //             = 150.000 + 280.000 + 135.000 = 565.000
    const { total, slices } = payroll.computeTax(1_500_000, BANDS);
    expect(total).toBe(565_000);
    expect(slices).toHaveLength(3);
    expect(slices[2]).toMatchObject({ from: 1_200_000, to: null, amount: 300_000, tax: 135_000 });
  });

  it('is exactly zero at zero, and at a threshold gives only the band below', () => {
    expect(payroll.computeTax(0, BANDS).total).toBe(0);
    // At exactly 500.000 the second band has not started: 500.000 × 30%.
    expect(payroll.computeTax(500_000, BANDS).total).toBe(150_000);
  });

  it('is monotonic — one more króna never reduces the tax', () => {
    // The property that catches a threshold off-by-one. A non-monotonic table makes a
    // raise cost the employee money, and would pass any spot check.
    let previous = -1;
    for (const amount of [0, 1, 499_999, 500_000, 500_001,
      1_199_999, 1_200_000, 1_200_001, 5_000_000]) {
      const { total } = payroll.computeTax(amount, BANDS);
      expect(total).toBeGreaterThanOrEqual(previous);
      previous = total;
    }
  });
});

describe('computePayslip', () => {
  it('works a whole payslip end to end', () => {
    // Gross 600.000
    //   pension employee 4%   =  24.000
    //   taxable               = 576.000   (pension comes off BEFORE tax)
    //   tax: 500.000 × 30%    = 150.000
    //         76.000 × 40%    =  30.400
    //                         = 180.400
    //   personal allowance    = -60.000
    //   withholding           = 120.400
    //   net = 600.000 − 120.400 − 24.000 = 455.600
    // Employer, separately: tryggingagjald 38.100, pension 69.000.
    const s = payroll.computePayslip(employee(), RATES);
    expect(s.pension_employee).toBe(24_000);
    expect(s.taxable_base).toBe(576_000);
    expect(s.computed_tax).toBe(180_400);
    expect(s.allowance_used).toBe(60_000);
    expect(s.withholding).toBe(120_400);
    expect(s.net_pay).toBe(455_600);
    expect(s.pension_employer).toBe(69_000);
    expect(s.social_security).toBe(38_100);
  });

  it('taxes the gross less pension, not the gross', () => {
    // The most consequential ordering in the file. Taxing the gross gives tax 190.000
    // and withholding 130.000 — over-withholding 9.600 every month.
    const s = payroll.computePayslip(employee(), RATES);
    expect(s.taxable_base).toBe(s.gross - s.pension_employee - s.extra_pension_employee);
    expect(s.taxable_base).toBeLessThan(s.gross);
  });

  it('applies the allowance to the tax, and never below zero', () => {
    // Small salary: tax 28.800 against a 60.000 allowance. Withholding is zero, not
    // negative — the state does not pay the employee the difference through payroll.
    const s = payroll.computePayslip(employee({ monthly_salary: 100_000 }), RATES);
    expect(s.computed_tax).toBe(28_800);        // 96.000 taxable × 30%
    expect(s.allowance_used).toBe(28_800);
    expect(s.allowance_unused).toBe(31_200);
    expect(s.withholding).toBe(0);
    expect(s.net_pay).toBe(96_000);             // gross less pension only
  });

  it('scales the allowance by the employee’s tax-card share', () => {
    // Someone with two jobs splits their card: more withheld here, correspondingly less
    // at the other employer.
    const half = payroll.computePayslip(employee({ allowance_factor: 0.5 }), RATES);
    const full = payroll.computePayslip(employee(), RATES);
    expect(half.allowance_used).toBe(30_000);
    expect(half.withholding).toBe(full.withholding + 30_000);
  });

  it('allows a transferred allowance above 100%', () => {
    // A spouse may transfer part of theirs, so above the standard allowance is legal.
    // Migration 072 capped this at 1; 076 raised the cap for exactly this case.
    const s = payroll.computePayslip(employee({ allowance_factor: 1.5 }), RATES);
    expect(s.allowance_used).toBe(90_000);
    expect(s.withholding).toBe(180_400 - 90_000);
  });

  it('caps the employer’s viðbótarsparnaður match at the employee’s own rate', () => {
    // An employer does not match more than is contributed. Paying a larger match would
    // overstate both the company's cost and its liability to the fund.
    const s = payroll.computePayslip(employee({
      extra_pension_employee: 0.04, extra_pension_employer: 0.06,
    }), RATES);
    expect(s.extra_pension_employee).toBe(24_000);   // 4% of 600.000
    expect(s.extra_pension_employer).toBe(24_000);   // capped at the employee's 4%
    // Tax-deferred, so it reduces the taxable base too.
    expect(s.taxable_base).toBe(600_000 - 24_000 - 24_000);
  });

  it('honours a collective-agreement pension rate over the statutory minimum', () => {
    const s = payroll.computePayslip(employee({ pension_employee_rate: 0.08 }), RATES);
    expect(s.pension_employee).toBe(48_000);
    expect(s.taxable_base).toBe(552_000);
    expect(s.breakdown.rates.pension_employee_bp).toBe(800);
  });

  it('treats a NULL pension rate as "use the year’s figure", not as zero', () => {
    // The distinction the nullable column exists for. Reading NULL as 0 would deduct no
    // pension and tax the full gross.
    const s = payroll.computePayslip(employee({ pension_employee_rate: null }), RATES);
    expect(s.pension_employee).toBe(24_000);
    const zero = payroll.computePayslip(employee({ pension_employee_rate: 0 }), RATES);
    expect(zero.pension_employee).toBe(0);
  });

  it('deducts union dues from the net but not from the taxable base', () => {
    // Union dues are not tax-deductible at source, so the taxable figure must not move.
    const withUnion = payroll.computePayslip(employee({ union_rate: 0.01 }), RATES);
    const without = payroll.computePayslip(employee(), RATES);
    expect(withUnion.union_dues).toBe(6_000);
    expect(withUnion.taxable_base).toBe(without.taxable_base);
    expect(withUnion.net_pay).toBe(without.net_pay - 6_000);
  });

  it('keeps tryggingagjald off the employee entirely', () => {
    // The commonest conceptual error in a home-made payroll: treating the employer's
    // contribution as a deduction. It is a cost of the company, not of the employee.
    const s = payroll.computePayslip(employee(), RATES);
    expect(s.net_pay + s.withholding + s.pension_employee).toBe(s.gross);
  });

  it('satisfies the identity the database enforces', () => {
    // payslip_net_adds_up, from migration 076. Asserted here too, so a change to the
    // computation fails in a test rather than as a constraint violation in production.
    for (const over of [
      {}, { monthly_salary: 0 }, { monthly_salary: 100_000 }, { monthly_salary: 2_000_000 },
      { union_rate: 0.01, extra_pension_employee: 0.04 }, { allowance_factor: 0 },
      { monthly_salary: 499_999 }, { monthly_salary: 500_001 },
    ]) {
      const s = payroll.computePayslip(employee(over), RATES);
      expect(s.net_pay).toBe(
        s.gross - s.withholding - s.pension_employee - s.extra_pension_employee - s.union_dues
      );
      expect(s.withholding).toBeLessThanOrEqual(s.computed_tax);
      expect(s.net_pay).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles a zero salary without dividing by anything', () => {
    const s = payroll.computePayslip(employee({ monthly_salary: 0 }), RATES);
    expect(s).toMatchObject({
      gross: 0, taxable_base: 0, withholding: 0, net_pay: 0, social_security: 0,
    });
  });

  it('refuses a payslip whose deductions exceed the pay', () => {
    // Reachable with an extreme union rate against a tiny salary. Refused rather than
    // clamped: a payslip that cannot be paid is not a payslip to be tidied up silently.
    expect(() => payroll.computePayslip(
      employee({ monthly_salary: 10_000, union_rate: 0.2, allowance_factor: 0 }),
      { ...RATES, bands: [{ income_from: 0, rate_bp: 9_000 }] }
    )).toThrow(/exceed gross pay/);
  });

  it('records the working, so the payslip can be explained', () => {
    const s = payroll.computePayslip(employee(), RATES);
    expect(s.breakdown.tax_year).toBe(2099);
    expect(s.breakdown.bands).toHaveLength(2);
    expect(s.breakdown.bands.reduce((a, b) => a + b.tax, 0)).toBe(s.computed_tax);
    expect(s.breakdown.rates).toMatchObject({
      social_security_bp: 635, personal_allowance: 60_000,
    });
  });
});

describe('kennitala validation', () => {
  it('accepts a checksum-valid number and rejects a mistyped one', () => {
    expect(payroll.isValidKennitala('1203894599')).toBe(true);
    // Formatting is presentation, so the dash is accepted.
    expect(payroll.isValidKennitala('120389-4599')).toBe(true);
    // Two digits transposed: same shape, wrong check digit — the commonest way a
    // kennitala is mistyped, and the case a plain length test waves through.
    expect(payroll.isValidKennitala('1203994599')).toBe(false);
    expect(payroll.isValidKennitala('1103894599')).toBe(false);
    expect(payroll.isValidKennitala('1234567890')).toBe(false);
    expect(payroll.isValidKennitala('120389459')).toBe(false);
    expect(payroll.isValidKennitala('')).toBe(false);
  });
});

describe('journal legs', () => {
  const run = {
    period: '2099-01',
    gross_total: 600_000,
    withholding_total: 120_400,
    pension_employee_total: 24_000,
    pension_employer_total: 69_000,
    union_total: 0,
    social_security_total: 38_100,
    net_total: 455_600,
  };

  it('balances, with the employer’s costs debited and every deduction a liability', () => {
    const lines = payroll.runJournalLines(run);
    const debit = lines.reduce((a, l) => a + (l.debit || 0), 0);
    const credit = lines.reduce((a, l) => a + (l.credit || 0), 0);
    expect(debit).toBe(credit);
    // The company's cost is the gross PLUS both employer contributions — not the net. A
    // payroll that debits only the net understates the cost of a hire by a fifth.
    expect(debit).toBe(600_000 + 38_100 + 69_000);

    const byAccount = Object.fromEntries(lines.map(l => [l.accountCode, l]));
    expect(byAccount['6100'].debit).toBe(600_000);          // Laun
    expect(byAccount['6110'].debit).toBe(38_100);           // Tryggingagjald
    expect(byAccount['6120'].debit).toBe(69_000);           // Employer pension
    expect(byAccount['2300'].credit).toBe(120_400);         // Withholding payable
    expect(byAccount['2320'].credit).toBe(24_000 + 69_000); // Both pension sides
    expect(byAccount['2350'].credit).toBe(455_600);         // Net owed to the employee
  });

  it('credits wages PAYABLE, not the bank', () => {
    // The salary is a liability from the moment it is earned and cash from the moment it
    // is paid, usually on different days. Crediting the bank here would make an unpaid
    // salary invisible and overstate what has left the account.
    const codes = payroll.runJournalLines(run).map(l => l.accountCode);
    expect(codes).toContain('2350');
    expect(codes).not.toContain('1900');
  });

  it('omits legs that would be zero', () => {
    // A zero-amount leg violates the one-side CHECK on journal_lines, so an empty run
    // must produce no such legs rather than a row of noughts. (Posting such a run is
    // refused earlier — see the integration test — so this only proves the leg shape.)
    const lines = payroll.runJournalLines({
      ...run,
      gross_total: 0, withholding_total: 0, pension_employee_total: 0,
      pension_employer_total: 0, union_total: 0, social_security_total: 0, net_total: 0,
    });
    expect(lines).toEqual([{ accountCode: '6100', debit: 0, memo: 'Laun' }]);
  });

  it('credits séreignarsparnaður to 2330, apart from the mandatory fund in 2320', () => {
    // The bug this pins: folding séreign into the mandatory total credited it all to
    // 2320 and left 2330 permanently zero, so the séreign custodian's remittance could
    // never be reconciled. Employee séreign 24.000, employer match 12.000.
    const withExtra = {
      ...run,
      extra_pension_employee_total: 24_000,
      extra_pension_employer_total: 12_000,
      // The employee's séreign comes off the net too, so a consistent run reduces net by
      // the employee's 24.000 (455.600 − 24.000). Otherwise the entry cannot balance.
      net_total: 455_600 - 24_000,
    };
    const lines = payroll.runJournalLines(withExtra);
    const byAccount = Object.fromEntries(lines.map(l => [l.accountCode, l]));
    expect(byAccount['2320'].credit).toBe(24_000 + 69_000);   // mandatory only, both sides
    expect(byAccount['2330'].credit).toBe(24_000 + 12_000);   // séreign only, both sides
    // The employer's pension EXPENSE (6120) still carries its whole contribution.
    expect(byAccount['6120'].debit).toBe(69_000 + 12_000);
    // And it still balances.
    const debit = lines.reduce((a, l) => a + (l.debit || 0), 0);
    const credit = lines.reduce((a, l) => a + (l.credit || 0), 0);
    expect(debit).toBe(credit);
  });
});

describe('normaliseBands', () => {
  // The bug this exists for: migration 072 seeded 2026 with UPPER bounds ("upTo"), the
  // service computes with LOWER bounds ("from"), and the first version of the loader
  // defaulted a missing "from" to 0. Every band then started at zero, the slicing
  // collapsed, and almost the whole salary was taxed at the top rate — while the screen
  // showed three plausible-looking rates. Nothing failed; the number was just wrong.
  const SEEDED_2026 = [
    { upTo: 498_122, rate: 0.3149 },
    { upTo: 1_398_450, rate: 0.3799 },
    { upTo: null, rate: 0.4629 },
  ];

  it('converts upper bounds to lower bounds', () => {
    expect(payroll.normaliseBands(SEEDED_2026, 2026)).toEqual([
      { income_from: 0, rate_bp: 3149 },
      { income_from: 498_122, rate_bp: 3799 },
      { income_from: 1_398_450, rate_bp: 4629 },
    ]);
  });

  it('accepts lower bounds unchanged', () => {
    expect(payroll.normaliseBands([
      { from: 0, rate: 0.30 }, { from: 500_000, rate: 0.40 },
    ], 2099)).toEqual([
      { income_from: 0, rate_bp: 3000 },
      { income_from: 500_000, rate_bp: 4000 },
    ]);
  });

  it('sorts an out-of-order upper-bound table before converting', () => {
    const shuffled = [SEEDED_2026[2], SEEDED_2026[0], SEEDED_2026[1]];
    expect(payroll.normaliseBands(shuffled, 2026).map(b => b.income_from))
      .toEqual([0, 498_122, 1_398_450]);
  });

  it('refuses a band that says neither where it starts nor where it stops', () => {
    // Defaulting to zero here is what hid the bug. A shapeless band is a data problem,
    // and the only safe response is to say so.
    expect(() => payroll.normaliseBands([{ rate: 0.3149 }], 2026))
      .toThrow(/say nothing about where/);
  });

  it('refuses a table that mixes the two forms', () => {
    expect(() => payroll.normaliseBands(
      [{ from: 0, rate: 0.30 }, { upTo: 500_000, rate: 0.40 }], 2026
    )).toThrow(/mix lower-bound/);
  });

  it('refuses more than one open-ended band', () => {
    // Two bands with no ceiling cannot both be the top one, and whichever lost would
    // silently take a lower bound of the other's.
    expect(() => payroll.normaliseBands(
      [{ upTo: null, rate: 0.30 }, { upTo: null, rate: 0.46 }], 2026
    )).toThrow(/open-ended/);
  });

  it('refuses a HALF-shapeless upper-bound table (a band that forgot its upTo)', () => {
    // The failure one shape over from the one above: an upper-bound table where one band
    // has no upTo KEY at all was coerced to null and silently promoted to the open-ended
    // top rate. An explicit upTo: null is a deliberate top band; an absent key is a
    // mistake, and the two must not be conflated.
    expect(() => payroll.normaliseBands(
      [{ upTo: 500_000, rate: 0.3149 }, { rate: 0.4629 }], 2026
    )).toThrow(/no "upTo"/);
    // The explicit-null top band is still accepted.
    expect(payroll.normaliseBands(
      [{ upTo: 500_000, rate: 0.3149 }, { upTo: null, rate: 0.4629 }], 2026
    )).toEqual([
      { income_from: 0, rate_bp: 3149 },
      { income_from: 500_000, rate_bp: 4629 },
    ]);
  });

  it('taxes a salary in the second band across two slices, not one', () => {
    // The end-to-end check on the real seeded figures. Under the collapsed-bands bug
    // this came out as 800.000 × 46.29% = 370.320 instead of 271.542 — a payslip wrong
    // by nearly 100.000 kr. a month.
    const bands = payroll.normaliseBands(SEEDED_2026, 2026);
    const { total, slices } = payroll.computeTax(800_000, bands);
    expect(slices).toHaveLength(2);
    expect(total).toBe(271_542);
    expect(total).toBeLessThan(payroll.applyBp(800_000, 4629));
  });
});
