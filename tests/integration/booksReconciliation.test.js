// Bank and card reconciliation.
//
// The property under test throughout: after a correct sync, the CLEARING account
// holds exactly what the card processor is still holding, and the BANK account holds
// what the bank says. The system this replaces debited the bank at checkout, which
// made both figures wrong and the reconciliation impossible.
const db = require('../../server/config/database');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const recon = require('../../server/services/bookkeeping/reconciliationService');
const invoices = require('../../server/services/bookkeeping/invoiceService');
const Setting = require('../../server/models/Setting');
const { createTestAdminUser, reseedBooksReferenceData } = require('../helpers');

let adminId;
let productId;
const VALID_KENNITALA = '1203894599';

async function balance(code) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::bigint AS bal
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE la.code = $1 AND je.posted_at IS NOT NULL`,
    [code]
  );
  return Number(rows[0].bal);
}

async function issuedInvoice(amount = 124_000) {
  const { rows } = await db.query(
    `INSERT INTO orders (order_number, currency, subtotal, shipping, total, status,
       payment_status, shipping_method, shipping_address, guest_email, guest_name, paid_at)
     VALUES ($1,'ISK',$2,0,$2,'paid','paid','local_pickup',$3::jsonb,
             'rec@example.is','Recon Test', NOW())
     RETURNING id`,
    [`HP-REC-${Math.random().toString(36).slice(2, 9)}`, amount,
      JSON.stringify({ name: 'Recon Test', line1: 'Gata 1', postal: '101', city: 'Reykjavík', country_code: 'IS' })]
  );
  await db.query(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot,
       product_price_snapshot, quantity, currency)
     VALUES ($1,$2,'Vefsíða',$3,1,'ISK')`,
    [rows[0].id, productId, amount]
  );
  const { invoice } = await ledger.withTransaction(c =>
    invoices.createFromOrder(c, rows[0].id, { createdBy: adminId }));
  return invoice;
}

// Dated TODAY by default: the fixture invoices are issued now, and money cannot be
// recorded as arriving before the invoice existed (invoiceService enforces that).
const TODAY = new Date().toISOString().slice(0, 10);

const bankRow = (over = {}) => ({
  booked_on: TODAY,
  value_on: TODAY,
  description: 'Millifærsla',
  counterparty: 'Recon Test',
  reference: null,
  amount: 124_000,
  balance_after: 500_000,
  ...over,
});

