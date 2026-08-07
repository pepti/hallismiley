// Invoicing. Turns a paid shop order into a statutory Icelandic sales invoice, and
// records payments and credit notes against it.
//
// What "statutory" forces on the design (Reglugerð 50/1993 + 505/2013):
//
//   * The seller's name, kennitala and VSK number, the buyer's name, the issue
//     date, quantity and unit price per line, and VAT stated explicitly AND
//     SEPARATED BY RATE. An invoice missing any of it is not valid, and an invalid
//     invoice breaks the BUYER's input-VAT deduction — the defect is inherited by
//     the customer, so issuing is refused rather than degraded.
//   * The number comes from a gapless series, allocated at ISSUE.
//   * Everything statutory is SNAPSHOTTED. Rendering the seller block from live
//     settings at PDF time means an edit silently reprints history differently.
//   * Once issued there is no edit and no delete — only a credit note.
//
// Money handling: the shop's prices are VAT-inclusive, so VAT is extracted from
// the gross, per line, at that line's rate. EUR orders are translated to ISK at
// the ORDER's own date, and the translated lines are reconciled so they sum
// exactly to the translated total.

const db = require('../../config/database');
const logger = require('../../logger');
const Setting = require('../../models/Setting');
const FxRate = require('../../models/FxRate');
const ledger = require('./ledgerService');
const audit = require('./auditLog');
const {
  splitVatInclusive, allocateProportional, summariseByRate, assertIntegerIsk, resolveVatRate,
  STANDARD_VAT_RATE, REDUCED_VAT_RATE,
} = require('../../utils/vat');
const { convertLinesToIsk, assertPlausibleRate } = require('../../utils/fx');
const { toIsoDate, addDays, assertAccountingDate, todayIso } = require('../../utils/booksDate');

class InvoiceError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'InvoiceError';
    this.status = status;
    if (code) this.code = code;
  }
}

// Payment methods, and which account each one lands in. A card payment does NOT
// go straight to the bank: the money sits with the acquirer until it is paid out,
// and booking it as bank cash overstates the bank balance and makes the bank
// reconciliation impossible. The system this replaces debited the bank for card
// AND for credit notes — the latter being money that never arrived at all.
const PAYMENT_ACCOUNTS = {
  bank_transfer: '1900', // Bankainnstæða
  cash: '1910',          // Sjóður
  card: '1400',          // Kortagreiðslur í vinnslu (acquirer clearing)
  stripe: '1400',        // same clearing account; the payout sweeps it to the bank
  other: '1990',         // Óvissureikningur — parked visibly, not guessed at
};

const AR_ACCOUNT = '1100';
const VAT_OUTPUT_ACCOUNT = { 24: '2200', 11: '2210' };

// Which revenue account a line belongs in. Zero-rated turnover is tracked in its
// own account because RSK 10.01 box C wants it separately from box A/B turnover.
function revenueAccountFor({ vatRate, isService }) {
  if (vatRate === 0) return '4300';               // Sala til útlanda (0%)
  if (vatRate === REDUCED_VAT_RATE) return '4200'; // Sala 11%
  return isService ? '4110' : '4100';              // services vs goods at 24%
}

// Orders that must never be invoiced. Invoicing a refunded order creates a
// receivable for money that was already given back.
const UNINVOICEABLE_PAYMENT_STATES = ['refunded', 'voided'];

/**
 * Read the order and its items using the CALLER'S transaction client.
 *
 * Deliberately not Order.findDetailById()/Order.listItems(): those use the pool,
 * so they would read at a different snapshot than the FOR UPDATE lock taken here
 * — defeating the isolation this function claims — and would check out a second
 * connection while holding the first, which deadlocks the pool under load. That
 * exact combination was a latent fault in the system this replaces.
 */
async function readOrderForInvoicing(client, orderId) {
  const { rows } = await client.query(
    `SELECT o.id, o.order_number, o.user_id, o.guest_email, o.guest_name,
            o.currency, o.subtotal, o.shipping, o.total, o.status, o.payment_status,
            o.shipping_address, o.discount_amount, o.shipping_discount, o.discount_title,
            o.paid_at, o.created_at,
            u.email AS user_email, u.display_name AS user_display_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
      FOR UPDATE OF o`,
    [String(orderId)]
  );
  const order = rows[0];
  if (!order) throw new InvoiceError('Order not found', 404, 'ORDER_NOT_FOUND');

  const { rows: items } = await client.query(
    `SELECT oi.id, oi.product_id, oi.product_name_snapshot, oi.product_price_snapshot,
            oi.quantity, oi.currency, p.sku, COALESCE(p.is_bookable, FALSE) AS is_service,
            p.vat_rate
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at ASC, oi.id ASC`,
    [String(orderId)]
  );
  return { order, items };
}

