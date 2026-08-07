// The VSK return: derivation, preflight, filing, locking, re-opening.
//
// The property that matters most is that the return is DERIVED FROM THE LEDGER.
// If the return were summed from invoices while the trial balance were summed from
// journal entries, the two could disagree and nothing would notice — and RSK 10.25,
// the annual reconciliation, is precisely a comparison of the year's filed returns
// against the accounts. So these tests assert against ledger balances, not against
// the invoice rows the figures happen to come from.
const db = require('../../server/config/database');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const vat = require('../../server/services/bookkeeping/vatService');
const invoices = require('../../server/services/bookkeeping/invoiceService');
const expenses = require('../../server/services/bookkeeping/expenseService');
const documents = require('../../server/services/bookkeeping/documentService');
const Setting = require('../../server/models/Setting');
const { BOOKS_UPLOAD_ROOT } = require('../../server/config/paths');
const { createTestAdminUser, reseedBooksReferenceData } = require('../helpers');

let adminId;
let productId;
let bookProductId;
const VALID_KENNITALA = '1203894599';

// Each test gets its OWN VSK period.
//
// Journal history is append-only by design — there is no DELETE to reset between
// tests — so two tests sharing a period would see each other's entries and every
// absolute assertion would drift as tests were added. Periods are allocated from
// years the seed does not use, created on demand.
let PERIOD;
let IN_PERIOD;
let periodCursor = 0;
const PERIOD_YEARS = [2021, 2022, 2023, 2024, 2025];

async function freshPeriod() {
  const idx = periodCursor++;
  const year = PERIOD_YEARS[Math.floor(idx / 6)];
  if (!year) throw new Error('Ran out of test periods — add another year to PERIOD_YEARS');
  const half = (idx % 6) + 1;              // P1..P6
  const month = String(half * 2 - 1).padStart(2, '0');
  const date = `${year}-${month}-10`;
  await ledger.withTransaction(c => ledger.ensureFiscalPeriod(c, date));
  return { period: `${year}-P${half}`, date };
}

// A date inside the period AFTER the claimed one — for tests that need later
// activity to prove a filed snapshot does not move.
function nextPeriodDate() {
  const [y, p] = PERIOD.split('-P');
  const half = Number(p);
  return half < 6
    ? `${y}-${String(half * 2 + 1).padStart(2, '0')}-10`
    : `${Number(y) + 1}-01-10`;
}

async function makePaidOrder({ items, paidAt, country = 'IS' } = {}) {
  paidAt = paidAt || IN_PERIOD;
  const lines = items || [{ productId, price: 124_000, qty: 1 }];
  const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0);
  const { rows } = await db.query(
    `INSERT INTO orders (order_number, currency, subtotal, shipping, total, status,
       payment_status, shipping_method, shipping_address, guest_email, guest_name, paid_at)
     VALUES ($1,'ISK',$2,0,$2,'paid','paid','local_pickup',$3::jsonb,
             'vsk@example.is','VSK Test',$4::timestamptz)
     RETURNING id`,
    [`HP-VSK-${Math.random().toString(36).slice(2, 9)}`, subtotal,
      JSON.stringify({ name: 'VSK Test', line1: 'Gata 1', postal: '101', city: 'Reykjavík', country_code: country }),
      paidAt]
  );
  for (const l of lines) {
    await db.query(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot,
         product_price_snapshot, quantity, currency)
       VALUES ($1,$2,'Vefsíða',$3,$4,'ISK')`,
      [rows[0].id, l.productId || productId, l.price, l.qty]
    );
  }
  return rows[0].id;
}

async function issueInvoice(opts) {
  const orderId = await makePaidOrder(opts);
  const { invoice } = await ledger.withTransaction(c =>
    invoices.createFromOrder(c, orderId, { createdBy: adminId }));
  return invoice;
}

async function attachedDocument() {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(BOOKS_UPLOAD_ROOT, 'test-fixtures');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `vsk-${Math.random().toString(36).slice(2, 10)}.pdf`);
  fs.writeFileSync(abs, '%PDF-1.4 receipt');
  const { document } = await ledger.withTransaction(c => documents.register(c, {
    path: abs, originalname: 'r.pdf', mimetype: 'application/pdf', size: 17,
  }, { createdBy: adminId }));
  return document.id;
}

// Account balance straight from the ledger — the figure the return must agree with.
async function accountBalance(code, { to = null } = {}) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::bigint AS bal
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE la.code = $1 AND je.posted_at IS NOT NULL
        AND je.source_type <> 'vat_settlement'
        AND ($2::date IS NULL OR je.entry_date <= $2::date)`,
    [code, to]
  );
  return Number(rows[0].bal);
}

