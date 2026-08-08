// Counter sales.
//
// The property this file exists to pin: shop prices in this system are VAT-INCLUSIVE, so
// a counter sale EXTRACTS the VAT from the price the customer paid rather than adding it
// on top. The system this replaces added VAT to the shelf price, which overstated both
// revenue and takings — and the till never reconciled against the drawer, which is how
// it was eventually noticed.
//
// The other property: a counter sale does not touch receivables. The sale and the money
// are one event, so the entry debits cash (or card clearing) directly. A POS sale that
// passed through 1100 would appear in the aging report as a debt nobody owed.
const db = require('../../server/config/database');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const pos = require('../../server/services/bookkeeping/posService');
const invoices = require('../../server/services/bookkeeping/invoiceService');
const Setting = require('../../server/models/Setting');
const { createTestAdminUser, reseedBooksReferenceData } = require('../helpers');

let adminId;
let productId;      // 12.400 kr. gross at 24%
let bookId;         // 2.220 kr. gross at 11%
let serviceId;      // a bookable service at 24%
const VALID_KENNITALA = '1203894599';

// Its own year, clear of every other books suite (2019 reports, 2020 payroll,
// 2021-2025 VSK, 2026 the seed). Dated in the past because a receipt is evidence that
// money changed hands, and posService refuses a future date for exactly that reason.
const DAY = '2018-06-15';
const NEXT_DAY = '2018-06-16';

async function accountMovement(code, date) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::bigint AS bal
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE la.code = $1 AND je.posted_at IS NOT NULL AND je.entry_date = $2::date`,
    [code, date]
  );
  return Number(rows[0].bal);
}

const ring = (opts) => ledger.withTransaction(c => pos.sell(c, {
  soldAt: DAY, createdBy: adminId, ...opts,
}));

beforeAll(async () => {
  await reseedBooksReferenceData();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();

  const { rows: p } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, is_bookable, vat_rate)
     VALUES ('pos-hilla','Eikarhilla','',12400,80,99,'POS-1',FALSE,24)
     ON CONFLICT (slug) DO UPDATE SET price_isk = 12400, vat_rate = 24 RETURNING id`
  );
  productId = p[0].id;
  const { rows: b } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, is_bookable, vat_rate)
     VALUES ('pos-bok','Handbók um smíðar','',2220,15,99,'POS-2',FALSE,11)
     ON CONFLICT (slug) DO UPDATE SET price_isk = 2220, vat_rate = 11 RETURNING id`
  );
  bookId = b[0].id;
  const { rows: s } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, is_bookable, vat_rate)
     VALUES ('pos-thjonusta','Klukkutími í vinnu','',15500,100,99,'POS-3',TRUE,24)
     ON CONFLICT (slug) DO UPDATE SET price_isk = 15500, vat_rate = 24 RETURNING id`
  );
  serviceId = s[0].id;

  await Setting.updateBookkeepingSettings({
    seller_name: 'Smiley Software ehf.',
    seller_kennitala: VALID_KENNITALA,
    seller_vat_number: '148820',
    payment_terms_days: 14,
  });
  for (const d of [DAY, NEXT_DAY]) {
    await ledger.withTransaction(c => ledger.ensureFiscalPeriod(c, d));
  }
});

afterAll(async () => { await db.pool.end(); });

