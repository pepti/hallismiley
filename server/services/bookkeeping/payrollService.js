// Payroll: computing a payslip, and refusing to when it cannot be done correctly.
//
// This module is written to be UNHELPFUL in one specific way. It will not compute a
// payslip for a tax year whose figures nobody has confirmed. It has no fallback rates,
// no "last known good" year, and no defaults to lean on. That is the design, and it is
// worth being explicit about why.
//
// Icelandic withholding, in order:
//
//   1. Take the gross.
//   2. Subtract the employee's pension contribution. Pension is deducted BEFORE tax,
//      so the taxable base is NOT the gross. Getting this backwards over-withholds
//      every month, and nobody notices until the annual assessment.
//   3. Apply the bands to what is left. The bands are cumulative monthly thresholds,
//      so income is SLICED, not classified: an employee is not "in the second band",
//      the portion of their income above the first threshold is.
//   4. Subtract the personal credit (persónuafsláttur) from the COMPUTED TAX, not from
//      the income. It cannot take the tax below zero.
//   5. Deduct union dues and any viðbótarsparnaður from the net.
//   6. Separately, the employer owes tryggingagjald on the gross and a pension
//      contribution beside the employee's. Neither is deducted from the employee; both
//      are the company's expense and the company's liability.
//
// Every rate in there is set annually and published by Skatturinn, and none of it is
// derivable from anything else. A payroll engine that guesses produces a number that
// looks right, under-remits withholding tax, and leaves the EMPLOYER liable for the
// shortfall years later with interest. So: rates are data (payroll_rates, from
// migration 072), a year must be confirmed by a person, and until then this module says
// no and explains what is missing.
//
// ON THE BAND RATES — read this before entering any figures.
//
// `bands[].rate` is the COMBINED rate for the slice: tekjuskattur PLUS útsvar, exactly
// as Skatturinn publishes it (e.g. 31.49%, not 22.5% + 14.something). `municipal_rate`
// on payroll_rates is recorded for reference and is NOT added again — adding it would
// double-count útsvar and over-withhold by roughly a third. upsertRates() refuses a
// band whose rate is at or below the municipal rate, because that is the fingerprint of
// tekjuskattur-only figures having been entered by mistake.
//
// The journal side, for one employee (gross 100, withholding 30, pension 4/11.5,
// tryggingagjald 6.35 — illustrative figures, not real rates):
//
//   6100 Laun                        debit  100      the cost of the work
//   6110 Tryggingagjald              debit  6.35     employer's contribution
//   6120 Lífeyrisframlag             debit  11.5     employer's pension
//     2300 Staðgreiðsla launa       credit  30       owed to Skatturinn
//     2310 Tryggingagjald           credit  6.35     owed to Skatturinn
//     2320 Lífeyrissjóður           credit  15.5     owed to the fund (both sides)
//     2350 Ógreidd laun             credit  66       owed to the employee
//
// Wages PAYABLE is credited, not the bank: paying the employee is a separate event with
// its own date, and booking them together makes an unpaid salary invisible.

const db = require('../../config/database');
const ledger = require('./ledgerService');
const Setting = require('../../models/Setting');
const { assertAccountingDate, toIsoDate } = require('../../utils/booksDate');
const { assertIntegerIsk } = require('../../utils/vat');

class PayrollError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.name = 'PayrollError';
    this.status = status;
    this.code = code;
  }
}

// The accounts payroll touches, from the chart of accounts in migration 072. Named
// rather than inlined so the mapping is readable as a list and a chart change is one
// edit.
const ACCOUNTS = {
  WAGES: '6100',              // expense: gross pay
  SOCIAL_SECURITY: '6110',    // expense: tryggingagjald
  PENSION_EMPLOYER: '6120',   // expense: employer's pension contribution
  WITHHOLDING_PAYABLE: '2300',
  SOCIAL_SECURITY_PAYABLE: '2310',
  PENSION_PAYABLE: '2320',
  EXTRA_PENSION_PAYABLE: '2330',
  UNION_PAYABLE: '2340',
  WAGES_PAYABLE: '2350',
  BANK: '1900',
};

const EMPLOYMENT_TYPES = ['employee', 'owner', 'contractor'];

// ── Rates as integers ────────────────────────────────────────────────────────

// Rates are stored as NUMERIC and arrive from pg as strings ("0.0635"). They are
// converted to BASIS POINTS — integer hundredths of a percent — once, here, and every
// calculation downstream is integer arithmetic. Floats never enter payroll: 0.0635 *
// 613000 is 38925.499999999996, and a payroll out by one króna per employee per month
// is a payroll that does not reconcile against what the bank actually paid.
// `max` defaults to 1 because a RATE above 100% is always a units mistake — 6.35 where
// 0.0635 was meant, which would withhold 635% of the gross. The personal-allowance
// FACTOR is a different kind of number and passes max: 2, since persónuafsláttur can be
// partly transferred from a spouse and 1.5 is a legitimate share.
function toBp(rate, label = 'rate', { max = 1 } = {}) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n < 0) {
    throw new PayrollError(`${label} is not a usable rate: ${rate}`, 500);
  }
  if (n > max) {
    throw new PayrollError(
      `${label} is ${n}, which reads as ${n * 100}%. Rates are decimals: 6.35% is 0.0635.`,
      400, 'RATE_UNITS'
    );
  }
  return Math.round(n * 10_000);
}

function applyBp(amount, bp) {
  const a = assertIntegerIsk(amount, 'amount');
  if (!Number.isInteger(bp) || bp < 0) {
    throw new PayrollError(`A rate must be a whole number of basis points, got ${bp}`, 500);
  }
  return Math.round((a * bp) / 10_000);
}

// ── Tax years ────────────────────────────────────────────────────────────────

/**
 * Load a year's rates with its bands, or explain precisely why it cannot be used.
 *
 * The refusals are separate on purpose. "No figures for 2027" and "2027's figures have
 * not been confirmed" are different problems with different fixes, and collapsing them
 * into one message sends the operator looking in the wrong place.
 */
