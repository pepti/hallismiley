// Counter sales (sölukassi).
//
// A till sale is a sale, so it lands in the same sales ledger as everything else: a
// receipt-series row in `invoices`, with its own gapless number from the 'receipt'
// counter. There is no second sales table, deliberately — see migration 077.
//
// What makes a counter sale different from an invoice is not the document, it is the
// TIMING. An invoice creates a debt that a payment settles later; at a till the sale and
// the money are one event. So the journal entry debits the tender account directly:
//
//   1910 Sjóður (or 1400 for a card)   debit   the whole gross
//     4100/4110/4200/4300 Sala        credit   net, per revenue account
//     2200/2210 Útskattur             credit   VAT, per rate
//
// Receivables are not involved. A POS entry that debited 1100 and credited it back in
// the same breath would add two legs to the ledger that describe nothing, and would show
// up in the aging report as a debt that was never owed.
//
// THE THING THIS MODULE EXISTS TO GET RIGHT: shop prices in this system are
// VAT-INCLUSIVE. The customer at the counter pays 12.400 kr., and 2.400 of that is not
// the business's money — it is VAT collected for Skatturinn. So VAT is EXTRACTED from
// the gross (gross − gross/1.24), never added on top. The system this replaces treated
// the shelf price as net and added VAT to it, which overstated both the sale and the
// takings and made the till never reconcile against the cash drawer.
//
// One transaction, one call. A counter sale that could half-happen — a receipt printed
// with no entry posted, or cash recorded against no document — is worse at a till than
// anywhere else, because there is a person standing there and nobody goes back to check.

const db = require('../../config/database');
const ledger = require('./ledgerService');
const invoiceService = require('./invoiceService');
const Setting = require('../../models/Setting');
const { assertAccountingDate, todayIso } = require('../../utils/booksDate');
const {
  assertIntegerIsk, resolveVatRate, splitVatInclusive, STANDARD_VAT_RATE,
} = require('../../utils/vat');

class PosError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.name = 'PosError';
    this.status = status;
    this.code = code;
  }
}

// Cash and card only. A counter sale settled by bank transfer is not a counter sale —
// it is an invoice that happens to be paid quickly, and it should be one so the transfer
// can be reconciled against a bank line.
const TENDERS = ['cash', 'card'];

// The label that goes in customer_name. A receipt does not need a named buyer under
// Reglugerð 50/1993 unless they ask for one for their own input-VAT deduction, which is
// what `customerName` is for.
const WALK_IN = 'Almenn sala';

const MAX_LINES = 100;

/**
 * Turn requested lines into invoice lines, extracting VAT from the gross.
 *
 * Free-text lines are allowed (a repair, a delivery charge) because a till needs them,
 * but they must carry an explicit VAT rate — defaulting a hand-typed line to 24% would
 * quietly mis-tax a book, and defaulting it to 0% would under-declare the return.
 */
