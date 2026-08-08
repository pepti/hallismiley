// Admin bookkeeping HTTP layer.
//
// Validation policy here is stricter than elsewhere in the app on purpose: a bad
// request must produce a 400 with an explanation, never a Postgres error surfacing
// as a 500. In the system this replaces, `?from=abc`, `?limit=-1` and a 30-digit
// search term were each a 500, because raw request values reached SQL unchecked.
//
// Every response uses the project's { error, code } envelope (docs/API.md).

const db = require('../config/database');
const logger = require('../logger');
const Invoice = require('../models/Invoice');
const Expense = require('../models/Expense');
const FxRate = require('../models/FxRate');
const Setting = require('../models/Setting');
const ledger = require('../services/bookkeeping/ledgerService');
const invoiceService = require('../services/bookkeeping/invoiceService');
const expenseService = require('../services/bookkeeping/expenseService');
const vatService = require('../services/bookkeeping/vatService');
const reconciliation = require('../services/bookkeeping/reconciliationService');
const reports = require('../services/bookkeeping/reportService');
const payroll = require('../services/bookkeeping/payrollService');
const posService = require('../services/bookkeeping/posService');
const documentService = require('../services/bookkeeping/documentService');
const audit = require('../services/bookkeeping/auditLog');
const { toCsv, csvHeaders } = require('../utils/csv');
const bookkeepingPdf = require('../services/bookkeepingPdf');
const securityLogger = require('../observability/securityLogger');
const { toIsoDate, todayIso, assertAccountingDate, addDays, DateError } = require('../utils/booksDate');
const { VatError } = require('../utils/vat');
const { FxError } = require('../utils/fx');

const MAX_LIMIT = 200;
const MAX_OFFSET = 1_000_000;
const PAYMENT_METHODS = Object.keys(invoiceService.PAYMENT_ACCOUNTS);

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// ── Request validation ────────────────────────────────────────────────────────

// Bounded on BOTH ends. `Math.min(Number(x) || d, cap)` — the idiom in the source
// system — clamps only the top, so ?limit=-1 became `LIMIT -1` and a 500.
function parsePagination(query) {
  const limitRaw = query.limit === undefined ? 50 : Number(query.limit);
  const offsetRaw = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > MAX_LIMIT) {
    throw new BadRequest(`limit must be a whole number between 1 and ${MAX_LIMIT}`);
  }
  if (!Number.isInteger(offsetRaw) || offsetRaw < 0 || offsetRaw > MAX_OFFSET) {
    throw new BadRequest(`offset must be a whole number between 0 and ${MAX_OFFSET}`);
  }
  return { limit: limitRaw, offset: offsetRaw };
}

// A malformed or reversed date range is rejected, not silently swapped. Swapping
// gives the user numbers for a window they did not ask for, with no indication.
function parseRange(query, { defaultDays = 60 } = {}) {
  let from = null;
  let to = null;
  try {
    if (query.from) from = assertAccountingDate(query.from, 'from', { allowFuture: true });
    if (query.to) to = assertAccountingDate(query.to, 'to', { allowFuture: true });
  } catch (err) {
    throw new BadRequest(err.message);
  }
  if (from && to && from > to) throw new BadRequest(`from (${from}) is after to (${to})`);
  if (!from && !to) {
    to = todayIso();
    from = addDays(to, -defaultDays);
  } else if (!from) {
    from = addDays(to, -defaultDays);
  } else if (!to) {
    to = todayIso();
    if (to < from) to = from;
  }
  return { from, to };
}

function parseEnum(value, allowed, label) {
  if (value === undefined || value === null || value === '') return null;
  const v = String(value);
  if (!allowed.includes(v)) {
    throw new BadRequest(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return v;
}

// Amounts are whole ISK. Reject NaN/Infinity/float/negative explicitly rather than
// letting a coerced value reach a BIGINT column.
function parseAmount(value, label) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    throw new BadRequest(`${label} is required`);
  }
  // A JSON body can carry an array where a scalar belongs, and Number([1000]) is
  // 1000 — it would pass every check below as a value nobody validated.
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new BadRequest(`${label} must be a whole number of ISK`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new BadRequest(`${label} must be a whole number of ISK`);
  }
  if (n <= 0) throw new BadRequest(`${label} must be greater than zero`);
  if (!Number.isSafeInteger(n)) throw new BadRequest(`${label} is unrealistically large`);
  return n;
}

function parseText(value, label, { maxLen = 200, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new BadRequest(`${label} is required`);
    return '';
  }
  if (typeof value !== 'string') throw new BadRequest(`${label} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new BadRequest(`${label} is required`);
  if (trimmed.length > maxLen) throw new BadRequest(`${label} must be ${maxLen} characters or fewer`);
  return trimmed;
}

// Ids are TEXT uuids. Checking the shape keeps a nonsense id from becoming a
// database round trip, and keeps it out of the logs.
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseId(value, label) {
  const v = String(value || '');
  if (!ID_RE.test(v)) throw new BadRequest(`${label} is not a valid id`);
  return v;
}

// Domain errors carry their own status and are safe to show; anything else is a
// bug and goes to the central error handler, which hides the detail.
function isClientSafe(err) {
  return err instanceof BadRequest
    || err instanceof DateError
    || err instanceof VatError
    || err instanceof FxError
    || (err && typeof err.status === 'number' && err.status >= 400 && err.status < 500);
}

function fail(res, err, next) {
  if (isClientSafe(err)) {
    const status = err.status || 400;
    return res.status(status).json({ error: err.message, code: status });
  }
  return next(err);
}

// ── Dashboard ────────────────────────────────────────────────────────────────

async function getDashboard(req, res, next) {
  try {
    const { from, to } = parseRange(req.query, { defaultDays: 60 });
    const [metrics, series, settings, fxFreshness] = await Promise.all([
      Invoice.metrics({ from, to }),
      Invoice.timeseries({ from, to }),
      Setting.getBookkeepingSettings(),
      FxRate.freshness('EUR'),
    ]);
    res.json({
      range: { from, to },
      metrics,
      timeseries: series,
      // Standing setup warnings, so a blocked first invoice is visible before it
      // is attempted rather than as a failure at the worst moment.
      readiness: {
        seller_complete: settings.seller_complete,
        coa_confirmed_at: settings.coa_confirmed_at,
        fx: fxFreshness,
      },
    });
  } catch (err) { fail(res, err, next); }
}

// ── Invoices ─────────────────────────────────────────────────────────────────

async function listInvoices(req, res, next) {
  try {
    const { limit, offset } = parsePagination(req.query);
    const status = parseEnum(req.query.status, Invoice.DISPLAY_STATUSES, 'status');
    const sort = parseEnum(req.query.sort, Object.keys(Invoice.SORTABLE), 'sort') || 'issued';
    const dir = parseEnum(req.query.dir, ['asc', 'desc'], 'dir') || 'desc';
    const series = parseEnum(req.query.series, ['invoice', 'receipt'], 'series');
    const q = req.query.q ? parseText(req.query.q, 'q', { maxLen: 100 }) : null;
    // No default range on the list: filtering to the last 60 days by default would
    // silently hide older invoices from a search.
    let from = null;
    let to = null;
    if (req.query.from) from = assertAccountingDate(req.query.from, 'from', { allowFuture: true });
    if (req.query.to) to = assertAccountingDate(req.query.to, 'to', { allowFuture: true });
    if (from && to && from > to) throw new BadRequest(`from (${from}) is after to (${to})`);

    const result = await Invoice.list({ q, status, from, to, series, sort, dir, limit, offset });
    res.json({ ...result, limit, offset });
  } catch (err) { fail(res, err, next); }
}

async function getInvoice(req, res, next) {
  try {
    const id = parseId(req.params.id, 'invoice id');
    const invoice = await Invoice.findDetail(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found', code: 404 });
    const history = await audit.forEntity(db, 'invoice', id, 50);
    res.json({ invoice, history });
  } catch (err) { fail(res, err, next); }
}

async function createInvoiceFromOrder(req, res, next) {
  try {
    const orderId = parseId(req.params.orderId, 'order id');
    const issuedAt = req.body && req.body.issued_at
      ? assertAccountingDate(req.body.issued_at, 'issued_at') : undefined;

    const result = await ledger.withTransaction(client =>
      invoiceService.createFromOrder(client, orderId, {
        createdBy: req.user.id,
        issuedAt,
        requestId: req.requestId || null,
      })
    );
    securityLogger.adminAction(req.user.id, 'books.invoice.issue', result.invoice.id, {
      created: result.created,
    });
    res.status(result.created ? 201 : 200).json({
      invoice: await Invoice.findById(result.invoice.id),
      created: result.created,
    });
  } catch (err) { fail(res, err, next); }
}

// Shared by the payment and refund endpoints — same request shape, opposite
// direction of travel.
function parseSettlementBody(req) {
  const body = req.body || {};
  const amount = parseAmount(body.amount, 'amount');
  const method = parseEnum(body.method, PAYMENT_METHODS, 'method');
  if (!method) throw new BadRequest(`method must be one of: ${PAYMENT_METHODS.join(', ')}`);
  const receivedAt = body.received_at
    ? assertAccountingDate(body.received_at, 'received_at') : todayIso();
  const reference = parseText(body.reference, 'reference', { maxLen: 200 });
  // The client supplies the key so a retried request is a no-op. Without one we
  // cannot tell a retry from a second genuine payment of the same amount — so it
  // is required rather than defaulted.
  const idempotencyKey = parseText(body.idempotency_key, 'idempotency_key',
    { maxLen: 100, required: true });
  return { amount, method, receivedAt, reference, idempotencyKey };
}

async function recordPayment(req, res, next) {
  try {
    const id = parseId(req.params.id, 'invoice id');
    const settlement = parseSettlementBody(req);

    const result = await ledger.withTransaction(client =>
      invoiceService.recordPayment(client, id, {
        ...settlement,
        ...audit.actorOf(req),
      })
    );
    securityLogger.adminAction(req.user.id, 'books.payment.record', id, {
      method: settlement.method, created: result.created,
    });
    res.status(result.created ? 201 : 200).json({
      invoice: await Invoice.findById(id),
      created: result.created,
    });
  } catch (err) { fail(res, err, next); }
}

/**
 * Record money going back to the customer.
 *
 * This is only HALF of a refund: it books the cash leaving. The sale itself is
 * reversed by a credit note. The UI issues both, but they are separate endpoints
 * because they are separate facts — a chargeback is a refund with no credit note,
 * and a goodwill credit is a credit note with no refund.
 */
async function recordRefund(req, res, next) {
  try {
    const id = parseId(req.params.id, 'invoice id');
    const settlement = parseSettlementBody(req);

    const result = await ledger.withTransaction(client =>
      invoiceService.recordRefund(client, id, {
        ...settlement,
        ...audit.actorOf(req),
      })
    );
    securityLogger.adminAction(req.user.id, 'books.payment.refund', id, {
      method: settlement.method, created: result.created,
    });
    res.status(result.created ? 201 : 200).json({
      invoice: await Invoice.findById(id),
      created: result.created,
    });
  } catch (err) { fail(res, err, next); }
}

async function createCreditNote(req, res, next) {
  try {
    const id = parseId(req.params.id, 'invoice id');
    const body = req.body || {};
    const amountGross = parseAmount(body.amount_gross, 'amount_gross');
    const reason = parseText(body.reason, 'reason', { maxLen: 500, required: true });
    const issuedAt = body.issued_at
      ? assertAccountingDate(body.issued_at, 'issued_at') : todayIso();

    const result = await ledger.withTransaction(client =>
      invoiceService.issueCreditNote(client, id, {
        amountGross, reason, issuedAt,
        ...audit.actorOf(req),
      })
    );
    securityLogger.adminAction(req.user.id, 'books.credit_note.issue', id, { created: result.created });
    res.status(result.created ? 201 : 200).json({
      invoice: await Invoice.findDetail(id),
      created: result.created,
    });
  } catch (err) { fail(res, err, next); }
}

async function getInvoicePdf(req, res, next) {
  try {
    const id = parseId(req.params.id, 'invoice id');
    const invoice = await Invoice.findDetail(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found', code: 404 });

    const filename = `${invoice.series === 'receipt' ? 'kvittun' : 'reikningur'}-${invoice.invoice_number}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    // attachment + no-store: an invoice carries a customer's name and address, and
    // should not sit in a shared browser cache or be rendered inline by accident.
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'no-store');
    bookkeepingPdf.streamInvoice(res, { invoice });
  } catch (err) { fail(res, err, next); }
}