async function loadRates(year, client = db, { requireConfirmed = true } = {}) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2020 || y > 2100) {
    throw new PayrollError(`${year} is not a usable tax year`, 400, 'BAD_YEAR');
  }
  const { rows } = await client.query(
    `SELECT r.*, u.username AS confirmed_by_username
       FROM payroll_rates r
       LEFT JOIN users u ON u.id = r.confirmed_by
      WHERE r.tax_year = $1`,
    [y]
  );
  if (!rows.length) {
    throw new PayrollError(
      `No payroll figures have been entered for ${y}. Enter them from Skatturinn's published table for the year before running payroll.`,
      409, 'YEAR_MISSING'
    );
  }
  const row = rows[0];

  const raw = Array.isArray(row.bands) ? row.bands : [];
  if (!raw.length) {
    throw new PayrollError(
      `${y} has no withholding bands. Payroll cannot compute tax without them.`,
      409, 'BANDS_MISSING'
    );
  }
  const bands = raw
    .map((b, i) => ({
      income_from: assertIntegerIsk(b.from ?? b.income_from ?? 0, `bands[${i}].from`),
      rate_bp: toBp(b.rate, `bands[${i}].rate`),
    }))
    .sort((a, b) => a.income_from - b.income_from);

  // The lowest band must start at zero, or the first slice of income is taxed at no
  // rate at all — silently under-withholding every payslip.
  if (bands[0].income_from !== 0) {
    throw new PayrollError(
      `${y}'s lowest withholding band starts at ${bands[0].income_from} ISK, not 0. Income below that would be untaxed.`,
      409, 'BANDS_INCOMPLETE'
    );
  }
  if (requireConfirmed && !row.confirmed_at) {
    throw new PayrollError(
      `${y}'s payroll figures have not been confirmed against Skatturinn's published rates. Confirm them before running payroll — a run computed from unverified rates under-remits withholding tax, and the shortfall is the employer's liability.`,
      409, 'YEAR_UNCONFIRMED'
    );
  }

  return {
    year: y,
    personal_allowance: Number(row.personal_allowance),
    municipal_rate_bp: toBp(row.municipal_rate, 'municipal_rate'),
    social_security_bp: toBp(row.social_security, 'social_security'),
    pension_employee_bp: toBp(row.pension_employee, 'pension_employee'),
    pension_employer_bp: toBp(row.pension_employer, 'pension_employer'),
    confirmed_at: row.confirmed_at,
    confirmed_by_username: row.confirmed_by_username,
    source_note: row.source_note,
    bands,
  };
}

/**
 * Enter or replace a year's figures. Always lands unconfirmed.
 *
 * Unconfirmed even when replacing a previously confirmed year: editing the figures
 * means they need checking again. A trigger refuses the edit outright once the year has
 * been used by a posted run.
 */
async function upsertRates(client, input) {
  const {
    year, personalAllowance, municipalRate, socialSecurity,
    pensionEmployee, pensionEmployer, bands = [], referenceWages = [],
    sourceNote = '', createdBy,
  } = input || {};
  if (!createdBy) throw new PayrollError('upsertRates requires createdBy', 500);

  const y = Number(year);
  if (!Number.isInteger(y) || y < 2020 || y > 2100) {
    throw new PayrollError(`${year} is not a usable tax year`, 400, 'BAD_YEAR');
  }
  if (!Array.isArray(bands) || !bands.length) {
    throw new PayrollError('At least one withholding band is required', 400, 'BANDS_REQUIRED');
  }

  const municipalBp = toBp(municipalRate, 'municipal_rate');

  // Validated here rather than left to the database, because "your bands overlap" is a
  // fixable message and a constraint violation is not.
  const sorted = bands
    .map((b, i) => ({
      from: assertIntegerIsk(b.from ?? b.income_from ?? 0, `bands[${i}].from`),
      rate: Number(b.rate),
      rate_bp: toBp(b.rate, `bands[${i}].rate`),
    }))
    .sort((a, b) => a.from - b.from);

  if (sorted[0].from !== 0) {
    throw new PayrollError('The lowest withholding band must start at 0 ISK', 400, 'BANDS_INCOMPLETE');
  }
  for (const [i, b] of sorted.entries()) {
    if (i > 0 && b.from === sorted[i - 1].from) {
      throw new PayrollError(`Two withholding bands both start at ${b.from} ISK`, 400, 'BANDS_OVERLAP');
    }
    // A higher slice taxed at a LOWER rate is legal arithmetic but has never been
    // Icelandic tax policy, so it is almost certainly a transcription error — and a
    // silent one, since the total still looks like a tax figure.
    if (i > 0 && b.rate_bp < sorted[i - 1].rate_bp) {
      throw new PayrollError(
        `bands[${i}] taxes income above ${b.from} ISK at a LOWER rate than the band below it. Check the figures against the published table.`,
        400, 'BANDS_DESCENDING'
      );
    }
    // The fingerprint of tekjuskattur-only rates having been entered: the published
    // band rate is tekjuskattur PLUS útsvar, so it is always well above útsvar alone.
    // Accepting these would under-withhold by roughly the municipal rate.
    if (b.rate_bp <= municipalBp) {
      throw new PayrollError(
        `bands[${i}] is ${b.rate_bp / 100}%, at or below the municipal rate of ${municipalBp / 100}%. Band rates are the COMBINED figure (tekjuskattur + útsvar) as published — check you have not entered tekjuskattur alone.`,
        400, 'BANDS_LOOK_PARTIAL'
      );
    }
  }

  await client.query(
    `INSERT INTO payroll_rates
       (tax_year, bands, personal_allowance, municipal_rate, social_security,
        pension_employee, pension_employer, source_note, confirmed_at, confirmed_by)
     VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,NULL,NULL)
     ON CONFLICT (tax_year) DO UPDATE SET
       bands              = EXCLUDED.bands,
       personal_allowance = EXCLUDED.personal_allowance,
       municipal_rate     = EXCLUDED.municipal_rate,
       social_security    = EXCLUDED.social_security,
       pension_employee   = EXCLUDED.pension_employee,
       pension_employer   = EXCLUDED.pension_employer,
       source_note        = EXCLUDED.source_note,
       -- Editing the figures un-confirms the year: they need checking again.
       confirmed_at       = NULL,
       confirmed_by       = NULL,
       updated_at         = NOW()`,
    [y, JSON.stringify(sorted.map(b => ({ from: b.from, rate: b.rate }))),
      assertIntegerIsk(personalAllowance, 'personal_allowance'),
      Number(municipalRate), Number(socialSecurity),
      Number(pensionEmployee), Number(pensionEmployer), String(sourceNote || '')]
  );

  if (Array.isArray(referenceWages) && referenceWages.length) {
    await client.query(`DELETE FROM payroll_reference_wages WHERE tax_year = $1`, [y]);
    for (const w of referenceWages) {
      await client.query(
        `INSERT INTO payroll_reference_wages (tax_year, category, description, monthly_min)
         VALUES ($1,$2,$3,$4)`,
        [y, String(w.category), String(w.description || ''),
          assertIntegerIsk(w.monthly_min ?? w.monthlyMin, 'monthly_min')]
      );
    }
  }

  return loadRates(y, client, { requireConfirmed: false });
}