describe('VAT is extracted from the price, never added to it', () => {
  it('splits a 24% shelf price out of the gross', async () => {
    // 12.400 gross at 24% → net 10.000, VAT 2.400. Adding VAT to the shelf price would
    // give 15.376 and a receipt for money the customer did not hand over.
    const { totals, lines } = await ring({ lines: [{ productId }], tender: 'cash' });
    expect(totals.total_gross).toBe(12_400);
    expect(totals.subtotal_net).toBe(10_000);
    expect(totals.vat_total).toBe(2_400);
    expect(lines[0].line_gross).toBe(12_400);
    expect(lines[0].unit_price_gross).toBe(12_400);
  });

  it('uses the reduced rate for something on the 11% list', async () => {
    // 2.220 at 11% → net 2.000, VAT 220. Charging 24% on a book is the wrong tax, not a
    // rounding preference.
    const { totals } = await ring({ lines: [{ productId: bookId }], tender: 'cash' });
    expect(totals.subtotal_net).toBe(2_000);
    expect(totals.vat_total).toBe(220);
    expect(totals.by_rate).toEqual([{ rate: 11, net: 2_000, vat: 220, gross: 2_220 }]);
  });

  it('keeps the rates apart on a mixed basket', async () => {
    // The case a single blended rate gets wrong. The VSK return needs box A and box B
    // separately, so the split has to survive all the way from the till.
    const { totals } = await ring({
      lines: [{ productId }, { productId: bookId }], tender: 'card',
    });
    expect(totals.total_gross).toBe(12_400 + 2_220);
    expect(totals.by_rate).toEqual([
      { rate: 24, net: 10_000, vat: 2_400, gross: 12_400 },
      { rate: 11, net: 2_000, vat: 220, gross: 2_220 },
    ]);
    expect(totals.vat_total).toBe(2_620);
  });

  it('multiplies before splitting, so the VAT is right on a quantity', async () => {
    // Splitting per unit and multiplying the result can differ by a króna per unit from
    // splitting the line total. The line total is what the customer paid.
    const { totals } = await ring({
      lines: [{ productId: bookId, quantity: 7 }], tender: 'cash',
    });
    expect(totals.total_gross).toBe(2_220 * 7);
    const { vat, net } = require('../../server/utils/vat').splitVatInclusive(2_220 * 7, 11);
    expect(totals.vat_total).toBe(vat);
    expect(totals.subtotal_net).toBe(net);
  });
});

