// Append-only audit trail for STAFF actions (migration 098 `staff_audit_log`).
//
// Sellers hold real power in this system — they own customer accounts, earn
// commission on them and (via GitHub) deploy to them — so "who did what, when"
// for the account registry, role grants, user invitations and commission must
// be a durable record, not a log line. Shape and rules mirror
// bookkeeping/auditLog.js:
//   - written with the SAME client as the change when inside a transaction
//     (account writes, commission), so it commits or rolls back with it;
//   - the role/user hooks run outside a transaction (those controllers are
//     single statements) and are best-effort: a failed audit insert is logged
//     loudly but never turns a successful grant into an error;
//   - summaries stay minimal (ids, field names, before/after of a status) —
//     never contact details.

const db = require('../config/database');
const logger = require('../logger');

// Closed vocabulary: a typo must not create a silent second category.
const ACTIONS = [
  'account.created', 'account.updated', 'account.status_changed', 'account.owner_changed',
  'provision.requested',
  'role.granted', 'role.revoked',
  'user.invited', 'user.disabled', 'user.enabled',
  'commission.recorded',
];

/**
 * Record a staff action.
 * @param {object} client  pg client (inside the caller's transaction) or the pool
 * @param {object} opts    { actorId, action, entityType, entityId, summary, requestId }
 */
async function record(client, { actorId = null, action, entityType, entityId = null, summary = {}, requestId = null }) {
  if (!ACTIONS.includes(action)) {
    throw new Error(`Unknown staff audit action: ${action}`);
  }
  await (client || db).query(
    `INSERT INTO staff_audit_log (actor_id, action, entity_type, entity_id, summary, request_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [actorId, action, entityType, entityId == null ? null : String(entityId), JSON.stringify(summary || {}), requestId]
  );
  logger.info({ action, entityType, entityId, actorId, requestId }, 'staff audit');
}

/** Best-effort variant for the hooks that run outside a transaction. */
async function recordSafe(opts) {
  try {
    await record(db, opts);
  } catch (err) {
    logger.error({ err: err.message, action: opts && opts.action }, 'staff audit write failed');
  }
}

function actorOf(req) {
  return { actorId: req.user ? req.user.id : null, requestId: req.requestId || null };
}

// Newest first. Filters are optional; `q` matches the actor's username.
async function list({ action = null, entityType = null, entityId = null, q = null, limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (action && ACTIONS.includes(action)) { params.push(action); clauses.push(`a.action = $${params.length}`); }
  if (entityType) { params.push(String(entityType)); clauses.push(`a.entity_type = $${params.length}`); }
  if (entityId != null) { params.push(String(entityId)); clauses.push(`a.entity_id = $${params.length}`); }
  if (q) { params.push(`%${String(q).trim()}%`); clauses.push(`u.username ILIKE $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const [{ rows }, { rows: [{ n: total }] }] = await Promise.all([
    db.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.summary, a.request_id, a.created_at,
              a.actor_id, u.username AS actor_username
         FROM staff_audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         ${where}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, lim, off]
    ),
    db.query(`SELECT COUNT(*)::int AS n FROM staff_audit_log a LEFT JOIN users u ON u.id = a.actor_id ${where}`, params),
  ]);
  return { entries: rows, total, limit: lim, offset: off };
}

module.exports = { ACTIONS, record, recordSafe, actorOf, list };
