// Commission settlement — statements, payouts, adjustments (migration 102).
// Decision: D-019 (2026-09-08), amending D-003.
//
// The unit is the seller-MONTH STATEMENT over a RUNNING BALANCE:
//
//   balance = Σ payable_now(event) + Σ adjustments − Σ payouts
//
// Positive = the company owes the seller. Negative = the seller has been paid
// for a sale that was later credited. Clawback is not a separate mechanism; it
// is this equation going down, and per D-019 it is netted against future
// statements only — the company never invoices a seller for cash.
//
// Two properties worth stating, because they are what make the thing correct:
//
//   1. The windows are SET DIFFERENCES, not date ranges. A statement consumes
//      every event whose payability has moved since the last line written for
//      it, plus every adjustment and payout with no line at all. So a payment
//      recorded late, a backdated payout, or a skipped month can never fall
//      between two windows and vanish — it simply lands on the next statement.
//   2. No statement is ever reopened, corrected or voided. September's
//      statement is a true record of what was owed on the day it was issued;
//      anything that changes afterwards is a line on October's.
const db = require('../config/database');
const Commission = require('../models/Commission');
const staffAudit = require('./staffAudit');
const { toIsoDate } = require('../utils/booksDate');

class StatementError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'StatementError';
    this.status = status;
    if (code) this.code = code;
  }
}

const DEFAULT_MINIMUM_ISK = 25000;   // D-003 §6.3 / contract clause 6.3
// D-019: an unrecovered negative balance is written off after this long. The
// write-off is a deliberate admin action, not an automatic one — money leaving
// the books should have a person behind it (Reglugerð 505/2013 gr. 8 is the
// same instinct) — so this only drives what the UI flags as eligible.
const CLAWBACK_WINDOW_MONTHS = 12;

const PAYEE_KINDS = ['contractor', 'employee', 'internal'];
const payeeKindOf = user => (PAYEE_KINDS.includes(user && user.payee_kind) ? user.payee_kind : 'contractor');

function firstOfMonth(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || '').trim());
  if (!m) throw new StatementError(`Not a valid month: ${period}`, 400, 'BAD_PERIOD');
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new StatementError(`Not a valid month: ${period}`, 400, 'BAD_PERIOD');
  return `${m[1]}-${m[2]}-01`;
}

/**
 * Everything a statement for this seller would contain right now, without
 * writing anything. `preview` and `issue` share it so the figures an admin
 * approves are the figures that get written.
 */