// Who is being billed. There is no companies table here — customers are either
// registered users or guest checkouts — so the invoice snapshots a name, an email
// and an address, and AR groups by a stable customer key.
function pickCustomer(order) {
  const addr = order.shipping_address && typeof order.shipping_address === 'object'
    ? order.shipping_address : null;
  const name = (addr && addr.name) || order.user_display_name || order.guest_name
    || order.user_email || order.guest_email || 'Óskráður viðskiptavinur';
  const email = (order.user_email || order.guest_email || '').trim().toLowerCase() || null;
  const lines = [];
  if (addr) {
    if (addr.line1) lines.push(addr.line1);
    if (addr.line2) lines.push(addr.line2);
    const cityLine = [addr.postal, addr.city].filter(Boolean).join(' ');
    if (cityLine) lines.push(cityLine);
    if (addr.country) lines.push(addr.country);
  }
  return {
    name: String(name).slice(0, 200),
    email,
    address: lines.join('\n'),
    // Country drives the VAT treatment: goods leaving Iceland are zero-rated.
    country: (addr && addr.country_code) || (addr && addr.country) || 'IS',
  };
}

// Iceland is not in the EU VAT area, so a sale shipped abroad is an export and
// zero-rated — but only against proof of export. Anything shipped within Iceland,
// and any service, stays at the standard rate.
function isExport(customerCountry) {
  const c = String(customerCountry || 'IS').trim().toUpperCase();
  return !(c === 'IS' || c === 'ISL' || c === 'ICELAND' || c === 'ÍSLAND');
}

/**
 * Build the invoice lines for an order.
 *
 * Order of operations matters and is the opposite of the obvious one: translate
 * to ISK FIRST, then extract VAT. Extracting VAT in EUR and converting the parts
 * separately lets rounding open a gap between net + vat and gross, which the
 * invoice's own CHECK constraint then rejects.
 */
