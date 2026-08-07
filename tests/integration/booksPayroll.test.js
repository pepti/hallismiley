// Payroll against a real database: the refusals, the posting, and the append-only rule.
//
// The arithmetic is covered in tests/unit/booksPayroll.test.js. What this file exists to
// prove is the behaviour that keeps a wrong payroll from being POSTED:
//
//   * an unconfirmed tax year is refused, with a message saying why
//   * band rates that look like tekjuskattur-only are refused on entry
//   * an owner below the reiknað endurgjald minimum is a blocker
//   * a second posted run for the same month is impossible
//   * a posted run and its payslips cannot be edited or deleted
//   * paying the wages is a separate event from incurring the cost
//
// The RATES here are illustrative, chosen so the arithmetic is checkable by hand. They
// are not the real Icelandic figures for any year.
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const db = require('../../server/config/database');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const payroll = require('../../server/services/bookkeeping/payrollService');
const { BOOKS_UPLOAD_ROOT } = require('../../server/config/paths');
const { createTestAdminUser, reseedBooksReferenceData } = require('../helpers');

let adminId;

// The posting year has to satisfy three constraints at once: at or after 2020 (the
// payroll_rates CHECK), in the PAST (recordWagePayment refuses a future cash date, and
// rightly so — money that has not moved cannot be recorded), and unused by any other
// books suite (the journal is append-only and fiscal periods are shared). 2020 is the
// only year that satisfies all three: booksVatReturn claims 2021-2025 and booksReports
// 2019.
//
// The years used only for entering figures can be anything, including the future, since
// nothing is ever posted against them.
const YEAR = 2020;
const UNCONFIRMED_YEAR = 2099;

const FIGURES = {
  personalAllowance: 60_000,
  municipalRate: 0.145,
  socialSecurity: 0.0635,
  pensionEmployee: 0.04,
  pensionEmployer: 0.115,
  bands: [
    { from: 0, rate: 0.30 },
    { from: 500_000, rate: 0.40 },
    { from: 1_200_000, rate: 0.45 },
  ],
  sourceNote: 'Illustrative figures for the test suite — not real published rates',
};

// Credit-positive, so a liability reads as a positive number. Range-scoped, because the
// journal is append-only and shared across every books suite.
async function liabilityBalance(code, { from, to }) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::bigint AS bal
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE la.code = $1 AND je.posted_at IS NOT NULL
        AND je.entry_date >= $2::date AND je.entry_date <= $3::date`,
    [code, from, to]
  );
  return Number(rows[0].bal);
}

// Scoped to ONE run, through source_id, which is what every payroll entry carries. Two
// runs in this file can legitimately share a pay date (the period is what must be
// unique), so a date window is not a precise enough lens for a per-run assertion.
async function runBalance(code, runId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::bigint AS bal
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE la.code = $1 AND je.posted_at IS NOT NULL
        AND je.source_type = 'payroll' AND je.source_id = $2`,
    [code, String(runId)]
  );
  return Number(rows[0].bal);
}

// Each test that posts gets its own PERIOD, so a posted run in one test cannot make
// another test's month "already posted".
//
// The period pool spans two years while every pay date stays inside YEAR. That is not a
// fudge: the period is the month the work was done and the pay date is when the money
// moves, and they routinely differ — December's salary paid in January is the case that
// catches people out, and the one the service reads the tax year from. Pinning pay dates
// to YEAR keeps every run on the confirmed figures while giving 24 usable slots.
let runCursor = 0;
function freshMonth() {
  if (runCursor >= 24) throw new Error('Ran out of test periods — widen the pool');
  const year = YEAR - 1 + Math.floor(runCursor / 12);
  const mm = String((runCursor % 12) + 1).padStart(2, '0');
  runCursor += 1;
  return { period: `${year}-${mm}`, payDate: `${YEAR}-${mm}-28` };
}

