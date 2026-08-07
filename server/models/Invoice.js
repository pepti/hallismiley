// Invoice reads. Writes live in services/bookkeeping/invoiceService.js, which owns
// the transaction, the numbering and the ledger posting.
//
// 'paid' and 'overdue' are DERIVED here, never stored: they are functions of
// amount_paid, amount_credited and due_at, so storing them would let the label
// drift away from the money. Only real state transitions (issued / credited /
// cancelled) live in the status column.

const db = require('../config/database');
const { toIsoDate, todayIso, daysBetween } = require('../utils/booksDate');

// Sort allowlist. The column name is never taken from the request — a request
// value reaching an ORDER BY clause is the classic injection route, so the client
// sends a key and this map decides the SQL.
const SORTABLE = {
  number: 'i.invoice_number',
  issued: 'i.issued_at',
  due: 'i.due_at',
  customer: 'i.customer_name',
  total: 'i.total_gross',
  outstanding: 'outstanding',
};

const DISPLAY_STATUSES = ['draft', 'issued', 'paid', 'part_paid', 'overdue', 'credited', 'cancelled'];

// Derived display status, as a SQL expression so it can also be filtered on.
// Order matters: cancelled/credited/draft win over anything money-derived, then
// fully settled, then overdue, then partly paid.
function displayStatusExpr(alias = 'i') {
  return `CASE
    WHEN ${alias}.status IN ('cancelled','credited','draft') THEN ${alias}.status
    WHEN ${alias}.amount_paid + ${alias}.amount_credited >= ${alias}.total_gross THEN 'paid'
    WHEN ${alias}.due_at < NOW() THEN 'overdue'
    WHEN ${alias}.amount_paid > 0 THEN 'part_paid'
    ELSE 'issued'
  END`;
}

const OUTSTANDING = 'i.total_gross - i.amount_paid - i.amount_credited';

// Normalise a row for the API: bigint columns arrive as strings from pg (they can
// exceed JS's safe integer range), and DATE/TIMESTAMPTZ arrive as Date objects.
function shape(row) {
  if (!row) return null;
  const num = v => (v === null || v === undefined ? null : Number(v));
  return {
    ...row,
    invoice_number: num(row.invoice_number),
    subtotal_net: num(row.subtotal_net),
    vat_total: num(row.vat_total),
    total_gross: num(row.total_gross),
    discount_total: num(row.discount_total),
    shipping_gross: num(row.shipping_gross),
    amount_paid: num(row.amount_paid),
    amount_credited: num(row.amount_credited),
    outstanding: num(row.outstanding),
    original_total_gross: num(row.original_total_gross),
    fx_rate: num(row.fx_rate),
    issued_at: toIsoDate(row.issued_at),
    due_at: toIsoDate(row.due_at),
  };
}

class Invoice {
  static get SORTABLE() { return SORTABLE; }
  static get DISPLAY_STATUSES() { return DISPLAY_STATUSES; }

  /**
   * Paginated list. Every filter is parameterised; `sort` and `dir` are resolved
   * through allowlists by the caller (the controller validates, this maps).
   */
  static async list({
    q = null, status = null, from = null, to = null, series = null,
    sort = 'issued', dir = 'desc', limit = 50, offset = 0,
  } = {}, client = db) {
    const where = ['1=1'];
    const params = [];
    const add = (sql, value) => { params.push(value); where.push(sql.replace('$?', `$${params.length}`)); };

    if (series) add('i.series = $?', series);

    // Search matches a customer name or email fragment, plus the invoice number
    // when the query looks numeric.
    if (q) {
      params.push(`%${q}%`);
      const like = `$${params.length}`;
      const clauses = [`i.customer_name ILIKE ${like}`, `i.customer_email ILIKE ${like}`];
      const digits = String(q).replace(/\D/g, '');
      // invoice_number is BIGINT, but keep the guard: a query of 30 digits would
      // otherwise raise a numeric-out-of-range from Postgres and surface as a 500
      // rather than an empty result set.
      if (digits && Number.isSafeInteger(Number(digits))) {
        params.push(Number(digits));
        clauses.push(`i.invoice_number = $${params.length}`);
      }
      where.push(`(${clauses.join(' OR ')})`);
    }
    if (from) add('i.issued_at >= $?::date', from);
    // Inclusive end: `< to + 1 day` so an invoice issued at 23:59 on the end date
    // is included. Half-open vs closed ranges differing between screens was a real
    // source of "the totals don't match" in the system this replaces.
    if (to) add('i.issued_at < ($?::date + INTERVAL \'1 day\')', to);
    if (status) add(`${displayStatusExpr()} = $?`, status);

    const sortCol = SORTABLE[sort] || SORTABLE.issued;
    const sortDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    params.push(limit, offset);
    const { rows } = await client.query(
      `SELECT i.*, ${OUTSTANDING} AS outstanding, ${displayStatusExpr()} AS display_status
         FROM invoices i
        WHERE ${where.join(' AND ')}
        ORDER BY ${sortCol} ${sortDir}, i.invoice_number DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS total FROM invoices i WHERE ${where.join(' AND ')}`,
      params.slice(0, -2)
    );
    return { invoices: rows.map(shape), total: countRows[0].total };
  }

  static async findById(id, client = db) {
    const { rows } = await client.query(
      `SELECT i.*, ${OUTSTANDING} AS outstanding, ${displayStatusExpr()} AS display_status
         FROM invoices i WHERE i.id = $1`,
      [String(id)]
    );
    return shape(rows[0]);
  }

