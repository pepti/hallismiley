// The reports an accountant actually asks for, and the journal underneath them.
//
// All four read the same posted journal lines, so they cannot disagree with each
// other or with the VSK return. That is the whole reason everything in this module
// posts to the ledger rather than keeping its own totals.
//
//   Journal          every posted entry, drillable to its source document
//   Trial balance    every account's debit/credit — must balance, or nothing else
//                    below is trustworthy
//   Profit and loss  revenue less expenses for a period
//   Balance sheet    assets, liabilities and equity AS AT a date
//
// A note on the balance sheet, because it is the one that surprises people: this
// system has no year-end close, so retained earnings are not a stored figure. The
// accumulated profit is DERIVED as (revenue − expenses) over all time up to the
// date. That makes the sheet balance without a closing entry, and it means the
// figure is always consistent with the P&L rather than drifting from it.

const db = require('../../config/database');
const { toIsoDate } = require('../../utils/booksDate');

// Reports are read-only, so a bad range is the only failure mode worth typing.
class ReportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ReportError';
    this.status = status;
  }
}

// Which side of the ledger an account type naturally sits on. Getting this wrong
// flips a sign on a report, which is the kind of error that survives review because
// the number still looks plausible.
const DEBIT_POSITIVE = new Set(['asset', 'expense']);

function naturalBalance(type, debit, credit) {
  return DEBIT_POSITIVE.has(type) ? debit - credit : credit - debit;
}

/**
 * The journal: posted entries, newest first, with their lines.
 *
 * Two queries rather than one join, deliberately. A join returns one row per LINE and
 * the caller has to regroup, which is where an off-by-one in the grouping silently
 * drops a leg — and a journal that drops a leg looks balanced while being wrong.
 */