/**
 * Confirm a year's figures.
 *
 * A person says "I have checked these against the published table". The note is
 * required because that claim is only worth something if it says what was checked
 * against what, and when.
 */
async function confirmRates(client, year, { confirmedBy, sourceNote }) {
  if (!confirmedBy) throw new PayrollError('confirmRates requires confirmedBy', 500);
  if (!sourceNote || !String(sourceNote).trim()) {
    throw new PayrollError(
      'Confirming a tax year requires a note saying where the figures came from',
      400, 'SOURCE_REQUIRED'
    );
  }
  // Loaded first so the structural problems (no bands, a band not starting at zero) are
  // refused before the year is marked as checked.
  await loadRates(year, client, { requireConfirmed: false });

  const { rows } = await client.query(
    `UPDATE payroll_rates
        SET confirmed_at = NOW(), confirmed_by = $2, source_note = $3, updated_at = NOW()
      WHERE tax_year = $1
      RETURNING tax_year, confirmed_at`,
    [Number(year), confirmedBy, String(sourceNote).trim()]
  );
  return rows[0];
}

async function listRateYears(client = db) {
  const { rows } = await client.query(
    `SELECT r.tax_year, r.personal_allowance, r.municipal_rate, r.social_security,
            r.pension_employee, r.pension_employer, r.source_note, r.confirmed_at,
            u.username AS confirmed_by_username,
            jsonb_array_length(COALESCE(r.bands, '[]'::jsonb)) AS band_count,
            (SELECT COUNT(*)::int FROM payroll_runs
              WHERE tax_year = r.tax_year AND status <> 'draft') AS used_by_runs
       FROM payroll_rates r
       LEFT JOIN users u ON u.id = r.confirmed_by
      ORDER BY r.tax_year DESC`
  );
  return rows.map(r => ({ ...r, personal_allowance: Number(r.personal_allowance) }));
}

async function getRateYear(year, client = db) {
  const rates = await loadRates(year, client, { requireConfirmed: false });
  const { rows } = await client.query(
    `SELECT category, description, monthly_min FROM payroll_reference_wages
      WHERE tax_year = $1 ORDER BY category`,
    [Number(year)]
  );
  return {
    ...rates,
    reference_wages: rows.map(w => ({ ...w, monthly_min: Number(w.monthly_min) })),
  };
}

// ── The computation ──────────────────────────────────────────────────────────

/**
 * Withholding tax on a monthly taxable amount.
 *
 * The bands are SLICED, not selected: each band's rate applies only to the portion of
 * income between its threshold and the next. Applying the top band's rate to the whole
 * amount — the intuitive misreading of a bracket table — over-withholds badly.
 *
 * Returns the per-band working as well as the total, because a payslip that cannot show
 * its own derivation cannot be disputed.
 */
function computeTax(taxable, bands) {
  const amount = assertIntegerIsk(taxable, 'taxable');
  const slices = [];
  let total = 0;

  for (const [i, band] of bands.entries()) {
    const from = band.income_from;
    if (amount <= from) break;
    const next = bands[i + 1];
    const upper = next ? Math.min(amount, next.income_from) : amount;
    const slice = upper - from;
    if (slice <= 0) continue;
    const tax = applyBp(slice, band.rate_bp);
    slices.push({
      from, to: next ? next.income_from : null, amount: slice, rate_bp: band.rate_bp, tax,
    });
    total += tax;
  }

  return { total, slices };
}

/**
 * One payslip, computed but not stored.
 *
 * Pure apart from the rates handed in, so it can be checked against a worked example
 * and shown as a preview before anything is written.
 */