// ── Settings ─────────────────────────────────────────────────────────────────

async function getSettings(req, res, next) {
  try {
    const [settings, fx] = await Promise.all([
      Setting.getBookkeepingSettings(),
      FxRate.recent('EUR', 30),
    ]);
    res.json({ settings, fx_rates: fx });
  } catch (err) { fail(res, err, next); }
}

async function updateSettings(req, res, next) {
  try {
    const settings = await Setting.updateBookkeepingSettings(req.body || {});
    // Log the ACCEPTED field names, not the raw body keys — otherwise an admin can
    // flood the security log with arbitrary strings up to the body limit.
    securityLogger.adminAction(req.user.id, 'books.settings.update', null, {
      fields: Object.keys(settings).filter(k => Object.prototype.hasOwnProperty.call(req.body || {}, k)),
    });
    logger.info({ actorId: req.user.id }, 'bookkeeping settings updated');
    res.json({ settings });
  } catch (err) {
    // Only OUR validation errors become 400s. Blanket-stamping every error as a
    // client mistake echoed pg failures ("connect ECONNREFUSED 10.x.x.x:5432",
    // constraint names) straight to the browser AND hid genuine outages from the
    // central handler and Sentry, because fail() returns instead of calling next().
    if (err instanceof Setting.SettingValidationError) err.status = 400;
    fail(res, err, next);
  }
}

