// The replay benchmark end to end: a synthetic period pushed through the REAL
// services (expenseService, posService, ledgerService, documentService), the
// return derived by vatService, and the result compared with the recorded
// figures. Then the same posted history against a deliberately wrong expectation,
// to prove a one-króna error surfaces with its box named.
//
// Claim year 2017 — the suites share one append-only journal (see
// docs/BOOKKEEPING-SYSTEM.md, "Things that will bite you").
const path = require('path');
const db = require('../../server/config/database');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const replay = require('../../server/services/bookkeeping/replay');
const { createTestAdminUser, reseedBooksReferenceData } = require('../helpers');

const CASE = path.join(__dirname, '..', 'fixtures', 'replay', '2017-P1-synthetic.json');

let adminId;

beforeAll(async () => {
  await reseedBooksReferenceData();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();
});

describe('books:replay', () => {
  it('replays the synthetic period through the real services and matches the recorded figures', async () => {
    const loaded = replay.loadCase(CASE);
    const result = await ledger.withTransaction(c => replay.replayCase(c, loaded, { actorId: adminId }));

    expect(result.ok).toBe(true);
    expect(result.comparison.ok).toBe(true);
    expect(result.trialBalance.balanced).toBe(true);
    expect(result.counts).toMatchObject({ manual_entries: 1, expenses: 2, pos_sales: 1, fx_rates: 1, documents_stubbed: 2 });

    // The parts that a totals-only check would not see.
    expect(result.derived.output_vat_reverse_charge).toBe(480);
    expect(result.derived.output_vat_domestic).toBe(2510);
    expect(result.derived.box_f_payable).toBe(110);

    // Stubs are real documents as far as the books are concerned — the preflight
    // saw a fylgiskjal on every deductible expense, so no blocker.
    expect(result.preflight.findings.filter(f => f.level === 'blocker')).toEqual([]);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM books_documents WHERE note = 'replay stub — not evidence'`
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('a one-króna difference in one filed box is a MISMATCH naming that box', async () => {
    // Same posted history, wrong expectation — runCase only reads.
    const loaded = replay.loadCase(CASE);
    const wrong = JSON.parse(JSON.stringify(loaded.def));
    wrong.expected.box_e_input += 1;
    wrong.expected.box_f_payable -= 1;

    const result = await ledger.withTransaction(c => replay.runCase(c, wrong, loaded.meta));
    expect(result.ok).toBe(false);
    expect(result.comparison.rows.filter(r => !r.ok).map(r => r.box)).toEqual(['box_e_input', 'box_f_payable']);
    expect(result.comparison.rows.find(r => r.box === 'box_e_input').diff).toBe(-1);
  });

  it('a pending case derives without comparing', async () => {
    const loaded = replay.loadCase(CASE);
    const pending = { ...loaded.def, pending: true };
    delete pending.expected;
    const result = await ledger.withTransaction(c => replay.runCase(c, pending, { ...loaded.meta, pending: true }));
    expect(result.ok).toBeNull();
    expect(result.comparison).toBeNull();
    expect(result.derived.box_e_input).toBe(2880);
  });

  it('refuses to apply without an actor — every posting needs a person', async () => {
    const loaded = replay.loadCase(CASE);
    await expect(ledger.withTransaction(c => replay.applyCase(c, loaded.def, {})))
      .rejects.toMatchObject({ name: 'ReplayError', code: 'NO_ACTOR' });
  });
});
