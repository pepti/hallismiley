// Commission — /api/v1/admin/commission.
//
// Reads (migration 098; D-003): the accrual report and the events behind it.
// Settlement (migration 102; D-019): statements over a running balance, the
// payouts that settle them, and the manual adjustments that move a balance.
//
// Gating. Reads are `requireView('commission')` + commissionScope: a seller
// sees their own rows, a foreign statement id is a 404 rather than a 403.
// Every WRITE is hard admin — a seller must never generate their own statement
// (they could time it to sit before a credit note lands) or record their own
// payout. Same precedent as PATCH /accounts/:id/owner. Everything no-store.
const express = require('express');
const router  = express.Router();

const db = require('../config/database');
const Commission = require('../models/Commission');
const settlement = require('../services/commissionStatements');
const ledger = require('../services/bookkeeping/ledgerService');
const staffAudit = require('../services/staffAudit');
const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');
const { requireView }  = require('../auth/requireView');
const { commissionScope } = require('../auth/commissionScope');
const { csrfProtect } = require('../middleware/csrf');
const { toCsv, csvHeaders } = require('../utils/csv');
const { toIsoDate } = require('../utils/booksDate');

// `period` is a DATE; pg hands it back as a local-midnight Date object. Both
// traps booksDate.js documents apply: String(date).slice(0,7) yields "Wed Sep",
// and toISOString() on any server east of UTC lands on the last day of the
// PREVIOUS month. Every period that leaves this file goes through toIsoDate.
const monthOf = (period) => toIsoDate(period).slice(0, 7);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function range(query) {
  const from = ISO_DATE.test(String(query.from || '')) ? query.from : null;
  const to   = ISO_DATE.test(String(query.to || ''))   ? query.to   : null;
  return { from, to };
}

function fail(res, err, next) {
  if (err && err.name === 'StatementError') {
    return res.status(err.status || 400).json({ error: err.message, code: err.status || 400 });
  }
  return next(err);
}

const noStore = (req, res, nxt) => { res.setHeader('Cache-Control', 'no-store'); nxt(); };

router.use(requireAuth, requireView('commission'), commissionScope, noStore);

// A statement the caller may not see answers 404, never 403 — the same rule
// CustomerAccount follows, so an id cannot be probed for existence.
async function loadStatement(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid statement id', code: 400 });
    return null;
  }
  const params = [id];
  let scoped = '';
  if (req.commissionScope.all !== true) {
    params.push(req.commissionScope.ownerId);
    scoped = ' AND s.seller_user_id = $2';
  }
  const { rows } = await db.query(
    `SELECT s.*, COALESCE(u.display_name, u.username) AS seller_name, u.username AS seller_username
       FROM commission_statements s JOIN users u ON u.id = s.seller_user_id
      WHERE s.id = $1${scoped}`,
    params
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'Statement not found', code: 404 });
    return null;
  }
  return rows[0];
}

// ── Reads ────────────────────────────────────────────────────────────────────

// GET /?from=&to= → per seller per month, the events, and the live balances.
router.get('/', async (req, res, next) => {
  try {
    const r = range(req.query);
    const [rows, events, bal] = await Promise.all([
      Commission.report(req.commissionScope, r),
      Commission.events(req.commissionScope, { ...r, limit: 500 }),
      settlement.balances(req.commissionScope),
    ]);
    return res.json({
      rows:   rows.map(x => ({ ...x, period: toIsoDate(x.period) })),
      events: events.map(x => ({ ...x, period: toIsoDate(x.period) })),
      balances: bal,
      minimumIsk: settlement.DEFAULT_MINIMUM_ISK,
      clawbackWindowMonths: settlement.CLAWBACK_WINDOW_MONTHS,
      scope: req.commissionScope.all ? 'all' : 'own', from: r.from, to: r.to,
    });
  } catch (err) { fail(res, err, next); }
});