async function setFxRate(req, res, next) {
  try {
    const body = req.body || {};
    const rateDate = assertAccountingDate(body.rate_date || todayIso(), 'rate_date');
    const currency = parseEnum(body.currency || 'EUR', ['EUR', 'USD', 'GBP', 'DKK'], 'currency');
    const rate = Number(body.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new BadRequest('rate must be a positive number');

    // Rate and audit row in ONE transaction. Written separately, a failed audit
    // write left a live rate with no record of who set it — and this rate scales
    // the ISK total of every EUR invoice, so it is exactly the value that must be
    // attributable.
    const row = await ledger.withTransaction(async (client) => {
      const saved = await FxRate.set(
        { rateDate, currency, rate, source: 'manual', createdBy: req.user.id }, client
      );
      await audit.record(client, {
        actorId: req.user.id,
        action: 'fx.rate_set',
        entityType: 'fx_rate',
        entityId: `${currency}:${rateDate}`,
        requestId: req.requestId || null,
        summary: { currency, rate_date: rateDate, rate },
      });
      return saved;
    });
    securityLogger.adminAction(req.user.id, 'books.fx.set', `${currency}:${rateDate}`, { rate });
    res.status(201).json({ fx_rate: { ...row, rate: Number(row.rate), rate_date: toIsoDate(row.rate_date) } });
  } catch (err) { fail(res, err, next); }
}

// ── Expenses ─────────────────────────────────────────────────────────────────

async function listExpenses(req, res, next) {
  try {
    const { limit, offset } = parsePagination(req.query);
    const vatCode = parseEnum(req.query.vat_code, expenseService.VAT_CODES, 'vat_code');
    const sort = parseEnum(req.query.sort, Object.keys(Expense.SORTABLE), 'sort') || 'date';
    const dir = parseEnum(req.query.dir, ['asc', 'desc'], 'dir') || 'desc';
    const q = req.query.q ? parseText(req.query.q, 'q', { maxLen: 100 }) : null;
    const missingDocument = req.query.missing_document === 'true';
    const deductible = req.query.deductible === undefined
      ? null : req.query.deductible === 'true';
    let from = null;
    let to = null;
    if (req.query.from) from = assertAccountingDate(req.query.from, 'from', { allowFuture: true });
    if (req.query.to) to = assertAccountingDate(req.query.to, 'to', { allowFuture: true });
    if (from && to && from > to) throw new BadRequest(`from (${from}) is after to (${to})`);

    const result = await Expense.list({
      q, from, to, vatCode, missingDocument, deductible, sort, dir, limit, offset,
    });
    res.json({ ...result, limit, offset });
  } catch (err) { fail(res, err, next); }
}

async function getExpense(req, res, next) {
  try {
    const id = parseId(req.params.id, 'expense id');
    const expense = await Expense.findById(id);
    if (!expense) return res.status(404).json({ error: 'Expense not found', code: 404 });
    const history = await audit.forEntity(db, 'expense', id, 50);
    res.json({ expense, history });
  } catch (err) { fail(res, err, next); }
}

async function createExpense(req, res, next) {
  try {
    const body = req.body || {};
    const payload = {
      supplierName: parseText(body.supplier_name, 'supplier_name', { maxLen: 200, required: true }),
      supplierKennitala: body.supplier_kennitala
        ? parseText(body.supplier_kennitala, 'supplier_kennitala', { maxLen: 20 }) : null,
      supplierVatNumber: parseText(body.supplier_vat_number, 'supplier_vat_number', { maxLen: 20 }),
      supplierCountry: parseText(body.supplier_country, 'supplier_country', { maxLen: 3 }) || 'IS',
      supplierInvoiceNo: body.supplier_invoice_no
        ? parseText(body.supplier_invoice_no, 'supplier_invoice_no', { maxLen: 100 }) : null,
      description: parseText(body.description, 'description', { maxLen: 500 }),
      expenseDate: assertAccountingDate(body.expense_date, 'expense_date'),
      amountGross: parseAmount(body.amount_gross, 'amount_gross'),
      currency: parseEnum(body.currency || 'ISK', ['ISK', 'EUR', 'USD', 'GBP', 'DKK'], 'currency'),
      vatCode: parseEnum(body.vat_code || 'input_24', expenseService.VAT_CODES, 'vat_code'),
      accountCode: parseText(body.account_code, 'account_code', { maxLen: 20, required: true }),
      documentId: body.document_id ? parseId(body.document_id, 'document_id') : null,
      allowDuplicate: body.allow_duplicate === true,
      createdBy: req.user.id,
      requestId: req.requestId || null,
    };

    const result = await ledger.withTransaction(client =>
      expenseService.createExpense(client, payload));
    securityLogger.adminAction(req.user.id, 'books.expense.create', result.expense.id, {
      account: payload.accountCode, deductible: result.verdict.deductible,
    });
    res.status(201).json({
      expense: await Expense.findById(result.expense.id),
      verdict: result.verdict,
    });
  } catch (err) {
    // A suspected duplicate is a 409 the UI turns into a confirm-and-resubmit,
    // so the candidate rows travel with the error rather than being looked up again.
    if (err && err.code === 'POSSIBLE_DUPLICATE') {
      return res.status(409).json({ error: err.message, code: 409, duplicates: err.duplicates || [] });
    }
    return fail(res, err, next);
  }
}

// The VAT verdict for a purchase, WITHOUT saving it. Lets the form tell the user
// "input VAT is not deductible on this, because…" while they are still typing,
// rather than after they have committed the entry.
async function previewExpenseVat(req, res, next) {
  try {
    const body = req.body || {};
    const accountCode = parseText(body.account_code, 'account_code', { maxLen: 20, required: true });
    const account = await ledger.accountByCode(accountCode);
    const verdict = expenseService.assessVat({
      vatCode: parseEnum(body.vat_code || 'input_24', expenseService.VAT_CODES, 'vat_code'),
      account,
      supplierCountry: parseText(body.supplier_country, 'supplier_country', { maxLen: 3 }) || 'IS',
      supplierVatNumber: parseText(body.supplier_vat_number, 'supplier_vat_number', { maxLen: 20 }),
    });
    res.json({ verdict, account: { code: account.code, name: account.name, type: account.type } });
  } catch (err) { fail(res, err, next); }
}

async function attachExpenseDocument(req, res, next) {
  try {
    const id = parseId(req.params.id, 'expense id');
    const documentId = req.body && req.body.document_id
      ? parseId(req.body.document_id, 'document_id') : null;
    await ledger.withTransaction(client =>
      expenseService.attachDocument(client, id, {
        documentId, ...audit.actorOf(req),
      }));
    res.json({ expense: await Expense.findById(id) });
  } catch (err) { fail(res, err, next); }
}

async function getMissingDocuments(req, res, next) {
  try {
    res.json(await Expense.missingDocuments({ limit: req.query.limit }));
  } catch (err) { fail(res, err, next); }
}

async function getSuppliers(req, res, next) {
  try {
    res.json({ suppliers: await Expense.recentSuppliers({ limit: req.query.limit }) });
  } catch (err) { fail(res, err, next); }
}

// The chart of accounts, for the expense form's account picker. Includes the
// input_vat_blocked flag so the form can warn before the entry is submitted.
async function getAccounts(req, res, next) {
  try {
    const { all } = await ledger.loadAccounts();
    res.json({
      accounts: all
        .filter(a => a.is_active)
        .map(a => ({
          code: a.code, name: a.name, name_en: a.name_en, type: a.type,
          vat_code: a.vat_code, input_vat_blocked: a.input_vat_blocked,
          // Whether a purchase may be posted here. Control accounts (AR, bank,
          // cash, input VAT, clearing, suspense) are excluded — they are the
          // machinery postings move through, not a destination.
          purchasable: expenseService.isPurchasable(a),
        })),
    });
  } catch (err) { fail(res, err, next); }
}

// ── Documents ────────────────────────────────────────────────────────────────

async function uploadDocument(req, res, next) {
  try {
    const kind = parseEnum(req.body && req.body.kind, documentService.KINDS, 'kind') || 'receipt';
    const note = parseText(req.body && req.body.note, 'note', { maxLen: 500 });
    const result = await ledger.withTransaction(client =>
      documentService.register(client, req.file, {
        kind, note, ...audit.actorOf(req),
      }));
    res.status(201).json(result);
  } catch (err) { fail(res, err, next); }
}

async function getDocument(req, res, next) {
  try {
    const id = parseId(req.params.id, 'document id');
    const { document, absolutePath } = await documentService.open(db, id);
    res.setHeader('Content-Type', document.mime_type);
    // Fylgiskjöl carry supplier terms and kennitölur — never a shared cache, and
    // never rendered inline where it could be mistaken for site content.
    res.setHeader('Content-Disposition',
      `attachment; filename="${String(document.original_name).replace(/[^\w.-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(absolutePath);
  } catch (err) { fail(res, err, next); }
}

// ── Receivables ──────────────────────────────────────────────────────────────

async function getAging(req, res, next) {
  try {
    res.json(await Invoice.agingByCustomer({ limit: req.query.limit }));
  } catch (err) { fail(res, err, next); }
}

async function getStatement(req, res, next) {
  try {
    const key = parseText(req.params.customerKey, 'customer key', { maxLen: 320, required: true });
    const { from, to } = req.query.from || req.query.to
      ? parseRange(req.query, { defaultDays: 3650 })
      : { from: null, to: null };
    const statement = await Invoice.statementForCustomer(key, { from, to });
    if (!statement.lines.length) {
      return res.status(404).json({ error: 'No transactions for that customer', code: 404 });
    }
    res.json({ statement });
  } catch (err) { fail(res, err, next); }
}

// ── VSK returns ──────────────────────────────────────────────────────────────

async function listVatPeriods(req, res, next) {
  try {
    const periods = await vatService.listPeriods(db, { limit: req.query.limit });
    res.json({ periods, current_period: vatService.currentPeriod() });
  } catch (err) { fail(res, err, next); }
}

/**
 * One period: the derived figures, the preflight review, and — if it has been filed
 * — the snapshot exactly as reported.
 *
 * Both are returned together on purpose. A filed period shows what WAS reported
 * alongside what the ledger says NOW, which is how you notice that something was
 * back-dated into a closed period.
 */
async function getVatPeriod(req, res, next) {
  try {
    const period = parseText(req.params.period, 'period', { maxLen: 12, required: true });
    const [filed, review] = await Promise.all([
      vatService.getFiledReturn(db, period),
      vatService.preflight(db, period),
    ]);
    res.json({
      period,
      filed,
      derived: review.derived,
      findings: review.findings,
      can_file: review.can_file,
    });
  } catch (err) { fail(res, err, next); }
}

async function fileVatReturn(req, res, next) {
  try {
    const period = parseText(req.params.period, 'period', { maxLen: 12, required: true });
    const body = req.body || {};
    const note = parseText(body.note, 'note', { maxLen: 1000 });
    // Overriding a blocker is allowed but never the default, and the reason is
    // recorded in the snapshot's preflight blob so "why was this filed with three
    // warnings outstanding" stays answerable a year later.
    const overrideBlockers = body.override_blockers === true;
    if (overrideBlockers && !note) {
      throw new BadRequest('Filing over a blocker requires a note explaining why');
    }

    const result = await ledger.withTransaction(client =>
      vatService.fileReturn(client, period, {
        ...audit.actorOf(req), filedBy: req.user.id, note, overrideBlockers,
      })
    );
    securityLogger.adminAction(req.user.id, 'books.vat.file', period, {
      payable: result.derived.box_f_payable, overridden: overrideBlockers,
    });
    res.status(201).json({
      filed: await vatService.getFiledReturn(db, period),
      findings: result.findings,
    });
  } catch (err) {
    if (err && err.code === 'PREFLIGHT_BLOCKED') {
      return res.status(409).json({ error: err.message, code: 409, findings: err.findings || [] });
    }
    return fail(res, err, next);
  }
}

async function unlockVatPeriod(req, res, next) {
  try {
    const period = parseText(req.params.period, 'period', { maxLen: 12, required: true });
    const reason = parseText((req.body || {}).reason, 'reason', { maxLen: 300, required: true });
    const result = await ledger.withTransaction(client =>
      vatService.unlockPeriod(client, period, { ...audit.actorOf(req), reason })
    );
    securityLogger.adminAction(req.user.id, 'books.vat.unlock', period, {
      discarded_return: result.discarded,
    });
    res.json(result);
  } catch (err) { fail(res, err, next); }
}

async function exportVatCsv(req, res, next) {
  try {
    const periods = await vatService.listPeriods(db, { limit: 60 });
    csvHeaders(res, `vsk-uppgjor-${todayIso()}.csv`);
    const rows = [];
    for (const p of periods) {
      const filed = await vatService.getFiledReturn(db, p.period);
      const figures = filed || await vatService.deriveReturn(db, p.period);
      rows.push([
        p.period, p.starts_on, p.ends_on,
        figures.box_a_net_24, figures.box_b_net_11, figures.box_c_net_zero,
        figures.box_d_output, figures.box_e_input, figures.box_f_payable,
        filed ? 'skilað' : 'óskilað', p.due_on || '',
      ]);
    }
    res.send(toCsv(
      ['Tímabil', 'Frá', 'Til', 'A (24% velta)', 'B (11% velta)', 'C (0% velta)',
        'D (útskattur)', 'E (innskattur)', 'F (til greiðslu)', 'Staða', 'Skiladagur'],
      rows
    ));
  } catch (err) { fail(res, err, next); }
}

// ── Reconciliation ───────────────────────────────────────────────────────────

async function getReconciliationStatus(req, res, next) {
  try {
    res.json(await reconciliation.reconciliationStatus(db));
  } catch (err) { fail(res, err, next); }
}

async function listBankTransactions(req, res, next) {
  try {
    const { limit, offset } = parsePagination(req.query);
    const state = parseEnum(req.query.state,
      ['unmatched', 'matched', 'explained', 'ignored'], 'state');
    const result = await reconciliation.listBankTransactions({ state, limit, offset }, db);
    res.json({ ...result, limit, offset });
  } catch (err) { fail(res, err, next); }
}

/**
 * Import a bank statement.
 *
 * Takes the CSV as text in the body rather than as a file upload: a statement is not
 * a document to retain (the bank keeps it, and the entries it produces carry their own
 * trail), so there is nothing to store and no reason to touch the document machinery.
 */
async function importBankStatement(req, res, next) {
  try {
    const csv = (req.body || {}).csv;
    if (typeof csv !== 'string' || !csv.trim()) {
      throw new BadRequest('Paste or upload the statement CSV in the `csv` field');
    }
    if (csv.length > 4_000_000) throw new BadRequest('That statement is too large (max 4 MB)');

    const parsed = reconciliation.parseBankCsv(csv);
    if (!parsed.rows.length) {
      throw new BadRequest(
        `No usable rows found. ${parsed.problems.length} line(s) could not be read.`
      );
    }
    const result = await ledger.withTransaction(client =>
      reconciliation.importBankRows(client, {
        rows: parsed.rows, ...audit.actorOf(req),
      }));
    securityLogger.adminAction(req.user.id, 'books.bank.import', result.batch, {
      imported: result.imported, duplicates: result.duplicates,
    });
    res.status(201).json({ ...result, problems: parsed.problems, delimiter: parsed.delimiter });
  } catch (err) { fail(res, err, next); }
}

async function getBankSuggestions(req, res, next) {
  try {
    const id = parseId(req.params.id, 'bank line id');
    res.json(await reconciliation.suggestMatches(db, id));
  } catch (err) { fail(res, err, next); }
}

async function resolveBankTransaction(req, res, next) {
  try {
    const id = parseId(req.params.id, 'bank line id');
    const body = req.body || {};
    const kind = parseEnum(body.kind, ['invoice', 'explained', 'suspense', 'ignore'], 'kind');
    if (!kind) throw new BadRequest('kind must be one of: invoice, explained, suspense, ignore');

    const result = await ledger.withTransaction(client =>
      reconciliation.resolveBankTransaction(client, id, {
        kind,
        invoiceId: body.invoice_id ? parseId(body.invoice_id, 'invoice_id') : null,
        accountCode: body.account_code
          ? parseText(body.account_code, 'account_code', { maxLen: 20 }) : null,
        reason: parseText(body.reason, 'reason', { maxLen: 500 }),
        ...audit.actorOf(req),
      }));
    securityLogger.adminAction(req.user.id, 'books.bank.resolve', id, { kind });
    res.json(result);
  } catch (err) { fail(res, err, next); }
}

/**
 * Pull Stripe balance transactions and post them.
 *
 * The fetch lives here rather than in the service so the posting logic stays testable
 * without network access. Paged to Stripe's maximum, newest first, bounded by a
 * `since` date so a re-sync does not walk the entire account history.
 */
async function syncStripe(req, res, next) {
  try {
    const since = (req.body || {}).since
      ? assertAccountingDate(req.body.since, 'since')
      : addDays(todayIso(), -30);

    const { getStripe } = require('../config/stripe');
    let stripe;
    try {
      stripe = getStripe();
    } catch {
      throw new BadRequest('Stripe is not configured on this environment');
    }

    const created = { gte: Math.floor(Date.parse(`${since}T00:00:00Z`) / 1000) };
    const collected = [];
    // autoPagingEach would be neater but is unbounded; an explicit cap keeps a
    // mis-set `since` from pulling years of history into one request.
    const MAX_PAGES = 20;
    let startingAfter;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch = await stripe.balanceTransactions.list({
        limit: 100, created, ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      collected.push(...batch.data);
      if (!batch.has_more || !batch.data.length) break;
      startingAfter = batch.data[batch.data.length - 1].id;
    }

    const result = await ledger.withTransaction(client =>
      reconciliation.syncStripeTransactions(client, collected, audit.actorOf(req)));
    securityLogger.adminAction(req.user.id, 'books.stripe.sync', since, result);
    res.json({ since, ...result });
  } catch (err) { fail(res, err, next); }
}

// ── Ledger and reports ───────────────────────────────────────────────────────

async function getJournal(req, res, next) {
  try {
    const { limit, offset } = parsePagination(req.query);
    const sourceType = parseEnum(req.query.source_type, [
      'invoice', 'payment', 'credit_note', 'expense', 'manual', 'reversal',
      'vat_settlement', 'bank', 'stripe', 'payroll', 'pos', 'opening',
    ], 'source_type');
    const accountCode = req.query.account_code
      ? parseText(req.query.account_code, 'account_code', { maxLen: 20 }) : null;
    let from = null;
    let to = null;
    if (req.query.from) from = assertAccountingDate(req.query.from, 'from', { allowFuture: true });
    if (req.query.to) to = assertAccountingDate(req.query.to, 'to', { allowFuture: true });
    if (from && to && from > to) throw new BadRequest(`from (${from}) is after to (${to})`);

    const result = await reports.journal({ from, to, sourceType, accountCode, limit, offset });
    res.json({ ...result, limit, offset });
  } catch (err) { fail(res, err, next); }
}

async function getTrialBalance(req, res, next) {
  try {
    // No default range: a trial balance is normally wanted for everything to date,
    // and silently windowing it would make it not balance for no visible reason.
    let from = null;
    let to = null;
    if (req.query.from) from = assertAccountingDate(req.query.from, 'from', { allowFuture: true });
    if (req.query.to) to = assertAccountingDate(req.query.to, 'to', { allowFuture: true });
    if (from && to && from > to) throw new BadRequest(`from (${from}) is after to (${to})`);
    res.json(await reports.trialBalance({ from, to }));
  } catch (err) { fail(res, err, next); }
}

async function getProfitAndLoss(req, res, next) {
  try {
    const { from, to } = parseRange(req.query, { defaultDays: 365 });
    res.json(await reports.profitAndLoss({ from, to }));
  } catch (err) { fail(res, err, next); }
}

async function getBalanceSheet(req, res, next) {
  try {
    const to = req.query.to
      ? assertAccountingDate(req.query.to, 'to', { allowFuture: true })
      : todayIso();
    res.json(await reports.balanceSheet({ to }));
  } catch (err) { fail(res, err, next); }
}

async function getAccountLedger(req, res, next) {
  try {
    const accountCode = parseText(req.params.code, 'account code', { maxLen: 20, required: true });
    let from = null;
    let to = null;
    if (req.query.from) from = assertAccountingDate(req.query.from, 'from', { allowFuture: true });
    if (req.query.to) to = assertAccountingDate(req.query.to, 'to', { allowFuture: true });
    res.json(await reports.accountLedger({ accountCode, from, to }));
  } catch (err) { fail(res, err, next); }
}

/**
 * Post a manual journal entry.
 *
 * The escape hatch every set of books needs — an opening balance, a depreciation
 * charge, an accountant's adjustment. Deliberately admin-only and deliberately
 * requiring a memo: a manual entry with no explanation is the hardest thing in a
 * ledger to understand a year later.
 */
async function createManualEntry(req, res, next) {
  try {
    const body = req.body || {};
    const memo = parseText(body.memo, 'memo', { maxLen: 500, required: true });
    const entryDate = assertAccountingDate(body.entry_date, 'entry_date');
    if (!Array.isArray(body.lines) || body.lines.length < 2) {
      throw new BadRequest('A journal entry needs at least two lines');
    }
    if (body.lines.length > 100) throw new BadRequest('A journal entry may have at most 100 lines');

    const lines = body.lines.map((l, i) => {
      const accountCode = parseText(l.account_code, `lines[${i}].account_code`,
        { maxLen: 20, required: true });
      const hasDebit = l.debit !== undefined && l.debit !== null && l.debit !== '' && Number(l.debit) !== 0;
      const hasCredit = l.credit !== undefined && l.credit !== null && l.credit !== '' && Number(l.credit) !== 0;
      if (hasDebit === hasCredit) {
        throw new BadRequest(`lines[${i}] must have exactly one of debit or credit`);
      }
      return {
        accountCode,
        ...(hasDebit ? { debit: parseAmount(l.debit, `lines[${i}].debit`) } : {}),
        ...(hasCredit ? { credit: parseAmount(l.credit, `lines[${i}].credit`) } : {}),
        memo: parseText(l.memo, `lines[${i}].memo`, { maxLen: 200 }),
      };
    });

    // Both of the checks below are ALSO enforced deeper down — postEntry refuses an
    // unbalanced entry and an unknown account, and a database trigger refuses an
    // unbalanced entry even if postEntry were bypassed. But those refusals are 500s
    // on purpose: for every other caller in this module they mean a programming bug.
    // This endpoint is the one place where a human types the figures, so the same two
    // mistakes have to come back as a 400 that says what is wrong.
    const debitTotal = lines.reduce((a, l) => a + (l.debit || 0), 0);
    const creditTotal = lines.reduce((a, l) => a + (l.credit || 0), 0);
    if (debitTotal !== creditTotal) {
      throw new BadRequest(
        `The entry does not balance: debits ${debitTotal} ISK against credits ${creditTotal} ISK`
      );
    }

    const codes = [...new Set(lines.map(l => l.accountCode))];
    const { rows: known } = await db.query(
      `SELECT code, is_active FROM ledger_accounts WHERE code = ANY($1::text[])`, [codes]
    );
    const byCode = new Map(known.map(r => [r.code, r]));
    for (const code of codes) {
      const account = byCode.get(code);
      if (!account) throw new BadRequest(`No such ledger account: ${code}`);
      if (!account.is_active) {
        throw new BadRequest(`Ledger account ${code} is no longer in use and cannot be posted to`);
      }
    }

    const entry = await ledger.withTransaction(async (client) => {
      const posted = await ledger.postEntry(client, {
        entryDate, memo, sourceType: 'manual', createdBy: req.user.id, lines,
      });
      await audit.record(client, {
        ...audit.actorOf(req),
        action: 'journal.posted',
        entityType: 'journal_entry',
        entityId: posted.id,
        summary: {
          entry_number: posted.entry_number,
          memo: memo.slice(0, 120),
          line_count: lines.length,
          debit_total: lines.reduce((a, l) => a + (l.debit || 0), 0),
        },
      });
      return posted;
    });
    securityLogger.adminAction(req.user.id, 'books.journal.manual', entry.id, {
      entry_number: entry.entry_number,
    });
    res.status(201).json({ entry });
  } catch (err) { fail(res, err, next); }
}

async function reverseJournalEntry(req, res, next) {
  try {
    const id = parseId(req.params.id, 'entry id');
    const reason = parseText((req.body || {}).reason, 'reason', { maxLen: 300, required: true });
    // reverseEntry returns { reversal, original_period, reversed_entry_number } — the
    // posted entry is the `reversal` field, not the result itself.
    const entry = await ledger.withTransaction(async (client) => {
      const { reversal, reversed_entry_number: reversedNumber } =
        await ledger.reverseEntry(client, id, { createdBy: req.user.id, reason });
      await audit.record(client, {
        ...audit.actorOf(req),
        action: 'journal.reversed',
        entityType: 'journal_entry',
        entityId: id,
        summary: {
          reversed_entry_number: reversedNumber,
          reversal_entry_number: reversal.entry_number,
          reason: reason.slice(0, 200),
        },
      });
      return reversal;
    });
    securityLogger.adminAction(req.user.id, 'books.journal.reverse', id, {
      reversal: entry.entry_number,
    });
    res.status(201).json({ entry });
  } catch (err) { fail(res, err, next); }
}

// ── Accountant export pack ───────────────────────────────────────────────────

/**
 * Everything an accountant needs for a period, as CSVs in one response.
 *
 * One endpoint rather than five downloads, because the point is that the files are
 * CONSISTENT WITH EACH OTHER — pulled in one read, from the same ledger, at the same
 * moment. Five separately-timed downloads can straddle a new posting and then not tie.
 */
async function getAccountantPack(req, res, next) {
  try {
    const { from, to } = parseRange(req.query, { defaultDays: 365 });
    const [tb, pl, bs, jrn] = await Promise.all([
      reports.trialBalance({ from, to }),
      reports.profitAndLoss({ from, to }),
      reports.balanceSheet({ to }),
      reports.journal({ from, to, limit: 200, offset: 0 }),
    ]);
    const vatPeriods = await vatService.listPeriods(db, { limit: 30 });

    res.json({
      range: { from, to },
      generated_at: new Date().toISOString(),
      trial_balance: tb,
      profit_and_loss: pl,
      balance_sheet: bs,
      journal_sample: jrn,
      vat_periods: vatPeriods.filter(p => p.entry_count > 0),
      // Stated explicitly so the recipient knows what they are looking at rather than
      // assuming it is a finished set of statutory accounts.
      caveats: [
        'Figures are derived from the ledger at the moment of generation.',
        'Retained earnings are computed as revenue less expenses to date; there is no year-end closing entry.',
        'The chart of accounts has not been confirmed by an accountant unless the settings say otherwise.',
      ],
    });
  } catch (err) { fail(res, err, next); }
}

async function exportTrialBalanceCsv(req, res, next) {
  try {
    let from = null;
    let to = null;
    if (req.query.from) from = assertAccountingDate(req.query.from, 'from', { allowFuture: true });
    if (req.query.to) to = assertAccountingDate(req.query.to, 'to', { allowFuture: true });
    const tb = await reports.trialBalance({ from, to });
    csvHeaders(res, `hofudbok-${todayIso()}.csv`);
    res.send(toCsv(
      ['Lykill', 'Heiti', 'Tegund', 'Debet', 'Kredit', 'Staða'],
      [
        ...tb.accounts.map(a => [a.code, a.name, a.type, a.debit, a.credit, a.balance]),
        ['', 'SAMTALS', '', tb.debit_total, tb.credit_total, ''],
      ]
    ));
  } catch (err) { fail(res, err, next); }
}

async function exportJournalCsv(req, res, next) {
  try {
    let from = null;
    let to = null;
    if (req.query.from) from = assertAccountingDate(req.query.from, 'from', { allowFuture: true });
    if (req.query.to) to = assertAccountingDate(req.query.to, 'to', { allowFuture: true });

    // One row per LINE, which is the shape every accounting package imports.
    const rows = [];
    const PAGE = 200;
    for (let offset = 0; ; offset += PAGE) {
      const page = await reports.journal({ from, to, limit: PAGE, offset });
      for (const e of page.entries) {
        for (const l of e.lines) {
          rows.push([
            e.entry_number, e.entry_date, e.source_type, e.memo,
            l.account_code, l.account_name, l.debit, l.credit, l.memo || '',
            l.vat_rate === null ? '' : l.vat_rate,
            e.is_correction ? 'já' : '', e.created_by_username || '',
          ]);
        }
      }
      if (page.entries.length < PAGE) break;
    }

    csvHeaders(res, `dagbok-${todayIso()}.csv`);
    res.send(toCsv(
      ['Færslunr.', 'Dagsetning', 'Uppruni', 'Skýring', 'Lykill', 'Lykilheiti',
        'Debet', 'Kredit', 'Línuskýring', 'VSK %', 'Leiðrétting', 'Bókað af'],
      rows
    ));
  } catch (err) { fail(res, err, next); }
}

// ── Payroll ──────────────────────────────────────────────────────────────────
//
// Note the shape of the errors here. PayrollError already carries a status and a
// message written for the operator, so most of these handlers do nothing but pass the
// request through and let fail() surface it. That is deliberate: the refusals are the
// product (an unconfirmed tax year, an owner below the reiknað endurgjald minimum), and
// re-wording them at the HTTP layer would either lose the detail or duplicate it.

function parseRate(value, label, { max = 1 } = {}) {
  if (value === null || value === undefined || value === '') {
    throw new BadRequest(`${label} is required`);
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new BadRequest(`${label} must be a decimal rate`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new BadRequest(`${label} must be a rate of 0 or more`);
  if (n > max) {
    throw new BadRequest(
      `${label} is ${n}, which reads as ${n * 100}%. Rates are decimals here: 6.35% is 0.0635.`
    );
  }
  return n;
}

function parseYear(value, label = 'year') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2020 || n > 2100) {
    throw new BadRequest(`${label} must be a year between 2020 and 2100`);
  }
  return n;
}

async function listPayrollYears(req, res, next) {
  try {
    res.json({ years: await payroll.listRateYears() });
  } catch (err) { fail(res, err, next); }
}

async function getPayrollYear(req, res, next) {
  try {
    res.json(await payroll.getRateYear(parseYear(req.params.year)));
  } catch (err) { fail(res, err, next); }
}

/**
 * Enter or replace a year's statutory figures.
 *
 * Every one of these is a number a person read off Skatturinn's published table. The
 * validation here is about catching a TRANSCRIPTION error before it reaches a payslip —
 * a percentage typed where a decimal belongs, a band left out, thresholds in the wrong
 * order. The service checks the same things again and is the real guarantee; this layer
 * exists so the answer is a 400 with a sentence rather than a 500.
 */
async function savePayrollYear(req, res, next) {
  try {
    const body = req.body || {};
    const year = parseYear(req.params.year);
    if (!Array.isArray(body.bands) || !body.bands.length) {
      throw new BadRequest('At least one withholding band is required');
    }
    if (body.bands.length > 10) throw new BadRequest('A year may have at most 10 bands');

    const bands = body.bands.map((b, i) => ({
      from: b.from === 0 || b.from === '0' ? 0 : parseAmount(b.from, `bands[${i}].from`),
      rate: parseRate(b.rate, `bands[${i}].rate`),
    }));
    const referenceWages = Array.isArray(body.reference_wages)
      ? body.reference_wages.map((w, i) => ({
        category: parseText(w.category, `reference_wages[${i}].category`,
          { maxLen: 20, required: true }),
        description: parseText(w.description, `reference_wages[${i}].description`, { maxLen: 200 }),
        monthly_min: parseAmount(w.monthly_min, `reference_wages[${i}].monthly_min`),
      }))
      : [];

    const result = await ledger.withTransaction(async (client) => {
      const saved = await payroll.upsertRates(client, {
        year,
        personalAllowance: parseAmount(body.personal_allowance, 'personal_allowance'),
        municipalRate: parseRate(body.municipal_rate, 'municipal_rate'),
        socialSecurity: parseRate(body.social_security, 'social_security'),
        pensionEmployee: parseRate(body.pension_employee, 'pension_employee'),
        pensionEmployer: parseRate(body.pension_employer, 'pension_employer'),
        bands,
        referenceWages,
        sourceNote: parseText(body.source_note, 'source_note', { maxLen: 500 }),
        createdBy: req.user.id,
      });
      await audit.record(client, {
        ...audit.actorOf(req),
        action: 'payroll.rates_saved',
        entityType: 'payroll_rates',
        entityId: String(year),
        summary: { year, bands: bands.length, personal_allowance: saved.personal_allowance },
      });
      return saved;
    });
    securityLogger.adminAction(req.user.id, 'books.payroll.rates', String(year), { year });
    res.json(result);
  } catch (err) { fail(res, err, next); }
}

/**
 * Confirm a year's figures against the published table.
 *
 * The one action in this module that turns a refusal into permission, so it is the one
 * that most needs a name attached and a note saying what was checked.
 */
async function confirmPayrollYear(req, res, next) {
  try {
    const year = parseYear(req.params.year);
    const sourceNote = parseText((req.body || {}).source_note, 'source_note',
      { maxLen: 500, required: true });
    const result = await ledger.withTransaction(async (client) => {
      const confirmed = await payroll.confirmRates(client, year, {
        confirmedBy: req.user.id, sourceNote,
      });
      await audit.record(client, {
        ...audit.actorOf(req),
        action: 'payroll.rates_confirmed',
        entityType: 'payroll_rates',
        entityId: String(year),
        summary: { year, source_note: sourceNote.slice(0, 200) },
      });
      return confirmed;
    });
    securityLogger.adminAction(req.user.id, 'books.payroll.confirm', String(year), { year });
    res.json(result);
  } catch (err) { fail(res, err, next); }
}

async function listEmployees(req, res, next) {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    res.json({ employees: await payroll.listEmployees({ includeInactive }) });
  } catch (err) { fail(res, err, next); }
}

async function getEmployee(req, res, next) {
  try {
    res.json({ employee: await payroll.getEmployee(parseId(req.params.id, 'employee id')) });
  } catch (err) { fail(res, err, next); }
}

async function saveEmployee(req, res, next) {
  try {
    const body = req.body || {};
    const id = req.params.id ? parseId(req.params.id, 'employee id') : null;
    const spec = {
      id,
      fullName: parseText(body.full_name, 'full_name', { maxLen: 200, required: true }),
      kennitala: parseText(body.kennitala, 'kennitala', { maxLen: 20, required: true }),
      email: parseText(body.email, 'email', { maxLen: 200 }),
      bankAccount: parseText(body.bank_account, 'bank_account', { maxLen: 40 }),
      employmentType: parseEnum(body.employment_type, payroll.EMPLOYMENT_TYPES,
        'employment_type') || 'employee',
      referenceWageCategory: body.reference_wage_category
        ? parseText(body.reference_wage_category, 'reference_wage_category', { maxLen: 20 })
        : null,
      referenceWageAmount: body.reference_wage_amount === '' || body.reference_wage_amount === null
        || body.reference_wage_amount === undefined
        ? null : parseAmount(body.reference_wage_amount, 'reference_wage_amount'),
      referenceWageConfirmedAt: body.reference_wage_confirmed_at || null,
      referenceWageConfirmedNote: parseText(body.reference_wage_confirmed_note,
        'reference_wage_confirmed_note', { maxLen: 500 }) || null,
      monthlySalary: body.monthly_salary === 0 || body.monthly_salary === '0'
        ? 0 : parseAmount(body.monthly_salary, 'monthly_salary'),
      // max 2: persónuafsláttur may be partly transferred from a spouse.
      allowanceFactor: parseRate(body.allowance_factor ?? 1, 'allowance_factor', { max: 2 }),
      pensionFund: parseText(body.pension_fund, 'pension_fund', { maxLen: 120 }),
      // NULL means "use the year's statutory rate", which is a different statement from
      // 0 — so an empty field is passed through as null rather than coerced.
      pensionEmployeeRate: body.pension_employee_rate === '' || body.pension_employee_rate === null
        || body.pension_employee_rate === undefined
        ? null : parseRate(body.pension_employee_rate, 'pension_employee_rate', { max: 0.5 }),
      pensionEmployerRate: body.pension_employer_rate === '' || body.pension_employer_rate === null
        || body.pension_employer_rate === undefined
        ? null : parseRate(body.pension_employer_rate, 'pension_employer_rate', { max: 0.5 }),
      extraPensionEmployee: parseRate(body.extra_pension_employee ?? 0,
        'extra_pension_employee', { max: 0.5 }),
      extraPensionEmployer: parseRate(body.extra_pension_employer ?? 0,
        'extra_pension_employer', { max: 0.5 }),
      unionName: parseText(body.union_name, 'union_name', { maxLen: 120 }),
      unionRate: parseRate(body.union_rate ?? 0, 'union_rate', { max: 0.2 }),
      startedOn: body.started_on || null,
      endedOn: body.ended_on || null,
      isActive: body.is_active === undefined ? true : Boolean(body.is_active),
      note: parseText(body.note, 'note', { maxLen: 1000 }),
      createdBy: req.user.id,
    };

    const employee = await ledger.withTransaction(async (client) => {
      const saved = await payroll.upsertEmployee(client, spec);
      await audit.record(client, {
        ...audit.actorOf(req),
        action: id ? 'payroll.employee_updated' : 'payroll.employee_created',
        entityType: 'employee',
        entityId: saved.id,
        summary: {
          name: saved.full_name,
          employment_type: saved.employment_type,
          monthly_salary: saved.monthly_salary,
        },
      });
      return saved;
    });
    securityLogger.adminAction(req.user.id,
      id ? 'books.payroll.employee.update' : 'books.payroll.employee.create',
      employee.id, { name: employee.full_name });
    res.status(id ? 200 : 201).json({ employee });
  } catch (err) { fail(res, err, next); }
}

async function listPayrollRuns(req, res, next) {
  try {
    const { limit, offset } = parsePagination(req.query);
    const [runs, owed] = await Promise.all([
      payroll.listRuns({ limit, offset }),
      payroll.liabilities(),
    ]);
    res.json({ ...runs, liabilities: owed, limit, offset });
  } catch (err) { fail(res, err, next); }
}

async function getPayrollRun(req, res, next) {
  try {
    res.json(await payroll.getRun(parseId(req.params.id, 'run id')));
  } catch (err) { fail(res, err, next); }
}

/**
 * Build a draft run.
 *
 * A draft is where the figures can be looked at. It writes payslips but touches no
 * account, so it is the cheap half of payroll and the half that should be run first.
 */
async function createPayrollRun(req, res, next) {
  try {
    const body = req.body || {};
    const period = parseText(body.period, 'period', { maxLen: 7, required: true });
    const payDate = assertAccountingDate(body.pay_date, 'pay_date', { allowFuture: true });
    let employeeIds = null;
    if (Array.isArray(body.employee_ids) && body.employee_ids.length) {
      if (body.employee_ids.length > 200) throw new BadRequest('Too many employees in one run');
      employeeIds = body.employee_ids.map((x, i) => parseId(x, `employee_ids[${i}]`));
    }

    const result = await ledger.withTransaction(async (client) => {
      const draft = await payroll.createDraftRun(client, {
        period, payDate, employeeIds,
        note: parseText(body.note, 'note', { maxLen: 500 }),
        createdBy: req.user.id,
      });
      await audit.record(client, {
        ...audit.actorOf(req),
        action: 'payroll.run_drafted',
        entityType: 'payroll_run',
        entityId: draft.run.id,
        summary: {
          period, pay_date: payDate,
          gross: draft.run.gross_total,
          employees: draft.payslips.length,
          blockers: draft.preflight.blockers.length,
        },
      });
      return draft;
    });
    res.status(201).json({ run: result.run, preflight: result.preflight });
  } catch (err) { fail(res, err, next); }
}

/**
 * Post a draft to the ledger.
 *
 * On a blocked run the 409 carries the findings, so the screen can show exactly what is
 * wrong rather than a bare message — and an override, if the operator insists, is a
 * separate deliberate request carrying a reason.
 */
async function postPayrollRun(req, res, next) {
  try {
    const id = parseId(req.params.id, 'run id');
    const override = (req.body || {}).override_reason
      ? parseText(req.body.override_reason, 'override_reason', { maxLen: 500 })
      : null;

    const result = await ledger.withTransaction(async (client) => {
      const posted = await payroll.postRun(client, id, {
        postedBy: req.user.id, overrideBlockers: override,
      });
      await audit.record(client, {
        ...audit.actorOf(req),
        action: 'payroll.run_posted',
        entityType: 'payroll_run',
        entityId: id,
        summary: {
          period: posted.run.period,
          gross: posted.run.gross_total,
          withholding: posted.run.withholding_total,
          net: posted.run.net_total,
          entry_number: posted.entry.entry_number,
          overridden: override ? override.slice(0, 200) : null,
        },
      });
      return posted;
    });
    securityLogger.adminAction(req.user.id, 'books.payroll.post', id, {
      period: result.run.period, overridden: Boolean(override),
    });
    res.json({ run: result.run, entry: result.entry });
  } catch (err) {
    // The findings are the useful part of a refusal: they say which employee, and by
    // how much.
    if (err && err.code === 'BLOCKED' && Array.isArray(err.findings)) {
      return res.status(409).json({ error: err.message, code: 409, findings: err.findings });
    }
    return fail(res, err, next);
  }
}

async function reversePayrollRun(req, res, next) {
  try {
    const id = parseId(req.params.id, 'run id');
    const reason = parseText((req.body || {}).reason, 'reason', { maxLen: 500, required: true });
    const result = await ledger.withTransaction(async (client) => {
      const reversed = await payroll.reverseRun(client, id, {
        reversedBy: req.user.id, reason,
      });
      await audit.record(client, {
        ...audit.actorOf(req),
        action: 'payroll.run_reversed',
        entityType: 'payroll_run',
        entityId: id,
        summary: {
          period: reversed.run.period,
          reason: reason.slice(0, 200),
          reversal_entry_number: reversed.reversal.entry_number,
        },
      });
      return reversed;
    });
    securityLogger.adminAction(req.user.id, 'books.payroll.reverse', id, {
      period: result.run.period,
    });
    res.json({ run: result.run });
  } catch (err) { fail(res, err, next); }
}

async function payPayrollRun(req, res, next) {
  try {
    const id = parseId(req.params.id, 'run id');
    const body = req.body || {};
    const amount = body.amount === undefined || body.amount === null || body.amount === ''
      ? null : parseAmount(body.amount, 'amount');
    const paidOn = assertAccountingDate(body.paid_on || todayIso(), 'paid_on');

    const result = await ledger.withTransaction(async (client) => {
      const paid = await payroll.recordWagePayment(client, id, {
        amount, paidOn, createdBy: req.user.id,
        note: parseText(body.note, 'note', { maxLen: 200 }),
      });
      await audit.record(client, {
        ...audit.actorOf(req),
        action: 'payroll.wages_paid',
        entityType: 'payroll_run',
        entityId: id,
        summary: { amount, paid_on: paidOn, entry_number: paid.entry.entry_number },
      });
      return paid;
    });
    securityLogger.adminAction(req.user.id, 'books.payroll.pay', id, { amount, paid_on: paidOn });
    res.json({ entry: result.entry });
  } catch (err) { fail(res, err, next); }
}

async function getPayslipPdf(req, res, next) {
  try {
    const slip = await payroll.getPayslip(parseId(req.params.id, 'payslip id'));
    const settings = await Setting.getBookkeepingSettings();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename="launasedill-${slip.period}-${slip.employee_kennitala}.pdf"`);
    // Payslips carry salary detail; keep them out of shared caches.
    res.setHeader('Cache-Control', 'no-store');
    bookkeepingPdf.streamPayslip(res, { payslip: slip, seller: settings });
  } catch (err) { fail(res, err, next); }
}

async function exportPayrollCsv(req, res, next) {
  try {
    const { runs } = await payroll.listRuns({ limit: 200, offset: 0 });
    csvHeaders(res, `laun-${todayIso()}.csv`);
    res.send(toCsv(
      ['Tímabil', 'Útborgunardagur', 'Staða', 'Laun', 'Staðgreiðsla', 'Lífeyrir starfsmanns',
        'Lífeyrir vinnuveitanda', 'Tryggingagjald', 'Félagsgjöld', 'Útborgað', 'Skattár',
        'Bókað af'],
      runs.map(r => [
        r.period, r.pay_date, r.status, r.gross_total, r.withholding_total,
        r.pension_employee_total, r.pension_employer_total, r.social_security_total,
        r.union_total, r.net_total, r.tax_year, r.posted_by_username || '',
      ])
    ));
  } catch (err) { fail(res, err, next); }
}


// ── Counter sales ────────────────────────────────────────────────────────────

/**
 * Ring up a sale.
 *
 * One request, one transaction, one receipt. There is deliberately no "start a sale"
 * endpoint: a half-open transaction at a till is a receipt printed with no entry posted,
 * or cash in the drawer against no document, and at a counter nobody goes back to check.
 */
async function createPosSale(req, res, next) {
  try {
    const body = req.body || {};
    const tender = parseEnum(body.tender, posService.TENDERS, 'tender');
    if (!tender) throw new BadRequest(`tender must be one of: ${posService.TENDERS.join(', ')}`);

    if (!Array.isArray(body.lines) || !body.lines.length) {
      throw new BadRequest('A sale needs at least one line');
    }
    if (body.lines.length > posService.MAX_LINES) {
      throw new BadRequest(`A sale may have at most ${posService.MAX_LINES} lines`);
    }
    const lines = body.lines.map((l, i) => ({
      productId: l.product_id ? parseId(l.product_id, `lines[${i}].product_id`) : null,
      description: parseText(l.description, `lines[${i}].description`, { maxLen: 300 }),
      quantity: l.quantity === undefined ? 1 : parseAmount(l.quantity, `lines[${i}].quantity`),
      // A zero price is legitimate on one line of a basket (a freebie alongside a sale),
      // so it is allowed here and only the SALE total is required to be positive.
      unitPriceGross: l.unit_price_gross === undefined || l.unit_price_gross === null
        || l.unit_price_gross === ''
        ? null
        : (Number(l.unit_price_gross) === 0
          ? 0 : parseAmount(l.unit_price_gross, `lines[${i}].unit_price_gross`)),
      vatRate: l.vat_rate === undefined || l.vat_rate === null || l.vat_rate === ''
        ? null : Number(l.vat_rate),
      isService: Boolean(l.is_service),
    }));

    const result = await ledger.withTransaction(async (client) => {
      const sale = await posService.sell(client, {
        lines,
        tender,
        soldAt: body.sold_at || null,
        customerName: parseText(body.customer_name, 'customer_name', { maxLen: 200 }),
        customerKennitala: body.customer_kennitala
          ? parseText(body.customer_kennitala, 'customer_kennitala', { maxLen: 20 })
          : null,
        note: parseText(body.note, 'note', { maxLen: 300 }),
        createdBy: req.user.id,
      });
      await audit.record(client, {
        ...audit.actorOf(req),
        action: 'pos.sale',
        entityType: 'invoice',
        entityId: sale.receipt.id,
        summary: {
          receipt_number: sale.receipt.invoice_number,
          tender,
          gross: sale.totals.total_gross,
          vat: sale.totals.vat_total,
          lines: sale.lines.length,
          entry_number: sale.entry.entry_number,
        },
      });
      return sale;
    });
    securityLogger.adminAction(req.user.id, 'books.pos.sale', result.receipt.id, {
      receipt_number: result.receipt.invoice_number, gross: result.totals.total_gross,
    });
    res.status(201).json({
      receipt: result.receipt,
      lines: result.lines,
      totals: result.totals,
      tender: result.tender,
    });
  } catch (err) { fail(res, err, next); }
}

async function listPosReceipts(req, res, next) {
  try {
    const { limit, offset } = parsePagination(req.query);
    let from = null;
    let to = null;
    if (req.query.from) from = assertAccountingDate(req.query.from, 'from', { allowFuture: true });
    if (req.query.to) to = assertAccountingDate(req.query.to, 'to', { allowFuture: true });
    if (from && to && from > to) throw new BadRequest(`from (${from}) is after to (${to})`);
    const result = await posService.listReceipts({ limit, offset, from, to });
    res.json({ ...result, limit, offset });
  } catch (err) { fail(res, err, next); }
}

/**
 * The day's takings.
 *
 * Split by tender because that is how a drawer is counted at closing: the cash figure
 * should equal what is physically there and the card figure should equal what the
 * acquirer says it will settle. A single total answers neither question.
 */
async function getPosDay(req, res, next) {
  try {
    const day = req.query.date
      ? assertAccountingDate(req.query.date, 'date', { allowFuture: true })
      : todayIso();
    const to = req.query.to
      ? assertAccountingDate(req.query.to, 'to', { allowFuture: true })
      : day;
    if (day > to) throw new BadRequest(`date (${day}) is after to (${to})`);
    res.json(await posService.dayTotals({ from: day, to }));
  } catch (err) { fail(res, err, next); }
}

/**
 * What the till can sell.
 *
 * Only what has a price and a VAT rate, because a till cannot ask questions. A product
 * with no rate would default to 24% somewhere downstream, and defaulting a book to 24%
 * is the wrong tax rather than a rounding preference.
 */
async function getPosCatalogue(req, res, next) {
  try {
    const search = parseText(req.query.q, 'q', { maxLen: 80 });
    const params = [];
    const where = ['p.active', 'p.price_isk IS NOT NULL', 'p.price_isk > 0'];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
    }
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.sku, p.price_isk, p.vat_rate, p.is_bookable
         FROM products p
        WHERE ${where.join(' AND ')}
        ORDER BY p.name
        LIMIT 200`,
      params
    );
    res.json({
      products: rows.map(p => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        price_isk: Number(p.price_isk),
        vat_rate: p.vat_rate === null ? null : Number(p.vat_rate),
        is_service: Boolean(p.is_bookable),
      })),
    });
  } catch (err) { fail(res, err, next); }
}

async function exportPosCsv(req, res, next) {
  try {
    let from = null;
    let to = null;
    if (req.query.from) from = assertAccountingDate(req.query.from, 'from', { allowFuture: true });
    if (req.query.to) to = assertAccountingDate(req.query.to, 'to', { allowFuture: true });

    const rows = [];
    const PAGE = 500;
    for (let offset = 0; ; offset += PAGE) {
      const page = await posService.listReceipts({ limit: PAGE, offset, from, to });
      rows.push(...page.receipts);
      if (page.receipts.length < PAGE) break;
    }
    csvHeaders(res, `kassasala-${todayIso()}.csv`);
    res.send(toCsv(
      ['Kvittun nr.', 'Dagsetning', 'Greiðslumáti', 'Viðskiptavinur', 'Án VSK', 'VSK',
        'Með VSK', 'Kreditfært', 'Athugasemd', 'Afgreitt af'],
      rows.map(r => [
        r.invoice_number, r.issued_at, r.tender || '', r.customer_name,
        r.subtotal_net, r.vat_total, r.total_gross, r.amount_credited,
        r.note || '', r.created_by_username || '',
      ])
    ));
  } catch (err) { fail(res, err, next); }
}


// ── CSV exports ──────────────────────────────────────────────────────────────
//
// Server-side and unbounded-safe. The client-side "export all" pattern that
// re-requested a page and called it a full export silently truncated at the
// server's page cap, handing the accountant a file that looked complete.

async function exportInvoicesCsv(req, res, next) {
  try {
    let from = null;
    let to = null;
    if (req.query.from) from = assertAccountingDate(req.query.from, 'from', { allowFuture: true });
    if (req.query.to) to = assertAccountingDate(req.query.to, 'to', { allowFuture: true });
    if (from && to && from > to) throw new BadRequest(`from (${from}) is after to (${to})`);
    const status = parseEnum(req.query.status, Invoice.DISPLAY_STATUSES, 'status');

    const rows = [];
    // Paged internally rather than one unbounded query, so a long history streams
    // instead of materialising in memory.
    const PAGE = 500;
    for (let offset = 0; ; offset += PAGE) {
      const page = await Invoice.list({ from, to, status, limit: PAGE, offset, sort: 'number', dir: 'asc' });
      rows.push(...page.invoices);
      if (page.invoices.length < PAGE || rows.length >= page.total) break;
    }

    csvHeaders(res, `reikningar-${todayIso()}.csv`);
    res.send(toCsv(
      ['Nr.', 'Dagsetning', 'Gjalddagi', 'Viðskiptavinur', 'Netto', 'VSK', 'Samtals', 'Greitt', 'Kreditfært', 'Ógreitt', 'Staða'],
      rows.map(i => [
        i.invoice_number, i.issued_at, i.due_at, i.customer_name,
        i.subtotal_net, i.vat_total, i.total_gross,
        i.amount_paid, i.amount_credited, i.outstanding, i.display_status,
      ])
    ));
  } catch (err) { fail(res, err, next); }
}

async function exportExpensesCsv(req, res, next) {
  try {
    let from = null;
    let to = null;
    if (req.query.from) from = assertAccountingDate(req.query.from, 'from', { allowFuture: true });
    if (req.query.to) to = assertAccountingDate(req.query.to, 'to', { allowFuture: true });
    if (from && to && from > to) throw new BadRequest(`from (${from}) is after to (${to})`);

    const rows = [];
    const PAGE = 500;
    for (let offset = 0; ; offset += PAGE) {
      const page = await Expense.list({ from, to, limit: PAGE, offset, sort: 'date', dir: 'asc' });
      rows.push(...page.expenses);
      if (page.expenses.length < PAGE || rows.length >= page.total) break;
    }

    csvHeaders(res, `kostnadur-${todayIso()}.csv`);
    res.send(toCsv(
      ['Dagsetning', 'Seljandi', 'Kennitala', 'Reikn.nr.', 'Lykill', 'Netto', 'VSK', 'Samtals',
        'VSK-meðferð', 'Innskattur frádráttarbær', 'Fylgiskjal'],
      rows.map(e => [
        e.expense_date, e.supplier_name, e.supplier_kennitala || '', e.supplier_invoice_no || '',
        e.account_code, e.amount_net, e.amount_vat, e.amount_gross,
        e.vat_code, e.vat_deductible ? 'já' : 'nei', e.document_name || '',
      ])
    ));
  } catch (err) { fail(res, err, next); }
}

async function exportAgingCsv(req, res, next) {
  try {
    const { customers, totals } = await Invoice.agingByCustomer({ limit: 500 });
    csvHeaders(res, `skuldalisti-${todayIso()}.csv`);
    res.send(toCsv(
      ['Viðskiptavinur', 'Tölvupóstur', 'Reikningar', 'Elsti gjalddagi', 'Ógjaldfallið', '1-30', '31-60', '61-90', '90+', 'Samtals'],
      [
        ...customers.map(c => [
          c.customer_name, c.customer_email || '', c.open_invoices, c.oldest_due_at,
          c.current, c.d1_30, c.d31_60, c.d61_90, c.d90_plus, c.total,
        ]),
        ['SAMTALS', '', '', '', totals.current, totals.d1_30, totals.d31_60, totals.d61_90, totals.d90_plus, totals.total],
      ]
    ));
  } catch (err) { fail(res, err, next); }
}

module.exports = {
  getDashboard,
  listExpenses,
  getExpense,
  createExpense,
  previewExpenseVat,
  attachExpenseDocument,
  getMissingDocuments,
  getSuppliers,
  getAccounts,
  uploadDocument,
  getDocument,
  getAging,
  getStatement,
  getJournal,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getAccountLedger,
  createManualEntry,
  reverseJournalEntry,
  getAccountantPack,
  exportTrialBalanceCsv,
  exportJournalCsv,
  listPayrollYears,
  getPayrollYear,
  savePayrollYear,
  confirmPayrollYear,
  listEmployees,
  getEmployee,
  saveEmployee,
  listPayrollRuns,
  getPayrollRun,
  createPayrollRun,
  postPayrollRun,
  reversePayrollRun,
  payPayrollRun,
  getPayslipPdf,
  exportPayrollCsv,
  createPosSale,
  listPosReceipts,
  getPosDay,
  getPosCatalogue,
  exportPosCsv,
  getReconciliationStatus,
  listBankTransactions,
  importBankStatement,
  getBankSuggestions,
  resolveBankTransaction,
  syncStripe,
  listVatPeriods,
  getVatPeriod,
  fileVatReturn,
  unlockVatPeriod,
  exportVatCsv,
  exportInvoicesCsv,
  exportExpensesCsv,
  exportAgingCsv,
  listInvoices,
  getInvoice,
  createInvoiceFromOrder,
  recordPayment,
  recordRefund,
  createCreditNote,
  getInvoicePdf,
  getSettings,
  updateSettings,
  setFxRate,
  // Request-parsing helpers, unit-tested in tests/unit/booksControllerParse.test.js.
  _internals: { parsePagination, parseRange, parseAmount, parseEnum, parseId, parseText },
};