function buildLines({ order, items, rate, exportSale }) {
  if (!items.length) throw new InvoiceError('That order has no items to invoice', 400, 'NO_LINES');

  // Per-line VAT rate, from the product.
  //
  // Zero-rating applies to EXPORTED GOODS. A service is taxed where it is
  // performed, so joinery or software work done in Iceland stays at the standard
  // rate even when the customer is abroad — VSK act art. 12 enumerates the narrow
  // cases where a service to a non-resident is zero-rated, and blanket-zeroing them
  // under-declares output VAT.
  //
  // Otherwise the product's own rate applies. The 11% band is a closed statutory
  // list, and books and printed matter are on it — charging 24% on a catalogue is
  // the wrong tax, not a rounding preference.
  const vatRateFor = (item) => {
    if (exportSale && !item.is_service) return 0;
    // resolveVatRate rather than a bare ?? default: a product row carrying a rate
    // outside {0,11,24} should stop the invoice, not be quietly normalised.
    return item.vat_rate === null || item.vat_rate === undefined
      ? STANDARD_VAT_RATE : resolveVatRate(item.vat_rate);
  };

  // UNIT prices are what get translated, not line totals.
  //
  // Reglugerð 50/1993 requires quantity and unit price on the line, which means a
  // reader must be able to multiply them and arrive at the total. Translating the
  // line total and dividing it back by the quantity does not survive that: 3 × EUR
  // 3.33 at 1.5 gives a 1,499 ISK line whose unit price rounds to 500, and the
  // document then claims 3 × 500 = 1,499. Translating the unit price and
  // multiplying makes the arithmetic on the page true by construction.
  const orderCurrency = order.currency;
  const unitIsk = items.map(it => convertLinesToIsk(
    [assertIntegerIsk(it.product_price_snapshot, 'product_price_snapshot')], orderCurrency, rate
  ).lines[0]);
  const grossBefore = items.map((it, i) =>
    unitIsk[i] * assertIntegerIsk(it.quantity, 'quantity'));

  const shippingMinor = Math.max(
    0,
    assertIntegerIsk(order.shipping || 0, 'shipping')
    - assertIntegerIsk(order.shipping_discount || 0, 'shipping_discount')
  );
  const shippingIsk = shippingMinor > 0
    ? convertLinesToIsk([shippingMinor], orderCurrency, rate).lines[0] : 0;
  if (shippingIsk > 0) grossBefore.push(shippingIsk);

  // THE authoritative figure is what the customer actually paid, translated once:
  // round(order.total × rate). Everything else is fitted around it.
  //
  // Anchoring instead on round((total + discount) × rate) and subtracting a
  // separately rounded round(discount × rate) is off by up to a króna, because
  // round(a + b) − round(b) ≠ round(a). That króna made the invoice disagree with
  // the payment, so it could never settle and eventually read "overdue".
  const orderTotalMinor = assertIntegerIsk(order.total, 'order.total');
  const iskInvoiceTotal = convertLinesToIsk([orderTotalMinor], orderCurrency, rate).lines[0];

  // Whatever it takes to bring the translated lines down to the authoritative
  // total — derived, never translated independently, so the two cannot disagree.
  // Allocated by line size so each line keeps its effective rate and the per-rate
  // VAT split stays honest. Shown separately on the line, so unit × qty still reads
  // correctly with the discount stated beneath it.
  const spread = grossBefore.reduce((a, b) => a + b, 0) - iskInvoiceTotal;
  const discountAlloc = spread > 0
    ? allocateProportional(spread, grossBefore)
    : grossBefore.map(() => 0);
  // A NEGATIVE spread means unit-price rounding left the lines a króna or two short
  // of what was actually paid. That difference is real money and has to appear, so
  // it becomes an explicit rounding line (sléttun) rather than being smeared into a
  // unit price and breaking the arithmetic this function exists to protect.
  const roundingIsk = spread < 0 ? -spread : 0;

  const built = [];
  items.forEach((item, i) => {
    const vatRate = vatRateFor(item);
    const before = grossBefore[i];
    const discount = Math.min(discountAlloc[i], before);
    const gross = before - discount;
    const split = splitVatInclusive(gross, vatRate);
    built.push({
      product_id: item.product_id || null,
      sku: item.sku || null,
      description: item.product_name_snapshot,
      quantity: Number(item.quantity),
      // unit × quantity === gross_before_discount, exactly, by construction. The
      // discount is reported on its own line beneath, never folded into the price
      // the customer was quoted.
      unit_price_gross: unitIsk[i],
      vat_rate: vatRate,
      gross_before_discount: before,
      discount_gross: discount,
      line_net: split.net,
      line_vat: split.vat,
      line_gross: gross,
      revenue_account: revenueAccountFor({ vatRate, isService: item.is_service }),
      is_shipping: false,
    });
  });

  if (shippingIsk > 0) {
    // Shipping is the last entry in grossBefore/discountAlloc — see where it was
    // pushed above. Standard-rated at home, zero-rated on an export, because it
    // follows the goods it carries.
    const i = grossBefore.length - 1;
    const vatRate = exportSale ? 0 : STANDARD_VAT_RATE;
    const before = grossBefore[i];
    const discount = Math.min(discountAlloc[i], before);
    const gross = before - discount;
    const split = splitVatInclusive(gross, vatRate);
    built.push({
      product_id: null,
      sku: null,
      description: 'Sending',
      quantity: 1,
      unit_price_gross: before,
      vat_rate: vatRate,
      gross_before_discount: before,
      discount_gross: discount,
      line_net: split.net,
      line_vat: split.vat,
      line_gross: gross,
      revenue_account: exportSale ? '4300' : '4100',
      is_shipping: true,
    });
  }

  // Sléttun. Only ever a couple of krónur, and only on a translated order, but it
  // is money the customer actually paid so it is stated rather than hidden. Taxed
  // at the rate of the largest line so it does not distort the per-rate split.
  if (roundingIsk > 0) {
    const dominant = built.reduce((best, l) => (l.line_gross > best.line_gross ? l : best), built[0]);
    const vatRate = dominant ? dominant.vat_rate : STANDARD_VAT_RATE;
    const split = splitVatInclusive(roundingIsk, vatRate);
    built.push({
      product_id: null,
      sku: null,
      description: 'Sléttun',
      quantity: 1,
      unit_price_gross: roundingIsk,
      vat_rate: vatRate,
      gross_before_discount: roundingIsk,
      discount_gross: 0,
      line_net: split.net,
      line_vat: split.vat,
      line_gross: roundingIsk,
      revenue_account: dominant ? dominant.revenue_account : '4100',
      is_shipping: false,
      is_rounding: true,
    });
  }

  // The lines must add up to the order total, translated. If they do not, the
  // invoice is wrong and it is better to refuse than to issue a document that
  // disagrees with what the customer paid.
  const grossSum = built.reduce((a, l) => a + l.line_gross, 0);
  if (grossSum !== iskInvoiceTotal) {
    throw new InvoiceError(
      `Invoice lines total ${grossSum} ISK but the order totals ${iskInvoiceTotal} ISK — refusing to issue a document that does not reconcile`,
      500, 'RECONCILIATION_FAILED'
    );
  }

  const summary = summariseByRate(built);
  return {
    lines: built,
    subtotal_net: summary.net_total,
    vat_total: summary.vat_total,
    total_gross: summary.gross_total,
    discount_total: built.reduce((a, l) => a + l.discount_gross, 0),
    shipping_gross: built.filter(l => l.is_shipping).reduce((a, l) => a + l.line_gross, 0),
    by_rate: summary.rates,
  };
}

// The journal entry for an issued invoice: the customer owes the gross, revenue is
// recognised net PER RATE, and output VAT is credited to the account for its own
// rate so the VSK return can be derived from the ledger.
function invoiceJournalLines({ totals, lines }) {
  const legs = [{ accountCode: AR_ACCOUNT, debit: totals.total_gross, memo: 'Viðskiptakrafa' }];

  const revenueByAccount = new Map();
  for (const line of lines) {
    revenueByAccount.set(line.revenue_account,
      (revenueByAccount.get(line.revenue_account) || 0) + line.line_net);
  }
  for (const [accountCode, net] of revenueByAccount) {
    legs.push({ accountCode, credit: net, memo: 'Sala' });
  }

  for (const bucket of totals.by_rate) {
    if (bucket.vat === 0) continue;
    const accountCode = VAT_OUTPUT_ACCOUNT[bucket.rate];
    if (!accountCode) {
      throw new InvoiceError(`No output-VAT account configured for rate ${bucket.rate}%`, 500);
    }
    legs.push({ accountCode, credit: bucket.vat, vatRate: bucket.rate, memo: `Útskattur ${bucket.rate}%` });
  }
  return legs;
}

