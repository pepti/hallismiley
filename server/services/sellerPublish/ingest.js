'use strict';
// Apply a seller-area snapshot on the PUBLIC instance (D-020).
//
// The body arrives as raw bytes (the signature covers them), so it has NOT been
// through sanitizeBody. That is acceptable because nothing here is rendered as
// HTML: the seller area escapes every field on output (escHtml), and `shape()`
// below bounds every string and pins every enum before a byte is written. It is
// also why shape() copies a whitelist of fields rather than spreading the input.
//
// Semantics: the snapshot REPLACES everything, in one transaction. A lead
// erased on ops, an account reassigned, a seller whose role was removed — all
// vanish here at the next publish, with no delete protocol to get wrong.
// Ordering: a snapshot older than (or equal to) the newest applied one is
// refused, so a delayed or replayed request can never roll the area back.
const crypto = require('crypto');
const { SNAPSHOT_VERSION } = require('./snapshot');

class PublishError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PublishError';
    this.status = status;
  }
}

const LIMITS = { sellers: 500, leads: 20000, accounts: 5000, statements: 20000, lines: 500, payouts: 50 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;

function bad(path, what) { throw new PublishError(`${path}: ${what}`); }

function str(v, path, max, { required = false } = {}) {
  if (v === null || v === undefined || v === '') {
    if (required) bad(path, 'is required');
    return null;
  }
  if (typeof v !== 'string') bad(path, 'must be a string');
  if (v.length > max) bad(path, `longer than ${max}`);
  return v;
}
function email(v, path, { required = false } = {}) {
  const s = str(v, path, 200, { required });
  if (s === null) return null;
  const lower = s.trim().toLowerCase();
  if (!EMAIL.test(lower)) bad(path, 'is not an email');
  return lower;
}
function int(v, path, { required = true, min = -Number.MAX_SAFE_INTEGER } = {}) {
  if (v === null || v === undefined) {
    if (required) bad(path, 'is required');
    return null;
  }
  if (!Number.isSafeInteger(v) || v < min) bad(path, 'must be an integer');
  return v;
}
function bool(v, path) {
  if (typeof v !== 'boolean') bad(path, 'must be true or false');
  return v;
}
function oneOf(v, path, allowed, { required = true } = {}) {
  if ((v === null || v === undefined) && !required) return null;
  if (!allowed.includes(v)) bad(path, `must be one of ${allowed.join(', ')}`);
  return v;
}
function date(v, path, { required = false } = {}) {
  if (v === null || v === undefined) {
    if (required) bad(path, 'is required');
    return null;
  }
  if (typeof v !== 'string' || !DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) bad(path, 'must be YYYY-MM-DD');
  return v;
}
function ts(v, path, { required = false } = {}) {
  if (v === null || v === undefined) {
    if (required) bad(path, 'is required');
    return null;
  }
  if (typeof v !== 'string' || v.length > 40 || Number.isNaN(Date.parse(v))) bad(path, 'must be an ISO timestamp');
  return new Date(v).toISOString();
}
function list(v, path, max) {
  if (!Array.isArray(v)) bad(path, 'must be an array');
  if (v.length > max) bad(path, `more than ${max} entries`);
  v.forEach((x, i) => { if (!x || typeof x !== 'object' || Array.isArray(x)) bad(`${path}[${i}]`, 'must be an object'); });
  return v;
}

const PAYEE = ['contractor', 'employee', 'internal'];

/** Validate and normalise. Throws PublishError(400) on the first problem. */
function shape(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) bad('body', 'must be an object');
  if (body.version !== SNAPSHOT_VERSION) bad('version', `must be ${SNAPSHOT_VERSION}`);
  if (typeof body.snapshot_id !== 'string' || !UUID.test(body.snapshot_id)) bad('snapshot_id', 'must be a UUID');
  const generatedAt = ts(body.generated_at, 'generated_at', { required: true });

  const sellers = list(body.sellers, 'sellers', LIMITS.sellers).map((s, i) => {
    const p = `sellers[${i}]`;
    return {
      email: email(s.email, `${p}.email`, { required: true }),
      display_name: str(s.display_name, `${p}.display_name`, 200, { required: true }),
      can_leads: bool(s.can_leads, `${p}.can_leads`),
      can_accounts: bool(s.can_accounts, `${p}.can_accounts`),
      can_commission: bool(s.can_commission, `${p}.can_commission`),
      payee_kind: oneOf(s.payee_kind, `${p}.payee_kind`, PAYEE, { required: false }),
    };
  });
  const known = new Set(sellers.map(s => s.email));
  if (known.size !== sellers.length) bad('sellers', 'duplicate email');
  const seller = (v, path) => {
    const e = email(v, path, { required: true });
    if (!known.has(e)) bad(path, 'is not a published seller');
    return e;
  };

  const leads = list(body.leads, 'leads', LIMITS.leads).map((l, i) => {
    const p = `leads[${i}]`;
    return {
      ops_id: int(l.ops_id, `${p}.ops_id`, { min: 1 }),
      received_at: ts(l.received_at, `${p}.received_at`, { required: true }),
      name: str(l.name, `${p}.name`, 200, { required: true }),
      email: str(l.email, `${p}.email`, 200, { required: true }),
      company: str(l.company, `${p}.company`, 200),
      phone: str(l.phone, `${p}.phone`, 60),
      current_platform: str(l.current_platform, `${p}.current_platform`, 40),
      message: str(l.message, `${p}.message`, 10000, { required: true }),
      status: oneOf(l.status, `${p}.status`, ['new', 'contacted', 'won', 'lost']),
      owner_email: email(l.owner_email, `${p}.owner_email`),
      owner_name: str(l.owner_name, `${p}.owner_name`, 200),
      contacted_at: ts(l.contacted_at, `${p}.contacted_at`),
      note: str(l.note, `${p}.note`, 10000),
    };
  });

  const accounts = list(body.accounts, 'accounts', LIMITS.accounts).map((a, i) => {
    const p = `accounts[${i}]`;
    return {
      ops_id: int(a.ops_id, `${p}.ops_id`, { min: 1 }),
      seller_email: seller(a.seller_email, `${p}.seller_email`),
      slug: str(a.slug, `${p}.slug`, 40, { required: true }),
      name: str(a.name, `${p}.name`, 300, { required: true }),
      tier: oneOf(a.tier, `${p}.tier`, ['vefur', 'verslun', 'rekstur']),
      status: oneOf(a.status, `${p}.status`,
        ['lead', 'offered', 'signed', 'provisioning', 'building', 'live', 'paused', 'churned']),
      contact_name: str(a.contact_name, `${p}.contact_name`, 200),
      contact_email: str(a.contact_email, `${p}.contact_email`, 200),
      contact_phone: str(a.contact_phone, `${p}.contact_phone`, 60),
      prod_url: str(a.prod_url, `${p}.prod_url`, 300),
      contract_start: date(a.contract_start, `${p}.contract_start`),
      contract_end: date(a.contract_end, `${p}.contract_end`),
      build_fee_isk: int(a.build_fee_isk, `${p}.build_fee_isk`, { required: false, min: 0 }),
      monthly_fee_isk: int(a.monthly_fee_isk, `${p}.monthly_fee_isk`, { required: false, min: 0 }),
      quota_units: int(a.quota_units, `${p}.quota_units`, { required: false, min: 0 }),
      updated_at: ts(a.updated_at, `${p}.updated_at`, { required: true }),
    };
  });

  const statements = list(body.statements, 'statements', LIMITS.statements).map((s, i) => {
    const p = `statements[${i}]`;
    const n = (k) => int(s[k], `${p}.${k}`);
    return {
      ops_id: int(s.ops_id, `${p}.ops_id`, { min: 1 }),
      seller_email: seller(s.seller_email, `${p}.seller_email`),
      period: date(s.period, `${p}.period`, { required: true }),
      status: oneOf(s.status, `${p}.status`, ['open', 'paid', 'carried', 'superseded']),
      payee_kind: oneOf(s.payee_kind, `${p}.payee_kind`, PAYEE),
      opening_balance_isk: n('opening_balance_isk'),
      earned_isk: n('earned_isk'),
      clawback_isk: n('clawback_isk'),
      adjustment_isk: n('adjustment_isk'),
      settled_isk: n('settled_isk'),
      closing_balance_isk: n('closing_balance_isk'),
      minimum_isk: n('minimum_isk'),
      payable_isk: n('payable_isk'),
      carried_isk: n('carried_isk'),
      amount_paid_isk: n('amount_paid_isk'),
      note: str(s.note, `${p}.note`, 2000) || '',
      issued_at: ts(s.issued_at, `${p}.issued_at`, { required: true }),
      lines: list(s.lines, `${p}.lines`, LIMITS.lines).map((l, j) => ({
        line_kind: oneOf(l.line_kind, `${p}.lines[${j}].line_kind`, ['earned', 'clawback', 'adjustment', 'payout']),
        account_name: str(l.account_name, `${p}.lines[${j}].account_name`, 300),
        invoice_number: str(l.invoice_number, `${p}.lines[${j}].invoice_number`, 60),
        description: str(l.description, `${p}.lines[${j}].description`, 1000) || '',
        amount_isk: int(l.amount_isk, `${p}.lines[${j}].amount_isk`),
      })),
      payouts: list(s.payouts, `${p}.payouts`, LIMITS.payouts).map((o, j) => ({
        paid_on: date(o.paid_on, `${p}.payouts[${j}].paid_on`, { required: true }),
        method: oneOf(o.method, `${p}.payouts[${j}].method`, ['bank_transfer', 'payroll', 'other']),
        seller_invoice_number: str(o.seller_invoice_number, `${p}.payouts[${j}].seller_invoice_number`, 60),
        amount_isk: int(o.amount_isk, `${p}.payouts[${j}].amount_isk`, { min: 1 }),
      })),
    };
  });

  return { snapshotId: body.snapshot_id.toLowerCase(), generatedAt, sellers, leads, accounts, statements };
}