router.get('/export.csv', async (req, res, next) => {
  try {
    const r = range(req.query);
    const events = await Commission.events(req.commissionScope, { ...r, limit: 1000 });
    csvHeaders(res, `solulaun-${new Date().toISOString().slice(0, 10)}.csv`);
    return res.send(toCsv(
      ['period', 'seller', 'account', 'kind', 'invoice_number', 'base_amount_isk', 'rate_bp', 'amount_isk', 'invoice_paid'],
      events.map(e => [
        monthOf(e.period), e.seller_username, e.account_name, e.kind, e.invoice_number,
        e.base_amount_isk, e.rate_bp, e.amount_isk, e.invoice_paid ? 'yes' : 'no',
      ])
    ));
  } catch (err) { fail(res, err, next); }
});

// GET /statements — newest first, scoped.
router.get('/statements', async (req, res, next) => {
  try {
    const params = [];
    let where = '';
    if (req.commissionScope.all !== true) {
      params.push(req.commissionScope.ownerId);
      where = 'WHERE s.seller_user_id = $1';
    }
    const { rows } = await db.query(
      `SELECT s.*, COALESCE(u.display_name, u.username) AS seller_name, u.username AS seller_username,
              EXISTS (SELECT 1 FROM commission_statements later
                       WHERE later.seller_user_id = s.seller_user_id AND later.period > s.period) AS has_later
         FROM commission_statements s JOIN users u ON u.id = s.seller_user_id
         ${where}
        ORDER BY s.period DESC, s.id DESC
        LIMIT 200`,
      params
    );
    // Status is DERIVED, never stored (settlement.statementStatus).
    return res.json({
      statements: rows.map(s => ({
        ...s,
        period: toIsoDate(s.period),
        status: settlement.statementStatus(s, s.has_later),
      })),
      scope: req.commissionScope.all ? 'all' : 'own',
    });
  } catch (err) { fail(res, err, next); }
});

// GET /statements/:id — the statement, its lines and its payouts.
router.get('/statements/:id', async (req, res, next) => {
  try {
    const stmt = await loadStatement(req, res);
    if (!stmt) return undefined;
    const [{ rows: lines }, { rows: payouts }] = await Promise.all([
      db.query(
        `SELECT l.*, a.name AS account_name, i.invoice_number
           FROM commission_statement_lines l
           LEFT JOIN customer_accounts a ON a.id = l.account_id
           LEFT JOIN invoices i ON i.id = l.invoice_id
          WHERE l.statement_id = $1 ORDER BY l.line_kind, l.id`,
        [stmt.id]
      ),
      db.query(`SELECT * FROM commission_payouts WHERE statement_id = $1 ORDER BY id`, [stmt.id]),
    ]);
    return res.json({ statement: { ...stmt, period: toIsoDate(stmt.period) }, lines, payouts });
  } catch (err) { fail(res, err, next); }
});

// ── Writes: hard admin ───────────────────────────────────────────────────────

// POST /statements/preview — computes and writes NOTHING, so the admin approves
// the same figures that will be written.
router.post('/statements/preview', requireRole('admin'), csrfProtect, async (req, res, next) => {
  try {
    const { seller_user_id: sellerUserId, period } = req.body || {};
    if (!sellerUserId || !period) {
      return res.status(400).json({ error: 'seller_user_id and period are required', code: 400 });
    }
    const draft = await settlement.compose(db, { sellerUserId: String(sellerUserId), period: String(period) });
    return res.json({ preview: draft });
  } catch (err) { return fail(res, err, next); }
});

router.post('/statements', requireRole('admin'), csrfProtect, async (req, res, next) => {
  try {
    const { seller_user_id: sellerUserId, period, note } = req.body || {};
    if (!sellerUserId || !period) {
      return res.status(400).json({ error: 'seller_user_id and period are required', code: 400 });
    }
    const out = await ledger.withTransaction(client => settlement.issue(client, {
      sellerUserId: String(sellerUserId), period: String(period), note,
      actorId: req.user.id, requestId: req.requestId || null,
    }));
    return res.status(201).json({
      statement: { ...out.statement, period: toIsoDate(out.statement.period) },
      lines: out.lines,
    });
  } catch (err) { return fail(res, err, next); }
});