beforeAll(async () => {
  await reseedBooksReferenceData();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();
  const { rows } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, is_bookable, vat_rate)
     VALUES ('vsk-vefur','Vefsíða','',124000,82000,999,'VSK-WEB',TRUE,24)
     ON CONFLICT (slug) DO UPDATE SET vat_rate = 24 RETURNING id`
  );
  productId = rows[0].id;
  const { rows: bk } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, vat_rate)
     VALUES ('vsk-handbok','Handbók','',11100,7900,99,'VSK-BOOK',11)
     ON CONFLICT (slug) DO UPDATE SET vat_rate = 11 RETURNING id`
  );
  bookProductId = bk.rows ? bk.rows[0].id : bk[0].id;
  await Setting.updateBookkeepingSettings({
    seller_name: 'Smiley Software ehf.',
    seller_kennitala: VALID_KENNITALA,
    seller_vat_number: '148820',
    payment_terms_days: 14,
  });
});

afterAll(async () => { await db.pool.end(); });

beforeEach(async () => {
  // Claim a fresh period per test — see freshPeriod() for why sharing one is unsafe.
  ({ period: PERIOD, date: IN_PERIOD } = await freshPeriod());
  await db.query(`UPDATE fiscal_periods SET status='open', locked_at=NULL, locked_by=NULL`);
  await db.query(`ALTER TABLE vat_returns DISABLE TRIGGER trg_vat_returns_immutable`);
  await db.query(`DELETE FROM vat_returns`);
  await db.query(`ALTER TABLE vat_returns ENABLE TRIGGER trg_vat_returns_immutable`);
});