async function insertRows(client, table, cols, rows) {
  // One INSERT per row keeps the parameter count bounded and the code obvious;
  // a snapshot is hundreds of rows, published at most a few times a day.
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  for (const r of rows) {
    await client.query(sql, cols.map(c => r[c]));
  }
}

/**
 * Replace the published copy with `snap` (the output of shape()).
 * @returns {{ applied: true, counts }} or throws PublishError(409) when stale.
 */
async function apply(pool, snap, rawBody) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialise concurrent publishes: the second waits, then sees the first's
    // generated_at and is refused as stale.
    await client.query('LOCK TABLE seller_publications IN EXCLUSIVE MODE');
    const { rows: [last] } = await client.query(
      'SELECT generated_at FROM seller_publications ORDER BY generated_at DESC LIMIT 1'
    );
    if (last && new Date(last.generated_at) >= new Date(snap.generatedAt)) {
      throw new PublishError('Snapshot is not newer than the one already published', 409);
    }
    const { rows: [seen] } = await client.query(
      'SELECT 1 FROM seller_publications WHERE snapshot_id = $1', [snap.snapshotId]
    );
    if (seen) throw new PublishError('Snapshot already applied', 409);

    await client.query(
      'TRUNCATE published_statement_lines, published_payouts, published_statements, published_accounts, published_leads, published_sellers'
    );
    await insertRows(client, 'published_sellers',
      ['email', 'display_name', 'can_leads', 'can_accounts', 'can_commission', 'payee_kind'], snap.sellers);
    await insertRows(client, 'published_leads',
      ['ops_id', 'received_at', 'name', 'email', 'company', 'phone', 'current_platform', 'message',
        'status', 'owner_email', 'owner_name', 'contacted_at', 'note'], snap.leads);
    await insertRows(client, 'published_accounts',
      ['ops_id', 'seller_email', 'slug', 'name', 'tier', 'status', 'contact_name', 'contact_email',
        'contact_phone', 'prod_url', 'contract_start', 'contract_end', 'build_fee_isk',
        'monthly_fee_isk', 'quota_units', 'updated_at'], snap.accounts);
    await insertRows(client, 'published_statements',
      ['ops_id', 'seller_email', 'period', 'status', 'payee_kind', 'opening_balance_isk', 'earned_isk',
        'clawback_isk', 'adjustment_isk', 'settled_isk', 'closing_balance_isk', 'minimum_isk',
        'payable_isk', 'carried_isk', 'amount_paid_isk', 'note', 'issued_at'], snap.statements);
    for (const s of snap.statements) {
      await insertRows(client, 'published_statement_lines',
        ['statement_ops_id', 'line_kind', 'account_name', 'invoice_number', 'description', 'amount_isk'],
        s.lines.map(l => ({ ...l, statement_ops_id: s.ops_id })));
      await insertRows(client, 'published_payouts',
        ['statement_ops_id', 'paid_on', 'method', 'seller_invoice_number', 'amount_isk'],
        s.payouts.map(o => ({ ...o, statement_ops_id: s.ops_id })));
    }

    const counts = {
      sellers: snap.sellers.length, leads: snap.leads.length,
      accounts: snap.accounts.length, statements: snap.statements.length,
    };
    await client.query(
      `INSERT INTO seller_publications
         (snapshot_id, generated_at, seller_count, lead_count, account_count, statement_count, body_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [snap.snapshotId, snap.generatedAt, counts.sellers, counts.leads, counts.accounts, counts.statements,
        crypto.createHash('sha256').update(rawBody).digest('hex')]
    );
    await client.query('COMMIT');
    return { applied: true, counts };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // A duplicate ops_id inside one snapshot is a malformed body, not a crash.
    if (err && err.code === '23505') throw new PublishError('Duplicate id in snapshot', 400);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { shape, apply, PublishError, LIMITS };