router.post('/statements/:id/payouts', requireRole('admin'), csrfProtect, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid statement id', code: 400 });
    }
    const b = req.body || {};
    const amount = Number(b.amount_isk);
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount_isk must be a positive whole number of krónur', code: 400 });
    }
    if (!ISO_DATE.test(String(b.paid_on || ''))) {
      return res.status(400).json({ error: 'paid_on must be YYYY-MM-DD', code: 400 });
    }
    if (!['bank_transfer', 'payroll', 'other'].includes(b.method)) {
      return res.status(400).json({ error: 'method must be bank_transfer, payroll or other', code: 400 });
    }
    if (!String(b.idempotency_key || '').trim()) {
      return res.status(400).json({ error: 'idempotency_key is required', code: 400 });
    }
    const vat = b.seller_vat_isk === undefined || b.seller_vat_isk === '' ? 0 : Number(b.seller_vat_isk);
    if (!Number.isInteger(vat) || vat < 0) {
      return res.status(400).json({ error: 'seller_vat_isk must be a whole number of krónur', code: 400 });
    }
    const out = await ledger.withTransaction(client => settlement.recordPayout(client, {
      statementId: id, amountIsk: amount, paidOn: String(b.paid_on), method: b.method,
      reference: b.reference, note: b.note,
      sellerInvoiceNumber: b.seller_invoice_number || null,
      sellerInvoiceDate: ISO_DATE.test(String(b.seller_invoice_date || '')) ? b.seller_invoice_date : null,
      sellerVatIsk: vat,
      idempotencyKey: String(b.idempotency_key).trim(),
      actorId: req.user.id, requestId: req.requestId || null,
    }));
    return res.status(out.created ? 201 : 200).json(out);
  } catch (err) { return fail(res, err, next); }
});

router.post('/adjustments', requireRole('admin'), csrfProtect, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.seller_user_id) return res.status(400).json({ error: 'seller_user_id is required', code: 400 });
    if (!['writeoff', 'manual_credit', 'manual_debit'].includes(b.kind)) {
      return res.status(400).json({ error: 'kind must be writeoff, manual_credit or manual_debit', code: 400 });
    }
    const amount = Number(b.amount_isk);
    if (!Number.isInteger(amount) || amount === 0) {
      return res.status(400).json({ error: 'amount_isk must be a non-zero whole number of krónur', code: 400 });
    }
    if (String(b.reason || '').trim().length < 3) {
      return res.status(400).json({ error: 'reason is required', code: 400 });
    }
    const effectiveOn = ISO_DATE.test(String(b.effective_on || ''))
      ? b.effective_on : new Date().toISOString().slice(0, 10);
    const adj = await ledger.withTransaction(client => settlement.recordAdjustment(client, {
      sellerUserId: String(b.seller_user_id),
      accountId: b.account_id ? Number(b.account_id) : null,
      kind: b.kind, amountIsk: amount, reason: b.reason, effectiveOn,
      actorId: req.user.id, requestId: req.requestId || null,
    }));
    return res.status(201).json({ adjustment: adj });
  } catch (err) {
    if (err && err.code === '23514') {
      return res.status(400).json({
        error: 'A writeoff and a manual credit must be positive; a manual debit must be negative.',
        code: 400,
      });
    }
    return fail(res, err, next);
  }
});

// The account's own trail, for the drawer.
router.get('/statements/:id/audit', async (req, res, next) => {
  try {
    const stmt = await loadStatement(req, res);
    if (!stmt) return undefined;
    const out = await staffAudit.list({ entityType: 'statement', entityId: stmt.id, limit: 50 });
    return res.json(out);
  } catch (err) { return fail(res, err, next); }
});

module.exports = router;