describe('the journal entry', () => {
  it('debits cash and never touches receivables', async () => {
    const before = await accountMovement('1910', DAY);
    const beforeAr = await accountMovement('1100', DAY);
    await ring({ lines: [{ productId }], tender: 'cash' });

    // Cash up by the whole gross, including the VAT — the customer handed over all of it.
    expect(await accountMovement('1910', DAY)).toBe(before + 12_400);
    // Receivables untouched. This is the difference between a till and an invoice.
    expect(await accountMovement('1100', DAY)).toBe(beforeAr);
  });

  it('debits the card clearing account, not the bank, for a card sale', async () => {
    // The money is with the acquirer until the payout lands, so debiting 1900 would
    // claim cash in the bank that is not there yet — and the reconciliation would then
    // have nothing to match the payout against.
    const beforeClearing = await accountMovement('1400', DAY);
    const beforeBank = await accountMovement('1900', DAY);
    await ring({ lines: [{ productId }], tender: 'card' });
    expect(await accountMovement('1400', DAY)).toBe(beforeClearing + 12_400);
    expect(await accountMovement('1900', DAY)).toBe(beforeBank);
  });

  it('balances, with revenue net and VAT on their own legs', async () => {
    const { entry, totals } = await ring({ lines: [{ productId }], tender: 'cash' });
    const { rows } = await db.query(
      `SELECT la.code, jl.debit, jl.credit, jl.vat_rate
         FROM journal_lines jl JOIN ledger_accounts la ON la.id = jl.account_id
        WHERE jl.entry_id = $1 ORDER BY jl.sort_order`,
      [entry.id]
    );
    const debit = rows.reduce((a, r) => a + Number(r.debit), 0);
    const credit = rows.reduce((a, r) => a + Number(r.credit), 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(totals.total_gross);

    const byCode = Object.fromEntries(rows.map(r => [r.code, r]));
    expect(Number(byCode['1910'].debit)).toBe(12_400);
    expect(Number(byCode['4100'].credit)).toBe(10_000);   // goods at 24%
    expect(Number(byCode['2200'].credit)).toBe(2_400);    // output VAT 24%
    // The rate is stamped on the VAT leg, which is what lets the VSK return derive
    // itself from the ledger rather than from a second set of totals.
    expect(byCode['2200'].vat_rate).toBe(24);
  });

  it('books a service to the service revenue account', async () => {
    const { entry } = await ring({ lines: [{ productId: serviceId }], tender: 'cash' });
    const { rows } = await db.query(
      `SELECT la.code FROM journal_lines jl JOIN ledger_accounts la ON la.id = jl.account_id
        WHERE jl.entry_id = $1 AND la.type = 'revenue'`,
      [entry.id]
    );
    expect(rows.map(r => r.code)).toEqual(['4110']);
  });

  it('is tagged as a POS entry, pointing at its receipt', async () => {
    const { entry, receipt } = await ring({ lines: [{ productId }], tender: 'cash' });
    const { rows } = await db.query(
      `SELECT source_type, source_id FROM journal_entries WHERE id = $1`, [entry.id]
    );
    expect(rows[0]).toEqual({ source_type: 'pos', source_id: receipt.id });
  });
});

describe('the receipt', () => {
  it('lands in the sales ledger as a receipt-series document, paid in full', async () => {
    const { receipt } = await ring({ lines: [{ productId }], tender: 'cash' });
    expect(receipt.series).toBe('receipt');
    expect(Number(receipt.total_gross)).toBe(12_400);
    // Paid at the counter, so nothing is outstanding the moment it exists.
    expect(Number(receipt.amount_paid)).toBe(12_400);
    expect(invoices.outstandingOf(receipt)).toBe(0);
    expect(receipt.status).toBe('issued');
  });

  it('takes numbers from the receipt counter, gaplessly, not from the invoice series', async () => {
    // Reglugerð 505/2013 gr. 16 wants a gapless series per document type. Sharing the
    // invoice counter would put gaps in both.
    const a = await ring({ lines: [{ productId }], tender: 'cash' });
    const b = await ring({ lines: [{ productId }], tender: 'cash' });
    expect(b.receipt.invoice_number).toBe(a.receipt.invoice_number + 1);

    const { rows } = await db.query(
      `SELECT MAX(invoice_number)::bigint AS n FROM invoices WHERE series = 'invoice'`
    );
    // The invoice series is in the 1000s; receipts start at 1. If they shared a counter
    // this would not hold.
    expect(a.receipt.invoice_number).toBeLessThan(Number(rows[0].n || 1001));
  });

  it('carries the walk-in label when nobody gives a name', async () => {
    const { receipt } = await ring({ lines: [{ productId }], tender: 'cash' });
    expect(receipt.customer_name).toBe(pos.WALK_IN);
    expect(receipt.customer_kennitala).toBeNull();
  });

  it('takes a name and kennitala when a business buyer asks', async () => {
    // A business buyer needs their kennitala on the document to deduct the input VAT.
    const { receipt } = await ring({
      lines: [{ productId }], tender: 'card',
      customerName: 'Verktakar ehf.', customerKennitala: VALID_KENNITALA,
    });
    expect(receipt.customer_name).toBe('Verktakar ehf.');
    expect(receipt.customer_kennitala).toBe(VALID_KENNITALA);
  });

  it('records the tender without posting a second cash leg', async () => {
    // The payment row exists so reconciliation and the audit trail know HOW it was paid.
    // If it also posted an entry, the day's takings would be double.
    const before = await accountMovement('1910', DAY);
    const { receipt, totals } = await ring({ lines: [{ productId }], tender: 'cash' });
    expect(await accountMovement('1910', DAY)).toBe(before + totals.total_gross);

    const { rows } = await db.query(
      `SELECT method, amount, direction FROM payments WHERE invoice_id = $1`, [receipt.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'cash', direction: 'in' });
    expect(Number(rows[0].amount)).toBe(12_400);
  });

  it('cannot be altered once rung up', async () => {
    // Same append-only rule as an invoice, enforced by the same trigger: a receipt is a
    // statutory sales document from the moment it exists.
    const { receipt } = await ring({ lines: [{ productId }], tender: 'cash' });
    await expect(db.query(`DELETE FROM invoices WHERE id = $1`, [receipt.id]))
      .rejects.toThrow();
    await expect(db.query(
      `UPDATE invoices SET total_gross = 1 WHERE id = $1`, [receipt.id]
    )).rejects.toThrow();
  });

  it('is corrected by a credit note, like any other sale', async () => {
    // A wrongly-rung sale is not deleted. The credit note reverses the revenue and the
    // output VAT, and the refund (if the customer got their money back) is separate.
    const { receipt } = await ring({ lines: [{ productId }], tender: 'cash' });
    const { invoice: after } = await ledger.withTransaction(c => invoices.issueCreditNote(c, receipt.id, {
      amountGross: 12_400, reason: 'Vitlaus vara skönnuð', createdBy: adminId, issuedAt: DAY,
    }));
    expect(Number(after.amount_credited)).toBe(12_400);
    const { rows } = await db.query(
      `SELECT amount_credited FROM invoices WHERE id = $1`, [receipt.id]
    );
    expect(Number(rows[0].amount_credited)).toBe(12_400);
  });
});

describe('refusals', () => {
  it('refuses a bank transfer at the till', async () => {
    // Not pedantry: a transfer needs to be matched against a bank line later, and a
    // receipt-series document with no invoice to match makes that impossible.
    await expect(ring({ lines: [{ productId }], tender: 'bank_transfer' }))
      .rejects.toMatchObject({ code: 'BAD_TENDER' });
  });

  it('refuses an empty sale', async () => {
    await expect(ring({ lines: [], tender: 'cash' }))
      .rejects.toMatchObject({ code: 'NO_LINES' });
  });

  it('refuses a free-text line with no VAT rate', async () => {
    // Defaulting a hand-typed line to 24% would mis-tax a book; defaulting it to 0%
    // would under-declare the return. Neither is a safe guess, so it asks.
    await expect(ring({
      lines: [{ description: 'Viðgerð', unitPriceGross: 5_000 }], tender: 'cash',
    })).rejects.toMatchObject({ code: 'RATE_REQUIRED' });

    // With a rate, it goes through.
    const { totals } = await ring({
      lines: [{ description: 'Viðgerð', unitPriceGross: 6_200, vatRate: 24 }], tender: 'cash',
    });
    expect(totals.subtotal_net).toBe(5_000);
    expect(totals.vat_total).toBe(1_200);
  });

  it('refuses a rate outside the statutory set', async () => {
    await expect(ring({
      lines: [{ description: 'Eitthvað', unitPriceGross: 1_000, vatRate: 15 }], tender: 'cash',
    })).rejects.toThrow();
  });

  it.each([
    [{ productId: '00000000-0000-0000-0000-000000000000' }, 'NO_PRODUCT', 'an unknown product'],
    [{ productId: null, description: '', unitPriceGross: 100, vatRate: 24 }, 'NO_DESCRIPTION', 'no description'],
    [{ productId: null, description: 'x', unitPriceGross: 100, vatRate: 24, quantity: 0 }, 'BAD_QTY', 'zero quantity'],
    [{ productId: null, description: 'x', unitPriceGross: 100, vatRate: 24, quantity: 1.5 }, 'BAD_QTY', 'a fractional quantity'],
  ])('refuses %#: %s', async (line, code) => {
    await expect(ring({ lines: [line], tender: 'cash' }))
      .rejects.toMatchObject({ code });
  });

  it('refuses a future date', async () => {
    // A receipt says money changed hands. It cannot have changed hands tomorrow.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await expect(ledger.withTransaction(c => pos.sell(c, {
      lines: [{ productId }], tender: 'cash', soldAt: tomorrow, createdBy: adminId,
    }))).rejects.toThrow(/future/);
  });

  it('refuses a sale that comes to nothing', async () => {
    await expect(ring({
      lines: [{ description: 'Gjöf', unitPriceGross: 0, vatRate: 24 }], tender: 'cash',
    })).rejects.toMatchObject({ code: 'ZERO_TOTAL' });
  });
});