function computePayslip(employee, rates, { gross = null } = {}) {
  const grossPay = assertIntegerIsk(
    gross === null || gross === undefined ? employee.monthly_salary : gross, 'gross'
  );

  // Per-employee rates override the statutory minimum. A collective agreement can be
  // more generous than the law but not less; a lower override is flagged by the
  // preflight rather than silently corrected here.
  const pensionEmployeeBp = employee.pension_employee_rate === null
    || employee.pension_employee_rate === undefined
    ? rates.pension_employee_bp
    : toBp(employee.pension_employee_rate, 'pension_employee_rate');
  const pensionEmployerBp = employee.pension_employer_rate === null
    || employee.pension_employer_rate === undefined
    ? rates.pension_employer_bp
    : toBp(employee.pension_employer_rate, 'pension_employer_rate');

  const pensionEmployee = applyBp(grossPay, pensionEmployeeBp);
  const pensionEmployer = applyBp(grossPay, pensionEmployerBp);

  // Viðbótarsparnaður: the employee's own contribution and the employer's match. Both
  // rates are per-employee here (072's shape); the employer's match is capped at the
  // employee's own, because an employer does not match more than is contributed.
  const extraEmployeeBp = toBp(employee.extra_pension_employee || 0, 'extra_pension_employee');
  const extraEmployerBp = Math.min(
    toBp(employee.extra_pension_employer || 0, 'extra_pension_employer'), extraEmployeeBp
  );
  const extraPensionEmployee = applyBp(grossPay, extraEmployeeBp);
  const extraPensionEmployer = applyBp(grossPay, extraEmployerBp);

  // Pension comes off before tax, and viðbótarsparnaður is tax-deferred too.
  const taxable = Math.max(0, grossPay - pensionEmployee - extraPensionEmployee);
  const { total: computedTax, slices } = computeTax(taxable, rates.bands);

  // The credit reduces the TAX and cannot take it below zero. An unused remainder is
  // not carried between months here — that is an annual-assessment matter, and
  // inventing a carry-forward would produce a payslip Skatturinn does not agree with.
  // max: 2 — a transferred spousal share puts this legitimately above 1.
  const allowanceBp = toBp(employee.allowance_factor ?? 1, 'allowance_factor', { max: 2 });
  const allowanceEntitlement = applyBp(rates.personal_allowance, allowanceBp);
  const allowanceUsed = Math.min(allowanceEntitlement, computedTax);
  const withholding = computedTax - allowanceUsed;

  const unionDues = applyBp(grossPay, toBp(employee.union_rate || 0, 'union_rate'));
  const socialSecurity = applyBp(grossPay, rates.social_security_bp);

  const net = grossPay - withholding - pensionEmployee - extraPensionEmployee - unionDues;
  if (net < 0) {
    // Reachable with a high union rate and a low salary. Refused rather than clamped: a
    // payslip whose deductions exceed the pay is not a payslip to be tidied up.
    throw new PayrollError(
      `Deductions (${grossPay - net} ISK) exceed gross pay (${grossPay} ISK) for ${employee.full_name}. Check the rates on this employee.`,
      400, 'NET_NEGATIVE'
    );
  }

  return {
    gross: grossPay,
    taxable_base: taxable,
    computed_tax: computedTax,
    allowance_entitlement: allowanceEntitlement,
    allowance_used: allowanceUsed,
    allowance_unused: allowanceEntitlement - allowanceUsed,
    withholding,
    pension_employee: pensionEmployee,
    pension_employer: pensionEmployer,
    extra_pension_employee: extraPensionEmployee,
    extra_pension_employer: extraPensionEmployer,
    union_dues: unionDues,
    social_security: socialSecurity,
    net_pay: net,
    // Everything needed to reproduce the figures above, stored with the payslip.
    breakdown: {
      tax_year: rates.year,
      bands: slices,
      rates: {
        pension_employee_bp: pensionEmployeeBp,
        pension_employer_bp: pensionEmployerBp,
        extra_pension_employee_bp: extraEmployeeBp,
        extra_pension_employer_bp: extraEmployerBp,
        union_rate_bp: toBp(employee.union_rate || 0, 'union_rate'),
        social_security_bp: rates.social_security_bp,
        allowance_factor_bp: allowanceBp,
        personal_allowance: rates.personal_allowance,
      },
    },
  };
}

// ── Employees ────────────────────────────────────────────────────────────────

function normaliseEmployee(row) {
  return {
    ...row,
    monthly_salary: Number(row.monthly_salary),
    reference_wage_amount: row.reference_wage_amount === null
      ? null : Number(row.reference_wage_amount),
    started_on: row.started_on ? toIsoDate(row.started_on) : null,
    ended_on: row.ended_on ? toIsoDate(row.ended_on) : null,
  };
}

async function listEmployees({ includeInactive = false } = {}, client = db) {
  const { rows } = await client.query(
    `SELECT e.*, u.username AS created_by_username,
            (SELECT COUNT(*)::int FROM payslips p
              JOIN payroll_runs r ON r.id = p.run_id
             WHERE p.employee_id = e.id AND r.status <> 'draft') AS payslip_count
       FROM employees e
       LEFT JOIN users u ON u.id = e.created_by
      ${includeInactive ? '' : 'WHERE e.is_active'}
      ORDER BY e.is_active DESC, e.full_name`
  );
  return rows.map(normaliseEmployee);
}

async function getEmployee(id, client = db) {
  const { rows } = await client.query(`SELECT * FROM employees WHERE id = $1`, [String(id)]);
  if (!rows.length) throw new PayrollError('Employee not found', 404, 'NOT_FOUND');
  return normaliseEmployee(rows[0]);
}

// Reuses the seller-settings validator rather than carrying a second modulus-11
// implementation: two copies of a check-digit rule is one copy too many, and this is
// already the rule an invoice is held to.
function isValidKennitala(kt) {
  const digits = String(kt || '').replace(/\D/g, '');
  if (!/^\d{10}$/.test(digits)) return false;
  return Setting.isValidKennitala(digits);
}