// Deactivates everyone else first. Employees referenced by a POSTED payslip cannot be
// deleted (created_by is ON DELETE RESTRICT and the payslip holds them), so without this
// a run later in the file would silently include staff left over from an earlier test —
// which is how the totals here drifted the first time round. A run picks up active
// employees, so 'active' is the switch the tests use to scope one.
async function makeEmployee(over = {}) {
  await db.query('UPDATE employees SET is_active = FALSE');
  const spec = {
    fullName: 'Prófmaður Launþegason',
    kennitala: '1203894599',
    monthlySalary: 600_000,
    pensionFund: 'Gildi',
    createdBy: adminId,
    ...over,
  };
  // Upserted by kennitala. The unique index on it is right — one person, one record —
  // but it means a plain INSERT collides the second time a test reuses a number, and an
  // employee on a posted payslip cannot be deleted to make room.
  const { rows } = await db.query('SELECT id FROM employees WHERE kennitala = $1',
    [String(spec.kennitala).replace(/\D/g, '')]);
  return ledger.withTransaction(c => payroll.upsertEmployee(c, {
    ...spec, id: rows.length ? rows[0].id : null,
  }));
}

async function draftAndPost(over = {}) {
  const { period, payDate } = freshMonth();
  const { run } = await ledger.withTransaction(c => payroll.createDraftRun(c, {
    period, payDate, createdBy: adminId, ...over,
  }));
  await ledger.withTransaction(c => payroll.postRun(c, run.id, { postedBy: adminId }));
  return { run, period, payDate };
}

beforeAll(async () => {
  await reseedBooksReferenceData();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();

  await ledger.withTransaction(c => payroll.upsertRates(c, {
    year: YEAR, ...FIGURES, createdBy: adminId,
    referenceWages: [{ category: 'A-1', description: 'Test category', monthly_min: 800_000 }],
  }));
  await ledger.withTransaction(c => payroll.confirmRates(c, YEAR, {
    confirmedBy: adminId, sourceNote: 'Illustrative test figures, confirmed for the suite',
  }));

  // Left deliberately unconfirmed.
  await ledger.withTransaction(c => payroll.upsertRates(c, {
    year: UNCONFIRMED_YEAR, ...FIGURES, createdBy: adminId,
  }));

  for (let m = 1; m <= 12; m += 1) {
    await ledger.withTransaction(c =>
      ledger.ensureFiscalPeriod(c, `${YEAR}-${String(m).padStart(2, '0')}-28`));
  }
});

afterAll(async () => { await db.pool.end(); });

// Drafts only. Employees are scoped by is_active (see makeEmployee) rather than deleted:
// anyone on a posted payslip cannot be removed, by design.
beforeEach(async () => {
  await db.query(`DELETE FROM payroll_runs WHERE status = 'draft'`);
});

describe('refusing to run', () => {
  it('refuses a year whose figures nobody has entered', async () => {
    await expect(payroll.loadRates(2098)).rejects.toMatchObject({ code: 'YEAR_MISSING' });
    // The message has to say what to do, not merely that something is wrong.
    await expect(payroll.loadRates(2098)).rejects.toThrow(/Skatturinn/);
  });

  it('refuses a year whose figures nobody has confirmed', async () => {
    // The central refusal of the whole module. A run computed from unverified rates
    // looks right and under-remits withholding tax, and the shortfall is the employer's
    // liability years later, with interest.
    await expect(payroll.loadRates(UNCONFIRMED_YEAR))
      .rejects.toMatchObject({ code: 'YEAR_UNCONFIRMED' });
    await expect(payroll.loadRates(UNCONFIRMED_YEAR))
      .rejects.toThrow(/under-remits withholding tax/);
  });

  it('will still SHOW an unconfirmed year, so it can be checked', async () => {
    // Refusing to compute is not refusing to display: the operator has to be able to
    // read the figures in order to confirm them.
    const y = await payroll.loadRates(UNCONFIRMED_YEAR, db, { requireConfirmed: false });
    expect(y.confirmed_at).toBeNull();
    expect(y.bands).toHaveLength(3);
  });

  it('refuses to build a draft run against an unconfirmed year', async () => {
    await makeEmployee();
    await expect(ledger.withTransaction(c => payroll.createDraftRun(c, {
      period: `${UNCONFIRMED_YEAR}-03`,
      payDate: `${UNCONFIRMED_YEAR}-03-28`,
      createdBy: adminId,
    }))).rejects.toMatchObject({ code: 'YEAR_UNCONFIRMED' });
  });

  it('takes the tax year from the PAY DATE, not the period', async () => {
    // December's salary paid in January is taxed on January's figures. Reading the year
    // off the period would use the wrong bands every January.
    await makeEmployee();
    await expect(ledger.withTransaction(c => payroll.createDraftRun(c, {
      period: `${YEAR}-12`,
      payDate: `${YEAR + 1}-01-05`,   // no figures for YEAR+1
      createdBy: adminId,
    }))).rejects.toMatchObject({ code: 'YEAR_MISSING' });
  });
});