describe('the day’s takings', () => {
  // Its own day, so the figures are exact rather than a delta.
  beforeAll(async () => {
    await ring({ lines: [{ productId }], tender: 'cash', soldAt: NEXT_DAY });
    await ring({ lines: [{ productId: bookId, quantity: 2 }], tender: 'cash', soldAt: NEXT_DAY });
    await ring({ lines: [{ productId }], tender: 'card', soldAt: NEXT_DAY });
  });

  it('splits by tender, because that is how a drawer is counted', async () => {
    // One total answers neither question the operator has at closing: the cash figure
    // should equal what is physically in the drawer, and the card figure should equal
    // what the acquirer says it will settle.
    const day = await pos.dayTotals({ from: NEXT_DAY, to: NEXT_DAY });
    const byMethod = Object.fromEntries(day.by_tender.map(t => [t.method, t]));
    expect(byMethod.cash.gross).toBe(12_400 + 2_220 * 2);
    expect(byMethod.cash.sales).toBe(2);
    expect(byMethod.card.gross).toBe(12_400);
    expect(day.total_gross).toBe(12_400 + 2_220 * 2 + 12_400);
  });

  it('splits by VAT rate, so the figure ties to the VSK return', async () => {
    const day = await pos.dayTotals({ from: NEXT_DAY, to: NEXT_DAY });
    const byRate = Object.fromEntries(day.by_rate.map(r => [r.rate, r]));
    expect(byRate[24].gross).toBe(24_800);
    expect(byRate[24].net).toBe(20_000);
    expect(byRate[11].gross).toBe(4_440);
    expect(byRate[11].net).toBe(4_000);
  });

  it('shows credits separately rather than netting them off', async () => {
    // A refunded sale and a smaller day are different facts, and the drawer needs to
    // know money went back out.
    const { receipt } = await ring({ lines: [{ productId }], tender: 'cash', soldAt: NEXT_DAY });
    await ledger.withTransaction(c => invoices.issueCreditNote(c, receipt.id, {
      amountGross: 12_400, reason: 'Skilað', createdBy: adminId, issuedAt: NEXT_DAY,
    }));
    const day = await pos.dayTotals({ from: NEXT_DAY, to: NEXT_DAY });
    expect(day.credited).toBe(12_400);
    // The takings still include the sale — it happened, and then it was credited.
    expect(day.total_gross).toBeGreaterThan(day.credited);
  });
});

