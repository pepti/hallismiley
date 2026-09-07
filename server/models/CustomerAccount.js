// CustomerAccount — one row per company Orange Smiley builds for (migration
// 098; ENHANCEMENTS #17). The per-customer state of record: tier, lifecycle
// status, the owning seller (commission follows owner_user_id), contract and
// fee facts, and the instance's repo/URL/Azure identifiers as they get filled
// in by provisioning.
//
// EVERY read and write takes a `scope` (server/auth/accountScope.js) and the
// model enforces it in SQL — a foreign account answers null → 404, never 403,
// so a seller cannot enumerate other sellers' customers by id. A missing scope
// throws: the model fails closed.
//
// Every write records a staff_audit_log row with the SAME client, so the audit
// commits or rolls back with the change.

const db = require('../config/database');
const staffAudit = require('../services/staffAudit');
const { foldSlug } = require('../utils/slug');

const TIERS    = ['vefur', 'verslun', 'rekstur'];
const STATUSES = ['lead', 'offered', 'signed', 'provisioning', 'building', 'live', 'paused', 'churned'];
// The lifecycle (plan §1b). A status not in a row's list is a 409 upstream.
const TRANSITIONS = {
  lead:         ['offered', 'churned'],
  offered:      ['signed', 'lead', 'churned'],
  signed:       ['provisioning', 'churned'],
  provisioning: ['building', 'churned'],
  building:     ['live', 'churned'],
  live:         ['paused', 'churned'],
  paused:       ['live', 'churned'],
  churned:      [],
};

// Fields a seller may write (create + patch). Owner and status have their own paths.
const EDITABLE = [
  'name', 'kennitala', 'tier', 'contact_name', 'contact_email', 'contact_phone',
  'repo_name', 'test_url', 'prod_url', 'canonical_host',
  'azure_subscription_id', 'azure_rg_test', 'azure_rg_prod',
  'contract_start', 'contract_end',
  'build_fee_isk', 'monthly_fee_isk', 'quota_units', 'build_rate_bp', 'recurring_rate_bp',
  'notes',
];

const COLUMNS = `
  a.id, a.slug, a.kennitala, a.name, a.market_company_id, a.tier, a.status, a.owner_user_id,
  a.contact_name, a.contact_email, a.contact_phone,
  a.repo_name, a.test_url, a.prod_url, a.canonical_host,
  a.azure_subscription_id, a.azure_rg_test, a.azure_rg_prod,
  a.contract_start, a.contract_end,
  a.build_fee_isk, a.monthly_fee_isk, a.quota_units, a.build_rate_bp, a.recurring_rate_bp,
  a.notes, a.created_by, a.created_at, a.updated_at,
  COALESCE(o.display_name, o.username) AS owner_name, o.username AS owner_username
`;
const JOINS = `FROM customer_accounts a LEFT JOIN users o ON o.id = a.owner_user_id`;

class ScopeError extends Error {
  constructor() { super('CustomerAccount: scope is required'); this.name = 'ScopeError'; this.status = 500; }
}

function scopeClause(scope, params) {
  if (!scope || typeof scope !== 'object') throw new ScopeError();
  if (scope.all === true) return '';
  if (!scope.ownerId) throw new ScopeError();
  params.push(String(scope.ownerId));
  return `a.owner_user_id = $${params.length}`;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

async function uniqueSlug(client, base, excludeId = null) {
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const { rows } = await client.query(
      `SELECT id FROM customer_accounts WHERE slug = $1${excludeId ? ' AND id <> $2' : ''}`,
      excludeId ? [candidate, excludeId] : [candidate]
    );
    if (!rows.length) return candidate;
    candidate = `${base}-${suffix++}`.slice(0, 40);
  }
}

function slugFrom(name) {
  const s = foldSlug(String(name || '')).replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40);
  return s.length >= 3 ? s : `reikningur-${Date.now().toString(36)}`;
}