async function upsertEmployee(client, input) {
  const {
    id = null, fullName, kennitala, email = '', bankAccount = '',
    employmentType = 'employee', referenceWageCategory = null,
    referenceWageAmount = null, referenceWageConfirmedAt = null,
    referenceWageConfirmedNote = null, monthlySalary = 0, allowanceFactor = 1,
    pensionFund = '', pensionEmployeeRate = null, pensionEmployerRate = null,
    extraPensionEmployee = 0, extraPensionEmployer = 0, unionName = '', unionRate = 0,
    startedOn = null, endedOn = null, isActive = true, note = '', createdBy,
  } = input || {};
  if (!createdBy) throw new PayrollError('upsertEmployee requires createdBy', 500);
  if (!fullName || !String(fullName).trim()) {
    throw new PayrollError('An employee needs a name', 400, 'NAME_REQUIRED');
  }
  if (!EMPLOYMENT_TYPES.includes(employmentType)) {
    throw new PayrollError(`Unknown employment type: ${employmentType}`, 400, 'BAD_TYPE');
  }
  // The kennitala goes on the payslip and into every remittance, so a wrong one is not
  // a cosmetic problem.
  const kt = String(kennitala || '').replace(/\D/g, '');
  if (!isValidKennitala(kt)) {
    throw new PayrollError(
      'That kennitala is not valid (it fails the check-digit test)', 400, 'BAD_KENNITALA'
    );
  }
  if (employmentType === 'owner' && !referenceWageCategory) {
    throw new PayrollError(
      'An owner needs an RSK reiknað endurgjald category, so the minimum salary can be checked',
      400, 'CATEGORY_REQUIRED'
    );
  }

  const params = [
    String(fullName).trim(), kt, String(email || ''), String(bankAccount || ''),
    employmentType, referenceWageCategory || null,
    referenceWageAmount === null || referenceWageAmount === ''
      ? null : assertIntegerIsk(referenceWageAmount, 'reference_wage_amount'),
    referenceWageConfirmedAt
      ? assertAccountingDate(referenceWageConfirmedAt, 'reference_wage_confirmed_at') : null,
    referenceWageConfirmedNote || null,
    assertIntegerIsk(monthlySalary || 0, 'monthly_salary'), Number(allowanceFactor),
    String(pensionFund || ''),
    pensionEmployeeRate === null || pensionEmployeeRate === '' ? null : Number(pensionEmployeeRate),
    pensionEmployerRate === null || pensionEmployerRate === '' ? null : Number(pensionEmployerRate),
    Number(extraPensionEmployee || 0), Number(extraPensionEmployer || 0),
    String(unionName || ''), Number(unionRate || 0),
    startedOn ? assertAccountingDate(startedOn, 'started_on', { allowFuture: true }) : null,
    endedOn ? assertAccountingDate(endedOn, 'ended_on', { allowFuture: true }) : null,
    Boolean(isActive), String(note || ''),
  ];

  if (id) {
    const { rows } = await client.query(
      `UPDATE employees SET
         full_name=$2, kennitala=$3, email=$4, bank_account=$5, employment_type=$6,
         reference_wage_category=$7, reference_wage_amount=$8,
         reference_wage_confirmed_at=$9, reference_wage_confirmed_note=$10,
         monthly_salary=$11, allowance_factor=$12, pension_fund=$13,
         pension_employee_rate=$14, pension_employer_rate=$15,
         extra_pension_employee=$16, extra_pension_employer=$17,
         union_name=$18, union_rate=$19, started_on=$20, ended_on=$21,
         is_active=$22, note=$23
       WHERE id=$1 RETURNING *`,
      [String(id), ...params]
    );
    if (!rows.length) throw new PayrollError('Employee not found', 404, 'NOT_FOUND');
    return normaliseEmployee(rows[0]);
  }

  const { rows } = await client.query(
    `INSERT INTO employees
       (full_name, kennitala, email, bank_account, employment_type,
        reference_wage_category, reference_wage_amount, reference_wage_confirmed_at,
        reference_wage_confirmed_note, monthly_salary, allowance_factor, pension_fund,
        pension_employee_rate, pension_employer_rate, extra_pension_employee,
        extra_pension_employer, union_name, union_rate, started_on, ended_on,
        is_active, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING *`,
    [...params, createdBy]
  );
  return normaliseEmployee(rows[0]);
}

// ── Runs ─────────────────────────────────────────────────────────────────────

function periodOf(period) {
  const p = String(period || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) {
    throw new PayrollError(`A payroll period looks like 2026-08, got "${period}"`, 400, 'BAD_PERIOD');
  }
  return p;
}

function normaliseRun(row) {
  return {
    ...row,
    pay_date: toIsoDate(row.pay_date),
    tax_year: Number(row.tax_year),
    gross_total: Number(row.gross_total),
    withholding_total: Number(row.withholding_total),
    pension_employee_total: Number(row.pension_employee_total),
    pension_employer_total: Number(row.pension_employer_total),
    social_security_total: Number(row.social_security_total),
    union_total: Number(row.union_total),
    net_total: Number(row.net_total),
  };
}

/**
 * Everything worth looking at before a run is posted.
 *
 * Blockers make the run knowably wrong; warnings are things to look at. The reiknað
 * endurgjald check is the one an owner most needs: paying yourself below the RSK
 * minimum is assessed years later, and nothing about the payslip looks wrong now.
 */