/**
 * Issue an invoice for an order. Idempotent: a second call returns the existing
 * invoice rather than issuing a duplicate.
 *
 * @param {object} client   pg client inside a transaction
 * @param {string} orderId
 * @param {object} opts     { createdBy, issuedAt?, series?, fxRateOverride? }
 */
async function createFromOrder(client, orderId, opts = {}) {
  const { createdBy, series = 'invoice', requestId = null } = opts;
  if (!createdBy) throw new InvoiceError('createFromOrder requires createdBy', 500);

  const { order, items } = await readOrderForInvoicing(client, orderId);

  // Already invoiced? Return it. uniq_invoices_order_id makes this a race-safe
  // check-then-act: a concurrent caller hits the constraint and lands here too.
  const { rows: existing } = await client.query(
    `SELECT * FROM invoices WHERE order_id = $1`, [order.id]
  );
  if (existing.length) {
    return { invoice: existing[0], created: false };
  }

  if (UNINVOICEABLE_PAYMENT_STATES.includes(order.payment_status)) {
    throw new InvoiceError(
      `Order ${order.order_number} is ${order.payment_status} and cannot be invoiced. ` +
      'If it was invoiced before the refund, credit the invoice instead.',
      409, 'ORDER_NOT_INVOICEABLE'
    );
  }

  // Read through the caller's client: this runs inside a transaction that already
  // holds a pool connection and a FOR UPDATE lock on the order, so a pool read here
  // would both break isolation and, under concurrency, deadlock on connections.
  const seller = await Setting.getBookkeepingSettings(client);
  if (!seller.seller_complete) {
    // Refusing outright rather than issuing with placeholders: an invoice without a
    // real kennitala and VSK number is not legally valid, and the customer cannot
    // deduct input VAT on it.
    throw new InvoiceError(
      'Cannot issue invoices yet: the seller name, kennitala and VSK number must be set ' +
      'in the bookkeeping settings first. An invoice without them is not legally valid.',
      409, 'SELLER_INCOMPLETE'
    );
  }

  // The invoice date is the order's payment date where known — that is when the
  // supply happened, and it decides which VSK period the sale belongs to.
  const issuedAt = opts.issuedAt
    ? assertAccountingDate(opts.issuedAt, 'issuedAt')
    : toIsoDate(order.paid_at || order.created_at);

  const customer = pickCustomer(order);
  const exportSale = isExport(customer.country);

  // FX at the invoice's own date, never "today".
  // fxRateOverride exists for the backfill script, which invoices historical orders
  // and may be handed the rate that applied then. It goes through the same
  // plausibility band as a stored rate — an override is still a rate nobody has
  // validated, and a decimal-place slip here misstates the whole invoice.
  const fx = opts.fxRateOverride !== undefined
    ? {
      rate: assertPlausibleRate(order.currency, opts.fxRateOverride),
      rate_date: issuedAt,
      source: 'manual',
    }
    : await FxRate.forDate(order.currency, issuedAt, client);

  const totals = buildLines({ order, items, rate: fx.rate, exportSale });

  const invoiceNumber = await ledger.nextCounter(client, series);
  const dueAt = addDays(issuedAt, seller.payment_terms_days);

  const { rows: invRows } = await client.query(
    `INSERT INTO invoices (
       series, invoice_number, order_id, user_id,
       seller_name, seller_kennitala, seller_vat_number, seller_address,
       customer_name, customer_email, customer_address, customer_country,
       issued_at, due_at, terms_days,
       original_currency, original_total_gross, fx_rate,
       subtotal_net, vat_total, total_gross, discount_total, shipping_gross,
       zero_rate_reason, note, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,$23,$24,$25,'draft',$26)
     RETURNING *`,
    [
      series, invoiceNumber, order.id, order.user_id,
      seller.seller_name, seller.seller_kennitala, seller.seller_vat_number, seller.seller_address,
      customer.name, customer.email, customer.address, customer.country,
      issuedAt, dueAt, seller.payment_terms_days,
      order.currency, order.currency === 'ISK' ? null : assertIntegerIsk(order.total, 'order.total'),
      fx.rate,
      totals.subtotal_net, totals.vat_total, totals.total_gross,
      totals.discount_total, totals.shipping_gross,
      exportSale ? 'Útflutningur — sala til útlanda, 0% VSK. Krefst útflutningsgagna.' : null,
      seller.invoice_note, createdBy,
    ]
  );
  await insertLines(client, invRows[0].id, totals.lines);

  // Flip to 'issued' only once the lines exist. The database refuses line inserts
  // into an issued invoice, so from this statement on its content is final and the
  // only way to change what the customer owes is a credit note.
  const { rows: issuedRows } = await client.query(
    `UPDATE invoices SET status = 'issued' WHERE id = $1 RETURNING *`,
    [invRows[0].id]
  );
  const invoice = issuedRows[0];

  const entry = await ledger.postEntry(client, {
    entryDate: issuedAt,
    memo: `Reikningur ${invoiceNumber} — ${customer.name}`,
    sourceType: 'invoice',
    sourceId: invoice.id,
    createdBy,
    lines: invoiceJournalLines({ totals, lines: totals.lines }),
  });

  await audit.record(client, {
    actorId: createdBy,
    action: 'invoice.issued',
    entityType: 'invoice',
    entityId: invoice.id,
    requestId,
    summary: {
      invoice_number: invoiceNumber,
      series,
      order_number: order.order_number,
      total_gross: totals.total_gross,
      vat_total: totals.vat_total,
      original_currency: order.currency,
      fx_rate: order.currency === 'ISK' ? undefined : fx.rate,
      journal_entry_number: entry.entry_number,
    },
  });

  logger.info(
    { invoiceId: invoice.id, invoiceNumber, series, period: entry.period, orderId: order.id },
    'invoice issued'
  );
  return { invoice, created: true, lines: totals.lines, journal_entry: entry };
}