async function buildLines(client, requested) {
  if (!Array.isArray(requested) || !requested.length) {
    throw new PosError('A sale needs at least one line', 400, 'NO_LINES');
  }
  if (requested.length > MAX_LINES) {
    throw new PosError(`A sale may have at most ${MAX_LINES} lines`, 400, 'TOO_MANY_LINES');
  }

  // Products are read in one query rather than per line: a till is the one place in this
  // system where latency is felt by a person waiting.
  const productIds = requested.map(l => l.productId).filter(Boolean);
  const byId = new Map();
  if (productIds.length) {
    const { rows } = await client.query(
      `SELECT id, name, sku, price_isk, vat_rate, is_bookable FROM products
        WHERE id = ANY($1::text[])`,
      [productIds]
    );
    for (const p of rows) byId.set(p.id, p);
  }

  const lines = [];
  for (const [i, req] of requested.entries()) {
    const quantity = Number(req.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
      throw new PosError(`lines[${i}].quantity must be a whole number of items`, 400, 'BAD_QTY');
    }

    let product = null;
    if (req.productId) {
      product = byId.get(req.productId);
      if (!product) {
        throw new PosError(`lines[${i}] refers to a product that does not exist`, 400, 'NO_PRODUCT');
      }
    }

    const description = String(req.description || (product && product.name) || '').trim();
    if (!description) {
      throw new PosError(`lines[${i}] needs a description`, 400, 'NO_DESCRIPTION');
    }

    // Price: the product's shelf price unless the operator typed one. A typed price is
    // legitimate at a till (a damaged item, an agreed discount) so it is allowed, but it
    // is still VAT-inclusive — the same money the customer hands over.
    const unitPriceGross = assertIntegerIsk(
      req.unitPriceGross === undefined || req.unitPriceGross === null || req.unitPriceGross === ''
        ? (product ? product.price_isk : null)
        : req.unitPriceGross,
      `lines[${i}].unit_price_gross`
    );
    if (unitPriceGross < 0) {
      throw new PosError(`lines[${i}] has a negative price`, 400, 'BAD_PRICE');
    }

    // A free-text line must state its rate; a product line inherits its own. Either way
    // resolveVatRate refuses a rate outside the statutory set rather than normalising it.
    let vatRate;
    if (req.vatRate !== undefined && req.vatRate !== null && req.vatRate !== '') {
      vatRate = resolveVatRate(req.vatRate);
    } else if (product) {
      vatRate = product.vat_rate === null || product.vat_rate === undefined
        ? STANDARD_VAT_RATE : resolveVatRate(product.vat_rate);
    } else {
      throw new PosError(
        `lines[${i}] is a free-text line, so it must say which VAT rate applies`,
        400, 'RATE_REQUIRED'
      );
    }

    const lineGross = unitPriceGross * quantity;
    // Extracted, not added. This is the whole point of the module.
    const { net, vat } = splitVatInclusive(lineGross, vatRate);

    lines.push({
      product_id: product ? product.id : null,
      sku: product ? product.sku : null,
      description,
      quantity,
      unit_price_gross: unitPriceGross,
      vat_rate: vatRate,
      gross_before_discount: lineGross,
      discount_gross: 0,
      line_net: net,
      line_vat: vat,
      line_gross: lineGross,
      revenue_account: invoiceService.revenueAccountFor({
        vatRate,
        isService: product ? Boolean(product.is_bookable) : Boolean(req.isService),
      }),
    });
  }

  return lines;
}

function totalsOf(lines) {
  const byRate = new Map();
  for (const l of lines) {
    const bucket = byRate.get(l.vat_rate) || { rate: l.vat_rate, net: 0, vat: 0, gross: 0 };
    bucket.net += l.line_net;
    bucket.vat += l.line_vat;
    bucket.gross += l.line_gross;
    byRate.set(l.vat_rate, bucket);
  }
  return {
    subtotal_net: lines.reduce((a, l) => a + l.line_net, 0),
    vat_total: lines.reduce((a, l) => a + l.line_vat, 0),
    total_gross: lines.reduce((a, l) => a + l.line_gross, 0),
    by_rate: [...byRate.values()].sort((a, b) => b.rate - a.rate),
  };
}

/**
 * The journal legs for a counter sale.
 *
 * Deliberately NOT invoiceService.invoiceJournalLines(): that one debits receivables,
 * which is right for an invoice and wrong here. Everything else — revenue grouped by
 * account, VAT grouped by rate — is the same, because it is the same sale.
 */
function saleJournalLines({ totals, lines, tender }) {
  const cashAccount = invoiceService.PAYMENT_ACCOUNTS[tender];
  if (!cashAccount) throw new PosError(`Unknown tender: ${tender}`, 400, 'BAD_TENDER');

  const legs = [{
    accountCode: cashAccount,
    debit: totals.total_gross,
    memo: tender === 'cash' ? 'Reiðufé í kassa' : 'Kortagreiðsla',
  }];

  const revenueByAccount = new Map();
  for (const l of lines) {
    revenueByAccount.set(l.revenue_account,
      (revenueByAccount.get(l.revenue_account) || 0) + l.line_net);
  }
  for (const [accountCode, net] of revenueByAccount) {
    if (net !== 0) legs.push({ accountCode, credit: net, memo: 'Sala' });
  }

  for (const bucket of totals.by_rate) {
    if (bucket.vat === 0) continue;
    const accountCode = invoiceService.VAT_OUTPUT_ACCOUNT[bucket.rate];
    if (!accountCode) {
      throw new PosError(`No output-VAT account configured for rate ${bucket.rate}%`, 500);
    }
    legs.push({
      accountCode, credit: bucket.vat, vatRate: bucket.rate,
      memo: `Útskattur ${bucket.rate}%`,
    });
  }
  return legs;
}