async function preflight(client, { period, staff, rates, payDate }) {
  const findings = [];
  const add = (level, code, message, extra = {}) =>
    findings.push({ level, code, message, ...extra });

  if (!staff.length) {
    add('blocker', 'NO_EMPLOYEES', 'There is nobody to pay in this run.');
  }

  const { rows: existing } = await client.query(
    `SELECT id FROM payroll_runs WHERE period = $1 AND status IN ('posted','settled')`,
    [period]
  );
  if (existing.length) {
    add('blocker', 'ALREADY_POSTED',
      `${period} has already been posted. Reverse that run before posting another, or every remittance for the month doubles.`);
  }

  const { rows: minimums } = await client.query(
    `SELECT category, monthly_min FROM payroll_reference_wages WHERE tax_year = $1`,
    [rates.year]
  );
  const minByCategory = new Map(minimums.map(m => [m.category, Number(m.monthly_min)]));

  for (const { employee, payslip } of staff) {
    if (employee.employment_type === 'owner') {
      const published = minByCategory.get(employee.reference_wage_category);
      // Falls back to the amount agreed on the employee record, which is what 072
      // stored. Less authoritative than the published table, but better than no check.
      const minimum = published ?? employee.reference_wage_amount;
      if (minimum === null || minimum === undefined) {
        add('warning', 'NO_REFERENCE_WAGE',
          `No reiknað endurgjald minimum is recorded for category ${employee.reference_wage_category} in ${rates.year}, so ${employee.full_name}'s salary cannot be checked against it.`,
          { employee: employee.full_name, category: employee.reference_wage_category });
      } else if (payslip.gross < minimum) {
        add('blocker', 'BELOW_REFERENCE_WAGE',
          `${employee.full_name} is being paid ${payslip.gross} ISK, below the ${rates.year} reiknað endurgjald minimum of ${minimum} ISK for category ${employee.reference_wage_category}. Paying an owner less than the minimum is assessed later, with interest.`,
          { employee: employee.full_name, gross: payslip.gross, minimum });
      } else if (published === undefined && employee.reference_wage_amount !== null) {
        add('warning', 'REFERENCE_WAGE_NOT_PUBLISHED',
          `${employee.full_name} was checked against the amount recorded on their record, not against ${rates.year}'s published table — RSK republishes the minimums every year.`,
          { employee: employee.full_name });
      }
    }
    if (payslip.gross === 0) {
      add('warning', 'ZERO_GROSS',
        `${employee.full_name} has no salary set, so their payslip is for zero.`,
        { employee: employee.full_name });
    }
    if (!employee.pension_fund) {
      add('warning', 'NO_PENSION_FUND',
        `${employee.full_name} has no pension fund recorded, so the contribution cannot be remitted to anyone.`,
        { employee: employee.full_name });
    }
    if (employee.ended_on && employee.ended_on < payDate) {
      add('warning', 'ENDED',
        `${employee.full_name}'s employment ended on ${employee.ended_on}, before this pay date.`,
        { employee: employee.full_name });
    }
    // A collective agreement can be more generous than the statutory minimum, never
    // less — so a lower per-employee rate is almost always a typo.
    if (employee.pension_employee_rate !== null && employee.pension_employee_rate !== undefined
        && toBp(employee.pension_employee_rate) < rates.pension_employee_bp) {
      add('warning', 'PENSION_BELOW_MINIMUM',
        `${employee.full_name}'s pension rate is below the statutory minimum for ${rates.year}.`,
        { employee: employee.full_name });
    }
  }

  // The period must be open in the ledger, or posting fails at the last step, after the
  // operator has already committed to it.
  const { rows: fiscal } = await client.query(
    `SELECT status FROM fiscal_periods WHERE $1::date BETWEEN starts_on AND ends_on`,
    [payDate]
  );
  if (fiscal.length && fiscal[0].status !== 'open') {
    add('blocker', 'PERIOD_LOCKED',
      `The VSK period containing ${payDate} is ${fiscal[0].status}. Payroll cannot be posted into a closed period.`);
  }

  return {
    findings,
    blockers: findings.filter(f => f.level === 'blocker'),
    ok: !findings.some(f => f.level === 'blocker'),
  };
}

/**
 * Build a draft run: compute every payslip, store them, run the preflight.
 *
 * Nothing reaches the ledger here. A draft exists precisely so the figures can be
 * looked at before they become a liability to Skatturinn.
 */