// One multi-row INSERT rather than a loop: the invoice counter row stays locked
// until COMMIT, so every extra round-trip taken here is time all invoicing spends
// serialised behind this document.
const LINE_COLUMNS = [
  'invoice_id', 'product_id', 'sku', 'description', 'quantity', 'unit_price_gross',
  'vat_rate', 'gross_before_discount', 'discount_gross', 'line_net', 'line_vat',
  'line_gross', 'revenue_account', 'sort_order',
];

async function insertLines(client, invoiceId, lines) {
  const width = LINE_COLUMNS.length;
  const rowPlaceholders = [];
  const params = [];
  lines.forEach((l, i) => {
    const base = i * width;
    rowPlaceholders.push(`(${Array.from({ length: width }, (_, k) => `$${base + k + 1}`).join(',')})`);
    params.push(
      invoiceId, l.product_id, l.sku, l.description, l.quantity, l.unit_price_gross,
      l.vat_rate, l.gross_before_discount, l.discount_gross, l.line_net, l.line_vat,
      l.line_gross, l.revenue_account, i
    );
  });
  await client.query(
    `INSERT INTO invoice_lines (${LINE_COLUMNS.join(', ')}) VALUES ${rowPlaceholders.join(', ')}`,
    params
  );
}

// ── Payments ─────────────────────────────────────────────────────────────────

/**
 * Record money moving between the customer and the business.
 *
 * `direction: 'in'` is a payment; `'out'` is a refund disbursement. Both share
 * this path because they are the same kind of fact with opposite signs, and the
 * idempotency, immutability and audit machinery should not be duplicated.
 *
 * Idempotency is by an explicit caller-supplied key scoped TO THE INVOICE, not by
 * a time window over amount+method. Two things this avoids:
 *   - the previous system's 10-second window over the CALLER'S own timestamp,
 *     which silently swallowed the second of two genuine identical transfers;
 *   - a globally unique key, where a caller reusing a key across invoices matched
 *     the first invoice's payment and returned a cheerful 200 for money never
 *     booked against the second.
 * A key that has been used on a DIFFERENT invoice is an error, not a no-op.
 */