describe('entering a year’s figures', () => {
  it('lands unconfirmed, and re-editing un-confirms it again', async () => {
    const y = await ledger.withTransaction(c => payroll.upsertRates(c, {
      year: 2097, ...FIGURES, createdBy: adminId,
    }));
    expect(y.confirmed_at).toBeNull();

    await ledger.withTransaction(c => payroll.confirmRates(c, 2097, {
      confirmedBy: adminId, sourceNote: 'checked against the published table',
    }));
    expect((await payroll.loadRates(2097)).confirmed_at).not.toBeNull();

    // Changing a figure means it needs checking again — otherwise a confirmed year could
    // be edited into something nobody verified while still looking confirmed.
    await ledger.withTransaction(c => payroll.upsertRates(c, {
      year: 2097, ...FIGURES, personalAllowance: 61_000, createdBy: adminId,
    }));
    const after = await payroll.loadRates(2097, db, { requireConfirmed: false });
    expect(after.confirmed_at).toBeNull();
  });

  it('requires a note saying where the figures came from', async () => {
    await ledger.withTransaction(c => payroll.upsertRates(c, {
      year: 2096, ...FIGURES, createdBy: adminId,
    }));
    await expect(ledger.withTransaction(c => payroll.confirmRates(c, 2096, {
      confirmedBy: adminId, sourceNote: '  ',
    }))).rejects.toMatchObject({ code: 'SOURCE_REQUIRED' });
  });

  it('refuses band rates that look like tekjuskattur without útsvar', async () => {
    // The trap this guard exists for: the published band rate is tekjuskattur PLUS
    // útsvar. Entering tekjuskattur alone (say 22.5% against a 14.5% municipal rate)
    // gives a plausible-looking payslip that under-withholds by roughly a third.
    await expect(ledger.withTransaction(c => payroll.upsertRates(c, {
      year: 2095, ...FIGURES, createdBy: adminId,
      bands: [{ from: 0, rate: 0.10 }, { from: 500_000, rate: 0.145 }],
    }))).rejects.toMatchObject({ code: 'BANDS_LOOK_PARTIAL' });
  });

  it.each([
    [{ bands: [{ from: 100_000, rate: 0.30 }] }, 'BANDS_INCOMPLETE', 'a lowest band above zero'],
    [{ bands: [] }, 'BANDS_REQUIRED', 'no bands at all'],
    [{ bands: [{ from: 0, rate: 0.40 }, { from: 500_000, rate: 0.30 }] },
      'BANDS_DESCENDING', 'a higher slice taxed at a lower rate'],
    [{ bands: [{ from: 0, rate: 0.30 }, { from: 0, rate: 0.40 }] },
      'BANDS_OVERLAP', 'two bands starting at the same figure'],
    [{ socialSecurity: 6.35 }, 'RATE_UNITS', 'a percentage where a decimal belongs'],
  ])('refuses %#: %s', async (over, code) => {
    await expect(ledger.withTransaction(c => payroll.upsertRates(c, {
      year: 2094, ...FIGURES, ...over, createdBy: adminId,
    }))).rejects.toMatchObject({ code });
  });
});

