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
    WHEN ${alias}.total_gross - ${alias}.amount_credited - ${alias}.amount_paid
         + ${alias}.amount_refunded <= 0 THEN 'paid'
    WHEN ${alias}.due_at < NOW() THEN 'overdue'
    WHEN ${alias}.amount_paid > 0 THEN 'part_paid'
    ELSE 'issued'
  END`;
}

// What the customer still owes. A refund puts money back on the clock, so it adds
// to the balance rather than subtracting: invoice, less credited, less paid, plus
// anything handed back. Mirrors invoiceService.outstandingOf().
const OUTSTANDING = 'i.total_gross - i.amount_credited - i.amount_paid + i.amount_refunded';

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
      // Escape LIKE metacharacters. Left raw, `%` matches everything and a
      // `%a%a%a…` pattern drives Postgres's backtracking matcher over every row —
      // twice, since the count query repeats the same WHERE.
      const escaped = String(q).replace(/[\\%_]/g, ch => `\\${ch}`);
      params.push(`%${escaped}%`);
      const like = `$${params.length}`;
      const clauses = [
        `i.customer_name ILIKE ${like} ESCAPE '\\'`,
        `i.customer_email ILIKE ${like} ESCAPE '\\'`,
      ];
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

    // hasOwnProperty, not a bare lookup: SORTABLE['constructor'] would otherwise
    // return an inherited function whose source lands in the ORDER BY clause. The
    // controller allowlists `sort` today, but this method is exported and a second
    // caller should not be able to reach that.
    const sortCol = Object.prototype.hasOwnProperty.call(SORTABLE, sort)
      ? SORTABLE[sort] : SORTABLE.issued;
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

    // Credit notes are SUBTRACTED, and cancelled invoices excluded, so the
    // dashboard ties to the ledger. Counting a fully refunded sale at full value —
    // which `status <> 'draft'` alone does — overstates revenue and output VAT from
    // the first refund onwards, and nothing on the screen would show why.
    const { rows } = await client.query(
      `SELECT
         COUNT(*)::int AS invoices_issued,
         COALESCE(SUM(i.subtotal_net), 0)::bigint AS revenue_gross_net,
         COALESCE(SUM(i.vat_total), 0)::bigint AS output_vat_gross,
         COALESCE(SUM(i.total_gross), 0)::bigint AS invoiced_gross,
         COALESCE(SUM(c.credited_net), 0)::bigint AS credited_net,
         COALESCE(SUM(c.credited_vat), 0)::bigint AS credited_vat,
         COALESCE(SUM(c.credited_gross), 0)::bigint AS credited_gross
       FROM invoices i
       LEFT JOIN LATERAL (
         SELECT SUM(cn.amount_net) AS credited_net,
                SUM(cn.amount_vat) AS credited_vat,
                SUM(cn.amount_gross) AS credited_gross
           FROM credit_notes cn WHERE cn.invoice_id = i.id
       ) c ON TRUE
      WHERE i.status IN ('issued','credited') AND i.series = 'invoice' ${rangeSql}`,
      params
    );

    // Receivables are a position, not a flow: always "as of now", never windowed.
    // Same series filter as the headline figures — a receipt-series document
    // otherwise appeared in AR but not in the revenue it came from.
    const { rows: ar } = await client.query(
      `SELECT
         COALESCE(SUM(${OUTSTANDING}), 0)::bigint AS outstanding,
         COALESCE(SUM(CASE WHEN i.due_at < NOW() THEN ${OUTSTANDING} ELSE 0 END), 0)::bigint AS overdue,
         COUNT(*) FILTER (WHERE i.due_at < NOW())::int AS overdue_count
       FROM invoices i
      WHERE i.status = 'issued' AND i.series = 'invoice' AND ${OUTSTANDING} > 0`
    );

    return {
      invoices_issued: rows[0].invoices_issued,
      revenue_net: Number(rows[0].revenue_gross_net) - Number(rows[0].credited_net),
      output_vat: Number(rows[0].output_vat_gross) - Number(rows[0].credited_vat),
      invoiced_gross: Number(rows[0].invoiced_gross) - Number(rows[0].credited_gross),
      credited_gross: Number(rows[0].credited_gross),
      ar_outstanding: Number(ar[0].outstanding),
      ar_overdue: Number(ar[0].overdue),
      ar_overdue_count: ar[0].overdue_count,
    };
  }

  /**
   * Accounts-receivable aging, grouped by customer.
   *
   * There is no companies table here — a customer is either a registered user or a
   * guest checkout — so rows are grouped by a stable CUSTOMER KEY: the user id when
   * one exists, otherwise the lowercased email. Guests who checked out under two
   * different emails therefore appear as two customers, which is inherent to an
   * email-keyed model and is surfaced in the UI rather than papered over.
   *
   * Buckets are measured from the DUE date, not the invoice date — "30 days
   * overdue" means thirty days past when payment was owed.
   */
  static async agingByCustomer({ limit = 200 } = {}, client = db) {
    const capped = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const { rows } = await client.query(
      `SELECT
         COALESCE(i.user_id, LOWER(i.customer_email)) AS group_key,
         MIN(CASE WHEN i.user_id IS NOT NULL THEN 'u' ELSE 'e' END) AS key_kind,
         MAX(i.user_id) AS user_id,
         MAX(i.customer_email) AS customer_email,
         (ARRAY_AGG(i.customer_name ORDER BY i.issued_at DESC))[1] AS customer_name,
         COUNT(*)::int AS open_invoices,
         MIN(i.due_at) AS oldest_due_at,
         SUM(${OUTSTANDING})::bigint AS total,
         SUM(CASE WHEN i.due_at >= NOW() THEN ${OUTSTANDING} ELSE 0 END)::bigint AS current,
         SUM(CASE WHEN i.due_at < NOW() AND i.due_at >= NOW() - INTERVAL '30 days'
                  THEN ${OUTSTANDING} ELSE 0 END)::bigint AS d1_30,
         SUM(CASE WHEN i.due_at < NOW() - INTERVAL '30 days' AND i.due_at >= NOW() - INTERVAL '60 days'
                  THEN ${OUTSTANDING} ELSE 0 END)::bigint AS d31_60,
         SUM(CASE WHEN i.due_at < NOW() - INTERVAL '60 days' AND i.due_at >= NOW() - INTERVAL '90 days'
                  THEN ${OUTSTANDING} ELSE 0 END)::bigint AS d61_90,
         SUM(CASE WHEN i.due_at < NOW() - INTERVAL '90 days'
                  THEN ${OUTSTANDING} ELSE 0 END)::bigint AS d90_plus
       FROM invoices i
      WHERE i.status = 'issued' AND i.series = 'invoice' AND ${OUTSTANDING} > 0
      GROUP BY COALESCE(i.user_id, LOWER(i.customer_email))
      ORDER BY SUM(${OUTSTANDING}) DESC
      LIMIT $1`,
      [capped]
    );

    const num = v => Number(v || 0);
    const customers = rows.map(r => ({
      // An opaque key the statement endpoint takes back. 'u:'/'e:' says which
      // identity it is, so the server never has to guess.
      customer_key: `${r.key_kind}:${r.key_kind === 'u' ? r.user_id : (r.customer_email || '')}`,
      customer_name: r.customer_name,
      customer_email: r.customer_email,
      open_invoices: r.open_invoices,
      oldest_due_at: toIsoDate(r.oldest_due_at),
      total: num(r.total),
      current: num(r.current),
      d1_30: num(r.d1_30),
      d31_60: num(r.d31_60),
      d61_90: num(r.d61_90),
      d90_plus: num(r.d90_plus),
    }));

    const sum = field => customers.reduce((a, c) => a + c[field], 0);
    return {
      customers,
      totals: {
        total: sum('total'),
        current: sum('current'),
        d1_30: sum('d1_30'),
        d31_60: sum('d31_60'),
        d61_90: sum('d61_90'),
        d90_plus: sum('d90_plus'),
      },
    };
  }

  // Split a customer key back into a scoped WHERE clause. Rejects anything that is
  // not one of the two shapes rather than falling through to an unscoped query.
  static parseCustomerKey(key) {
    const raw = String(key || '');
    const kind = raw.slice(0, 2);
    const value = raw.slice(2);
    if (kind === 'u:' && value) return { kind: 'user', userId: value };
    if (kind === 'e:' && value) return { kind: 'email', email: value.toLowerCase() };
    const err = new Error('Not a valid customer key');
    err.status = 400;
    throw err;
  }

  /**
   * A customer account statement: every charge and credit in date order with a
   * running balance.
   *
   * This is what you send someone who asks "what do I actually owe you", and what
   * an accountant reads to check the AR control account. Charges (invoices) and
   * credits (payments, credit notes) are UNIONed so the ordering is genuinely
   * chronological rather than invoices-then-payments.
   */
  static async statementForCustomer(customerKey, { from = null, to = null } = {}, client = db) {
    const scope = Invoice.parseCustomerKey(customerKey);
    const params = [];
    let scopeSql;
    if (scope.kind === 'user') {
      params.push(scope.userId);
      scopeSql = `i.user_id = $${params.length}`;
    } else {
      params.push(scope.email);
      scopeSql = `LOWER(i.customer_email) = $${params.length}`;
    }

    const range = [];
    if (from) { params.push(from); range.push(`occurred_on >= $${params.length}::date`); }
    if (to) { params.push(to); range.push(`occurred_on <= $${params.length}::date`); }
    const rangeSql = range.length ? `WHERE ${range.join(' AND ')}` : '';

    const { rows } = await client.query(
      `WITH tx AS (
         SELECT i.issued_at::date AS occurred_on, 'invoice' AS kind,
                i.invoice_number::text AS reference, i.id AS invoice_id,
                i.total_gross::bigint AS charge, 0::bigint AS credit,
                i.customer_name, i.customer_email, i.due_at::date AS due_on
           FROM invoices i
          WHERE ${scopeSql} AND i.status IN ('issued','credited') AND i.series = 'invoice'
         UNION ALL
         SELECT p.received_at::date, CASE WHEN p.direction = 'in' THEN 'payment' ELSE 'refund' END,
                COALESCE(NULLIF(p.reference,''), p.method), i.id,
                CASE WHEN p.direction = 'out' THEN p.amount::bigint ELSE 0::bigint END,
                CASE WHEN p.direction = 'in'  THEN p.amount::bigint ELSE 0::bigint END,
                i.customer_name, i.customer_email, NULL
           FROM payments p JOIN invoices i ON i.id = p.invoice_id
          WHERE ${scopeSql} AND i.series = 'invoice'
         UNION ALL
         SELECT cn.issued_at::date, 'credit_note', cn.credit_note_number::text, i.id,
                0::bigint, cn.amount_gross::bigint,
                i.customer_name, i.customer_email, NULL
           FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id
          WHERE ${scopeSql} AND i.series = 'invoice'
       )
       SELECT * FROM tx ${rangeSql} ORDER BY occurred_on, kind, reference`,
      params
    );

    let balance = 0;
    const lines = rows.map((r) => {
      balance += Number(r.charge) - Number(r.credit);
      return {
        occurred_on: toIsoDate(r.occurred_on),
        kind: r.kind,
        reference: r.reference,
        invoice_id: r.invoice_id,
        due_on: toIsoDate(r.due_on),
        charge: Number(r.charge),
        credit: Number(r.credit),
        balance,
      };
    });

    return {
      customer_key: customerKey,
      customer_name: rows.length ? rows[rows.length - 1].customer_name : null,
      customer_email: rows.length ? rows[rows.length - 1].customer_email : null,
      lines,
      closing_balance: balance,
      range: { from, to },
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
        WHERE i.status IN ('issued','credited') AND i.series = 'invoice'
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
