'use strict';
// Build the seller-area snapshot on OPS (D-020). Pure read: nothing here writes.
//
// Who is a seller: an enabled user with an email whose role set grants any of
// `leads`, `accounts` or `commission` — and who is NOT an admin. The views
// decide what reaches them, so ops' /admin/roles stays the one place a
// seller's access is granted:
//
//   leads      → every lead (Halli, 2026-09-21: "all leads" — the same queue
//                the ops inbox shows the `leads` view)
//   accounts   → the accounts they own, WITHOUT the rate fields (the
//                stripRateFields rule) and without Azure/repo internals
//   commission → their issued statements, lines and payouts. No payee
//                kennitala leaves ops.
//
// Leads are published only while at least one seller holds `leads`, so a team
// with no inbox seat puts no enquirer PII on the public box at all.
const crypto = require('crypto');
const { toIsoDate } = require('../../utils/booksDate');
const { statementStatus } = require('../commissionStatements');

const SNAPSHOT_VERSION = 1;

const num = (v) => (v === null || v === undefined ? null : Number(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);

async function loadSellers(db) {
  const { rows } = await db.query(
    `SELECT u.id, lower(u.email) AS email,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS display_name,
            u.payee_kind,
            bool_or(r.view_access @> '["leads"]'::jsonb)      AS can_leads,
            bool_or(r.view_access @> '["accounts"]'::jsonb)   AS can_accounts,
            bool_or(r.view_access @> '["commission"]'::jsonb) AS can_commission,
            bool_or(r.view_access @> '["*"]'::jsonb)          AS is_admin
       FROM users u
       JOIN roles r
         ON r.name = u.role
         OR r.name IN (SELECT role_name FROM user_roles ur WHERE ur.user_id = u.id)
      WHERE u.disabled = FALSE AND u.email IS NOT NULL AND u.email <> ''
      GROUP BY u.id
     HAVING NOT bool_or(r.view_access @> '["*"]'::jsonb)
        AND bool_or(r.view_access @> '["leads"]'::jsonb
                 OR r.view_access @> '["accounts"]'::jsonb
                 OR r.view_access @> '["commission"]'::jsonb)
      ORDER BY lower(u.email)`
  );
  return rows;
}

async function buildSnapshot(db, { now = new Date() } = {}) {
  const sellers = await loadSellers(db);
  const withView = (flag) => sellers.filter(s => s[flag]).map(s => s.id);
  const accountSellers = withView('can_accounts');
  const commissionSellers = withView('can_commission');
  const anyLeads = sellers.some(s => s.can_leads);

  const leads = anyLeads ? (await db.query(
    `SELECT l.id, l.created_at, l.name, l.email, l.company, l.phone, l.current_platform,
            l.message, l.status, lower(o.email) AS owner_email,
            COALESCE(NULLIF(o.display_name, ''), o.username) AS owner_name,
            l.contacted_at, l.note
       FROM leads l LEFT JOIN users o ON o.id = l.owner_user_id
      ORDER BY l.created_at DESC, l.id DESC`
  )).rows : [];

  const accounts = accountSellers.length ? (await db.query(
    `SELECT a.id, lower(u.email) AS seller_email, a.slug, a.name, a.tier, a.status,
            a.contact_name, a.contact_email, a.contact_phone, a.prod_url,
            a.contract_start, a.contract_end, a.build_fee_isk, a.monthly_fee_isk,
            a.quota_units, a.updated_at
       FROM customer_accounts a JOIN users u ON u.id = a.owner_user_id
      WHERE a.owner_user_id = ANY($1::text[])
      ORDER BY a.id`,
    [accountSellers]
  )).rows : [];

  let statements = [];
  if (commissionSellers.length) {
    const { rows: stmts } = await db.query(
      `SELECT s.*, lower(u.email) AS seller_email,
              EXISTS (SELECT 1 FROM commission_statements later
                       WHERE later.seller_user_id = s.seller_user_id AND later.period > s.period) AS has_later
         FROM commission_statements s JOIN users u ON u.id = s.seller_user_id
        WHERE s.seller_user_id = ANY($1::text[])
        ORDER BY s.id`,
      [commissionSellers]
    );
    const ids = stmts.map(s => s.id);
    const [{ rows: lines }, { rows: payouts }] = ids.length ? await Promise.all([
      db.query(
        `SELECT l.statement_id, l.line_kind, a.name AS account_name, i.invoice_number,
                l.description, l.amount_isk
           FROM commission_statement_lines l
           LEFT JOIN customer_accounts a ON a.id = l.account_id
           LEFT JOIN invoices i ON i.id = l.invoice_id
          WHERE l.statement_id = ANY($1::bigint[])
          ORDER BY l.statement_id, l.line_kind, l.id`,
        [ids]
      ),
      db.query(
        `SELECT statement_id, paid_on, method, seller_invoice_number, amount_isk
           FROM commission_payouts WHERE statement_id = ANY($1::bigint[])
          ORDER BY statement_id, id`,
        [ids]
      ),
    ]) : [{ rows: [] }, { rows: [] }];

    statements = stmts.map(s => ({
      ops_id: Number(s.id),
      seller_email: s.seller_email,
      period: toIsoDate(s.period),
      status: statementStatus(s, s.has_later),
      payee_kind: s.payee_kind,
      opening_balance_isk: num(s.opening_balance_isk),
      earned_isk: num(s.earned_isk),
      clawback_isk: num(s.clawback_isk),
      adjustment_isk: num(s.adjustment_isk),
      settled_isk: num(s.settled_isk),
      closing_balance_isk: num(s.closing_balance_isk),
      minimum_isk: num(s.minimum_isk),
      payable_isk: num(s.payable_isk),
      carried_isk: num(s.carried_isk),
      amount_paid_isk: num(s.amount_paid_isk),
      note: s.note || '',
      issued_at: iso(s.issued_at),
      lines: lines.filter(l => String(l.statement_id) === String(s.id)).map(l => ({
        line_kind: l.line_kind,
        account_name: l.account_name || null,
        invoice_number: l.invoice_number || null,
        description: l.description || '',
        amount_isk: num(l.amount_isk),
      })),
      payouts: payouts.filter(p => String(p.statement_id) === String(s.id)).map(p => ({
        paid_on: toIsoDate(p.paid_on),
        method: p.method,
        seller_invoice_number: p.seller_invoice_number || null,
        amount_isk: num(p.amount_isk),
      })),
    }));
  }

  return {
    version: SNAPSHOT_VERSION,
    snapshot_id: crypto.randomUUID(),
    generated_at: now.toISOString(),
    sellers: sellers.map(s => ({
      email: s.email,
      display_name: s.display_name,
      can_leads: !!s.can_leads,
      can_accounts: !!s.can_accounts,
      can_commission: !!s.can_commission,
      payee_kind: s.payee_kind || null,
    })),
    leads: leads.map(l => ({
      ops_id: l.id,
      received_at: iso(l.created_at),
      name: l.name,
      email: l.email,
      company: l.company || null,
      phone: l.phone || null,
      current_platform: l.current_platform || null,
      message: l.message,
      status: l.status,
      owner_email: l.owner_email || null,
      owner_name: l.owner_email ? l.owner_name : null,
      contacted_at: iso(l.contacted_at),
      note: l.note || null,
    })),
    accounts: accounts.map(a => ({
      ops_id: a.id,
      seller_email: a.seller_email,
      slug: a.slug,
      name: a.name,
      tier: a.tier,
      status: a.status,
      contact_name: a.contact_name || null,
      contact_email: a.contact_email || null,
      contact_phone: a.contact_phone || null,
      prod_url: a.prod_url || null,
      contract_start: toIsoDate(a.contract_start),
      contract_end: toIsoDate(a.contract_end),
      build_fee_isk: num(a.build_fee_isk),
      monthly_fee_isk: num(a.monthly_fee_isk),
      quota_units: num(a.quota_units),
      updated_at: iso(a.updated_at),
    })),
    statements,
  };
}

module.exports = { buildSnapshot, SNAPSHOT_VERSION };
