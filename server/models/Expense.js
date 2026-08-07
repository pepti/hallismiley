// Expense reads. Writes live in services/bookkeeping/expenseService.js.

const db = require('../config/database');
const { toIsoDate } = require('../utils/booksDate');

const SORTABLE = {
  date: 'e.expense_date',
  supplier: 'LOWER(e.supplier_name)',
  gross: 'e.amount_gross',
  vat: 'e.amount_vat',
};

function shape(row) {
  if (!row) return null;
  return {
    ...row,
    amount_net: Number(row.amount_net),
    amount_vat: Number(row.amount_vat),
    amount_gross: Number(row.amount_gross),
    original_amount_gross: row.original_amount_gross === null ? null : Number(row.original_amount_gross),
    fx_rate: Number(row.fx_rate),
    expense_date: toIsoDate(row.expense_date),
  };
}

class Expense {
  static get SORTABLE() { return SORTABLE; }

  static async list({
    q = null, from = null, to = null, vatCode = null, missingDocument = false,
    deductible = null, sort = 'date', dir = 'desc', limit = 50, offset = 0,
  } = {}, client = db) {
    const where = ['1=1'];
    const params = [];

    if (q) {
      // Same LIKE-metacharacter escaping as the invoice search: unescaped, a bare
      // `%` matches everything and a `%a%a%…` pattern is a cheap CPU drain.
      const escaped = String(q).replace(/[\\%_]/g, ch => `\\${ch}`);
      params.push(`%${escaped}%`);
      where.push(`(e.supplier_name ILIKE $${params.length} ESCAPE '\\'
                   OR e.supplier_invoice_no ILIKE $${params.length} ESCAPE '\\'
                   OR e.description ILIKE $${params.length} ESCAPE '\\')`);
    }
    if (from) { params.push(from); where.push(`e.expense_date >= $${params.length}::date`); }
    if (to) { params.push(to); where.push(`e.expense_date <= $${params.length}::date`); }
    if (vatCode) { params.push(vatCode); where.push(`e.vat_code = $${params.length}`); }
    if (deductible !== null) { params.push(deductible); where.push(`e.vat_deductible = $${params.length}`); }
    if (missingDocument) where.push('e.document_id IS NULL');

    const sortCol = Object.prototype.hasOwnProperty.call(SORTABLE, sort)
      ? SORTABLE[sort] : SORTABLE.date;
    const sortDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    params.push(limit, offset);
    const { rows } = await client.query(
      `SELECT e.*, la.code AS account_code, la.name AS account_name,
              d.original_name AS document_name, d.mime_type AS document_mime
         FROM expenses e
         JOIN ledger_accounts la ON la.id = e.account_id
         LEFT JOIN books_documents d ON d.id = e.document_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${sortCol} ${sortDir}, e.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS total FROM expenses e WHERE ${where.join(' AND ')}`,
      params.slice(0, -2)
    );
    return { expenses: rows.map(shape), total: countRows[0].total };
  }

  static async findById(id, client = db) {
    const { rows } = await client.query(
      `SELECT e.*, la.code AS account_code, la.name AS account_name,
              d.original_name AS document_name, d.mime_type AS document_mime,
              d.byte_size AS document_size, u.username AS created_by_username
         FROM expenses e
         JOIN ledger_accounts la ON la.id = e.account_id
         LEFT JOIN books_documents d ON d.id = e.document_id
         LEFT JOIN users u ON u.id = e.created_by
        WHERE e.id = $1`,
      [String(id)]
    );
    return shape(rows[0]);
  }

  /**
   * Input VAT for a VSK period — box E of RSK 10.01.
   *
   * Only DEDUCTIBLE expenses count. The non-deductible ones are still recorded (the
   * cost is real) but their VAT was folded into the expense, so including them here
   * would claim a deduction the law refuses.
   */
  static async inputVatForPeriod({ from, to }, client = db) {
    const { rows } = await client.query(
      `SELECT COALESCE(SUM(e.amount_vat), 0)::bigint AS input_vat,
              COALESCE(SUM(e.amount_net), 0)::bigint AS net_purchases,
              COUNT(*)::int AS entries
         FROM expenses e
        WHERE e.vat_deductible = TRUE
          AND e.expense_date >= $1::date AND e.expense_date <= $2::date`,
      [from, to]
    );
    return {
      input_vat: Number(rows[0].input_vat),
      net_purchases: Number(rows[0].net_purchases),
      entries: rows[0].entries,
    };
  }

  /**
   * The missing-documents queue.
   *
   * "No fylgiskjal, no deduction" is the operative rule, so this is not a tidiness
   * report — every row here is input VAT that cannot be substantiated if Skatturinn
   * asks. Surfaced on the dashboard so it stays a weekly five-minute job instead of
   * a year-end reconstruction.
   */
  static async missingDocuments({ limit = 50 } = {}, client = db) {
    const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const { rows } = await client.query(
      `SELECT e.id, e.supplier_name, e.supplier_invoice_no, e.expense_date,
              e.amount_gross, e.amount_vat, e.vat_deductible, la.code AS account_code
         FROM expenses e
         JOIN ledger_accounts la ON la.id = e.account_id
        WHERE e.document_id IS NULL
        ORDER BY e.expense_date DESC
        LIMIT $1`,
      [capped]
    );
    const { rows: totals } = await client.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(CASE WHEN vat_deductible THEN amount_vat ELSE 0 END), 0)::bigint AS unsubstantiated_vat
         FROM expenses WHERE document_id IS NULL`
    );
    return {
      entries: rows.map(r => ({
        ...r,
        expense_date: toIsoDate(r.expense_date),
        amount_gross: Number(r.amount_gross),
        amount_vat: Number(r.amount_vat),
      })),
      count: totals[0].count,
      unsubstantiated_vat: Number(totals[0].unsubstantiated_vat),
    };
  }

  // Distinct suppliers, most recent first — autocompletes the expense form and
  // keeps the same supplier from being typed three different ways.
  static async recentSuppliers({ limit = 30 } = {}, client = db) {
    const capped = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const { rows } = await client.query(
      `SELECT supplier_name, supplier_kennitala, supplier_country,
              MAX(expense_date) AS last_used,
              (ARRAY_AGG(account_id ORDER BY expense_date DESC))[1] AS last_account_id
         FROM expenses
        GROUP BY supplier_name, supplier_kennitala, supplier_country
        ORDER BY MAX(expense_date) DESC
        LIMIT $1`,
      [capped]
    );
    return rows.map(r => ({ ...r, last_used: toIsoDate(r.last_used) }));
  }
}

module.exports = Expense;