async function recordSettlement(client, invoiceId, opts = {}) {
  const {
    amount, method, receivedAt, reference = '', idempotencyKey, createdBy,
    requestId = null, direction = 'in',
  } = opts;
  if (!createdBy) throw new InvoiceError('recordSettlement requires createdBy', 500);
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    throw new InvoiceError('recordSettlement requires an idempotencyKey', 500);
  }
  if (direction !== 'in' && direction !== 'out') {
    throw new InvoiceError(`Unknown settlement direction: ${direction}`, 500);
  }
  if (!Object.prototype.hasOwnProperty.call(PAYMENT_ACCOUNTS, method)) {
    throw new InvoiceError(
      `Unknown payment method: ${method} (expected one of ${Object.keys(PAYMENT_ACCOUNTS).join(', ')})`,
      400, 'BAD_METHOD'
    );
  }
  const value = assertIntegerIsk(amount, 'amount');
  if (value <= 0) throw new InvoiceError('An amount must be greater than zero', 400, 'BAD_AMOUNT');

  // Lock the invoice FIRST, then check the key. Checking before the lock let two
  // concurrent retries of the same request both pass, and the loser hit the unique
  // index as a raw 23505 — a 500 in exactly the situation idempotency exists for.
  const { rows: invRows } = await client.query(
    `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [String(invoiceId)]
  );
  const invoice = invRows[0];
  if (!invoice) throw new InvoiceError('Invoice not found', 404, 'NOT_FOUND');

  const { rows: dup } = await client.query(
    `SELECT id, direction, amount FROM payments
      WHERE invoice_id = $1 AND idempotency_key = $2`,
    [invoice.id, String(idempotencyKey)]
  );
  if (dup.length) {
    return { invoice: await findById(client, invoice.id), payment_id: dup[0].id, created: false };
  }
  // The same key against a different invoice means the caller is generating keys
  // per batch rather than per settlement. Refusing loudly is the only way that
  // mistake surfaces before money goes missing.
  const { rows: elsewhere } = await client.query(
    `SELECT p.id, i.invoice_number FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
      WHERE p.idempotency_key = $1 AND p.invoice_id <> $2 LIMIT 1`,
    [String(idempotencyKey), invoice.id]
  );
  if (elsewhere.length) {
    throw new InvoiceError(
      `That idempotency key was already used on invoice ${elsewhere[0].invoice_number}; use a fresh key per settlement`,
      409, 'KEY_REUSED'
    );
  }

  if (invoice.status === 'cancelled') {
    throw new InvoiceError('That invoice is cancelled; it cannot be settled', 409, 'INVALID_STATE');
  }
  if (invoice.status === 'draft') {
    throw new InvoiceError('That invoice has not been issued yet', 409, 'INVALID_STATE');
  }

  if (direction === 'in') {
    const outstanding = outstandingOf(invoice);
    if (value > outstanding) {
      throw new InvoiceError(
        `Payment of ${value} ISK exceeds the ${outstanding} ISK still outstanding on invoice ${invoice.invoice_number}`,
        422, 'OVERPAYMENT'
      );
    }
  } else {
    // You cannot hand back more than you actually received.
    const refundable = Number(invoice.amount_paid) - Number(invoice.amount_refunded);
    if (value > refundable) {
      throw new InvoiceError(
        `Refund of ${value} ISK exceeds the ${refundable} ISK received on invoice ${invoice.invoice_number}`,
        422, 'OVERREFUND'
      );
    }
  }

  const paidOn = receivedAt
    ? assertAccountingDate(receivedAt, 'received_at')
    : todayIso();
  // Money cannot move before the invoice existed.
  if (paidOn < toIsoDate(invoice.issued_at)) {
    throw new InvoiceError(
      `Date ${paidOn} is before invoice ${invoice.invoice_number} was issued (${toIsoDate(invoice.issued_at)})`,
      400, 'BAD_DATE'
    );
  }

  const { rows: payRows } = await client.query(
    `INSERT INTO payments (invoice_id, direction, amount, method, received_at, reference, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [invoice.id, direction, value, method, paidOn,
      String(reference).slice(0, 200), String(idempotencyKey), createdBy]
  );
  const paymentId = payRows[0].id;

  // Money in: Dr cash-or-clearing / Cr AR. Money out: the mirror. The cash-side
  // account depends on the method — a card settlement lands in the acquirer
  // clearing account, not the bank, or the bank reconciliation cannot be done.
  const cashAccount = PAYMENT_ACCOUNTS[method];
  const entry = await ledger.postEntry(client, {
    entryDate: paidOn,
    memo: direction === 'in'
      ? `Innborgun á reikning ${invoice.invoice_number}`
      : `Endurgreiðsla á reikning ${invoice.invoice_number}`,
    sourceType: 'payment',
    sourceId: paymentId,
    createdBy,
    lines: direction === 'in'
      ? [
        { accountCode: cashAccount, debit: value, memo: `Innborgun (${method})` },
        { accountCode: AR_ACCOUNT, credit: value, memo: 'Viðskiptakrafa greidd' },
      ]
      : [
        { accountCode: AR_ACCOUNT, debit: value, memo: 'Endurgreiðsla til viðskiptavinar' },
        { accountCode: cashAccount, credit: value, memo: `Endurgreiðsla (${method})` },
      ],
  });

  const { rows: updated } = await client.query(
    direction === 'in'
      ? `UPDATE invoices SET amount_paid = amount_paid + $2 WHERE id = $1 RETURNING *`
      : `UPDATE invoices SET amount_refunded = amount_refunded + $2 WHERE id = $1 RETURNING *`,
    [invoice.id, value]
  );

  await audit.record(client, {
    actorId: createdBy,
    action: direction === 'in' ? 'payment.recorded' : 'payment.refunded',
    entityType: 'invoice',
    entityId: invoice.id,
    requestId,
    summary: {
      invoice_number: Number(invoice.invoice_number),
      amount: value,
      method,
      direction,
      received_at: paidOn,
      journal_entry_number: entry.entry_number,
    },
  });

  logger.info(
    { invoiceId: invoice.id, paymentId, method, direction, period: entry.period },
    direction === 'in' ? 'payment recorded' : 'refund recorded'
  );
  return { invoice: updated[0], payment_id: paymentId, created: true, journal_entry: entry };
}