/**
 * Ring up a sale: document, entry and tender, in one transaction.
 *
 * @param {object} client  pg client inside a transaction
 * @param {object} opts
 *   lines        [{ productId?, description?, quantity?, unitPriceGross?, vatRate?, isService? }]
 *   tender       'cash' | 'card'
 *   soldAt       ISO date (defaults to today; never in the future — the money has moved)
 *   customerName optional, for a buyer who wants their name on the receipt
 *   customerKennitala optional, for a business buyer claiming input VAT
 *   note         optional
 *   createdBy    required
 */
async function sell(client, opts = {}) {
  const {
    lines: requested, tender = 'cash', soldAt = null, customerName = '',
    customerKennitala = null, note = '', createdBy,
  } = opts;
  if (!createdBy) throw new PosError('sell requires createdBy', 500);
  if (!TENDERS.includes(tender)) {
    throw new PosError(
      `A counter sale is settled in cash or by card, not by ${tender}. A bank transfer should be an invoice, so it can be reconciled against the bank line.`,
      400, 'BAD_TENDER'
    );
  }

  // Not future-dated, ever: a receipt is evidence that money changed hands, and it
  // cannot have changed hands tomorrow.
  const issuedAt = assertAccountingDate(soldAt || todayIso(), 'sold_at');

  const seller = await Setting.getBookkeepingSettings();
  if (!seller.seller_complete) {
    throw new PosError(
      'Cannot issue receipts yet: the seller name, kennitala and VSK number must be set in the books settings first. A receipt without them is not a valid sales document.',
      409, 'SELLER_INCOMPLETE'
    );
  }

  const lines = await buildLines(client, requested);
  const totals = totalsOf(lines);
  if (totals.total_gross <= 0) {
    throw new PosError('A sale must come to more than zero', 400, 'ZERO_TOTAL');
  }

  const number = await ledger.nextCounter(client, 'receipt');

  // Created as a DRAFT, then flipped to issued once its lines exist — the same two-step
  // as an invoice, and for the same reason. The append-only triggers refuse line INSERTs
  // into an already-issued document, which is what stops posted history being rewritten
  // by appending a balanced pair of lines later. A receipt born 'issued' cannot have
  // lines added to it at all.
  const { rows } = await client.query(
    `INSERT INTO invoices
       (series, invoice_number, seller_name, seller_kennitala, seller_vat_number,
        seller_address, customer_name, customer_kennitala, customer_country,
        issued_at, due_at, terms_days, currency, subtotal_net, vat_total, total_gross,
        discount_total, shipping_gross, amount_paid, note, status, created_by)
     VALUES ('receipt',$1,$2,$3,$4,$5,$6,$7,'IS',$8::date,$8::date,0,'ISK',
             $9,$10,$11,0,0,$11,$12,'draft',$13)
     RETURNING *`,
    [number, seller.seller_name, seller.seller_kennitala, seller.seller_vat_number,
      seller.seller_address || '', String(customerName || '').trim() || WALK_IN,
      customerKennitala || null, issuedAt,
      totals.subtotal_net, totals.vat_total, totals.total_gross, String(note || ''), createdBy]
  );
  let receipt = rows[0];

  await invoiceService.insertLines(client, receipt.id, lines);

  const { rows: issued } = await client.query(
    `UPDATE invoices SET status = 'issued' WHERE id = $1 RETURNING *`, [receipt.id]
  );
  receipt = issued[0];

  const entry = await ledger.postEntry(client, {
    entryDate: issuedAt,
    memo: `Kassasala ${number}`,
    sourceType: 'pos',
    sourceId: receipt.id,
    createdBy,
    lines: saleJournalLines({ totals, lines, tender }),
  });

  // The tender is recorded as a payment row so the reconciliation screen can match a
  // card settlement to it and the audit trail says how it was paid. It does NOT post its
  // own journal entry — the sale entry above already moved the cash, and a second one
  // would double the takings. That is why this inserts directly rather than calling
  // recordSettlement, which exists to post the cash leg for an invoice.
  await client.query(
    `INSERT INTO payments
       (invoice_id, direction, amount, method, received_at, reference, idempotency_key, created_by)
     VALUES ($1,'in',$2,$3,$4::date,$5,$6,$7)`,
    [receipt.id, totals.total_gross, tender, issuedAt,
      `Kassasala ${number}`, `pos-${receipt.id}`, createdBy]
  );

  return {
    receipt: { ...receipt, invoice_number: Number(receipt.invoice_number) },
    lines,
    totals,
    entry,
    tender,
  };
}