describe('deriving the return from the ledger', () => {
  it('agrees with the output-VAT and input-VAT account balances', async () => {
    // The whole design claim in one assertion: the return is what the ledger says.
    await issueInvoice();
    const derived = await vat.deriveReturn(db, PERIOD);
    const { ends_on: to } = require('../../server/utils/vatPeriod').periodBounds(PERIOD);

    // Output VAT is a liability, so a credit balance shows as negative here.
    expect(derived.box_d_output).toBe(-(await accountBalance('2200', { to })
      + await accountBalance('2210', { to })));
    // Input VAT is an asset: a debit balance.
    expect(derived.box_e_input).toBe(await accountBalance('1310', { to }));
    expect(derived.box_f_payable).toBe(derived.box_d_output - derived.box_e_input);
  });

  it('puts each rate in its own box', async () => {
    await issueInvoice({ items: [
      { productId, price: 124_000, qty: 1 },
      { productId: bookProductId, price: 11_100, qty: 2 },
    ] });
    const d = await vat.deriveReturn(db, PERIOD);
    expect(d.box_a_net_24).toBe(100_000);            // 124,000 incl. → 100,000 net
    expect(d.box_b_net_11).toBe(20_000);             // 2 × 11,100 incl. → 20,000 net
    expect(d.box_c_net_zero).toBe(0);
    // And D is exactly the VAT on those two: 24,000 + 2,200.
    expect(d.box_d_output).toBe(26_200);
  });

  it('reports zero-rated exports in box C with no VAT', async () => {
    await issueInvoice({ items: [{ productId: bookProductId, price: 11_100, qty: 1 }], country: 'DE' });
    const d = await vat.deriveReturn(db, PERIOD);
    expect(d.box_c_net_zero).toBe(11_100);
    expect(d.box_d_output).toBe(0);
  });

  it('reduces turnover when a sale is credited, rather than leaving it overstated', async () => {
    const invoice = await issueInvoice();
    const before = await vat.deriveReturn(db, PERIOD);
    await ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: Number(invoice.total_gross), reason: 'Afturkallað',
      issuedAt: IN_PERIOD, createdBy: adminId,
    }));
    const after = await vat.deriveReturn(db, PERIOD);
    expect(after.box_a_net_24).toBe(0);
    expect(after.box_d_output).toBe(0);
    expect(before.box_a_net_24).toBeGreaterThan(0);
  });

  it('separates self-assessed reverse-charge VAT from VAT charged to customers', async () => {
    // Box D otherwise exceeds 24% of box A for no visible reason, which is exactly
    // the kind of number that makes an accountant distrust the return. RSK 10.01
    // gives reverse charge its own line.
    await issueInvoice();
    const docId = await attachedDocument();
    await ledger.withTransaction(c => expenses.createExpense(c, {
      supplierName: 'Microsoft Azure', supplierCountry: 'IE', supplierVatNumber: '',
      expenseDate: IN_PERIOD, amountGross: 50_000, accountCode: '6300',
      vatCode: 'reverse_charge_24', documentId: docId, createdBy: adminId,
    }));
    const d = await vat.deriveReturn(db, PERIOD);
    expect(d.output_vat_reverse_charge).toBe(12_000);          // 24% on top of 50,000
    expect(d.output_vat_domestic).toBe(24_000);                // the invoice's own VAT
    expect(d.box_d_output).toBe(36_000);
    // Domestic output VAT ties exactly to the declared turnover.
    expect(d.output_vat_domestic).toBe(Math.round(d.box_a_net_24 * 0.24));
    // And reverse charge nets to zero: the same amount appears in box E.
    expect(d.box_e_input).toBe(12_000);
  });

  it('excludes draft entries, which are not part of the books', async () => {
    await ledger.withTransaction(c => ledger.createDraft(c, {
      entryDate: IN_PERIOD, memo: 'not posted', createdBy: adminId,
      lines: [{ accountCode: '4110', credit: 1_000_000 }, { accountCode: '1100', debit: 1_000_000 }],
    }));
    const d = await vat.deriveReturn(db, PERIOD);
    expect(d.box_a_net_24).toBe(0);
  });

  it('refuses a malformed period rather than returning a silent zero', async () => {
    await expect(vat.deriveReturn(db, 'nonsense')).rejects.toMatchObject({ code: 'BAD_PERIOD' });
    await expect(vat.deriveReturn(db, '2026-P9')).rejects.toMatchObject({ code: 'BAD_PERIOD' });
  });
});