// What the customer still owes: the invoice, less what was credited, less what was
// paid, plus anything handed back.
function outstandingOf(invoice) {
  return Number(invoice.total_gross)
    - Number(invoice.amount_credited)
    - Number(invoice.amount_paid)
    + Number(invoice.amount_refunded);
}

const recordPayment = (client, invoiceId, opts = {}) =>
  recordSettlement(client, invoiceId, { ...opts, direction: 'in' });

/**
 * Record money going back to the customer.
 *
 * This is the SECOND half of a refund and is deliberately separate from the credit
 * note: the credit note reverses the sale (revenue and output VAT), this records
 * the cash leaving. Doing only one of the two leaves either a receivable that will
 * never be collected or VAT owed on a sale that was undone.
 */
const recordRefund = (client, invoiceId, opts = {}) =>
  recordSettlement(client, invoiceId, { ...opts, direction: 'out' });

// ── Credit notes ─────────────────────────────────────────────────────────────

/**
 * Credit an issued invoice, in whole or in part.
 *
 * This is the ONLY way to undo an invoice (Reglugerð 505/2013 gr. 9 forbids
 * editing or deleting it), and it is what a refund becomes in the books. It
 * reverses revenue and output VAT and reduces the receivable — it never touches a
 * cash account, because issuing a credit note is not itself a payment. The system
 * this replaces had a `credit_note` PAYMENT METHOD wired to debit the bank, which
 * recorded money arriving that never existed and left the sale un-reversed.
 */