/**
 * A day's takings, split by tender and by VAT rate.
 *
 * Split by TENDER because that is how the drawer is counted at the end of the day: the
 * cash figure should equal what is physically there, and the card figure should equal
 * what the acquirer says it will settle. A single total answers neither question.
 */
async function dayTotals({ from = null, to = null } = {}, client = db) {
  const day = from || todayIso();
  const until = to || day;

  const { rows: byTender } = await client.query(
    `SELECT p.method,
            COUNT(*)::int AS sales,
            COALESCE(SUM(p.amount), 0)::bigint AS gross
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
      WHERE i.series = 'receipt' AND p.direction = 'in'
        AND i.issued_at >= $1::date AND i.issued_at <= $2::date
      GROUP BY p.method
      ORDER BY p.method`,
    [day, until]
  );

  const { rows: byRate } = await client.query(
    `SELECT il.vat_rate,
            COALESCE(SUM(il.line_net), 0)::bigint   AS net,
            COALESCE(SUM(il.line_vat), 0)::bigint   AS vat,
            COALESCE(SUM(il.line_gross), 0)::bigint AS gross
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
      WHERE i.series = 'receipt'
        AND i.issued_at >= $1::date AND i.issued_at <= $2::date
      GROUP BY il.vat_rate
      ORDER BY il.vat_rate DESC`,
    [day, until]
  );

  const { rows: credited } = await client.query(
    `SELECT COALESCE(SUM(cn.amount_gross), 0)::bigint AS gross
       FROM credit_notes cn
       JOIN invoices i ON i.id = cn.invoice_id
      WHERE i.series = 'receipt'
        AND cn.issued_at >= $1::date AND cn.issued_at <= $2::date`,
    [day, until]
  );

  return {
    range: { from: day, to: until },
    by_tender: byTender.map(r => ({
      method: r.method, sales: r.sales, gross: Number(r.gross),
    })),
    by_rate: byRate.map(r => ({
      rate: r.vat_rate, net: Number(r.net), vat: Number(r.vat), gross: Number(r.gross),
    })),
    // Shown separately rather than netted off: a refunded sale and a smaller day are
    // different facts, and the drawer needs to know money went back out.
    credited: Number(credited[0].gross),
    total_gross: byTender.reduce((a, r) => a + Number(r.gross), 0),
  };
}

async function listReceipts({ limit = 50, offset = 0, from = null, to = null } = {}, client = db) {
  const params = [];
  const where = ["i.series = 'receipt'"];
  if (from) { params.push(from); where.push(`i.issued_at >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`i.issued_at <= $${params.length}::date`); }
  params.push(limit, offset);

  const { rows } = await client.query(
    `SELECT i.id, i.invoice_number, i.issued_at, i.customer_name, i.subtotal_net,
            i.vat_total, i.total_gross, i.amount_credited, i.note,
            u.username AS created_by_username,
            (SELECT method FROM payments WHERE invoice_id = i.id AND direction = 'in'
              ORDER BY created_at LIMIT 1) AS tender
       FROM invoices i
       LEFT JOIN users u ON u.id = i.created_by
      WHERE ${where.join(' AND ')}
      ORDER BY i.invoice_number DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: count } = await client.query(
    `SELECT COUNT(*)::int AS total FROM invoices i WHERE ${where.join(' AND ')}`,
    params.slice(0, -2)
  );

  return {
    receipts: rows.map(r => ({
      ...r,
      invoice_number: Number(r.invoice_number),
      issued_at: r.issued_at.toISOString().slice(0, 10),
      subtotal_net: Number(r.subtotal_net),
      vat_total: Number(r.vat_total),
      total_gross: Number(r.total_gross),
      amount_credited: Number(r.amount_credited),
    })),
    total: count[0].total,
  };
}

module.exports = {
  PosError,
  TENDERS,
  WALK_IN,
  MAX_LINES,
  buildLines,
  totalsOf,
  saleJournalLines,
  sell,
  dayTotals,
  listReceipts,
};
