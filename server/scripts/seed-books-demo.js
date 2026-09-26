#!/usr/bin/env node
/**
 * Demo books for a small Icelandic software company.
 *
 *   npm run seed:books -- --allow-dev-db          # seed the local dev database
 *   npm run seed:books -- --allow-dev-db --wipe   # replace an earlier demo first
 *
 * (A local `…_test` database needs no flag; anything else is refused — see
 * SAFETY below.)
 *
 * The business it models is a two-person shop selling three things — a website
 * build as a fixed-price project, an ERP system as a monthly subscription, and
 * consulting by the hour — because that combination exercises the parts of the books
 * that are easy to get wrong:
 *
 *   * Services at 24%, which is nearly all of the revenue.
 *   * One printed handbook at 11%, so the reduced-rate path and its own revenue and
 *     output-VAT accounts (4200 / 2210) carry real figures rather than zeros.
 *   * A EUR-invoiced customer, so the FX translation and the "invoice must total
 *     what the customer paid" reconciliation are visible.
 *   * Foreign SaaS suppliers (Azure, GitHub, Figma) under REVERSE CHARGE, which for
 *     a software company is most of the cost base and is the single most commonly
 *     missed entry in owner-kept books.
 *   * A blocked-input-VAT purchase (client dinner) and a receipt-less purchase, so
 *     the VSK preflight has something real to complain about.
 *   * An unpaid invoice past its due date, so receivables aging is not empty.
 *
 * SAFETY (harvest 2, 2026-09-26): server/scripts/targetGuard.js runs first and
 * refuses any target that is not a LOCAL database named `…_test`, or the local
 * dev database when --allow-dev-db is passed — never a books/ops/prod name,
 * never an Azure host, never under NODE_ENV=production, APP_ENV=production|staging
 * or inside App Service. --wipe deletes ONLY the rows this script seeded, and
 * refuses (UNSEEDED_BOOKS, nothing deleted) when the books hold anything else.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });
const db = require('../config/database');
const { assertSafeTarget } = require('./targetGuard');
const ledger = require('../services/bookkeeping/ledgerService');
const invoices = require('../services/bookkeeping/invoiceService');
const expenses = require('../services/bookkeeping/expenseService');
const documents = require('../services/bookkeeping/documentService');
const Setting = require('../models/Setting');
const FxRate = require('../models/FxRate');
const { periodForDate } = require('../utils/vatPeriod');

// Demo rows are tagged so --wipe can find exactly what this script created and
// leave anything real alone.
const DEMO_SLUG_PREFIX = 'demo-';
const DEMO_EMAIL_DOMAIN = '@demo.orangesmiley.is';
// The wipe matches ANY demo domain, not the constant above: the constant moved
// from hallismiley to orangesmiley on 2026-09-03 and a wipe keyed on the new
// value left the old rows behind, invoices RESTRICT-locked to them, and the
// re-seed doubled everything. Demo customers are @demo.<anything> by definition.
const DEMO_WIPE_PATTERN = '%@demo.%';

// A checksum-valid kennitala (modulus-11), not a registered one.
const SELLER_KENNITALA = '1203894599';

function log(msg) { process.stdout.write(`${msg}\n`); }

// ── The catalogue ────────────────────────────────────────────────────────────

const PRODUCTS = [
  {
    slug: `${DEMO_SLUG_PREFIX}vefur-grunnpakki`,
    name: 'Website — standard build',
    name_is: 'Vefsíða — grunnpakki',
    price_isk: 890_000, price_eur: 590_000, vat_rate: 24, is_bookable: true,
    sku: 'WEB-STD',
  },
  {
    slug: `${DEMO_SLUG_PREFIX}vefur-serlausn`,
    name: 'Website — custom build',
    name_is: 'Vefsíða — sérlausn',
    price_isk: 2_450_000, price_eur: 1_620_000, vat_rate: 24, is_bookable: true,
    sku: 'WEB-CUSTOM',
  },
  {
    slug: `${DEMO_SLUG_PREFIX}erp-manadargjald`,
    name: 'ERP system — monthly licence',
    name_is: 'ERP kerfi — mánaðargjald',
    price_isk: 74_400, price_eur: 49_500, vat_rate: 24, is_bookable: true,
    sku: 'ERP-MONTHLY',
  },
  {
    slug: `${DEMO_SLUG_PREFIX}erp-uppsetning`,
    name: 'ERP system — implementation',
    name_is: 'ERP kerfi — uppsetning',
    price_isk: 1_240_000, price_eur: 820_000, vat_rate: 24, is_bookable: true,
    sku: 'ERP-SETUP',
  },
  {
    slug: `${DEMO_SLUG_PREFIX}radgjof-klst`,
    name: 'Consulting — hourly',
    name_is: 'Ráðgjöf — klukkustund',
    price_isk: 24_800, price_eur: 16_400, vat_rate: 24, is_bookable: true,
    sku: 'CONSULT-HR',
  },
  {
    // The one 11% line in the catalogue. Printed matter sits in the reduced band,
    // so this is what makes accounts 4200 and 2210 carry real figures.
    slug: `${DEMO_SLUG_PREFIX}erp-handbok`,
    name: 'ERP handbook (printed)',
    name_is: 'ERP handbók (prentuð)',
    price_isk: 8_880, price_eur: 5_900, vat_rate: 11, is_bookable: false,
    sku: 'ERP-BOOK',
  },
];

// ── Customers and their orders ───────────────────────────────────────────────
//
// `daysAgo` places each order so the demo spans several VSK periods, which is what
// makes the returns screen worth looking at.

const ORDERS = [
  {
    customer: 'Sjávarútvegur Vest ehf.', email: `vest${DEMO_EMAIL_DOMAIN}`,
    kennitala: '5502691299', city: 'Grundarfjörður',
    daysAgo: 96, currency: 'ISK',
    items: [{ sku: 'WEB-CUSTOM', qty: 1 }, { sku: 'ERP-SETUP', qty: 1 }],
    settle: 'paid',
  },
  {
    customer: 'Bakarí Norðurljós', email: `bakari${DEMO_EMAIL_DOMAIN}`,
    kennitala: '4811051450', city: 'Akureyri',
    daysAgo: 88, currency: 'ISK',
    items: [{ sku: 'WEB-STD', qty: 1 }, { sku: 'ERP-BOOK', qty: 2 }],
    settle: 'paid',
  },
  // The recurring ERP licence, one order per month — the shape a SaaS business
  // actually generates, and what makes month-on-month revenue readable.
  ...[74, 44, 14].map(daysAgo => ({
    customer: 'Sjávarútvegur Vest ehf.', email: `vest${DEMO_EMAIL_DOMAIN}`,
    kennitala: '5502691299', city: 'Grundarfjörður',
    daysAgo, currency: 'ISK',
    items: [{ sku: 'ERP-MONTHLY', qty: 1 }],
    settle: 'paid',
  })),
  {
    // Billed in EUR: exercises the FX translation and the reconciliation that keeps
    // the invoice total equal to what the customer actually paid.
    customer: 'Nordic Freight A/S', email: `nordic${DEMO_EMAIL_DOMAIN}`,
    country: 'DK', city: 'København',
    daysAgo: 58, currency: 'EUR',
    items: [{ sku: 'ERP-SETUP', qty: 1 }, { sku: 'CONSULT-HR', qty: 12 }],
    settle: 'paid',
  },
  {
    customer: 'Verkfræðistofa Ásgeirs', email: `asgeir${DEMO_EMAIL_DOMAIN}`,
    kennitala: '6403912459', city: 'Reykjavík',
    daysAgo: 40, currency: 'ISK',
    items: [{ sku: 'CONSULT-HR', qty: 24 }],
    settle: 'paid',
  },
  {
    // Deliberately unpaid and past due, so the aging report has a real 30+ bucket.
    customer: 'Hótel Vatnajökull', email: `hotel${DEMO_EMAIL_DOMAIN}`,
    kennitala: '7109882289', city: 'Höfn',
    daysAgo: 52, currency: 'ISK',
    items: [{ sku: 'WEB-STD', qty: 1 }, { sku: 'ERP-MONTHLY', qty: 2 }],
    settle: 'unpaid',
  },
  {
    // Part-paid, so "part_paid" is a state the screens actually display.
    customer: 'Trésmiðjan Björk', email: `bjork${DEMO_EMAIL_DOMAIN}`,
    kennitala: '5210902349', city: 'Selfoss',
    daysAgo: 26, currency: 'ISK',
    items: [{ sku: 'CONSULT-HR', qty: 8 }],
    settle: 'part',
  },
  {
    // Refunded in full — the credit note AND the cash leg, which is the flow that
    // used to be structurally impossible.
    customer: 'Kaffihús Mokka', email: `mokka${DEMO_EMAIL_DOMAIN}`,
    kennitala: '4909933019', city: 'Reykjavík',
    daysAgo: 34, currency: 'ISK',
    items: [{ sku: 'WEB-STD', qty: 1 }],
    settle: 'refunded',
  },
];

// ── Costs ────────────────────────────────────────────────────────────────────
//
// A software company's cost base is mostly foreign SaaS, which means reverse charge
// on most of it. Getting that wrong is the most common error in these books, so the
// demo makes it prominent.

const EXPENSES = [
  // Foreign, electronically supplied → self-assess Icelandic VAT.
  { supplier: 'Microsoft Azure', country: 'IE', vatNo: '', invoiceNo: 'AZ-2026-06',
    daysAgo: 92, gross: 48_900, currency: 'ISK', account: '6300', vat: 'reverse_charge_24',
    description: 'Azure hosting — App Service + Postgres', doc: true },
  { supplier: 'Microsoft Azure', country: 'IE', vatNo: '', invoiceNo: 'AZ-2026-07',
    daysAgo: 62, gross: 51_200, currency: 'ISK', account: '6300', vat: 'reverse_charge_24',
    description: 'Azure hosting — App Service + Postgres', doc: true },
  { supplier: 'Microsoft Azure', country: 'IE', vatNo: '', invoiceNo: 'AZ-2026-08',
    daysAgo: 31, gross: 53_800, currency: 'ISK', account: '6300', vat: 'reverse_charge_24',
    description: 'Azure hosting — App Service + Postgres', doc: true },
  { supplier: 'GitHub', country: 'US', vatNo: '', invoiceNo: 'GH-88213',
    daysAgo: 70, gross: 8_400, currency: 'ISK', account: '6300', vat: 'reverse_charge_24',
    description: 'GitHub Team — 2 seats', doc: true },
  { supplier: 'Figma', country: 'US', vatNo: '', invoiceNo: 'FIG-5521',
    daysAgo: 55, gross: 12_600, currency: 'ISK', account: '6300', vat: 'reverse_charge_24',
    description: 'Figma — design seats', doc: true },
  { supplier: 'Stripe Payments Europe', country: 'IE', vatNo: '', invoiceNo: 'ST-2026-07',
    daysAgo: 45, gross: 31_500, currency: 'ISK', account: '6500', vat: 'exempt',
    description: 'Stripe processing fees — treatment UNCONFIRMED, see accountant questions', doc: true },

  // Domestic, with a supplier VSK number → ordinary deductible input VAT.
  { supplier: 'Nova', country: 'IS', vatNo: '90304', invoiceNo: 'NV-114552',
    daysAgo: 90, gross: 14_880, currency: 'ISK', account: '6400', vat: 'input_24',
    description: 'Mobile + fibre', doc: true },
  { supplier: 'Nova', country: 'IS', vatNo: '90304', invoiceNo: 'NV-118904',
    daysAgo: 60, gross: 14_880, currency: 'ISK', account: '6400', vat: 'input_24',
    description: 'Mobile + fibre', doc: true },
  { supplier: 'Nova', country: 'IS', vatNo: '90304', invoiceNo: 'NV-123301',
    daysAgo: 29, gross: 15_500, currency: 'ISK', account: '6400', vat: 'input_24',
    description: 'Mobile + fibre', doc: true },
  { supplier: 'Regus Reykjavík', country: 'IS', vatNo: '112233', invoiceNo: 'RG-2026-07',
    daysAgo: 64, gross: 186_000, currency: 'ISK', account: '6200', vat: 'input_24',
    description: 'Two desks, shared office', doc: true },
  { supplier: 'Regus Reykjavík', country: 'IS', vatNo: '112233', invoiceNo: 'RG-2026-08',
    daysAgo: 33, gross: 186_000, currency: 'ISK', account: '6200', vat: 'input_24',
    description: 'Two desks, shared office', doc: true },
  { supplier: 'Origo', country: 'IS', vatNo: '55123', invoiceNo: 'OR-77120',
    daysAgo: 84, gross: 449_000, currency: 'ISK', account: '1200', vat: 'input_24',
    description: 'Two developer laptops', doc: true },
  { supplier: 'Lögmenn Höfðabakka', country: 'IS', vatNo: '66412', invoiceNo: 'LH-2211',
    daysAgo: 78, gross: 124_000, currency: 'ISK', account: '6700', vat: 'input_24',
    description: 'Terms of service + DPA review', doc: true },

  // Input VAT statutorily blocked: entertaining a client. The VAT becomes cost.
  { supplier: 'Restaurant Dill', country: 'IS', vatNo: '77321', invoiceNo: 'DL-9912',
    daysAgo: 47, gross: 68_000, currency: 'ISK', account: '6900', vat: 'input_24',
    description: 'Client dinner — ERP kickoff', doc: true },

  // No receipt attached: gives the VSK preflight a genuine blocker to report.
  { supplier: 'Sindri', country: 'IS', vatNo: '33221', invoiceNo: null,
    daysAgo: 20, gross: 23_700, currency: 'ISK', account: '6800', vat: 'input_24',
    description: 'Cables and adapters — receipt not filed yet', doc: false },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function dateDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

// ── What this script created ─────────────────────────────────────────────────
//
// Ported from icelandicstore #427 (seed:bookkeeping never deletes a real
// expense). --wipe used to `DELETE FROM` every books table outright — every
// invoice, payment, credit note, expense, journal entry, VAT return and audit
// row, whoever had entered them — and reset the invoice counter to 1001. Its
// only guard was NODE_ENV=production, which a shell holding the private books
// instance's DATABASE_URL does not set (docs/BOOKS-PARALLEL-RUN.md §0 calls it
// "the single largest risk to the figure"). Now it finds exactly the rows it
// seeded, REFUSES (code UNSEEDED_BOOKS, nothing deleted) when the books hold
// anything else, and deletes only those ids.

// An expense this script created matches one EXPENSES entry on supplier +
// invoice number + description + the amount it was entered with. The amount is
// the stored gross — except under reverse charge, where the supplier's figure is
// the NET and Icelandic VAT goes on top (expenseService.createExpense), so it is
// the stored net there.
const expenseKey = (supplier, invoiceNo, description) => `${supplier}|${invoiceNo || ''}|${description || ''}`;
const DEMO_EXPENSE_AMOUNTS = new Map(
  EXPENSES.map(e => [expenseKey(e.supplier, e.invoiceNo, e.description), e.gross])
);
function isDemoExpense(row) {
  const entered = DEMO_EXPENSE_AMOUNTS.get(expenseKey(row.supplier_name, row.supplier_invoice_no, row.description));
  if (entered === undefined) return false;
  return Number(row.amount_gross) === entered
    || (row.vat_code === 'reverse_charge_24' && Number(row.amount_net) === entered);
}
// books_documents.file_path is relative to BOOKS_UPLOAD_ROOT (documentService
// relativePath), and the stand-in receipts are written as demo/demo-<rand>.pdf.
const DEMO_DOCUMENT_PREFIX = 'demo/demo-';

async function findDemoBooks(client) {
  const ids = async (sql, params) => (await client.query(sql, params)).rows.map(r => r.id);
  const orderIds = await ids('SELECT id FROM orders WHERE guest_email LIKE $1', [DEMO_WIPE_PATTERN]);
  const invoiceIds = await ids('SELECT id FROM invoices WHERE order_id = ANY($1::text[])', [orderIds]);
  const paymentIds = await ids('SELECT id FROM payments WHERE invoice_id = ANY($1::text[])', [invoiceIds]);
  const creditNoteIds = await ids('SELECT id FROM credit_notes WHERE invoice_id = ANY($1::text[])', [invoiceIds]);
  const { rows: expenseRows } = await client.query(
    `SELECT id, supplier_name, supplier_invoice_no, description, amount_gross, amount_net,
            vat_code, document_id FROM expenses`
  );
  const demoExpenses = expenseRows.filter(isDemoExpense);
  const expenseIds = demoExpenses.map(r => r.id);
  // The stand-in receipts: the ones a demo expense points at, plus any orphan a
  // failed run left in the `demo` bucket (real uploads land in YYYY-MM buckets).
  const documentIds = [...new Set([
    ...demoExpenses.map(r => r.document_id).filter(Boolean),
    ...await ids('SELECT id FROM books_documents WHERE starts_with(file_path, $1)', [DEMO_DOCUMENT_PREFIX]),
  ])];
  const entryIds = await ids(
    `SELECT id FROM journal_entries
      WHERE (source_type = 'invoice'     AND source_id = ANY($1::text[]))
         OR (source_type = 'payment'     AND source_id = ANY($2::text[]))
         OR (source_type = 'credit_note' AND source_id = ANY($3::text[]))
         OR (source_type = 'expense'     AND source_id = ANY($4::text[]))`,
    [invoiceIds, paymentIds, creditNoteIds, expenseIds]
  );
  return { orderIds, invoiceIds, paymentIds, creditNoteIds, expenseIds, documentIds, entryIds };
}

// Every books row that is NOT the demo's, table by table. A filed VAT return or
// an intake item is never the demo's (the seed creates neither).
async function findUnseededBooks(client, demo) {
  const checks = [
    ['invoices', 'SELECT COUNT(*)::int n FROM invoices WHERE NOT (id = ANY($1::text[]))', demo.invoiceIds],
    ['payments', 'SELECT COUNT(*)::int n FROM payments WHERE NOT (id = ANY($1::text[]))', demo.paymentIds],
    ['credit_notes', 'SELECT COUNT(*)::int n FROM credit_notes WHERE NOT (id = ANY($1::text[]))', demo.creditNoteIds],
    ['expenses', 'SELECT COUNT(*)::int n FROM expenses WHERE NOT (id = ANY($1::text[]))', demo.expenseIds],
    ['journal_entries', 'SELECT COUNT(*)::int n FROM journal_entries WHERE NOT (id = ANY($1::text[]))', demo.entryIds],
    ['books_documents', 'SELECT COUNT(*)::int n FROM books_documents WHERE NOT (id = ANY($1::text[]))', demo.documentIds],
    ['vat_returns', 'SELECT COUNT(*)::int n FROM vat_returns', null],
    ['books_intake', 'SELECT COUNT(*)::int n FROM books_intake', null],
  ];
  const found = [];
  for (const [table, sql, param] of checks) {
    const { rows } = await client.query(sql, param ? [param] : []);
    if (rows[0].n > 0) found.push({ table, count: rows[0].n });
  }
  return found;
}

async function wipe() {
  log('Wiping demo books…');
  const client = await db.pool.connect();
  try {
    // One transaction: the refusal check, the trigger switch and the deletes
    // commit together or not at all — a crash can no longer leave the
    // immutability triggers disabled, and ALTER TABLE's lock keeps a concurrent
    // posting out of the window.
    await client.query('BEGIN');
    const demo = await findDemoBooks(client);
    const unseeded = await findUnseededBooks(client, demo);
    if (unseeded.length > 0) {
      const err = new Error(
        'refusing to wipe: the books hold rows this script did not create ('
        + unseeded.map(u => `${u.table} ${u.count}`).join(', ')
        + '). Nothing was deleted. Use a fresh database for the demo.'
      );
      err.code = 'UNSEEDED_BOOKS';
      err.unseeded = unseeded;
      throw err;
    }
    await wipeDemoRows(client, demo);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  log('  wiped.');
}

async function wipeDemoRows(db, demo) {
  // Books tables first (children before parents), then only the demo catalogue and
  // demo customers. Triggers block ordinary DELETEs on posted history, so these are
  // disabled for the duration — acceptable in a dev seed, never in the app.
  const guarded = [
    ['journal_lines', 'trg_journal_lines_append_only'],
    ['journal_lines', 'trg_journal_lines_no_insert_posted'],
    ['journal_entries', 'trg_journal_entries_append_only'],
    ['invoices', 'trg_invoices_issued_immutable'],
    ['invoice_lines', 'trg_invoice_lines_immutable'],
    ['payments', 'trg_payments_immutable'],
    ['credit_notes', 'trg_credit_notes_immutable'],
    ['expenses', 'trg_expenses_immutable'],
    ['books_documents', 'trg_books_documents_immutable'],
    ['vat_returns', 'trg_vat_returns_immutable'],
    ['books_audit_log', 'trg_books_audit_log_immutable'],
  ];
  // No .catch() on the switch any more: inside the transaction a failed ALTER
  // aborts the wipe (and the rollback restores the trigger), where a swallowed
  // one used to let the deletes run into the trigger half-way through.
  for (const [table, trig] of guarded) {
    await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trig}`);
  }
  const auditIds = [
    ...demo.invoiceIds, ...demo.paymentIds, ...demo.creditNoteIds,
    ...demo.expenseIds, ...demo.documentIds, ...demo.entryIds,
  ];
  // Every statement names the ids findDemoBooks() found — never a whole table.
  await db.query('DELETE FROM journal_lines WHERE entry_id = ANY($1::text[])', [demo.entryIds]);
  await db.query('DELETE FROM journal_entries WHERE id = ANY($1::text[])', [demo.entryIds]);
  await db.query('DELETE FROM credit_notes WHERE id = ANY($1::text[])', [demo.creditNoteIds]);
  await db.query('DELETE FROM payments WHERE id = ANY($1::text[])', [demo.paymentIds]);
  await db.query('DELETE FROM invoice_lines WHERE invoice_id = ANY($1::text[])', [demo.invoiceIds]);
  await db.query('DELETE FROM invoices WHERE id = ANY($1::text[])', [demo.invoiceIds]);
  await db.query('DELETE FROM expenses WHERE id = ANY($1::text[])', [demo.expenseIds]);
  await db.query('DELETE FROM books_documents WHERE id = ANY($1::text[])', [demo.documentIds]);
  await db.query('DELETE FROM books_audit_log WHERE entity_id = ANY($1::text[])', [auditIds]);
  // Reopening the periods and restarting the number series is safe ONLY because
  // wipe() refused above unless the demo was all the books held: after these
  // deletes the ledger is empty, so no real document shares a number.
  await db.query(`UPDATE fiscal_periods SET status='open', locked_at=NULL, locked_by=NULL`);
  await db.query(`UPDATE bookkeeping_counters SET next_value = CASE
                    WHEN name = 'invoice' THEN 1001 ELSE 1 END`);
  await db.query('DELETE FROM order_items WHERE order_id = ANY($1::text[])', [demo.orderIds]);
  await db.query('DELETE FROM orders WHERE id = ANY($1::text[])', [demo.orderIds]);
  await db.query(`DELETE FROM products WHERE slug LIKE $1`, [`${DEMO_SLUG_PREFIX}%`]);
  // The ledger's deferred constraint triggers (the entry-balances check) queue
  // events on the deletes above, and ALTER TABLE refuses a table with pending
  // trigger events — fire them now, inside the transaction.
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  for (const [table, trig] of guarded) {
    await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trig}`);
  }
}

async function ensureSeller() {
  const s = await Setting.getBookkeepingSettings();
  if (s.seller_complete) {
    log(`Seller already configured: ${s.seller_name}`);
    return;
  }
  await Setting.updateBookkeepingSettings({
    seller_name: 'Smiley Software ehf.',
    seller_kennitala: SELLER_KENNITALA,
    seller_vat_number: '148820',
    seller_address: 'Höfðabakki 9\n110 Reykjavík',
    payment_terms_days: 14,
    accountant_name: 'Bókhaldsstofan Tveir Plús ehf.',
    accountant_email: 'bokari@example.is',
  });
  log('Seller identity configured (demo values — replace before real use).');
}

async function ensureFxRates() {
  // A rate for every day the demo touches, so a EUR invoice on any of them can be
  // translated. Real rates would come from `npm run books:fx`.
  const base = 148.5;
  for (let d = 0; d <= 120; d += 1) {
    const day = dateDaysAgo(d);
    // Gentle wobble so the demo does not look like a constant.
    const rate = Number((base + Math.sin(d / 9) * 3.2).toFixed(4));
    await FxRate.set({ rateDate: day, currency: 'EUR', rate, source: 'manual' });
  }
  log('EUR rates seeded for the last 120 days.');
}

async function ensureProducts() {
  const bySku = {};
  for (const p of PRODUCTS) {
    const { rows } = await db.query(
      `INSERT INTO products (slug, name, name_is, description, price_isk, price_eur,
                             stock, sku, is_bookable, vat_rate, category, active)
       VALUES ($1,$2,$3,'',$4,$5,999,$6,$7,$8,'tech_service',TRUE)
       ON CONFLICT (slug) DO UPDATE
         SET price_isk = EXCLUDED.price_isk, price_eur = EXCLUDED.price_eur,
             vat_rate = EXCLUDED.vat_rate, is_bookable = EXCLUDED.is_bookable
       RETURNING id, sku, price_isk, price_eur, name`,
      [p.slug, p.name, p.name_is, p.price_isk, p.price_eur, p.sku, p.is_bookable, p.vat_rate]
    );
    bySku[p.sku] = { ...rows[0], vat_rate: p.vat_rate };
  }
  log(`${PRODUCTS.length} demo products.`);
  return bySku;
}

async function createOrder(spec, bySku) {
  const paidAt = dateDaysAgo(spec.daysAgo);
  const lines = spec.items.map((it) => {
    const p = bySku[it.sku];
    const unit = spec.currency === 'EUR' ? Number(p.price_eur) : Number(p.price_isk);
    return { product: p, qty: it.qty, unit, gross: unit * it.qty };
  });
  const subtotal = lines.reduce((a, l) => a + l.gross, 0);
  const { rows } = await db.query(
    `INSERT INTO orders (order_number, currency, subtotal, shipping, total, status,
       payment_status, shipping_method, shipping_address, guest_email, guest_name, paid_at)
     -- 'local_pickup' rather than a 'digital' method: orders.shipping_method is
     -- constrained to flat_rate|local_pickup, and software has nothing to ship.
     VALUES ($1,$2,$3,0,$3,'paid',$4,'local_pickup',$5::jsonb,$6,$7,$8::timestamptz)
     RETURNING id, order_number`,
    [
      `HP-${paidAt.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      spec.currency, subtotal,
      spec.settle === 'unpaid' ? 'pending' : 'paid',
      JSON.stringify({
        name: spec.customer,
        line1: 'Demo address 1',
        postal: '101',
        city: spec.city,
        country: spec.country === 'DK' ? 'Denmark' : 'Iceland',
        country_code: spec.country || 'IS',
      }),
      spec.email, spec.customer, paidAt,
    ]
  );
  const order = rows[0];
  for (const l of lines) {
    await db.query(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot,
         product_price_snapshot, quantity, currency)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [order.id, l.product.id, l.product.name, l.unit, l.qty, spec.currency]
    );
  }
  return { order, paidAt, subtotal };
}

async function seedSales(adminId, bySku) {
  let issued = 0;
  for (const spec of ORDERS) {
    const { order } = await createOrder(spec, bySku);
    const { invoice } = await ledger.withTransaction(client =>
      invoices.createFromOrder(client, order.id, { createdBy: adminId }));
    issued += 1;

    const outstanding = Number(invoice.total_gross);
    // Settlement dated a few days after issue, so the statement reads chronologically.
    const settledOn = dateDaysAgo(Math.max(0, spec.daysAgo - 6));

    if (spec.settle === 'paid') {
      await ledger.withTransaction(client => invoices.recordPayment(client, invoice.id, {
        amount: outstanding, method: 'bank_transfer', receivedAt: settledOn,
        reference: `Millifærsla ${invoice.invoice_number}`,
        idempotencyKey: `seed-pay-${invoice.id}`, createdBy: adminId,
      }));
    } else if (spec.settle === 'part') {
      await ledger.withTransaction(client => invoices.recordPayment(client, invoice.id, {
        amount: Math.round(outstanding / 2), method: 'bank_transfer', receivedAt: settledOn,
        reference: 'Hluti greiddur', idempotencyKey: `seed-part-${invoice.id}`, createdBy: adminId,
      }));
    } else if (spec.settle === 'refunded') {
      // Both halves: the credit note reverses the sale and its VAT, the refund
      // records the cash going back out.
      await ledger.withTransaction(client => invoices.recordPayment(client, invoice.id, {
        amount: outstanding, method: 'card', receivedAt: settledOn,
        idempotencyKey: `seed-refpay-${invoice.id}`, createdBy: adminId,
      }));
      await ledger.withTransaction(client => invoices.issueCreditNote(client, invoice.id, {
        amountGross: outstanding, reason: 'Verkefni afturkallað af viðskiptavini',
        issuedAt: dateDaysAgo(Math.max(0, spec.daysAgo - 10)), createdBy: adminId,
      }));
      await ledger.withTransaction(client => invoices.recordRefund(client, invoice.id, {
        amount: outstanding, method: 'card',
        receivedAt: dateDaysAgo(Math.max(0, spec.daysAgo - 10)),
        idempotencyKey: `seed-refund-${invoice.id}`, createdBy: adminId,
      }));
    }
    // 'unpaid' deliberately left alone — that is the aging bucket.
  }
  log(`${issued} invoices issued, with payments, a part-payment and a full refund.`);
}

async function seedExpenses(adminId) {
  let count = 0;
  for (const e of EXPENSES) {
    let documentId = null;
    if (e.doc) {
      // A stand-in "scan". Real receipts arrive through the upload endpoint; this
      // only needs to exist so the missing-document queue is honest about which
      // entries genuinely lack evidence.
      const fs = require('fs');
      const path = require('path');
      const { booksDocumentDir } = require('../config/paths');
      const dir = booksDocumentDir('demo');
      fs.mkdirSync(dir, { recursive: true });
      const abs = path.join(dir, `demo-${Math.random().toString(36).slice(2, 10)}.pdf`);
      fs.writeFileSync(abs, `%PDF-1.4\n% Demo receipt: ${e.supplier} ${e.invoiceNo || ''}\n`);
      const registered = await ledger.withTransaction(client => documents.register(client, {
        path: abs,
        originalname: `${e.supplier.replace(/\W+/g, '-').toLowerCase()}-${e.invoiceNo || 'kvittun'}.pdf`,
        mimetype: 'application/pdf',
        size: fs.statSync(abs).size,
      }, { kind: 'supplier_invoice', createdBy: adminId }));
      documentId = registered.document.id;
    }

    await ledger.withTransaction(client => expenses.createExpense(client, {
      supplierName: e.supplier,
      supplierVatNumber: e.vatNo,
      supplierCountry: e.country,
      supplierInvoiceNo: e.invoiceNo,
      expenseDate: dateDaysAgo(e.daysAgo),
      amountGross: e.gross,
      currency: e.currency,
      accountCode: e.account,
      vatCode: e.vat,
      description: e.description,
      documentId,
      // The demo intentionally contains repeated monthly bills from the same
      // supplier, which is exactly what the duplicate detector is meant to flag.
      allowDuplicate: true,
      createdBy: adminId,
    }));
    count += 1;
  }
  log(`${count} expenses recorded (reverse charge, blocked input VAT, one without a receipt).`);
}

async function summarise() {
  const vatService = require('../services/bookkeeping/vatService');
  // Enough periods to reach back past the seeded activity — the newest few are
  // future periods with nothing in them.
  const periods = await vatService.listPeriods(db, { limit: 30 });
  const active = periods.filter(p => p.entry_count > 0);
  log('');
  log('VSK periods with activity:');
  for (const p of active) {
    const d = await vatService.deriveReturn(db, p.period);
    log(`  ${p.period}  ${p.starts_on}–${p.ends_on}  `
      + `A ${d.box_a_net_24.toLocaleString('is-IS')}  `
      + `B ${d.box_b_net_11.toLocaleString('is-IS')}  `
      + `C ${d.box_c_net_zero.toLocaleString('is-IS')}  `
      + `D ${d.box_d_output.toLocaleString('is-IS')}  `
      + `E ${d.box_e_input.toLocaleString('is-IS')}  `
      + `=> ${d.box_f_payable.toLocaleString('is-IS')} kr.`);
  }
  const current = periodForDate(new Date().toISOString().slice(0, 10));
  const pre = await vatService.preflight(db, current);
  log('');
  log(`Preflight for the current period (${current}):`);
  if (!pre.findings.length) log('  nothing to review');
  for (const f of pre.findings) log(`  [${f.level}] ${f.message}`);
}

async function main(argv = process.argv) {
  const wipeFirst = argv.includes('--wipe');
  // The shared guard (server/scripts/targetGuard.js) replaces the old
  // NODE_ENV-only check: a local `_test` database, or the local dev database
  // with --allow-dev-db — never a books/ops/prod name, never Azure. Checked
  // before the first query; the pool connects lazily.
  const target = assertSafeTarget({
    databaseUrl: db.pool.options?.connectionString || process.env.DATABASE_URL,
    env: process.env,
    allowDevDb: argv.includes('--allow-dev-db'),
  }, { label: 'seed:books', exit: () => {} });
  if (!target.ok) return 1;

  const { rows: admins } = await db.query(
    `SELECT id, username FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`
  );
  if (!admins.length) {
    log('No admin user found. Run `node server/scripts/setup-admin.js` first.');
    return 1;
  }
  const adminId = admins[0].id;
  log(`Seeding as admin "${admins[0].username}".`);

  if (wipeFirst) await wipe();

  ledger.invalidateAccountCache();
  await ensureSeller();
  await ensureFxRates();
  const bySku = await ensureProducts();
  await seedSales(adminId, bySku);
  await seedExpenses(adminId);
  await summarise();

  log('');
  log('Done. Open /admin/books, /admin/books/invoices, /admin/books/expenses,');
  log('/admin/books/ar and /admin/books/vat to see it.');
  return 0;
}

if (require.main === module) {
  main()
    .then(async (code) => {
      await db.pool.end().catch(() => {});
      process.exit(code);
    })
    .catch(async (err) => {
      log(`FAILED: ${err.message}`);
      if (err.stack) log(err.stack.split('\n').slice(1, 4).join('\n'));
      await db.pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = {
  main, wipe, findDemoBooks, findUnseededBooks, ensureSeller, ensureFxRates, ensureProducts,
  seedSales, seedExpenses, EXPENSES, ORDERS, PRODUCTS,
};