async function issueCreditNote(client, invoiceId, opts = {}) {
  const {
    amountGross, reason, issuedAt, stripeRefundId = null, createdBy, requestId = null,
  } = opts;
  if (!createdBy) throw new InvoiceError('issueCreditNote requires createdBy', 500);
  if (!reason || !String(reason).trim()) {
    throw new InvoiceError('A credit note must state a reason', 400, 'REASON_REQUIRED');
  }

  // Idempotency for the Stripe refund webhook: the same refund can only ever
  // produce one credit note.
  if (stripeRefundId) {
    const { rows: dup } = await client.query(
      `SELECT id, invoice_id FROM credit_notes WHERE stripe_refund_id = $1`, [stripeRefundId]
    );
    if (dup.length) {
      return { invoice: await findById(client, dup[0].invoice_id), credit_note_id: dup[0].id, created: false };
    }
  }

  const { rows: invRows } = await client.query(
    `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [String(invoiceId)]
  );
  const invoice = invRows[0];
  if (!invoice) throw new InvoiceError('Invoice not found', 404, 'NOT_FOUND');
  if (invoice.status === 'draft') {
    throw new InvoiceError('That invoice has not been issued, so there is nothing to credit', 409, 'INVALID_STATE');
  }

  const alreadyCredited = Number(invoice.amount_credited);
  const creditable = Number(invoice.total_gross) - alreadyCredited;
  const value = assertIntegerIsk(amountGross, 'amountGross');
  if (value <= 0) throw new InvoiceError('A credit note must be greater than zero', 400, 'BAD_AMOUNT');
  if (value > creditable) {
    throw new InvoiceError(
      `Credit of ${value} ISK exceeds the ${creditable} ISK still creditable on invoice ${invoice.invoice_number}`,
      422, 'OVERCREDIT'
    );
  }

  const creditDate = issuedAt ? assertAccountingDate(issuedAt, 'issuedAt') : todayIso();

  // Split the credit across the invoice's rate mix in proportion to each rate's
  // share of the gross. A partial credit on a mixed-rate invoice must reverse VAT
  // at the rates actually charged, or the VSK return goes wrong in both directions.
  const { rows: rateRows } = await client.query(
    `SELECT vat_rate, SUM(line_net)::bigint AS net, SUM(line_vat)::bigint AS vat,
            SUM(line_gross)::bigint AS gross
       FROM invoice_lines WHERE invoice_id = $1 GROUP BY vat_rate ORDER BY vat_rate`,
    [invoice.id]
  );
  if (!rateRows.length) throw new InvoiceError('That invoice has no lines to credit', 500);

  const buckets = rateRows.map(r => ({
    rate: Number(r.vat_rate),
    net: Number(r.net),
    vat: Number(r.vat),
    gross: Number(r.gross),
  }));
  const invoiceGross = buckets.reduce((a, b) => a + b.gross, 0);
  const isFullCredit = alreadyCredited + value >= invoiceGross;

  // The net/VAT split of a credit comes from the amounts the invoice ACTUALLY
  // RECORDED, apportioned — never re-derived from the credited gross.
  //
  // Re-deriving loses the invoice's own rounding: two lines of 101 ISK charge
  // round(101×24/124) twice = 40 ISK VAT, but splitVatInclusive(202) gives 39. A
  // "full" credit would leave 1 ISK of output VAT standing on a sale that no
  // longer exists — and that króna flows straight into the VSK return. A full
  // credit therefore reverses the recorded figures exactly; a partial one
  // apportions them and the residual stays with the uncredited remainder.
  const grossShares = allocateProportional(value, buckets.map(b => b.gross));
  const creditByRate = buckets.map((b, i) => {
    const grossShare = grossShares[i];
    if (grossShare === 0) return { rate: b.rate, gross: 0, net: 0, vat: 0 };
    if (isFullCredit && alreadyCredited === 0) {
      // Reverse this rate bucket exactly as it was booked.
      return { rate: b.rate, gross: b.gross, net: b.net, vat: b.vat };
    }
    // Apportion the RECORDED vat for this bucket by the credited share of it,
    // then let net absorb the remainder so net + vat === gross holds exactly.
    const vatShare = b.gross === 0 ? 0 : Math.round((b.vat * grossShare) / b.gross);
    return { rate: b.rate, gross: grossShare, net: grossShare - vatShare, vat: vatShare };
  }).filter(b => b.gross > 0);

  const creditNet = creditByRate.reduce((a, b) => a + b.net, 0);
  const creditVat = creditByRate.reduce((a, b) => a + b.vat, 0);

  const creditNumber = await ledger.nextCounter(client, 'credit_note');
  const { rows: cnRows } = await client.query(
    `INSERT INTO credit_notes
       (credit_note_number, invoice_id, amount_net, amount_vat, amount_gross,
        reason, issued_at, stripe_refund_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, credit_note_number`,
    [creditNumber, invoice.id, creditNet, creditVat, value,
      String(reason).trim().slice(0, 500), creditDate, stripeRefundId, createdBy]
  );
  const creditNote = cnRows[0];

  // Mirror of the invoice entry: revenue and output VAT come back off, and the
  // receivable is reduced. No cash account is involved.
  const legs = [];
  const { rows: revRows } = await client.query(
    `SELECT revenue_account, SUM(line_net)::bigint AS net
       FROM invoice_lines WHERE invoice_id = $1 GROUP BY revenue_account`,
    [invoice.id]
  );
  const revenueTotal = revRows.reduce((a, r) => a + Number(r.net), 0);
  const revenueShares = allocateProportional(creditNet, revRows.map(r => Number(r.net)));
  revRows.forEach((r, i) => {
    if (revenueShares[i] > 0) {
      legs.push({ accountCode: r.revenue_account, debit: revenueShares[i], memo: 'Sala bakfærð' });
    }
  });
  if (revenueTotal === 0 && creditNet > 0) {
    throw new InvoiceError('Cannot allocate a credit against an invoice with no net revenue', 500);
  }
  for (const bucket of creditByRate) {
    if (bucket.vat === 0) continue;
    legs.push({
      accountCode: VAT_OUTPUT_ACCOUNT[bucket.rate],
      debit: bucket.vat,
      vatRate: bucket.rate,
      memo: `Útskattur ${bucket.rate}% bakfærður`,
    });
  }
  legs.push({ accountCode: AR_ACCOUNT, credit: value, memo: 'Viðskiptakrafa lækkuð' });

  const entry = await ledger.postEntry(client, {
    entryDate: creditDate,
    memo: `Kreditnóta ${creditNumber} á reikning ${invoice.invoice_number}: ${String(reason).trim()}`,
    sourceType: 'credit_note',
    sourceId: creditNote.id,
    createdBy,
    lines: legs,
  });

  const fullyCredited = isFullCredit;
  const { rows: updated } = await client.query(
    `UPDATE invoices
        SET amount_credited = amount_credited + $2,
            status = CASE WHEN $3::boolean THEN 'credited' ELSE status END
      WHERE id = $1 RETURNING *`,
    [invoice.id, value, fullyCredited]
  );

  await audit.record(client, {
    actorId: createdBy,
    action: 'credit_note.issued',
    entityType: 'invoice',
    entityId: invoice.id,
    requestId,
    summary: {
      credit_note_number: Number(creditNote.credit_note_number),
      invoice_number: Number(invoice.invoice_number),
      amount_gross: value,
      amount_vat: creditVat,
      fully_credited: fullyCredited,
      stripe_refund_id: stripeRefundId || undefined,
      journal_entry_number: entry.entry_number,
    },
  });

  logger.info(
    { invoiceId: invoice.id, creditNoteId: creditNote.id, period: entry.period, fullyCredited },
    'credit note issued'
  );
  return { invoice: updated[0], credit_note_id: creditNote.id, created: true, journal_entry: entry };
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function findById(client, id) {
  const { rows } = await (client || db).query(`SELECT * FROM invoices WHERE id = $1`, [String(id)]);
  return rows[0] || null;
}

module.exports = {
  InvoiceError,
  recordPayment,
  recordRefund,
  recordSettlement,
  outstandingOf,
  issueCreditNote,
  findById,
  PAYMENT_ACCOUNTS,
  AR_ACCOUNT,
  VAT_OUTPUT_ACCOUNT,
  revenueAccountFor,
  isExport,
  pickCustomer,
  buildLines,
  invoiceJournalLines,
  readOrderForInvoicing,
  createFromOrder,
};