  // Full document: header, lines, per-rate VAT summary, payments and credit notes.
  // One round trip per collection rather than per row — the detail screen is the
  // most-visited page in the books and an N+1 here is felt immediately.
  static async findDetail(id, client = db) {
    const invoice = await Invoice.findById(id, client);
    if (!invoice) return null;
    const [lines, payments, creditNotes] = await Promise.all([
      client.query(
        `SELECT id, product_id, sku, description, quantity::float AS quantity,
                unit_price_gross, vat_rate, gross_before_discount, discount_gross,
                line_net, line_vat, line_gross, revenue_account, sort_order
           FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order`, [invoice.id]),
      client.query(
        `SELECT p.id, p.amount, p.method, p.received_at, p.reference, p.created_at,
                u.username AS recorded_by
           FROM payments p LEFT JOIN users u ON u.id = p.created_by
          WHERE p.invoice_id = $1 ORDER BY p.received_at, p.created_at`, [invoice.id]),
      client.query(
        `SELECT cn.id, cn.credit_note_number, cn.amount_net, cn.amount_vat, cn.amount_gross,
                cn.reason, cn.issued_at, cn.stripe_refund_id, u.username AS issued_by
           FROM credit_notes cn LEFT JOIN users u ON u.id = cn.created_by
          WHERE cn.invoice_id = $1 ORDER BY cn.issued_at, cn.created_at`, [invoice.id]),
    ]);

    const shapedLines = lines.rows.map(l => ({
      ...l,
      unit_price_gross: Number(l.unit_price_gross),
      gross_before_discount: Number(l.gross_before_discount),
      discount_gross: Number(l.discount_gross),
      line_net: Number(l.line_net),
      line_vat: Number(l.line_vat),
      line_gross: Number(l.line_gross),
    }));

    // Per-rate breakdown — the invoice must state VAT separated by rate, and the
    // VSK return is built from the same shape.
    const byRate = new Map();
    for (const l of shapedLines) {
      const cur = byRate.get(l.vat_rate) || { rate: l.vat_rate, net: 0, vat: 0, gross: 0 };
      cur.net += l.line_net; cur.vat += l.line_vat; cur.gross += l.line_gross;
      byRate.set(l.vat_rate, cur);
    }

    return {
      ...invoice,
      lines: shapedLines,
      vat_by_rate: [...byRate.values()].sort((a, b) => a.rate - b.rate),
      payments: payments.rows.map(p => ({
        ...p, amount: Number(p.amount), received_at: toIsoDate(p.received_at),
      })),
      credit_notes: creditNotes.rows.map(c => ({
        ...c,
        credit_note_number: Number(c.credit_note_number),
        amount_net: Number(c.amount_net),
        amount_vat: Number(c.amount_vat),
        amount_gross: Number(c.amount_gross),
        issued_at: toIsoDate(c.issued_at),
      })),
      days_overdue: invoice.due_at && invoice.outstanding > 0
        ? Math.max(0, daysBetween(invoice.due_at, todayIso())) : 0,
    };
  }

  // Dashboard headline numbers. Deliberately period-bounded rather than all-time:
  // an unbounded aggregate over the whole table gets slower every year.
  static async metrics({ from = null, to = null } = {}, client = db) {
    const params = [];
    const range = [];
    if (from) { params.push(from); range.push(`i.issued_at >= $${params.length}::date`); }
    if (to) { params.push(to); range.push(`i.issued_at < ($${params.length}::date + INTERVAL '1 day')`); }
    const rangeSql = range.length ? `AND ${range.join(' AND ')}` : '';

    const { rows } = await client.query(
      `SELECT
         COUNT(*)::int AS invoices_issued,
         COALESCE(SUM(i.subtotal_net), 0)::bigint AS revenue_net,
         COALESCE(SUM(i.vat_total), 0)::bigint AS output_vat,
         COALESCE(SUM(i.total_gross), 0)::bigint AS invoiced_gross
       FROM invoices i
      WHERE i.status <> 'draft' AND i.series = 'invoice' ${rangeSql}`,
      params
    );

    // Receivables are a position, not a flow: always "as of now", never windowed.
    const { rows: ar } = await client.query(
      `SELECT
         COALESCE(SUM(${OUTSTANDING}), 0)::bigint AS outstanding,
         COALESCE(SUM(CASE WHEN i.due_at < NOW() THEN ${OUTSTANDING} ELSE 0 END), 0)::bigint AS overdue,
         COUNT(*) FILTER (WHERE i.due_at < NOW())::int AS overdue_count
       FROM invoices i
      WHERE i.status = 'issued' AND ${OUTSTANDING} > 0`
    );

    return {
      invoices_issued: rows[0].invoices_issued,
      revenue_net: Number(rows[0].revenue_net),
      output_vat: Number(rows[0].output_vat),
      invoiced_gross: Number(rows[0].invoiced_gross),
      ar_outstanding: Number(ar[0].outstanding),
      ar_overdue: Number(ar[0].overdue),
      ar_overdue_count: ar[0].overdue_count,
    };
  }

  // Invoiced gross per day, for the dashboard chart. Bucketed in SQL so the
  // response stays small regardless of volume.
  static async timeseries({ from, to }, client = db) {
    const { rows } = await client.query(
      `SELECT i.issued_at::date AS day,
              SUM(i.total_gross)::bigint AS gross,
              SUM(i.vat_total)::bigint AS vat
         FROM invoices i
        WHERE i.status <> 'draft'
          AND i.issued_at >= $1::date
          AND i.issued_at < ($2::date + INTERVAL '1 day')
        GROUP BY 1 ORDER BY 1`,
      [from, to]
    );
    return rows.map(r => ({ day: toIsoDate(r.day), gross: Number(r.gross), vat: Number(r.vat) }));
  }
}

Invoice.displayStatusExpr = displayStatusExpr;
Invoice.OUTSTANDING = OUTSTANDING;
module.exports = Invoice;