describe('employees', () => {
  it('refuses a mistyped kennitala', async () => {
    // A wrong kennitala goes onto the payslip and into every remittance.
    await expect(makeEmployee({ kennitala: '1203994599' }))
      .rejects.toMatchObject({ code: 'BAD_KENNITALA' });
  });

  it('refuses an owner with no reiknað endurgjald category', async () => {
    await expect(makeEmployee({ employmentType: 'owner', referenceWageCategory: null }))
      .rejects.toMatchObject({ code: 'CATEGORY_REQUIRED' });
  });

  it('keeps a NULL pension rate distinct from zero', async () => {
    const overridden = await makeEmployee({ pensionEmployeeRate: 0.08 });
    expect(Number(overridden.pension_employee_rate)).toBe(0.08);
    // NULL means "use the year's statutory rate", which is a different statement from 0.
    const plain = await makeEmployee({ kennitala: '2503885009', fullName: 'Annar' });
    expect(plain.pension_employee_rate).toBeNull();
  });

  it('accepts a transferred allowance factor above 1', async () => {
    // Migration 072 capped this at 1; 076 raised it, because persónuafsláttur can be
    // partly transferred from a spouse.
    const e = await makeEmployee({ allowanceFactor: 1.5 });
    expect(Number(e.allowance_factor)).toBe(1.5);
  });
});