async function journal({
  from = null, to = null, sourceType = null, accountCode = null,
  limit = 50, offset = 0,
} = {}, client = db) {
  const where = ['je.posted_at IS NOT NULL'];
  const params = [];
  if (from) { params.push(from); where.push(`je.entry_date >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`je.entry_date <= $${params.length}::date`); }
  if (sourceType) { params.push(sourceType); where.push(`je.source_type = $${params.length}`); }
  if (accountCode) {
    params.push(accountCode);
    where.push(`EXISTS (SELECT 1 FROM journal_lines jl2
                          JOIN ledger_accounts la2 ON la2.id = jl2.account_id
                         WHERE jl2.entry_id = je.id AND la2.code = $${params.length})`);
  }

  params.push(limit, offset);
  const { rows: entries } = await client.query(
    `SELECT je.id, je.entry_number, je.entry_date, je.memo, je.source_type, je.source_id,
            je.reverses_entry_id, je.is_correction, je.posted_at, je.document_id,
            u.username AS created_by_username
       FROM journal_entries je
       LEFT JOIN users u ON u.id = je.created_by
      WHERE ${where.join(' AND ')}
      ORDER BY je.entry_date DESC, je.entry_number DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: countRows } = await client.query(
    `SELECT COUNT(*)::int AS total FROM journal_entries je WHERE ${where.join(' AND ')}`,
    params.slice(0, -2)
  );

  if (!entries.length) return { entries: [], total: countRows[0].total };

  const { rows: lines } = await client.query(
    `SELECT jl.entry_id, jl.debit, jl.credit, jl.memo, jl.vat_rate, jl.sort_order,
            la.code AS account_code, la.name AS account_name, la.type AS account_type
       FROM journal_lines jl
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE jl.entry_id = ANY($1::text[])
      ORDER BY jl.sort_order`,
    [entries.map(e => e.id)]
  );
  const byEntry = new Map();
  for (const l of lines) {
    const arr = byEntry.get(l.entry_id) || [];
    arr.push({
      account_code: l.account_code,
      account_name: l.account_name,
      account_type: l.account_type,
      debit: Number(l.debit),
      credit: Number(l.credit),
      memo: l.memo,
      vat_rate: l.vat_rate,
    });
    byEntry.set(l.entry_id, arr);
  }

  return {
    entries: entries.map(e => ({
      ...e,
      entry_number: Number(e.entry_number),
      entry_date: toIsoDate(e.entry_date),
      lines: byEntry.get(e.id) || [],
      debit_total: (byEntry.get(e.id) || []).reduce((a, l) => a + l.debit, 0),
    })),
    total: countRows[0].total,
  };
}

/**
 * Trial balance.
 *
 * The first thing an accountant looks at, because if the totals do not match, every
 * other report is untrustworthy. `balanced` is returned explicitly rather than left
 * for the reader to check by squinting at two numbers.
 */
async function trialBalance({ from = null, to = null } = {}, client = db) {
  const params = [];
  const where = ['je.posted_at IS NOT NULL'];
  if (from) { params.push(from); where.push(`je.entry_date >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`je.entry_date <= $${params.length}::date`); }

  const { rows } = await client.query(
    `SELECT la.code, la.name, la.name_en, la.type,
            COALESCE(SUM(jl.debit), 0)::bigint  AS debit,
            COALESCE(SUM(jl.credit), 0)::bigint AS credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE ${where.join(' AND ')}
      GROUP BY la.code, la.name, la.name_en, la.type, la.sort
      HAVING COALESCE(SUM(jl.debit), 0) <> 0 OR COALESCE(SUM(jl.credit), 0) <> 0
      ORDER BY la.sort, la.code`,
    params
  );

  const accounts = rows.map(r => ({
    code: r.code,
    name: r.name,
    name_en: r.name_en,
    type: r.type,
    debit: Number(r.debit),
    credit: Number(r.credit),
    balance: naturalBalance(r.type, Number(r.debit), Number(r.credit)),
  }));
  const debitTotal = accounts.reduce((a, x) => a + x.debit, 0);
  const creditTotal = accounts.reduce((a, x) => a + x.credit, 0);

  return {
    range: { from, to },
    accounts,
    debit_total: debitTotal,
    credit_total: creditTotal,
    // Enforced by a deferred constraint trigger per entry, so this should never be
    // false. It is reported anyway: a trial balance that does not state whether it
    // balances is not doing its job.
    balanced: debitTotal === creditTotal,
    difference: debitTotal - creditTotal,
  };
}

/**
 * Profit and loss for a period.
 *
 * Revenue is a credit balance and expenses a debit balance, so both are reported as
 * positive figures and the profit is revenue − expenses. A credit note debiting
 * revenue back reduces the revenue line, which is exactly right.
 */
async function profitAndLoss({ from, to } = {}, client = db) {
  if (!from || !to) throw new ReportError('A profit and loss report needs a from and a to date');

  const { rows } = await client.query(
    `SELECT la.code, la.name, la.name_en, la.type, la.sort,
            COALESCE(SUM(jl.debit), 0)::bigint  AS debit,
            COALESCE(SUM(jl.credit), 0)::bigint AS credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE je.posted_at IS NOT NULL
        AND je.entry_date >= $1::date AND je.entry_date <= $2::date
        AND la.type IN ('revenue', 'expense')
      GROUP BY la.code, la.name, la.name_en, la.type, la.sort
      HAVING COALESCE(SUM(jl.debit), 0) <> 0 OR COALESCE(SUM(jl.credit), 0) <> 0
      ORDER BY la.sort, la.code`,
    [from, to]
  );

  const line = r => ({
    code: r.code,
    name: r.name,
    name_en: r.name_en,
    amount: naturalBalance(r.type, Number(r.debit), Number(r.credit)),
  });
  const revenue = rows.filter(r => r.type === 'revenue').map(line);
  const expenses = rows.filter(r => r.type === 'expense').map(line);
  const revenueTotal = revenue.reduce((a, x) => a + x.amount, 0);
  const expenseTotal = expenses.reduce((a, x) => a + x.amount, 0);

  return {
    range: { from, to },
    revenue,
    expenses,
    revenue_total: revenueTotal,
    expense_total: expenseTotal,
    profit: revenueTotal - expenseTotal,
  };
}

/**
 * Balance sheet as at a date.
 *
 * Retained earnings are DERIVED, not stored — see the file header. Without a
 * year-end close there is no closing entry moving profit into equity, so the sheet
 * would not balance if accumulated profit were omitted. Deriving it also guarantees
 * the sheet and the P&L can never disagree.
 */
async function balanceSheet({ to } = {}, client = db) {
  if (!to) throw new ReportError('A balance sheet needs an as-at date');

  const { rows } = await client.query(
    `SELECT la.code, la.name, la.name_en, la.type, la.sort,
            COALESCE(SUM(jl.debit), 0)::bigint  AS debit,
            COALESCE(SUM(jl.credit), 0)::bigint AS credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE je.posted_at IS NOT NULL AND je.entry_date <= $1::date
      GROUP BY la.code, la.name, la.name_en, la.type, la.sort
      HAVING COALESCE(SUM(jl.debit), 0) <> 0 OR COALESCE(SUM(jl.credit), 0) <> 0
      ORDER BY la.sort, la.code`,
    [to]
  );

  const shape = r => ({
    code: r.code,
    name: r.name,
    name_en: r.name_en,
    amount: naturalBalance(r.type, Number(r.debit), Number(r.credit)),
  });
  const assets = rows.filter(r => r.type === 'asset').map(shape);
  const liabilities = rows.filter(r => r.type === 'liability').map(shape);
  const equityAccounts = rows.filter(r => r.type === 'equity').map(shape);

  const revenueTotal = rows.filter(r => r.type === 'revenue')
    .reduce((a, r) => a + naturalBalance('revenue', Number(r.debit), Number(r.credit)), 0);
  const expenseTotal = rows.filter(r => r.type === 'expense')
    .reduce((a, r) => a + naturalBalance('expense', Number(r.debit), Number(r.credit)), 0);
  const retained = revenueTotal - expenseTotal;

  const assetTotal = assets.reduce((a, x) => a + x.amount, 0);
  const liabilityTotal = liabilities.reduce((a, x) => a + x.amount, 0);
  const equityTotal = equityAccounts.reduce((a, x) => a + x.amount, 0) + retained;

  return {
    as_at: to,
    assets,
    liabilities,
    equity: equityAccounts,
    retained_earnings: retained,
    asset_total: assetTotal,
    liability_total: liabilityTotal,
    equity_total: equityTotal,
    balanced: assetTotal === liabilityTotal + equityTotal,
    difference: assetTotal - (liabilityTotal + equityTotal),
  };
}

/**
 * One account's movements, with a running balance.
 *
 * The opening balance is everything before `from`, so the running balance is a real
 * continuation rather than starting from zero mid-year — which is what makes this
 * usable for tying an account to an external statement.
 */
async function accountLedger({ accountCode, from = null, to = null, limit = 500 } = {}, client = db) {
  if (!accountCode) throw new ReportError('An account code is required');
  const capped = Math.min(Math.max(Number(limit) || 500, 1), 2000);

  const { rows: acct } = await client.query(
    `SELECT code, name, name_en, type FROM ledger_accounts WHERE code = $1`, [accountCode]
  );
  if (!acct.length) throw new ReportError(`No such account: ${accountCode}`, 404);

  let opening = 0;
  if (from) {
    const { rows } = await client.query(
      `SELECT COALESCE(SUM(jl.debit), 0)::bigint AS debit,
              COALESCE(SUM(jl.credit), 0)::bigint AS credit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN ledger_accounts la ON la.id = jl.account_id
        WHERE la.code = $1 AND je.posted_at IS NOT NULL AND je.entry_date < $2::date`,
      [accountCode, from]
    );
    opening = naturalBalance(acct[0].type, Number(rows[0].debit), Number(rows[0].credit));
  }

  const params = [accountCode];
  const where = ['la.code = $1', 'je.posted_at IS NOT NULL'];
  if (from) { params.push(from); where.push(`je.entry_date >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`je.entry_date <= $${params.length}::date`); }
  params.push(capped);

  const { rows: movements } = await client.query(
    `SELECT je.entry_number, je.entry_date, je.memo, je.source_type, je.source_id,
            jl.debit, jl.credit, jl.memo AS line_memo
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE ${where.join(' AND ')}
      ORDER BY je.entry_date, je.entry_number
      LIMIT $${params.length}`,
    params
  );

  let running = opening;
  const lines = movements.map((m) => {
    running += naturalBalance(acct[0].type, Number(m.debit), Number(m.credit));
    return {
      entry_number: Number(m.entry_number),
      entry_date: toIsoDate(m.entry_date),
      memo: m.memo,
      line_memo: m.line_memo,
      source_type: m.source_type,
      source_id: m.source_id,
      debit: Number(m.debit),
      credit: Number(m.credit),
      balance: running,
    };
  });

  return {
    account: acct[0],
    range: { from, to },
    opening_balance: opening,
    closing_balance: running,
    lines,
    truncated: movements.length === capped,
  };
}

module.exports = {
  ReportError,
  naturalBalance,
  journal,
  trialBalance,
  profitAndLoss,
  balanceSheet,
  accountLedger,
};