class CustomerAccount {
  static async list(scope, { status = null, tier = null, q = null, limit = 50, offset = 0 } = {}) {
    const params = [];
    const clauses = [];
    const sc = scopeClause(scope, params);
    if (sc) clauses.push(sc);
    if (STATUSES.includes(status)) { params.push(status); clauses.push(`a.status = $${params.length}`); }
    if (TIERS.includes(tier))      { params.push(tier);   clauses.push(`a.tier = $${params.length}`); }
    if (q) { params.push(`%${String(q).trim()}%`); clauses.push(`(a.name ILIKE $${params.length} OR a.slug ILIKE $${params.length} OR a.kennitala LIKE $${params.length})`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const off = Math.max(Number(offset) || 0, 0);
    const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
      db.query(`SELECT ${COLUMNS} ${JOINS} ${where} ORDER BY a.updated_at DESC, a.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, lim, off]),
      db.query(`SELECT COUNT(*)::int AS n ${JOINS} ${where}`, params),
    ]);
    return { accounts: rows, total };
  }

  static async findById(scope, id, client = db) {
    const params = [id];
    const sc = scopeClause(scope, params);
    const { rows } = await client.query(`SELECT ${COLUMNS} ${JOINS} WHERE a.id = $1${sc ? ` AND ${sc}` : ''}`, params);
    return rows[0] || null;
  }

  /** Unscoped lookup for the invoice path (admin-only callers). */
  static async findByIdUnscoped(id, client = db) {
    return this.findById({ all: true }, id, client);
  }

  static async findByKennitala(kennitala, client = db) {
    const { rows } = await client.query(`SELECT ${COLUMNS} ${JOINS} WHERE a.kennitala = $1`, [kennitala]);
    return rows[0] || null;
  }

  /**
   * Create. `ownerUserId` is already decided by the controller (self unless the
   * scope is unscoped). Optional `marketCompanyId`: copies name/kennitala/
   * tier_fit when the body did not set them and moves the market row to
   * handed_to_sales in the same transaction (the #16 hand-off).
   */
  static async create(client, { fields, ownerUserId, marketCompanyId = null, slug = null }, { actorId, requestId } = {}) {
    let data = pick(fields, EDITABLE);
    let company = null;
    if (marketCompanyId) {
      const { rows } = await client.query(
        `SELECT id, name, kennitala, tier_fit, status FROM market_companies WHERE id = $1 FOR UPDATE`, [marketCompanyId]
      );
      company = rows[0];
      // Only a SHORTLISTED company may become an account, matching the
      // sanctioned path exactly (marketRoutes PATCH /:id/status is
      // admin/moderator AND shortlist-only). Without this the hand-off is a
      // second, ungated door onto market_companies: any `accounts` holder
      // could pull a candidate or a REJECTED company into sales and read its
      // details back, or hand the same row over twice. FOR UPDATE above plus
      // the status flip below make the check race-safe. Not-eligible reads as
      // not-found, so the endpoint cannot enumerate market ids either.
      if (!company || company.status !== 'shortlist') {
        const e = new Error('Market company not found'); e.status = 404; e.code = 'MARKET_COMPANY_NOT_FOUND'; throw e;
      }
      data = {
        name: data.name || company.name,
        kennitala: data.kennitala || company.kennitala,
        tier: data.tier || company.tier_fit || 'verslun',
        ...pick(data, EDITABLE.filter(k => !['name', 'kennitala', 'tier'].includes(k))),
      };
    }
    if (!data.name || !TIERS.includes(data.tier)) {
      const e = new Error('name and tier are required'); e.status = 400; e.code = 'ACCOUNT_INVALID'; throw e;
    }
    const finalSlug = await uniqueSlug(client, slug || slugFrom(data.name));
    const cols = ['slug', 'owner_user_id', 'market_company_id', 'created_by', ...Object.keys(data)];
    const vals = [finalSlug, ownerUserId, marketCompanyId, actorId || null, ...Object.values(data)];
    const { rows: [row] } = await client.query(
      `INSERT INTO customer_accounts (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      vals
    );
    if (company && company.status !== 'handed_to_sales') {
      await client.query(`UPDATE market_companies SET status = 'handed_to_sales' WHERE id = $1`, [company.id]);
    }
    await staffAudit.record(client, {
      actorId, requestId, action: 'account.created', entityType: 'account', entityId: row.id,
      summary: { slug: finalSlug, tier: data.tier, owner_user_id: ownerUserId, market_company_id: marketCompanyId || undefined },
    });
    return this.findById({ all: true }, row.id, client);
  }

  /**
   * Patch editable fields and/or move the status (checked against
   * TRANSITIONS). Returns null when the id is outside the scope.
   */
  static async update(client, scope, id, patch, { actorId, requestId } = {}) {
    const params = [id];
    const sc = scopeClause(scope, params);
    const { rows: [current] } = await client.query(
      `SELECT id, status, owner_user_id FROM customer_accounts a WHERE a.id = $1${sc ? ` AND ${sc}` : ''} FOR UPDATE`, params
    );
    if (!current) return null;

    const data = pick(patch, EDITABLE);
    const nextStatus = patch.status !== undefined ? patch.status : null;
    if (nextStatus !== null) {
      if (!STATUSES.includes(nextStatus) || !(TRANSITIONS[current.status] || []).includes(nextStatus)) {
        const e = new Error(`Cannot move ${current.status} → ${nextStatus}`); e.status = 409; e.code = 'BAD_TRANSITION'; throw e;
      }
      data.status = nextStatus;
    }
    const keys = Object.keys(data);
    if (!keys.length) return this.findById(scope, id, client);

    await client.query(
      `UPDATE customer_accounts SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [id, ...keys.map(k => data[k])]
    );
    const changed = keys.filter(k => k !== 'status');
    if (changed.length) {
      await staffAudit.record(client, {
        actorId, requestId, action: 'account.updated', entityType: 'account', entityId: id,
        summary: { fields: changed },
      });
    }
    if (nextStatus !== null) {
      await staffAudit.record(client, {
        actorId, requestId, action: 'account.status_changed', entityType: 'account', entityId: id,
        summary: { from: current.status, to: nextStatus },
      });
    }
    return this.findById(scope, id, client);
  }

  /** Admin only (no scope): commission follows the new owner from here on. */
  static async changeOwner(client, id, newOwnerId, { actorId, requestId } = {}) {
    const { rows: [current] } = await client.query(`SELECT id, owner_user_id FROM customer_accounts WHERE id = $1 FOR UPDATE`, [id]);
    if (!current) return null;
    const { rows: u } = await client.query(`SELECT id FROM users WHERE id = $1`, [String(newOwnerId)]);
    if (!u.length) { const e = new Error('Owner not found'); e.status = 400; e.code = 'OWNER_NOT_FOUND'; throw e; }
    if (current.owner_user_id !== String(newOwnerId)) {
      await client.query(`UPDATE customer_accounts SET owner_user_id = $2 WHERE id = $1`, [id, String(newOwnerId)]);
      await staffAudit.record(client, {
        actorId, requestId, action: 'account.owner_changed', entityType: 'account', entityId: id,
        summary: { from: current.owner_user_id, to: String(newOwnerId) },
      });
    }
    return this.findById({ all: true }, id, client);
  }

  /**
   * "Please provision this" — records the request (the workflow that acts on it
   * is #19); moves signed → provisioning when that transition applies.
   */
  static async requestProvision(client, scope, id, { actorId, requestId } = {}) {
    const params = [id];
    const sc = scopeClause(scope, params);
    const { rows: [current] } = await client.query(
      `SELECT id, status FROM customer_accounts a WHERE a.id = $1${sc ? ` AND ${sc}` : ''} FOR UPDATE`, params
    );
    if (!current) return null;
    if (current.status === 'signed') {
      await client.query(`UPDATE customer_accounts SET status = 'provisioning' WHERE id = $1`, [id]);
      await staffAudit.record(client, {
        actorId, requestId, action: 'account.status_changed', entityType: 'account', entityId: id,
        summary: { from: 'signed', to: 'provisioning' },
      });
    }
    await staffAudit.record(client, {
      actorId, requestId, action: 'provision.requested', entityType: 'account', entityId: id,
      summary: { status_before: current.status },
    });
    return this.findById(scope, id, client);
  }
}

CustomerAccount.TIERS = TIERS;
CustomerAccount.STATUSES = STATUSES;
CustomerAccount.TRANSITIONS = TRANSITIONS;
CustomerAccount.EDITABLE = EDITABLE;

module.exports = CustomerAccount;