describe('preflight', () => {
  it('blocks on input VAT that cannot be substantiated', async () => {
    await ledger.withTransaction(c => expenses.createExpense(c, {
      supplierName: 'Sindri', supplierVatNumber: '33221', supplierCountry: 'IS',
      expenseDate: IN_PERIOD, amountGross: 24_800, accountCode: '6800',
      vatCode: 'input_24', createdBy: adminId, // no documentId
    }));
    const pre = await vat.preflight(db, PERIOD);
    const finding = pre.findings.find(f => f.code === 'UNSUBSTANTIATED_INPUT_VAT');
    expect(finding).toBeTruthy();
    expect(finding.level).toBe('blocker');
    expect(finding.amount).toBe(4_800);
    expect(pre.can_file).toBe(false);
  });

  it('blocks on a draft entry sitting in the period', async () => {
    await ledger.withTransaction(c => ledger.createDraft(c, {
      entryDate: IN_PERIOD, memo: 'draft', createdBy: adminId,
      lines: [{ accountCode: '4110', credit: 500 }, { accountCode: '1100', debit: 500 }],
    }));
    const pre = await vat.preflight(db, PERIOD);
    expect(pre.findings.find(f => f.code === 'UNPOSTED_DRAFTS').level).toBe('blocker');
    expect(pre.can_file).toBe(false);
  });

  it('blocks on a paid order that was never invoiced', async () => {
    // The turnover exists; the duty to declare it does not wait for the paperwork.
    await makePaidOrder();
    const pre = await vat.preflight(db, PERIOD);
    const finding = pre.findings.find(f => f.code === 'UNINVOICED_ORDERS');
    expect(finding.level).toBe('blocker');
    expect(pre.can_file).toBe(false);
  });

  it('warns that zero-rated turnover needs evidence, without blocking', async () => {
    // A GOOD shipped abroad, not a service: only exported goods are zero-rated here,
    // services stay at the standard rate because they are taxed where performed.
    await issueInvoice({ items: [{ productId: bookProductId, price: 11_100, qty: 1 }], country: 'DE' });
    const pre = await vat.preflight(db, PERIOD);
    const finding = pre.findings.find(f => f.code === 'ZERO_RATED_NEEDS_PROOF');
    expect(finding.level).toBe('warning');
    expect(pre.can_file).toBe(true);
  });

  it('passes cleanly on a tidy period', async () => {
    await issueInvoice();
    const docId = await attachedDocument();
    await ledger.withTransaction(c => expenses.createExpense(c, {
      supplierName: 'Nova', supplierVatNumber: '90304', supplierCountry: 'IS',
      expenseDate: IN_PERIOD, amountGross: 14_880, accountCode: '6400',
      vatCode: 'input_24', documentId: docId, createdBy: adminId,
    }));
    const pre = await vat.preflight(db, PERIOD);
    expect(pre.findings.filter(f => f.level === 'blocker')).toHaveLength(0);
    expect(pre.can_file).toBe(true);
  });

  it('flags an empty period as worth a second look', async () => {
    const pre = await vat.preflight(db, PERIOD);
    expect(pre.findings.find(f => f.code === 'NIL_RETURN')).toBeTruthy();
  });
});