describe('posting a run', () => {
  it('computes, posts and lands the liabilities where they belong', async () => {
    const { period, payDate } = freshMonth();
    await makeEmployee();

    const { run, preflight } = await ledger.withTransaction(c => payroll.createDraftRun(c, {
      period, payDate, createdBy: adminId,
    }));
    expect(run.status).toBe('draft');
    expect(preflight.ok).toBe(true);
    // Gross 600.000 → withholding 120.400, net 455.600 (working in the unit test).
    expect(run.gross_total).toBe(600_000);
    expect(run.withholding_total).toBe(120_400);
    expect(run.net_total).toBe(455_600);
    expect(run.social_security_total).toBe(38_100);

    // A draft touches nothing.
    const range = { from: payDate, to: payDate };
    expect(await liabilityBalance('2300', range)).toBe(0);

    const posted = await ledger.withTransaction(c => payroll.postRun(c, run.id, {
      postedBy: adminId,
    }));
    expect(posted.run.status).toBe('posted');
    expect(posted.run.journal_entry_id).toBeTruthy();

    expect(await liabilityBalance('2300', range)).toBe(120_400);          // withholding
    expect(await liabilityBalance('2310', range)).toBe(38_100);           // tryggingagjald
    expect(await liabilityBalance('2320', range)).toBe(24_000 + 69_000);  // both pension sides
    expect(await liabilityBalance('2350', range)).toBe(455_600);          // owed to the employee
    // Nothing has left the bank yet — that is a separate event.
    expect(await liabilityBalance('1900', range)).toBe(0);
  });

  it('posts one entry whose legs balance', async () => {
    await makeEmployee();
    const { period, payDate } = freshMonth();
    const { run } = await ledger.withTransaction(c => payroll.createDraftRun(c, {
      period, payDate, createdBy: adminId,
    }));
    const { entry } = await ledger.withTransaction(c => payroll.postRun(c, run.id, {
      postedBy: adminId,
    }));
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(debit),0)::bigint AS d, COALESCE(SUM(credit),0)::bigint AS c
         FROM journal_lines WHERE entry_id = $1`,
      [entry.id]
    );
    expect(Number(rows[0].d)).toBe(Number(rows[0].c));
    // The company's cost is the gross plus both employer contributions.
    expect(Number(rows[0].d)).toBe(600_000 + 38_100 + 69_000);
  });

  it('snapshots the employee’s name onto the payslip', async () => {
    // A payslip is a document, not a view: renaming someone later must not rewrite what
    // their old payslips say.
    await makeEmployee({ fullName: 'Upphaflegt Nafn' });
    const { period, payDate } = freshMonth();
    const { run } = await ledger.withTransaction(c => payroll.createDraftRun(c, {
      period, payDate, createdBy: adminId,
    }));
    const { payslips } = await payroll.getRun(run.id);
    expect(payslips[0].employee_name).toBe('Upphaflegt Nafn');
    expect(payslips[0].employee_kennitala).toBe('1203894599');
  });

  it('blocks an owner paid below the reiknað endurgjald minimum', async () => {
    // The check an owner most needs. Paying yourself under the RSK minimum is assessed
    // years later, and nothing about the payslip looks wrong at the time.
    await makeEmployee({
      employmentType: 'owner', referenceWageCategory: 'A-1', monthlySalary: 500_000,
    });
    const { period, payDate } = freshMonth();
    const { run, preflight } = await ledger.withTransaction(c => payroll.createDraftRun(c, {
      period, payDate, createdBy: adminId,
    }));
    expect(preflight.ok).toBe(false);
    expect(preflight.blockers.map(b => b.code)).toContain('BELOW_REFERENCE_WAGE');

    await expect(ledger.withTransaction(c => payroll.postRun(c, run.id, {
      postedBy: adminId,
    }))).rejects.toMatchObject({ code: 'BLOCKED' });

    // Overridable with a written reason, stored with the run — a system that cannot be
    // overridden gets worked around instead, and then nothing is recorded at all.
    const posted = await ledger.withTransaction(c => payroll.postRun(c, run.id, {
      postedBy: adminId,
      overrideBlockers: 'Taking the rest as a dividend; accountant advised',
    }));
    expect(posted.run.status).toBe('posted');
    expect(posted.run.preflight.overridden).toMatch(/dividend/);
  });

  it('allows an owner paid at or above the minimum', async () => {
    await makeEmployee({
      employmentType: 'owner', referenceWageCategory: 'A-1', monthlySalary: 800_000,
    });
    const { period, payDate } = freshMonth();
    const { preflight } = await ledger.withTransaction(c => payroll.createDraftRun(c, {
      period, payDate, createdBy: adminId,
    }));
    expect(preflight.blockers).toEqual([]);
  });

  it('refuses a second posted run for the same month', async () => {
    // Two posted runs would double every remittance for the month.
    await makeEmployee();
    const { period, payDate } = freshMonth();
    const first = await ledger.withTransaction(c => payroll.createDraftRun(c, {
      period, payDate, createdBy: adminId,
    }));
    await ledger.withTransaction(c => payroll.postRun(c, first.run.id, { postedBy: adminId }));

    const second = await ledger.withTransaction(c => payroll.createDraftRun(c, {
      period, payDate, createdBy: adminId,
    }));
    expect(second.preflight.blockers.map(b => b.code)).toContain('ALREADY_POSTED');
    await expect(ledger.withTransaction(c => payroll.postRun(c, second.run.id, {
      postedBy: adminId,
    }))).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('will not post the same run twice', async () => {
    await makeEmployee();
    const { run } = await draftAndPost();
    await expect(ledger.withTransaction(c => payroll.postRun(c, run.id, {
      postedBy: adminId,
    }))).rejects.toMatchObject({ code: 'NOT_DRAFT' });
  });

  it('refuses to post into a locked period', async () => {
    await makeEmployee();
    const { period, payDate } = freshMonth();
    const { run } = await ledger.withTransaction(c => payroll.createDraftRun(c, {
      period, payDate, createdBy: adminId,
    }));
    await db.query(
      `UPDATE fiscal_periods SET status = 'locked', locked_at = NOW(), locked_by = $1
        WHERE $2::date BETWEEN starts_on AND ends_on`,
      [adminId, payDate]
    );
    try {
      await expect(ledger.withTransaction(c => payroll.postRun(c, run.id, {
        postedBy: adminId,
      }))).rejects.toThrow();
    } finally {
      await db.query(
        `UPDATE fiscal_periods SET status = 'open', locked_at = NULL, locked_by = NULL
          WHERE $1::date BETWEEN starts_on AND ends_on`,
        [payDate]
      );
    }
  });

  it('discards a draft cleanly, taking its payslips with it', async () => {
    // 072 had ON DELETE RESTRICT here, which would leave orphan payslips behind when a
    // draft was abandoned. 076 made it CASCADE, and the trigger is what protects a
    // POSTED run from being deleted at all.
    await makeEmployee();
    const { period, payDate } = freshMonth();
    const { run } = await ledger.withTransaction(c => payroll.createDraftRun(c, {
      period, payDate, createdBy: adminId,
    }));
    await db.query(`DELETE FROM payroll_runs WHERE id = $1`, [run.id]);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM payslips WHERE run_id = $1`, [run.id]
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('append-only, once posted', () => {
  let postedRunId;
  let postedPayDate;

  beforeAll(async () => {
    await db.query(`DELETE FROM payroll_runs WHERE status = 'draft'`);
    await makeEmployee({ kennitala: '0101885049', fullName: 'Fastur Starfsmaður' });
    const { run, payDate } = await draftAndPost();
    postedRunId = run.id;
    postedPayDate = payDate;
  });

  it('refuses to delete a posted run', async () => {
    await expect(db.query(`DELETE FROM payroll_runs WHERE id = $1`, [postedRunId]))
      .rejects.toThrow(/cannot be deleted|reverse it instead/i);
  });

  it('refuses to change the figures on a posted run', async () => {
    await expect(db.query(
      `UPDATE payroll_runs SET gross_total = 1 WHERE id = $1`, [postedRunId]
    )).rejects.toThrow(/final/i);
  });

  it('refuses to return a posted run to draft', async () => {
    await expect(db.query(
      `UPDATE payroll_runs SET status = 'draft' WHERE id = $1`, [postedRunId]
    )).rejects.toThrow(/only be settled or reversed/i);
  });

  it('refuses to delete or edit its payslips', async () => {
    // Without the payslip guard the run guard could be sidestepped: delete the payslips,
    // and a posted run's totals rest on no document at all.
    await expect(db.query(`DELETE FROM payslips WHERE run_id = $1`, [postedRunId]))
      .rejects.toThrow(/final/i);
    await expect(db.query(
      `UPDATE payslips SET net_pay = net_pay + 1 WHERE run_id = $1`, [postedRunId]
    )).rejects.toThrow(/final|net_pay/i);
  });

  it('still allows the PDF to be attached afterwards', async () => {
    // The document is evidence OF the payslip, not part of its figures, so this is the
    // one permitted change — otherwise a payslip could never be filed.
    //
    // A REAL file with its real checksum, not a placeholder row. A books_documents row
    // pointing at a file that does not exist is not a harmless fixture: the archive
    // export verifies every document against the checksum recorded at upload, and a
    // fabricated row makes that check fail in a different suite entirely — which is
    // exactly what it did the first time this was written.
    const body = Buffer.from('%PDF-1.4 launaseðill (test)\n');
    const dir = path.join(BOOKS_UPLOAD_ROOT, `${YEAR}-01`);
    await fs.mkdir(dir, { recursive: true });
    const rel = `${YEAR}-01/payslip-test.pdf`;
    await fs.writeFile(path.join(BOOKS_UPLOAD_ROOT, rel), body);
    const checksum = crypto.createHash('sha256').update(body).digest('hex');

    const { rows: doc } = await db.query(
      `INSERT INTO books_documents
         (kind, original_name, file_path, mime_type, byte_size, checksum_sha256, created_by)
       VALUES ('other','launasedill.pdf',$1,'application/pdf',$2,$3,$4)
       RETURNING id`,
      [rel, body.length, checksum, adminId]
    );
    const { rows: slips } = await db.query(
      `SELECT id FROM payslips WHERE run_id = $1 LIMIT 1`, [postedRunId]
    );
    await db.query(`UPDATE payslips SET document_id = $2 WHERE id = $1`,
      [slips[0].id, doc[0].id]);
    const { rows: after } = await db.query(
      `SELECT document_id FROM payslips WHERE id = $1`, [slips[0].id]
    );
    expect(after[0].document_id).toBe(doc[0].id);
  });

  it('refuses to edit a tax year that a posted run has used', async () => {
    // Otherwise a posted run would rest on rates that have since changed, and its
    // payslips would no longer be reproducible from the year's figures.
    await expect(db.query(
      `UPDATE payroll_rates SET personal_allowance = 1 WHERE tax_year = $1`, [YEAR]
    )).rejects.toThrow(/final/i);
    await expect(db.query(
      `UPDATE payroll_rates SET confirmed_at = NULL, confirmed_by = NULL WHERE tax_year = $1`,
      [YEAR]
    )).rejects.toThrow(/final/i);
    await expect(db.query(
      `DELETE FROM payroll_rates WHERE tax_year = $1`, [YEAR]
    )).rejects.toThrow(/cannot be deleted/i);
  });

  it('reverses by posting a mirror entry, keeping the run and its payslips', async () => {
    const payDateOnly = { from: postedPayDate, to: postedPayDate };
    // The reversal is dated TODAY, not back on the pay date, so the window has to span
    // both. That dating is deliberate: back-dating a reversal into a period that may
    // already have been filed is how a filed VSK return silently stops matching the
    // ledger. The ledger marks a cross-period reversal as a correction for that reason.
    const spanning = { from: postedPayDate, to: new Date().toISOString().slice(0, 10) };
    const before = await liabilityBalance('2300', payDateOnly);
    expect(before).toBeGreaterThan(0);

    const { run } = await ledger.withTransaction(c => payroll.reverseRun(c, postedRunId, {
      reversedBy: adminId, reason: 'Vitlaus launafjárhæð',
    }));
    expect(run.status).toBe('reversed');
    // The original still stands on its own date; the two together net to nothing.
    expect(await liabilityBalance('2300', payDateOnly)).toBe(before);
    expect(await liabilityBalance('2300', spanning)).toBe(0);

    // Both the run and its payslips survive. A payroll that could be deleted would let a
    // month of withholding vanish with nothing to show it had been there.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM payslips WHERE run_id = $1`, [postedRunId]
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('refuses to reverse the same run twice', async () => {
    await expect(ledger.withTransaction(c => payroll.reverseRun(c, postedRunId, {
      reversedBy: adminId, reason: 'aftur',
    }))).rejects.toMatchObject({ code: 'NOT_POSTED' });
  });

  it('requires a reason to reverse', async () => {
    const { run } = await draftAndPost();
    await expect(ledger.withTransaction(c => payroll.reverseRun(c, run.id, {
      reversedBy: adminId, reason: '   ',
    }))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });
});

describe('paying the wages', () => {
  beforeAll(async () => {
    await db.query(`DELETE FROM payroll_runs WHERE status = 'draft'`);
    await makeEmployee({ kennitala: '1508885069', fullName: 'Greiðsluprófun' });
  });

  it('is a separate event that clears the liability and moves the cash', async () => {
    const { run, payDate } = await draftAndPost();
    expect(await runBalance('2350', run.id)).toBe(455_600);

    await ledger.withTransaction(c => payroll.recordWagePayment(c, run.id, {
      amount: 455_600, paidOn: payDate, createdBy: adminId,
    }));

    // Wages payable cleared, and the money has left the bank. (The helper is
    // credit-positive, so a debit-balance asset going DOWN reads as positive here.)
    expect(await runBalance('2350', run.id)).toBe(0);
    expect(await runBalance('1900', run.id)).toBe(455_600);

    // Paying the whole net marks the run settled, which is 072's own word for it.
    const { run: after } = await payroll.getRun(run.id);
    expect(after.status).toBe('settled');
  });

  it('leaves a part payment visibly outstanding', async () => {
    const { run, payDate } = await draftAndPost();
    await ledger.withTransaction(c => payroll.recordWagePayment(c, run.id, {
      amount: 100_000, paidOn: payDate, createdBy: adminId,
    }));
    expect(await runBalance('2350', run.id)).toBe(455_600 - 100_000);
    // Still 'posted', not 'settled' — the remainder is owed and should look like it.
    const { run: after } = await payroll.getRun(run.id);
    expect(after.status).toBe('posted');
  });

  it('refuses to pay more than the net the run posted', async () => {
    const { run, payDate } = await draftAndPost();
    await expect(ledger.withTransaction(c => payroll.recordWagePayment(c, run.id, {
      amount: 500_000, paidOn: payDate, createdBy: adminId,
    }))).rejects.toMatchObject({ code: 'OVER_NET' });
  });

  it('refuses to pay against a draft', async () => {
    const { period, payDate } = freshMonth();
    const { run } = await ledger.withTransaction(c => payroll.createDraftRun(c, {
      period, payDate, createdBy: adminId,
    }));
    await expect(ledger.withTransaction(c => payroll.recordWagePayment(c, run.id, {
      amount: 1_000, paidOn: payDate, createdBy: adminId,
    }))).rejects.toMatchObject({ code: 'NOT_POSTED' });
  });
});

describe('liabilities', () => {
  it('reads what is owed from the ledger, not from the runs', async () => {
    // "Have I paid Skatturinn yet" is not answerable from the payroll register alone —
    // only the ledger knows whether the remittance has gone out.
    const owed = await payroll.liabilities();
    expect(owed.map(o => o.code)).toEqual(
      expect.arrayContaining(['2300', '2310', '2320', '2350'])
    );
    for (const row of owed) expect(typeof row.balance).toBe('number');
  });
});