async function compose(client, { sellerUserId, period, minimumIsk = DEFAULT_MINIMUM_ISK }) {
  const periodDate = firstOfMonth(period);

  const { rows: sellerRows } = await client.query(
    `SELECT id, username, COALESCE(display_name, username) AS display_name,
            payee_kind, payee_kennitala, payee_vat_number
       FROM users WHERE id = $1`,
    [sellerUserId]
  );
  const seller = sellerRows[0];
  if (!seller) throw new StatementError('Seller not found', 404, 'SELLER_NOT_FOUND');

  // The predecessor, and the guard that periods run forward. Locked so two
  // concurrent runs serialise on the same seller rather than both linking to it
  // (the chain's unique index is the real backstop; see migration 102).
  const { rows: prevRows } = await client.query(
    `SELECT id, period, closing_balance_isk FROM commission_statements
      WHERE seller_user_id = $1 ORDER BY period DESC, id DESC LIMIT 1 FOR UPDATE`,
    [sellerUserId]
  );
  const previous = prevRows[0] || null;
  if (previous && toIsoDate(previous.period) >= periodDate) {
    throw new StatementError(
      `The last statement for this seller is ${toIsoDate(previous.period).slice(0, 7)}; a statement must be for a later month.`,
      409, 'STATEMENT_PERIOD_ORDER'
    );
  }
  const opening = previous ? Number(previous.closing_balance_isk) : 0;

  // Window 1 — every event whose payable amount has moved since whatever a
  // statement last recorded for it. `payable_before` is that recorded value, or
  // 0 when the event has never appeared on one.
  const { rows: eventRows } = await client.query(
    `SELECT e.id, e.account_id, a.name AS account_name, e.invoice_id, i.invoice_number,
            e.kind, e.amount_isk,
            ${Commission.PAYABLE_NOW_ISK} AS payable_now_isk,
            COALESCE((
              SELECT l.payable_after_isk FROM commission_statement_lines l
               WHERE l.commission_event_id = e.id
               ORDER BY l.statement_id DESC LIMIT 1
            ), 0) AS payable_before_isk
       FROM commission_events e
       JOIN customer_accounts a ON a.id = e.account_id
       JOIN invoices i ON i.id = e.invoice_id
      WHERE e.seller_user_id = $1
      ORDER BY e.id`,
    [sellerUserId]
  );

  const lines = [];
  let earned = 0;
  let clawback = 0;
  for (const e of eventRows) {
    const before = Number(e.payable_before_isk);
    const after = Number(e.payable_now_isk);
    const delta = after - before;
    if (delta === 0) continue;
    if (delta > 0) earned += delta; else clawback += -delta;
    lines.push({
      line_kind: delta > 0 ? 'earned' : 'clawback',
      commission_event_id: e.id,
      account_id: e.account_id,
      invoice_id: e.invoice_id,
      description: `${e.account_name} · #${e.invoice_number}`,
      payable_before_isk: before,
      payable_after_isk: after,
      amount_isk: delta,
    });
  }

  // Window 2 — adjustments never consumed by a statement.
  const { rows: adjRows } = await client.query(
    `SELECT j.id, j.kind, j.amount_isk, j.reason, j.account_id
       FROM commission_adjustments j
      WHERE j.seller_user_id = $1
        AND NOT EXISTS (SELECT 1 FROM commission_statement_lines l WHERE l.adjustment_id = j.id)
      ORDER BY j.id`,
    [sellerUserId]
  );
  let adjustment = 0;
  for (const a of adjRows) {
    adjustment += Number(a.amount_isk);
    lines.push({
      line_kind: 'adjustment',
      adjustment_id: a.id,
      account_id: a.account_id,
      description: a.reason,
      amount_isk: Number(a.amount_isk),
    });
  }

  // Window 3 — payouts never consumed by a statement.
  const { rows: payRows } = await client.query(
    `SELECT p.id, p.amount_isk, p.paid_on, p.method
       FROM commission_payouts p
      WHERE p.seller_user_id = $1
        AND NOT EXISTS (SELECT 1 FROM commission_statement_lines l WHERE l.payout_id = p.id)
      ORDER BY p.id`,
    [sellerUserId]
  );
  let settled = 0;
  for (const p of payRows) {
    settled += Number(p.amount_isk);
    lines.push({
      line_kind: 'payout',
      payout_id: p.id,
      description: `${toIsoDate(p.paid_on)} · ${p.method}`,
      amount_isk: -Number(p.amount_isk),
    });
  }

  const closing = opening + earned - clawback + adjustment - settled;
  const payeeKind = payeeKindOf(seller);
  // Under the minimum, or non-positive, the whole balance carries. An `internal`
  // payee is never payable at all — it is an attribution, not a payment.
  const payable = (payeeKind === 'internal' || closing < minimumIsk) ? 0 : closing;

  return {
    seller: { id: seller.id, username: seller.username, display_name: seller.display_name },
    period: periodDate,
    payee_kind: payeeKind,
    payee_kennitala: seller.payee_kennitala || null,
    payee_vat_number: seller.payee_vat_number || null,
    previous_statement_id: previous ? previous.id : null,
    opening_balance_isk: opening,
    earned_isk: earned,
    clawback_isk: clawback,
    adjustment_isk: adjustment,
    settled_isk: settled,
    closing_balance_isk: closing,
    minimum_isk: minimumIsk,
    payable_isk: payable,
    carried_isk: closing - payable,
    lines,
  };
}