describe('filing', () => {
  async function tidyPeriod() {
    await issueInvoice();
    const docId = await attachedDocument();
    await ledger.withTransaction(c => expenses.createExpense(c, {
      supplierName: 'Nova', supplierVatNumber: '90304', supplierCountry: 'IS',
      expenseDate: IN_PERIOD, amountGross: 14_880, accountCode: '6400',
      vatCode: 'input_24', documentId: docId, createdBy: adminId,
    }));
  }

  it('snapshots the figures, posts the settlement and locks the period', async () => {
    await tidyPeriod();
    const { vat_return: filed, journal_entry: entry } = await ledger.withTransaction(c =>
      vat.fileReturn(c, PERIOD, { filedBy: adminId, note: 'Fyrsta uppgjör' }));

    expect(Number(filed.box_f_payable)).toBe(Number(filed.box_d_output) - Number(filed.box_e_input));
    expect(entry).toBeTruthy();

    // The settlement clears both VAT accounts to zero and parks the net in 2290.
    expect(await accountBalanceIncludingSettlement('2200')).toBe(0);
    expect(await accountBalanceIncludingSettlement('1310')).toBe(0);
    expect(await accountBalanceIncludingSettlement('2290'))
      .toBe(-Number(filed.box_f_payable)); // a liability: credit balance

    const { rows } = await db.query(`SELECT status FROM fiscal_periods WHERE period = $1`, [PERIOD]);
    expect(rows[0].status).toBe('locked');
  });

  it('refuses to post into the period afterwards', async () => {
    await tidyPeriod();
    await ledger.withTransaction(c => vat.fileReturn(c, PERIOD, { filedBy: adminId }));
    await expect(ledger.withTransaction(c => ledger.postEntry(c, {
      entryDate: IN_PERIOD, memo: 'late', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '4110', credit: 1000 }, { accountCode: '1100', debit: 1000 }],
    }))).rejects.toThrow(/closed because its VSK return has been filed/i);
  });

  it('reproduces the figures AS FILED even after the books change', async () => {
    // The reason the snapshot exists at all. RSK 10.25 compares filed returns
    // against the accounts, so "what did we actually report" must survive.
    await tidyPeriod();
    await ledger.withTransaction(c => vat.fileReturn(c, PERIOD, { filedBy: adminId }));
    const asFiled = await vat.getFiledReturn(db, PERIOD);

    // A later period gains activity; the filed snapshot must not move.
    await issueInvoice({ paidAt: nextPeriodDate() });
    const again = await vat.getFiledReturn(db, PERIOD);
    expect(again.box_d_output).toBe(asFiled.box_d_output);
    expect(again.box_f_payable).toBe(asFiled.box_f_payable);
  });

  it('will not file the same period twice', async () => {
    await tidyPeriod();
    await ledger.withTransaction(c => vat.fileReturn(c, PERIOD, { filedBy: adminId }));
    await expect(ledger.withTransaction(c => vat.fileReturn(c, PERIOD, { filedBy: adminId })))
      .rejects.toMatchObject({ code: 'PREFLIGHT_BLOCKED' });
  });

  it('refuses to file over a blocker unless explicitly overridden', async () => {
    await issueInvoice();
    await ledger.withTransaction(c => expenses.createExpense(c, {
      supplierName: 'Sindri', supplierVatNumber: '33221', supplierCountry: 'IS',
      expenseDate: IN_PERIOD, amountGross: 24_800, accountCode: '6800',
      vatCode: 'input_24', createdBy: adminId, // no receipt
    }));
    await expect(ledger.withTransaction(c => vat.fileReturn(c, PERIOD, { filedBy: adminId })))
      .rejects.toMatchObject({ code: 'PREFLIGHT_BLOCKED', status: 409 });

    const { vat_return: filed } = await ledger.withTransaction(c => vat.fileReturn(c, PERIOD, {
      filedBy: adminId, overrideBlockers: true, note: 'Receipt promised by supplier',
    }));
    // The override and the findings are stored WITH the return, so a year later
    // "why was this filed with a blocker outstanding" is answerable.
    expect(filed.preflight.overridden).toBe(true);
    expect(filed.preflight.findings.some(f => f.code === 'UNSUBSTANTIATED_INPUT_VAT')).toBe(true);
  });

  it('files a nil return without trying to post an empty settlement entry', async () => {
    const { vat_return: filed, journal_entry: entry } = await ledger.withTransaction(c =>
      vat.fileReturn(c, PERIOD, { filedBy: adminId, overrideBlockers: true, note: 'Nil' }));
    expect(Number(filed.box_f_payable)).toBe(0);
    expect(entry).toBeNull();
  });

  it('cannot be edited or deleted once filed', async () => {
    await tidyPeriod();
    await ledger.withTransaction(c => vat.fileReturn(c, PERIOD, { filedBy: adminId }));
    await expect(db.query(`UPDATE vat_returns SET box_f_payable = 1 WHERE period = $1`, [PERIOD]))
      .rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM vat_returns WHERE period = $1`, [PERIOD]))
      .rejects.toThrow(/append-only/);
  });
});

// Balance WITHIN the claimed period, settlement entry included. Scoped to the
// period on purpose: other tests leave balances in their own periods, and the
// settlement only ever clears the period it settles.
async function accountBalanceIncludingSettlement(code) {
  const { starts_on: from, ends_on: to } =
    require('../../server/utils/vatPeriod').periodBounds(PERIOD);
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::bigint AS bal
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE la.code = $1 AND je.posted_at IS NOT NULL
        AND je.entry_date >= $2::date AND je.entry_date <= $3::date`,
    [code, from, to]
  );
  return Number(rows[0].bal);
}