async function createDraftRun(client, { period, payDate, employeeIds = null, note = '', createdBy }) {
  if (!createdBy) throw new PayrollError('createDraftRun requires createdBy', 500);
  const p = periodOf(period);
  const date = assertAccountingDate(payDate, 'pay_date', { allowFuture: true });

  // The tax year comes from the PAY DATE, not the period: December's salary paid in
  // January is taxed on January's figures, which is the rule that catches people out.
  const rates = await loadRates(Number(date.slice(0, 4)), client);

  const { rows } = await client.query(
    employeeIds
      ? `SELECT * FROM employees WHERE id = ANY($1::text[]) ORDER BY full_name`
      : `SELECT * FROM employees WHERE is_active ORDER BY full_name`,
    employeeIds ? [employeeIds] : []
  );
  if (employeeIds && rows.length !== employeeIds.length) {
    throw new PayrollError('One of the selected employees does not exist', 400, 'BAD_EMPLOYEE');
  }

  const staff = rows.map((row) => {
    const employee = normaliseEmployee(row);
    return { employee, payslip: computePayslip(employee, rates) };
  });

  const check = await preflight(client, { period: p, staff, rates, payDate: date });

  const totals = staff.reduce((a, { payslip: s }) => ({
    gross: a.gross + s.gross,
    withholding: a.withholding + s.withholding,
    pensionEmployee: a.pensionEmployee + s.pension_employee + s.extra_pension_employee,
    pensionEmployer: a.pensionEmployer + s.pension_employer + s.extra_pension_employer,
    union: a.union + s.union_dues,
    socialSecurity: a.socialSecurity + s.social_security,
    net: a.net + s.net_pay,
  }), {
    gross: 0, withholding: 0, pensionEmployee: 0, pensionEmployer: 0,
    union: 0, socialSecurity: 0, net: 0,
  });

  const { rows: runRows } = await client.query(
    `INSERT INTO payroll_runs
       (period, pay_date, tax_year, gross_total, withholding_total,
        pension_employee_total, pension_employer_total, social_security_total,
        union_total, net_total, status, preflight, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11::jsonb,$12,$13)
     RETURNING *`,
    [p, date, rates.year, totals.gross, totals.withholding, totals.pensionEmployee,
      totals.pensionEmployer, totals.socialSecurity, totals.union, totals.net,
      JSON.stringify(check), String(note || ''), createdBy]
  );
  const run = runRows[0];

  for (const { employee, payslip: s } of staff) {
    await client.query(
      `INSERT INTO payslips
         (run_id, employee_id, employee_name, employee_kennitala, gross, pension_employee,
          taxable_base, computed_tax, allowance_used, withholding, union_dues,
          extra_pension_employee, net_pay, pension_employer, extra_pension_employer,
          social_security, breakdown)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
      [run.id, employee.id, employee.full_name, employee.kennitala, s.gross,
        s.pension_employee, s.taxable_base, s.computed_tax, s.allowance_used,
        s.withholding, s.union_dues, s.extra_pension_employee, s.net_pay,
        s.pension_employer, s.extra_pension_employer, s.social_security,
        JSON.stringify(s.breakdown)]
    );
  }

  return { run: normaliseRun(run), preflight: check, payslips: staff };
}

/**
 * The journal legs for a run.
 *
 * Grouped totals rather than per-employee legs. Per-employee legs would put every
 * salary in the general ledger, where anyone holding the ledger view could read what
 * each person earns; the payslips hold the detail and are gated separately. The
 * trade-off is deliberate and worth stating, because detail is otherwise exactly what
 * the ledger is for.
 */
function runJournalLines(run) {
  const lines = [{ accountCode: ACCOUNTS.WAGES, debit: run.gross_total, memo: 'Laun' }];
  const push = (accountCode, side, amount, memo) => {
    if (amount > 0) lines.push({ accountCode, [side]: amount, memo });
  };
  push(ACCOUNTS.SOCIAL_SECURITY, 'debit', run.social_security_total, 'Tryggingagjald');
  push(ACCOUNTS.PENSION_EMPLOYER, 'debit', run.pension_employer_total,
    'Lífeyrisframlag atvinnurekanda');
  push(ACCOUNTS.WITHHOLDING_PAYABLE, 'credit', run.withholding_total, 'Staðgreiðsla launa');
  push(ACCOUNTS.SOCIAL_SECURITY_PAYABLE, 'credit', run.social_security_total,
    'Tryggingagjald til greiðslu');
  push(ACCOUNTS.PENSION_PAYABLE, 'credit',
    run.pension_employee_total + run.pension_employer_total, 'Lífeyrissjóður');
  push(ACCOUNTS.UNION_PAYABLE, 'credit', run.union_total, 'Félagsgjöld');
  push(ACCOUNTS.WAGES_PAYABLE, 'credit', run.net_total, 'Ógreidd laun');
  return lines;
}

/**
 * Post a draft run to the ledger.
 *
 * Blockers can be overridden, because a system that cannot be overridden gets worked
 * around — but the reason is stored with the run, so "why was this posted with the
 * owner below the minimum" is a question the record can answer.
 */
async function postRun(client, runId, { postedBy, overrideBlockers = null }) {
  if (!postedBy) throw new PayrollError('postRun requires postedBy', 500);

  const { rows } = await client.query(
    `SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE`, [String(runId)]
  );
  if (!rows.length) throw new PayrollError('Payroll run not found', 404, 'NOT_FOUND');
  const run = normaliseRun(rows[0]);
  if (run.status !== 'draft') {
    throw new PayrollError(`This run is already ${run.status}`, 409, 'NOT_DRAFT');
  }

  const { rows: slips } = await client.query(
    `SELECT p.id, p.employee_id, p.gross, e.*
       FROM payslips p JOIN employees e ON e.id = p.employee_id
      WHERE p.run_id = $1`,
    [run.id]
  );
  if (!slips.length) throw new PayrollError('This run has no payslips', 400, 'EMPTY_RUN');

  // Re-checked rather than trusting the stored preflight: the draft may be days old,
  // and an employee record or the period lock may have changed since.
  const rates = await loadRates(run.tax_year, client);
  const staff = slips.map(row => ({
    employee: normaliseEmployee(row),
    payslip: { gross: Number(row.gross) },
  }));
  const check = await preflight(client, {
    period: run.period, staff, rates, payDate: run.pay_date,
  });

  if (!check.ok) {
    if (!overrideBlockers || !String(overrideBlockers).trim()) {
      const err = new PayrollError(
        `This run cannot be posted: ${check.blockers.map(b => b.message).join(' ')}`,
        409, 'BLOCKED'
      );
      err.findings = check.findings;
      throw err;
    }
  }

  const entry = await ledger.postEntry(client, {
    entryDate: run.pay_date,
    memo: `Laun ${run.period}`,
    sourceType: 'payroll',
    sourceId: run.id,
    createdBy: postedBy,
    lines: runJournalLines(run),
  });

  const { rows: posted } = await client.query(
    `UPDATE payroll_runs
        SET status = 'posted', journal_entry_id = $2, posted_at = NOW(), posted_by = $3,
            preflight = $4::jsonb
      WHERE id = $1
      RETURNING *`,
    [run.id, entry.id, postedBy, JSON.stringify({
      ...check,
      overridden: overrideBlockers ? String(overrideBlockers).trim() : null,
    })]
  );

  return { run: normaliseRun(posted[0]), entry, preflight: check };
}

/**
 * Reverse a posted run.
 *
 * The run stays, the payslips stay, and a mirror journal entry cancels the posting. A
 * payroll run that could be deleted would let a month of withholding vanish from the
 * books with nothing to show it had ever been there.
 */
async function reverseRun(client, runId, { reversedBy, reason }) {
  if (!reversedBy) throw new PayrollError('reverseRun requires reversedBy', 500);
  if (!reason || !String(reason).trim()) {
    throw new PayrollError('Reversing a payroll run requires a reason', 400, 'REASON_REQUIRED');
  }
  const { rows } = await client.query(
    `SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE`, [String(runId)]
  );
  if (!rows.length) throw new PayrollError('Payroll run not found', 404, 'NOT_FOUND');
  const run = normaliseRun(rows[0]);
  if (run.status !== 'posted' && run.status !== 'settled') {
    throw new PayrollError(
      `Only a posted run can be reversed; this one is ${run.status}`, 409, 'NOT_POSTED'
    );
  }

  const { reversal } = await ledger.reverseEntry(client, run.journal_entry_id, {
    createdBy: reversedBy,
    reason: `Laun ${run.period} bakfærð: ${String(reason).trim()}`,
  });

  const { rows: updated } = await client.query(
    `UPDATE payroll_runs
        SET status = 'reversed',
            note = CASE WHEN note = '' THEN $2 ELSE note || ' | ' || $2 END
      WHERE id = $1 RETURNING *`,
    [run.id, `Bakfært: ${String(reason).trim()}`]
  );

  return { run: normaliseRun(updated[0]), reversal };
}

/**
 * Record the wages actually leaving the bank.
 *
 * A separate event from the run, with its own date, because the salary is a liability
 * from the moment it is earned and cash from the moment it is paid — usually different
 * days. Booking them together makes an unpaid salary invisible.
 */
async function recordWagePayment(client, runId, { amount, paidOn, createdBy, note = '' }) {
  if (!createdBy) throw new PayrollError('recordWagePayment requires createdBy', 500);
  const { rows } = await client.query(
    `SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE`, [String(runId)]
  );
  if (!rows.length) throw new PayrollError('Payroll run not found', 404, 'NOT_FOUND');
  const run = normaliseRun(rows[0]);
  if (run.status !== 'posted' && run.status !== 'settled') {
    throw new PayrollError('Wages can only be paid against a posted run', 409, 'NOT_POSTED');
  }
  const value = assertIntegerIsk(
    amount === null || amount === undefined ? run.net_total : amount, 'amount'
  );
  if (value <= 0) throw new PayrollError('An amount must be greater than zero', 400, 'BAD_AMOUNT');
  if (value > run.net_total) {
    throw new PayrollError(
      `Paying ${value} ISK against a run whose net is ${run.net_total} ISK`, 400, 'OVER_NET'
    );
  }
  const date = assertAccountingDate(paidOn, 'paid_on');

  const entry = await ledger.postEntry(client, {
    entryDate: date,
    memo: `Laun ${run.period} greidd${note ? ` — ${note}` : ''}`,
    sourceType: 'payroll',
    sourceId: run.id,
    createdBy,
    lines: [
      { accountCode: ACCOUNTS.WAGES_PAYABLE, debit: value, memo: 'Ógreidd laun greidd' },
      { accountCode: ACCOUNTS.BANK, credit: value, memo: `Laun ${run.period}` },
    ],
  });

  // 'settled' is 072's own word for a run whose wages have gone out. Only marked when
  // the whole net has been paid — a part payment leaves the run posted and the
  // remainder visibly outstanding.
  if (value === run.net_total && run.status === 'posted') {
    await client.query(`UPDATE payroll_runs SET status = 'settled' WHERE id = $1`, [run.id]);
  }
  return { entry };
}

// ── Reads ────────────────────────────────────────────────────────────────────

function normalisePayslip(s) {
  const numeric = ['gross', 'pension_employee', 'taxable_base', 'computed_tax',
    'allowance_used', 'withholding', 'union_dues', 'extra_pension_employee', 'net_pay',
    'pension_employer', 'extra_pension_employer', 'social_security'];
  const out = { ...s };
  for (const k of numeric) if (out[k] !== undefined && out[k] !== null) out[k] = Number(out[k]);
  if (out.pay_date) out.pay_date = toIsoDate(out.pay_date);
  return out;
}

async function listRuns({ limit = 24, offset = 0 } = {}, client = db) {
  const { rows } = await client.query(
    `SELECT r.*, u.username AS created_by_username, p.username AS posted_by_username,
            (SELECT COUNT(*)::int FROM payslips WHERE run_id = r.id) AS payslip_count
       FROM payroll_runs r
       LEFT JOIN users u ON u.id = r.created_by
       LEFT JOIN users p ON p.id = r.posted_by
      ORDER BY r.period DESC, r.created_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const { rows: count } = await client.query(`SELECT COUNT(*)::int AS total FROM payroll_runs`);
  return { runs: rows.map(normaliseRun), total: count[0].total };
}

async function getRun(runId, client = db) {
  const { rows } = await client.query(
    `SELECT r.*, u.username AS created_by_username, p.username AS posted_by_username
       FROM payroll_runs r
       LEFT JOIN users u ON u.id = r.created_by
       LEFT JOIN users p ON p.id = r.posted_by
      WHERE r.id = $1`,
    [String(runId)]
  );
  if (!rows.length) throw new PayrollError('Payroll run not found', 404, 'NOT_FOUND');
  const { rows: slips } = await client.query(
    `SELECT * FROM payslips WHERE run_id = $1 ORDER BY employee_name`, [String(runId)]
  );
  return { run: normaliseRun(rows[0]), payslips: slips.map(normalisePayslip) };
}

async function getPayslip(payslipId, client = db) {
  const { rows } = await client.query(
    `SELECT p.*, r.period, r.pay_date, r.status AS run_status
       FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
      WHERE p.id = $1`,
    [String(payslipId)]
  );
  if (!rows.length) throw new PayrollError('Payslip not found', 404, 'NOT_FOUND');
  return normalisePayslip(rows[0]);
}

/**
 * What is owed to whom right now, read from the LEDGER.
 *
 * Not summed from the runs: "have I paid Skatturinn yet" is not answerable from the
 * payroll register alone — only the ledger knows whether the remittance has gone out.
 */
async function liabilities(client = db) {
  const codes = [
    ACCOUNTS.WITHHOLDING_PAYABLE, ACCOUNTS.SOCIAL_SECURITY_PAYABLE,
    ACCOUNTS.PENSION_PAYABLE, ACCOUNTS.EXTRA_PENSION_PAYABLE,
    ACCOUNTS.UNION_PAYABLE, ACCOUNTS.WAGES_PAYABLE,
  ];
  const { rows } = await client.query(
    `SELECT la.code, la.name,
            COALESCE(SUM(CASE WHEN je.posted_at IS NOT NULL
                              THEN jl.credit - jl.debit ELSE 0 END), 0)::bigint AS balance
       FROM ledger_accounts la
       LEFT JOIN journal_lines jl ON jl.account_id = la.id
       LEFT JOIN journal_entries je ON je.id = jl.entry_id
      WHERE la.code = ANY($1::text[])
      GROUP BY la.code, la.name, la.sort
      ORDER BY la.sort`,
    [codes]
  );
  return rows.map(r => ({ code: r.code, name: r.name, balance: Number(r.balance) }));
}

module.exports = {
  PayrollError,
  ACCOUNTS,
  EMPLOYMENT_TYPES,
  toBp,
  applyBp,
  computeTax,
  computePayslip,
  isValidKennitala,
  loadRates,
  upsertRates,
  confirmRates,
  listRateYears,
  getRateYear,
  listEmployees,
  getEmployee,
  upsertEmployee,
  preflight,
  createDraftRun,
  runJournalLines,
  postRun,
  reverseRun,
  recordWagePayment,
  listRuns,
  getRun,
  getPayslip,
  liabilities,
};