/** Compose and WRITE. Caller supplies the transaction client. */
async function issue(client, { sellerUserId, period, minimumIsk, note = '', actorId, requestId = null }) {
  const draft = await compose(client, { sellerUserId, period, minimumIsk });

  // A statement with nothing on it and nothing carried forward is noise.
  if (!draft.lines.length && draft.opening_balance_isk === 0) {
    throw new StatementError('Nothing to settle for this seller in this period.', 409, 'NOTHING_TO_SETTLE');
  }

  let stmt;
  try {
    const { rows } = await client.query(
      `INSERT INTO commission_statements
         (seller_user_id, period, cutoff_at, previous_statement_id,
          payee_kind, payee_kennitala, payee_vat_number,
          opening_balance_isk, earned_isk, clawback_isk, adjustment_isk, settled_isk,
          closing_balance_isk, minimum_isk, payable_isk, carried_isk, note, issued_by)
       VALUES ($1,$2::date,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        sellerUserId, draft.period, draft.previous_statement_id,
        draft.payee_kind, draft.payee_kennitala, draft.payee_vat_number,
        draft.opening_balance_isk, draft.earned_isk, draft.clawback_isk,
        draft.adjustment_isk, draft.settled_isk, draft.closing_balance_isk,
        draft.minimum_isk, draft.payable_isk, draft.carried_isk, String(note || ''), actorId,
      ]
    );
    stmt = rows[0];
  } catch (err) {
    if (err && err.code === '23505') {
      // Either this seller-month exists, or another run claimed the same
      // predecessor a moment ago. Both are 409s the caller can simply retry.
      throw new StatementError(
        'A statement for this seller and month already exists, or one was issued concurrently.',
        409, 'STATEMENT_EXISTS'
      );
    }
    throw err;
  }

  for (const l of draft.lines) {
    await client.query(
      `INSERT INTO commission_statement_lines
         (statement_id, line_kind, commission_event_id, adjustment_id, payout_id,
          account_id, invoice_id, description, payable_before_isk, payable_after_isk, amount_isk)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        stmt.id, l.line_kind, l.commission_event_id || null, l.adjustment_id || null,
        l.payout_id || null, l.account_id || null, l.invoice_id || null,
        String(l.description || ''), l.payable_before_isk || 0, l.payable_after_isk || 0, l.amount_isk,
      ]
    );
  }

  await staffAudit.record(client, {
    actorId, requestId,
    action: 'commission.statement_issued', entityType: 'statement', entityId: stmt.id,
    summary: {
      seller_user_id: sellerUserId, period: draft.period, payee_kind: draft.payee_kind,
      opening_balance_isk: draft.opening_balance_isk, earned_isk: draft.earned_isk,
      clawback_isk: draft.clawback_isk, adjustment_isk: draft.adjustment_isk,
      settled_isk: draft.settled_isk, closing_balance_isk: draft.closing_balance_isk,
      payable_isk: draft.payable_isk, carried_isk: draft.carried_isk, lines: draft.lines.length,
    },
  });

  return { statement: stmt, lines: draft.lines };
}

/** Record that a statement was actually paid. */
async function recordPayout(client, {
  statementId, amountIsk, paidOn, method, reference = '', note = '',
  sellerInvoiceNumber = null, sellerInvoiceDate = null, sellerVatIsk = 0,
  idempotencyKey, actorId, requestId = null,
}) {
  if (!idempotencyKey) throw new StatementError('idempotency_key is required', 400, 'IDEMPOTENCY_KEY_REQUIRED');

  const { rows: existing } = await client.query(
    `SELECT * FROM commission_payouts WHERE idempotency_key = $1`, [idempotencyKey]
  );
  if (existing.length) return { payout: existing[0], created: false };

  const { rows: sRows } = await client.query(
    `SELECT * FROM commission_statements WHERE id = $1 FOR UPDATE`, [statementId]
  );
  const stmt = sRows[0];
  if (!stmt) throw new StatementError('Statement not found', 404, 'STATEMENT_NOT_FOUND');
  if (Number(stmt.payable_isk) === 0) {
    throw new StatementError(
      'This statement has nothing payable — the balance was carried forward.',
      409, 'PAYOUT_NOT_PAYABLE'
    );
  }
  // An employee's commission is gross pay: it goes through the payroll module,
  // which withholds staðgreiðsla and tryggingagjald. Recording it as a bank
  // transfer here would book a net payment as if it were a contractor invoice.
  if (stmt.payee_kind === 'employee' && method !== 'payroll') {
    throw new StatementError(
      'This seller is on payroll; a commission payment to them must be recorded with method "payroll".',
      409, 'PAYOUT_METHOD_MISMATCH'
    );
  }
  const outstanding = Number(stmt.payable_isk) - Number(stmt.amount_paid_isk);
  if (amountIsk > outstanding) {
    throw new StatementError(
      `That is more than the statement still owes (${outstanding} kr.).`,
      422, 'PAYOUT_OVERPAYMENT'
    );
  }

  const { rows } = await client.query(
    `INSERT INTO commission_payouts
       (statement_id, seller_user_id, amount_isk, paid_on, method, reference,
        seller_invoice_number, seller_invoice_date, seller_vat_isk, idempotency_key, note, created_by)
     VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8::date,$9,$10,$11,$12)
     RETURNING *`,
    [
      stmt.id, stmt.seller_user_id, amountIsk, paidOn, method, String(reference || ''),
      sellerInvoiceNumber, sellerInvoiceDate, sellerVatIsk || 0, idempotencyKey,
      String(note || ''), actorId,
    ]
  );
  const payout = rows[0];

  await client.query(
    `UPDATE commission_statements SET amount_paid_isk = amount_paid_isk + $2 WHERE id = $1`,
    [stmt.id, amountIsk]
  );

  await staffAudit.record(client, {
    actorId, requestId,
    action: 'commission.payout_recorded', entityType: 'statement', entityId: stmt.id,
    summary: {
      payout_id: payout.id, seller_user_id: stmt.seller_user_id, amount_isk: amountIsk,
      seller_vat_isk: sellerVatIsk || 0, paid_on: paidOn, method,
      seller_invoice_number: sellerInvoiceNumber,
    },
  });

  return { payout, created: true };
}