describe('re-opening a period filed by mistake', () => {
  it('discards the snapshot, unlocks, and records what was thrown away', async () => {
    await issueInvoice();
    const { vat_return: filed } = await ledger.withTransaction(c =>
      vat.fileReturn(c, PERIOD, { filedBy: adminId }));
    const payable = Number(filed.box_f_payable);

    await ledger.withTransaction(c => vat.unlockPeriod(c, PERIOD, {
      actorId: adminId, reason: 'Filed before the figures were checked',
    }));

    expect(await vat.getFiledReturn(db, PERIOD)).toBeNull();
    const { rows } = await db.query(`SELECT status FROM fiscal_periods WHERE period = $1`, [PERIOD]);
    expect(rows[0].status).toBe('open');

    // The discarded figures survive in the audit log — that is the whole point of
    // allowing this rather than making people edit the database by hand.
    const { rows: log } = await db.query(
      `SELECT summary FROM books_audit_log WHERE action = 'period.unlocked' ORDER BY created_at DESC LIMIT 1`
    );
    expect(log[0].summary.discarded_return.payable).toBe(payable);
    expect(log[0].summary.reason).toMatch(/before the figures/);
  });

  it('reverses the settlement entry, so no VSK liability is left for an unfiled period', async () => {
    // Filing clears the VAT accounts into 2290. Deleting the return without undoing
    // that leaves a liability on the balance sheet for a period that is no longer
    // filed — and the NEXT filing would post a second settlement on top, double
    // counting the whole period.
    await issueInvoice();
    await ledger.withTransaction(c => vat.fileReturn(c, PERIOD, { filedBy: adminId }));
    const settled = await accountBalanceIncludingSettlement('2290');
    expect(settled).not.toBe(0);

    const res = await ledger.withTransaction(c => vat.unlockPeriod(c, PERIOD, {
      actorId: adminId, reason: 'filed too early',
    }));
    expect(res.settlement_reversal).toBeTruthy();

    // Within the period, 2290 nets back to zero — the reversal is dated on the
    // settlement's own date, so the period is left exactly as it was before filing.
    expect(await accountBalanceIncludingSettlement('2290')).toBe(0);
    // And the VAT accounts carry their original balances again.
    expect(await accountBalanceIncludingSettlement('2200')).not.toBe(0);

    // Re-filing produces exactly ONE net settlement, not a second stacked on top.
    await ledger.withTransaction(c => vat.fileReturn(c, PERIOD, { filedBy: adminId }));
    const refiled = await vat.getFiledReturn(db, PERIOD);
    expect(await accountBalanceIncludingSettlement('2290')).toBe(-refiled.box_f_payable);
    expect(await accountBalanceIncludingSettlement('2200')).toBe(0);
  });

  it('demands a reason', async () => {
    await issueInvoice();
    await ledger.withTransaction(c => vat.fileReturn(c, PERIOD, { filedBy: adminId }));
    await expect(ledger.withTransaction(c => vat.unlockPeriod(c, PERIOD, { actorId: adminId })))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('refuses to unlock a period that is not locked', async () => {
    await expect(ledger.withTransaction(c => vat.unlockPeriod(c, PERIOD, {
      actorId: adminId, reason: 'nothing to undo',
    }))).rejects.toMatchObject({ code: 'NOT_LOCKED' });
  });

  it('lets the period be re-filed afterwards, with the corrected figures', async () => {
    await issueInvoice();
    await ledger.withTransaction(c => vat.fileReturn(c, PERIOD, { filedBy: adminId }));
    await ledger.withTransaction(c => vat.unlockPeriod(c, PERIOD, {
      actorId: adminId, reason: 'missing an invoice',
    }));
    // The forgotten invoice can now be issued into the re-opened period.
    await issueInvoice();
    const { vat_return: refiled } = await ledger.withTransaction(c =>
      vat.fileReturn(c, PERIOD, { filedBy: adminId }));
    expect(Number(refiled.box_a_net_24)).toBe(200_000); // both invoices now
  });
});

describe('locking', () => {
  it('refuses to lock a period twice, rather than silently doing nothing', async () => {
    await ledger.withTransaction(c => ledger.lockPeriod(c, PERIOD, { lockedBy: adminId }));
    await expect(ledger.withTransaction(c => ledger.lockPeriod(c, PERIOD, { lockedBy: adminId })))
      .rejects.toMatchObject({ code: 'ALREADY_LOCKED' });
  });

  it('refuses to lock a period that does not exist', async () => {
    await expect(ledger.withTransaction(c => ledger.lockPeriod(c, '1999-P1', { lockedBy: adminId })))
      .rejects.toMatchObject({ code: 'NO_SUCH_PERIOD' });
  });
});
