// Commission — the seller's ledger (migration 098 `commission_events`;
// ENHANCEMENTS #18, D-003). One row per commissionable service invoice,
// written in the invoice's transaction with the seller and the rate
// snapshotted from the account at that moment (an owner change moves only
// future commission).
//
// D-003: commission is EARNED only on receipt of the customer's payment, so
// the ledger stores the accrual and the report derives "payable" from the
// invoice (fully paid, not credited). Nothing here is paid from the app —
// Halli pays the seller's verktaka invoice outside it.

const db = require('../config/database');

const KINDS = ['build', 'recurring'];

// First day of the invoice month. Takes the ISO date the invoice was issued
// with ('YYYY-MM-DD') or, defensively, the Date pg hands back for a
// TIMESTAMPTZ — read in LOCAL components, because that is how the date-only
// string was written.
function periodOf(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-01`;
  }
  return `${String(value).slice(0, 7)}-01`;
}

class Commission {
  /** Inside the invoice transaction. Returns the event, or null when nothing is due. */
  static async recordForInvoice(client, { account, invoice, kind, issuedAt = null }) {
    if (!KINDS.includes(kind)) return null;
    const rateBp = kind === 'build' ? Number(account.build_rate_bp) : Number(account.recurring_rate_bp);
    if (!rateBp) return null;
    const base = Number(invoice.subtotal_net) || 0;
    const amount = Math.round(base * rateBp / 10000);
    const { rows: [row] } = await client.query(
      `INSERT INTO commission_events
         (account_id, seller_user_id, kind, period, base_amount_isk, rate_bp, amount_isk, invoice_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [account.id, account.owner_user_id, kind, periodOf(issuedAt || invoice.issued_at), base, rateBp, amount, invoice.id]
    );
    return row;
  }

  static _scope(scope, params) {
    if (!scope || typeof scope !== 'object') throw new Error('Commission: scope is required');
    if (scope.all === true) return '';
    if (!scope.ownerId) throw new Error('Commission: scope is required');
    params.push(String(scope.ownerId));
    return `e.seller_user_id = $${params.length}`;
  }

  static _range(from, to, params) {
    const out = [];
    if (from) { params.push(from); out.push(`e.period >= $${params.length}`); }
    if (to)   { params.push(to);   out.push(`e.period <= $${params.length}`); }
    return out;
  }

  /** Events, newest first, with the invoice's paid state. */
  static async events(scope, { from = null, to = null, accountId = null, limit = 200 } = {}) {
    const params = [];
    const clauses = [];
    const sc = this._scope(scope, params); if (sc) clauses.push(sc);
    clauses.push(...this._range(from, to, params));
    if (accountId) { params.push(accountId); clauses.push(`e.account_id = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const { rows } = await db.query(
      `SELECT e.id, e.account_id, a.name AS account_name, a.slug AS account_slug,
              e.seller_user_id, COALESCE(u.display_name, u.username) AS seller_name, u.username AS seller_username,
              e.kind, e.period, e.base_amount_isk, e.rate_bp, e.amount_isk, e.invoice_id, e.created_at,
              i.invoice_number, i.status AS invoice_status, i.total_gross, i.amount_paid,
              (i.status = 'issued' AND i.amount_paid >= i.total_gross) AS invoice_paid
         FROM commission_events e
         JOIN customer_accounts a ON a.id = e.account_id
         JOIN users u ON u.id = e.seller_user_id
         JOIN invoices i ON i.id = e.invoice_id
         ${where}
        ORDER BY e.period DESC, e.id DESC
        LIMIT $${params.length + 1}`,
      [...params, lim]
    );
    return rows;
  }

  /** Per seller per month: accrued vs payable (invoice fully paid). */
  static async report(scope, { from = null, to = null } = {}) {
    const params = [];
    const clauses = [];
    const sc = this._scope(scope, params); if (sc) clauses.push(sc);
    clauses.push(...this._range(from, to, params));
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT e.seller_user_id, COALESCE(u.display_name, u.username) AS seller_name, u.username AS seller_username,
              e.period,
              COUNT(*)::int AS events,
              SUM(e.amount_isk)::bigint AS accrued_isk,
              SUM(CASE WHEN i.status = 'issued' AND i.amount_paid >= i.total_gross THEN e.amount_isk ELSE 0 END)::bigint AS payable_isk,
              SUM(CASE WHEN e.kind = 'build' THEN e.amount_isk ELSE 0 END)::bigint AS build_isk,
              SUM(CASE WHEN e.kind = 'recurring' THEN e.amount_isk ELSE 0 END)::bigint AS recurring_isk
         FROM commission_events e
         JOIN users u ON u.id = e.seller_user_id
         JOIN invoices i ON i.id = e.invoice_id
         ${where}
        GROUP BY e.seller_user_id, u.display_name, u.username, e.period
        ORDER BY e.period DESC, seller_name ASC`,
      params
    );
    return rows;
  }
}

Commission.KINDS = KINDS;
Commission.periodOf = periodOf;

module.exports = Commission;
