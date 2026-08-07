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
const FxRate = require('../models/FxRate');
const Setting = require('../models/Setting');
const ledger = require('../services/bookkeeping/ledgerService');
const invoiceService = require('../services/bookkeeping/invoiceService');
const audit = require('../services/bookkeeping/auditLog');
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

async function recordPayment(req, res, next) {
  try {
    const id = parseId(req.params.id, 'invoice id');
    const body = req.body || {};
    const amount = parseAmount(body.amount, 'amount');
    const method = parseEnum(body.method, PAYMENT_METHODS, 'method');
    if (!method) throw new BadRequest(`method must be one of: ${PAYMENT_METHODS.join(', ')}`);
    const receivedAt = body.received_at
      ? assertAccountingDate(body.received_at, 'received_at') : todayIso();
    const reference = parseText(body.reference, 'reference', { maxLen: 200 });
    // The client supplies the key so a retried request is a no-op. Without one we
    // cannot tell a retry from a second genuine payment of the same amount — so
    // it is required rather than defaulted.
    const idempotencyKey = parseText(body.idempotency_key, 'idempotency_key',
      { maxLen: 100, required: true });

    const result = await ledger.withTransaction(client =>
      invoiceService.recordPayment(client, id, {
        amount, method, receivedAt, reference, idempotencyKey,
        createdBy: req.user.id, requestId: req.requestId || null,
      })
    );
    securityLogger.adminAction(req.user.id, 'books.payment.record', id, { method, created: result.created });
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
        createdBy: req.user.id, requestId: req.requestId || null,
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
    securityLogger.adminAction(req.user.id, 'books.settings.update', null, {
      fields: Object.keys(req.body || {}),
    });
    logger.info({ actorId: req.user.id }, 'bookkeeping settings updated');
    res.json({ settings });
  } catch (err) {
    // Setting.updateBookkeepingSettings throws plain Errors for validation; they
    // are our own messages and safe to show, but must not become 500s.
    if (err && !err.status) err.status = 400;
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

    const row = await FxRate.set({ rateDate, currency, rate, source: 'manual', createdBy: req.user.id });
    await ledger.withTransaction(client => audit.record(client, {
      actorId: req.user.id,
      action: 'fx.rate_set',
      entityType: 'fx_rate',
      entityId: `${currency}:${rateDate}`,
      requestId: req.requestId || null,
      summary: { currency, rate_date: rateDate, rate },
    }));
    res.status(201).json({ fx_rate: { ...row, rate: Number(row.rate), rate_date: toIsoDate(row.rate_date) } });
  } catch (err) { fail(res, err, next); }
}

module.exports = {
  getDashboard,
  listInvoices,
  getInvoice,
  createInvoiceFromOrder,
  recordPayment,
  createCreditNote,
  getInvoicePdf,
  getSettings,
  updateSettings,
  setFxRate,
  // exported for unit tests
  _internals: { parsePagination, parseRange, parseAmount, parseEnum, parseId, parseText },
};