beforeAll(async () => {
  await reseedBooksReferenceData();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();
  const { rows } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, is_bookable, vat_rate)
     VALUES ('rec-vefur','Vefsíða','',124000,82000,999,'REC-WEB',TRUE,24)
     ON CONFLICT (slug) DO UPDATE SET vat_rate = 24 RETURNING id`
  );
  productId = rows[0].id;
  await Setting.updateBookkeepingSettings({
    seller_name: 'Smiley Software ehf.',
    seller_kennitala: VALID_KENNITALA,
    seller_vat_number: '148820',
    payment_terms_days: 14,
  });
});

afterAll(async () => { await db.pool.end(); });

beforeEach(async () => {
  await db.query(`UPDATE fiscal_periods SET status='open', locked_at=NULL, locked_by=NULL`);
  await db.query(`DELETE FROM bank_transactions`);
  await db.query(`DELETE FROM stripe_transactions`);
});

describe('parsing an Icelandic bank CSV', () => {
  it('handles semicolons, dd.mm.yyyy and the decimal comma', () => {
    // What a locale-aware Excel actually writes in Iceland. Splitting this on `[,;]`
    // would turn "1.240.000,00" into two cells — the same class of bug that silently
    // truncated FX rates in the earlier importer.
    const csv = [
      'Dagsetning;Gildisdagur;Skýring;Viðskiptaaðili;Tilvísun;Fjárhæð;Staða',
      '07.08.2026;07.08.2026;Millifærsla;Vest ehf.;1001;1.240.000,00;3.482.910,00',
      '05.08.2026;05.08.2026;Þjónustugjald;Landsbankinn;;-1.850,00;2.242.910,00',
    ].join('\n');
    const { rows, delimiter } = recon.parseBankCsv(csv);
    expect(delimiter).toBe(';');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ booked_on: '2026-08-07', amount: 1_240_000, balance_after: 3_482_910 });
    expect(rows[1]).toMatchObject({ booked_on: '2026-08-05', amount: -1_850 });
  });

  it('handles a comma-separated ISO export too', () => {
    const { rows } = recon.parseBankCsv('date,description,amount\n2026-08-07,Payment,124000');
    expect(rows).toEqual([expect.objectContaining({ booked_on: '2026-08-07', amount: 124_000 })]);
  });

  it('strips the UTF-8 BOM Excel prepends', () => {
    const csv = `${String.fromCharCode(0xFEFF)}Dagsetning;Skýring;Fjárhæð\n07.08.2026;Test;1.000,00`;
    expect(recon.parseBankCsv(csv).rows).toHaveLength(1);
  });

  it('reports unreadable lines instead of dropping them silently', () => {
    const csv = [
      'Dagsetning;Skýring;Fjárhæð',
      '07.08.2026;Good;1.000,00',
      'not-a-date;Bad;500',
      '08.08.2026;No amount;',
    ].join('\n');
    const { rows, problems } = recon.parseBankCsv(csv);
    expect(rows).toHaveLength(1);
    expect(problems.map(p => p.reason)).toEqual(['unreadableDate', 'unreadableAmount']);
  });

  it('refuses a file with no recognisable date and amount columns', () => {
    expect(() => recon.parseBankCsv('foo;bar\n1;2')).toThrow(/date and amount/i);
  });

  it('refuses an empty file', () => {
    expect(() => recon.parseBankCsv('')).toThrow(/empty/i);
  });
});

describe('importing a statement', () => {
  it('is idempotent, so an overlapping re-download does not double the lines', async () => {
    const rows = [bankRow(), bankRow({ amount: -1_850, description: 'Gjald', balance_after: 498_150 })];
    const first = await ledger.withTransaction(c =>
      recon.importBankRows(c, { rows, createdBy: adminId }));
    expect(first).toMatchObject({ imported: 2, duplicates: 0 });

    const second = await ledger.withTransaction(c =>
      recon.importBankRows(c, { rows, createdBy: adminId }));
    expect(second).toMatchObject({ imported: 0, duplicates: 2 });

    const { rows: count } = await db.query(`SELECT COUNT(*)::int AS n FROM bank_transactions`);
    expect(count[0].n).toBe(2);
  });

  it('refuses an unknown account rather than importing into nowhere', async () => {
    await expect(ledger.withTransaction(c =>
      recon.importBankRows(c, { accountCode: '9999', rows: [bankRow()], createdBy: adminId })))
      .rejects.toThrow();
  });
});

describe('matching a receipt to an invoice', () => {
  it('ranks an exact amount + invoice number reference as the best suggestion', async () => {
    const invoice = await issuedInvoice(124_000);
    await ledger.withTransaction(c => recon.importBankRows(c, {
      rows: [bankRow({ reference: String(invoice.invoice_number) })], createdBy: adminId,
    }));
    const { rows } = await db.query(`SELECT id FROM bank_transactions LIMIT 1`);
    const { suggestions } = await recon.suggestMatches(db, rows[0].id);
    expect(suggestions[0]).toMatchObject({
      kind: 'invoice',
      invoice_number: Number(invoice.invoice_number),
      confidence: 'exact',
    });
  });

  it('records the payment through the invoice service, so AR posts identically', async () => {
    const invoice = await issuedInvoice(124_000);
    await ledger.withTransaction(c => recon.importBankRows(c, {
      rows: [bankRow()], createdBy: adminId,
    }));
    const { rows } = await db.query(`SELECT id FROM bank_transactions LIMIT 1`);

    const bankBefore = await balance('1900');
    await ledger.withTransaction(c => recon.resolveBankTransaction(c, rows[0].id, {
      kind: 'invoice', invoiceId: invoice.id, actorId: adminId,
    }));

    // Dr bank / Cr AR, exactly as a hand-entered payment.
    expect(await balance('1900')).toBe(bankBefore + 124_000);
    const settled = await invoices.findById(db, invoice.id);
    expect(Number(settled.amount_paid)).toBe(124_000);

    const { rows: after } = await db.query(
      `SELECT match_state, matched_invoice_id FROM bank_transactions WHERE id = $1`, [rows[0].id]);
    expect(after[0]).toMatchObject({ match_state: 'matched', matched_invoice_id: invoice.id });
  });

  it('is idempotent per bank line, so re-resolving cannot double-book', async () => {
    const invoice = await issuedInvoice(124_000);
    await ledger.withTransaction(c => recon.importBankRows(c, { rows: [bankRow()], createdBy: adminId }));
    const { rows } = await db.query(`SELECT id FROM bank_transactions LIMIT 1`);
    await ledger.withTransaction(c => recon.resolveBankTransaction(c, rows[0].id, {
      kind: 'invoice', invoiceId: invoice.id, actorId: adminId,
    }));
    // Second attempt is refused on state, and the invoice is untouched.
    await expect(ledger.withTransaction(c => recon.resolveBankTransaction(c, rows[0].id, {
      kind: 'invoice', invoiceId: invoice.id, actorId: adminId,
    }))).rejects.toMatchObject({ code: 'ALREADY_RESOLVED' });
    expect(Number((await invoices.findById(db, invoice.id)).amount_paid)).toBe(124_000);
  });

  it('refuses to treat a money-OUT line as a customer receipt', async () => {
    const invoice = await issuedInvoice();
    await ledger.withTransaction(c => recon.importBankRows(c, {
      rows: [bankRow({ amount: -50_000 })], createdBy: adminId,
    }));
    const { rows } = await db.query(`SELECT id FROM bank_transactions LIMIT 1`);
    await expect(ledger.withTransaction(c => recon.resolveBankTransaction(c, rows[0].id, {
      kind: 'invoice', invoiceId: invoice.id, actorId: adminId,
    }))).rejects.toMatchObject({ code: 'WRONG_DIRECTION' });
  });
});

describe('explaining a line', () => {
  it('posts money out against the chosen account', async () => {
    await ledger.withTransaction(c => recon.importBankRows(c, {
      rows: [bankRow({ amount: -186_000, description: 'Regus' })], createdBy: adminId,
    }));
    const { rows } = await db.query(`SELECT id FROM bank_transactions LIMIT 1`);
    const before = await balance('1900');
    const rentBefore = await balance('6200');

    await ledger.withTransaction(c => recon.resolveBankTransaction(c, rows[0].id, {
      kind: 'explained', accountCode: '6200', reason: 'Skrifstofuleiga', actorId: adminId,
    }));
    // Dr rent / Cr bank.
    expect(await balance('6200') - rentBefore).toBe(186_000);
    expect(await balance('1900') - before).toBe(-186_000);
  });

  it('parks an unidentifiable line in suspense rather than absorbing it', async () => {
    await ledger.withTransaction(c => recon.importBankRows(c, {
      rows: [bankRow({ amount: 9_999, description: 'Óþekkt innborgun' })], createdBy: adminId,
    }));
    const { rows } = await db.query(`SELECT id FROM bank_transactions LIMIT 1`);
    const suspenseBefore = await balance('1990');
    await ledger.withTransaction(c => recon.resolveBankTransaction(c, rows[0].id, {
      kind: 'suspense', reason: 'Nobody knows who sent this', actorId: adminId,
    }));
    // A suspense CREDIT for money in: the balance is visible and will be chased.
    expect(await balance('1990') - suspenseBefore).toBe(-9_999);
  });

  it('demands an explanation, because an unexplained line is the signal', async () => {
    await ledger.withTransaction(c => recon.importBankRows(c, { rows: [bankRow()], createdBy: adminId }));
    const { rows } = await db.query(`SELECT id FROM bank_transactions LIMIT 1`);
    await expect(ledger.withTransaction(c => recon.resolveBankTransaction(c, rows[0].id, {
      kind: 'explained', accountCode: '6800', reason: '   ', actorId: adminId,
    }))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('ignores a line with a recorded reason, posting nothing', async () => {
    await ledger.withTransaction(c => recon.importBankRows(c, {
      rows: [bankRow({ amount: 1, description: 'Vaxtaprófun' })], createdBy: adminId,
    }));
    const { rows } = await db.query(`SELECT id FROM bank_transactions LIMIT 1`);
    const before = await balance('1900');
    const res = await ledger.withTransaction(c => recon.resolveBankTransaction(c, rows[0].id, {
      kind: 'ignore', reason: 'Bank test deposit, not ours', actorId: adminId,
    }));
    expect(res.journal_entry).toBeNull();
    expect(await balance('1900')).toBe(before);
  });
});

describe('Stripe settlement', () => {
  // Stripe's own shape, trimmed to the fields the sync reads. Passed in rather than
  // fetched so the posting logic is testable without network access.
  const bt = (over = {}) => ({
    id: `txn_${Math.random().toString(36).slice(2, 10)}`,
    type: 'charge',
    currency: 'isk',
    amount: 124_000,
    fee: 3_600,
    net: 120_400,
    created: Math.floor(Date.parse('2026-07-15T12:00:00Z') / 1000),
    ...over,
  });

  it('posts the fee against the clearing account, not the bank', async () => {
    // The charge itself already put the gross in clearing when the payment was
    // recorded. Only the fee is new information — booking the gross again doubles it.
    //
    // Deltas throughout this file: journal history is append-only, and other suites
    // legitimately post to these same accounts (booksExpenses books Stripe fees to
    // 6500), so an absolute balance is not a stable assertion.
    const before = {
      clearing: await balance('1400'), bank: await balance('1900'), fee: await balance('6500'),
    };
    await ledger.withTransaction(c =>
      recon.syncStripeTransactions(c, [bt()], { actorId: adminId }));

    expect(await balance('6500') - before.fee).toBe(3_600);        // Dr fee
    expect(await balance('1400') - before.clearing).toBe(-3_600);  // Cr clearing
    expect(await balance('1900') - before.bank).toBe(0);           // bank untouched
  });

  it('sweeps the clearing account into the bank on payout', async () => {
    const before = { clearing: await balance('1400'), bank: await balance('1900') };
    await ledger.withTransaction(c => recon.syncStripeTransactions(c, [
      bt({ type: 'payout', amount: -120_400, fee: 0, net: -120_400, payout: 'po_1' }),
    ], { actorId: adminId }));

    expect(await balance('1900') - before.bank).toBe(120_400);
    expect(await balance('1400') - before.clearing).toBe(-120_400);
  });

  it('leaves the clearing account holding exactly what Stripe still holds', async () => {
    // The whole point. A customer pays 124,000 by card; Stripe keeps 3,600 and pays
    // out 120,400. Afterwards clearing must be zero — anything else means card money
    // is unaccounted for.
    // Deltas, not absolutes: journal history is append-only, so earlier tests in this
    // file have legitimately left balances on these accounts.
    const before = {
      clearing: await balance('1400'), fee: await balance('6500'), bank: await balance('1900'),
    };

    const invoice = await issuedInvoice(124_000);
    await ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 124_000, method: 'stripe', receivedAt: TODAY,
      idempotencyKey: `stripe-${invoice.id}`, createdBy: adminId,
    }));
    // Stripe is holding all of it — nothing has reached the bank.
    expect(await balance('1400') - before.clearing).toBe(124_000);
    expect(await balance('1900') - before.bank).toBe(0);

    await ledger.withTransaction(c => recon.syncStripeTransactions(c, [
      bt({ id: 'txn_fee_1' }),
      bt({ id: 'txn_po_1', type: 'payout', amount: -120_400, fee: 0, net: -120_400, payout: 'po_1' }),
    ], { actorId: adminId }));

    // Fee out, payout swept: clearing is back where it started, so nothing of this
    // sale is left unaccounted for.
    expect(await balance('1400') - before.clearing).toBe(0);
    expect(await balance('6500') - before.fee).toBe(3_600);
    expect(await balance('1900') - before.bank).toBe(120_400);
  });

  it('is idempotent by Stripe id, so a re-sync posts nothing twice', async () => {
    const one = bt({ id: 'txn_dup' });
    await ledger.withTransaction(c => recon.syncStripeTransactions(c, [one], { actorId: adminId }));
    const feeAfterFirst = await balance('6500');
    const again = await ledger.withTransaction(c =>
      recon.syncStripeTransactions(c, [one], { actorId: adminId }));
    expect(again).toMatchObject({ posted: 0, skipped: 1 });
    expect(await balance('6500')).toBe(feeAfterFirst);
  });

  it('records a foreign-currency settlement WITHOUT posting it', async () => {
    // It needs an FX rate and a decision about where the difference goes. Recorded so
    // it is visible, not posted so it cannot be silently wrong.
    const before = await balance('6500');
    const res = await ledger.withTransaction(c => recon.syncStripeTransactions(c, [
      bt({ id: 'txn_eur', currency: 'eur', amount: 8_900, fee: 300, net: 8_600 }),
    ], { actorId: adminId }));
    expect(res).toMatchObject({ posted: 0, skipped: 1 });
    expect(await balance('6500')).toBe(before);
    const { rows } = await db.query(
      `SELECT currency, journal_entry_id FROM stripe_transactions WHERE id = 'txn_eur'`);
    expect(rows[0]).toMatchObject({ currency: 'EUR', journal_entry_id: null });
  });
});

describe('reconciliation status', () => {
  it('reports the difference between the ledger and the statement', async () => {
    await ledger.withTransaction(c => recon.importBankRows(c, {
      rows: [bankRow({ amount: 124_000, balance_after: 124_000 })], createdBy: adminId,
    }));
    const status = await recon.reconciliationStatus(db);
    expect(status.statement_balance).toBe(124_000);
    // Nothing posted to the bank yet, so the ledger and the statement disagree —
    // which is exactly the signal the screen exists to surface.
    expect(status.difference).toBe(status.ledger_balance - 124_000);
    expect(status.unmatched_count).toBe(1);
    expect(status.unmatched_total).toBe(124_000);
  });

  it('shows nothing outstanding once every line is resolved', async () => {
    await ledger.withTransaction(c => recon.importBankRows(c, {
      rows: [bankRow({ amount: -1_850, description: 'Gjald' })], createdBy: adminId,
    }));
    const { rows } = await db.query(`SELECT id FROM bank_transactions LIMIT 1`);
    await ledger.withTransaction(c => recon.resolveBankTransaction(c, rows[0].id, {
      kind: 'explained', accountCode: '6500', reason: 'Bankagjald', actorId: adminId,
    }));
    const status = await recon.reconciliationStatus(db);
    expect(status.unmatched_count).toBe(0);
  });
});