async function recordAdjustment(client, {
  sellerUserId, accountId = null, kind, amountIsk, reason, effectiveOn, actorId, requestId = null,
}) {
  const { rows } = await client.query(
    `INSERT INTO commission_adjustments
       (seller_user_id, account_id, kind, amount_isk, reason, effective_on, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7)
     RETURNING *`,
    [sellerUserId, accountId, kind, amountIsk, String(reason).trim(), effectiveOn, actorId]
  );
  const adj = rows[0];
  await staffAudit.record(client, {
    actorId, requestId,
    action: 'commission.adjustment_recorded', entityType: 'user', entityId: sellerUserId,
    summary: { adjustment_id: adj.id, kind, amount_isk: amountIsk, account_id: accountId, reason: adj.reason },
  });
  return adj;
}

/**
 * The live balance per seller, independent of any statement — what the screen's
 * balance strip shows, and what the tests recompute against.
 */
async function balances(scope, client = db) {
  if (!scope || typeof scope !== 'object') throw new StatementError('scope is required', 500);
  const params = [];
  let where = '';
  if (scope.all !== true) {
    if (!scope.ownerId) throw new StatementError('scope is required', 500);
    params.push(String(scope.ownerId));
    where = `WHERE u.id = $1`;
  }
  const { rows } = await client.query(
    `SELECT u.id AS seller_user_id, COALESCE(u.display_name, u.username) AS seller_name,
            u.username AS seller_username, COALESCE(u.payee_kind, 'contractor') AS payee_kind,
            COALESCE(ev.payable_isk, 0)::bigint AS payable_isk,
            COALESCE(ev.accrued_isk, 0)::bigint AS accrued_isk,
            COALESCE(aj.adjust_isk, 0)::bigint  AS adjustment_isk,
            COALESCE(po.paid_isk, 0)::bigint    AS settled_isk,
            (COALESCE(ev.payable_isk,0) + COALESCE(aj.adjust_isk,0) - COALESCE(po.paid_isk,0))::bigint AS balance_isk,
            po.last_paid_on
       FROM users u
       LEFT JOIN LATERAL (
         SELECT SUM(${Commission.PAYABLE_NOW_ISK})::bigint AS payable_isk,
                SUM(e.amount_isk)::bigint AS accrued_isk
           FROM commission_events e JOIN invoices i ON i.id = e.invoice_id
          WHERE e.seller_user_id = u.id
       ) ev ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(amount_isk)::bigint AS adjust_isk
           FROM commission_adjustments WHERE seller_user_id = u.id
       ) aj ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(amount_isk)::bigint AS paid_isk, MAX(paid_on) AS last_paid_on
           FROM commission_payouts WHERE seller_user_id = u.id
       ) po ON TRUE
       ${where ? where + ' AND' : 'WHERE'} (ev.accrued_isk IS NOT NULL OR aj.adjust_isk IS NOT NULL OR po.paid_isk IS NOT NULL)
      ORDER BY seller_name`,
    params
  );
  // D-019's 12-month window: a negative balance older than this is eligible for
  // write-off. Flagged, never applied automatically — the write-off is money
  // leaving the books and wants a person behind it.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - CLAWBACK_WINDOW_MONTHS);
  return rows.map(r => ({
    ...r,
    writeoff_eligible: Number(r.balance_isk) < 0 && !!r.last_paid_on
      && new Date(r.last_paid_on) < cutoff,
  }));
}

// A statement's status is DERIVED, never stored — the same rule the invoices
// table states for 'paid'/'overdue', so it cannot drift out of sync with the
// figures. `hasLater` = the seller has a statement for a later period. One
// function for the admin list and the seller-area publish (D-020), so the two
// can never disagree about what "open" means.
function statementStatus(s, hasLater) {
  if (Number(s.payable_isk) === 0) return 'carried';
  if (Number(s.amount_paid_isk) >= Number(s.payable_isk)) return 'paid';
  return hasLater ? 'superseded' : 'open';
}

module.exports = {
  StatementError, statementStatus, DEFAULT_MINIMUM_ISK, CLAWBACK_WINDOW_MONTHS, PAYEE_KINDS,
  compose, issue, recordPayout, recordAdjustment, balances, firstOfMonth,
};