describe('the receipt list', () => {
  it('returns receipts only, newest first, with the tender', async () => {
    const { receipts, total } = await pos.listReceipts({ limit: 5 });
    expect(total).toBeGreaterThan(0);
    expect(receipts.length).toBeGreaterThan(0);
    for (const r of receipts) expect(['cash', 'card']).toContain(r.tender);
    // Descending by number, which for a gapless series is also chronological.
    const numbers = receipts.map(r => r.invoice_number);
    expect([...numbers].sort((a, b) => b - a)).toEqual(numbers);
  });

  it('excludes invoices', async () => {
    const { receipts } = await pos.listReceipts({ limit: 200 });
    const { rows } = await db.query(
      `SELECT id FROM invoices WHERE series = 'invoice' LIMIT 1`
    );
    if (rows.length) {
      expect(receipts.map(r => r.id)).not.toContain(rows[0].id);
    }
  });
});

describe('idempotency', () => {
  it('returns the first receipt for a repeated key instead of ringing up a second sale', async () => {
    // A double-tap or a retry after a lost response must not create a second sale. The
    // pre-079 key was derived from the receipt's own fresh UUID, so it could never dedupe.
    const key = `test-${Math.random().toString(36).slice(2)}`;
    const first = await ring({ lines: [{ productId }], tender: 'cash', idempotencyKey: key });
    const second = await ring({ lines: [{ productId }], tender: 'cash', idempotencyKey: key });

    expect(second.duplicate).toBe(true);
    expect(second.receipt.id).toBe(first.receipt.id);
    expect(second.receipt.invoice_number).toBe(first.receipt.invoice_number);
    // Exactly one receipt and one payment exist for that key.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM payments WHERE idempotency_key = $1`,
      [`client:${key}`]
    );
    expect(rows[0].n).toBe(1);
    // And the gapless series advanced by exactly one, not two.
    const third = await ring({ lines: [{ productId }], tender: 'cash' });
    expect(third.receipt.invoice_number).toBe(first.receipt.invoice_number + 1);
  });

  it('rings up a genuinely different sale under a different key', async () => {
    const a = await ring({ lines: [{ productId }], tender: 'cash', idempotencyKey: `a-${Date.now()}` });
    const b = await ring({ lines: [{ productId }], tender: 'cash', idempotencyKey: `b-${Date.now()}` });
    expect(b.receipt.id).not.toBe(a.receipt.id);
    expect(b.duplicate).toBeUndefined();
  });
});

describe('the day’s takings with a refund', () => {
  it('nets a cash refund out of the drawer figure, and reports it separately', async () => {
    // A refunded cash sale: the credit note reverses the sale on paper AND a cash refund
    // leaves the drawer. The drawer figure (gross) must drop by the refund, or the day
    // never ties to the physical count — which is how the earlier bug was noticed.
    const day = '2018-07-02';
    await ledger.withTransaction(c => ledger.ensureFiscalPeriod(c, day));
    const { receipt } = await ring({ lines: [{ productId }], tender: 'cash', soldAt: day });
    // The cash going back out.
    await ledger.withTransaction(c => invoices.recordRefund(c, receipt.id, {
      amount: 12_400, method: 'cash', receivedAt: day,
      idempotencyKey: `ref-${Math.random().toString(36).slice(2, 9)}`, createdBy: adminId,
    }));

    const totals = await pos.dayTotals({ from: day, to: day });
    const cash = totals.by_tender.find(t => t.method === 'cash');
    // Took 12.400, refunded 12.400, so the drawer nets to zero — and both halves show.
    expect(cash.taken).toBe(12_400);
    expect(cash.refunded).toBe(12_400);
    expect(cash.gross).toBe(0);
    expect(totals.total_gross).toBe(0);
  });
});
