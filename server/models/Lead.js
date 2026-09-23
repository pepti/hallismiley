// Lead — one /hafa-samband enquiry, persisted alongside the notification
// email so a missed email never loses a prospect (migration 097_leads; the
// email's outcome on the row since 108_leads_notification).
//
// Ids are compared as TEXT (`l.id::text = $1`): the engine's column is SERIAL,
// a product whose table predates 097 (rekstrarkerfid) holds TEXT uuids, and
// the controller hands either through as the string it received (rk-feed,
// 2026-09-23). The table is bounded by the retention job, so the cast costs
// nothing measurable.
//
// PII table. Never log field values — only the submission id. Retention is
// enforced by server/services/leadsCleanup.js (LEAD_RETENTION_DAYS); every
// API response that carries a row is Cache-Control: no-store.
//
// Shape follows EventLog: a never-throwing insert (the contact path must not
// fail because the inbox failed), a shared _filter for list + count, and a
// pruneOlderThan for the retention job.

const db = require('../config/database');
const logger = require('../logger');

const STATUSES = ['new', 'contacted', 'won', 'lost'];

// Column caps mirror contactController's validation; the insert clamps too so
// a future caller cannot overflow a VARCHAR and take the row down.
const CAPS = { name: 100, email: 200, company: 150, phone: 40, platform: 20, message: 2000, locale: 5, source: 30 };
const MAX_NOTE = 4000;

function clamp(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

const COLUMNS = `
  l.id, l.submission_id, l.name, l.email, l.company, l.phone, l.current_platform,
  l.message, l.source, l.locale, l.status, l.owner_user_id, l.contacted_at,
  l.contacted_by, l.note, l.notified_at, l.notify_error, l.created_at, l.updated_at,
  COALESCE(o.display_name, o.username) AS owner_name,
  COALESCE(c.display_name, c.username) AS contacted_by_name
`;
const JOINS = `
  FROM leads l
  LEFT JOIN users o ON o.id = l.owner_user_id
  LEFT JOIN users c ON c.id = l.contacted_by
`;

class Lead {
  /**
   * Persist one enquiry. Never throws: the visitor already has their 200 and
   * the email is on its way — a database problem is logged (id only) and the
   * lead survives in the inbox email. Returns the row, or null if dropped.
   */
  static async create({
    submissionId, name, email, message, company = null, phone = null,
    platform = null, locale = null, source = 'hafa-samband',
  } = {}) {
    try {
      const { rows } = await db.query(
        `INSERT INTO leads
           (submission_id, name, email, company, phone, current_platform, message, source, locale)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, submission_id, status, created_at`,
        [
          submissionId,
          clamp(name, CAPS.name), clamp(email, CAPS.email),
          clamp(company, CAPS.company), clamp(phone, CAPS.phone),
          clamp(platform, CAPS.platform), clamp(message, CAPS.message),
          clamp(source, CAPS.source) || 'hafa-samband', clamp(locale, CAPS.locale),
        ]
      );
      return rows[0] || null;
    } catch (err) {
      logger.error({ submissionId, err: err.message }, 'lead persist failed');
      return null;
    }
  }

  // Shared WHERE for list() + count() so a paginated list can never disagree
  // with its own total.
  static _filter({ status = null, q = null, ownerId = null } = {}) {
    const clauses = [];
    const params  = [];
    if (STATUSES.includes(status)) { params.push(status); clauses.push(`l.status = $${params.length}`); }
    if (ownerId) { params.push(String(ownerId)); clauses.push(`l.owner_user_id = $${params.length}`); }
    if (q) {
      // Leading-wildcard ILIKE = sequential scan. Fine: the table is bounded by
      // the retention job and by how many enquiries a company site receives.
      params.push(`%${String(q).trim()}%`);
      clauses.push(`(l.name ILIKE $${params.length} OR l.email ILIKE $${params.length} OR l.company ILIKE $${params.length})`);
    }
    return { clause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  static async list({ status, q, ownerId, limit = 50, offset = 0 } = {}) {
    const { clause, params } = this._filter({ status, q, ownerId });
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const off = Math.max(Number(offset) || 0, 0);
    params.push(lim, off);
    const { rows } = await db.query(
      `SELECT ${COLUMNS} ${JOINS} ${clause}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows;
  }

  static async count({ status, q, ownerId } = {}) {
    const { clause, params } = this._filter({ status, q, ownerId });
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM leads l ${clause}`, params);
    return rows[0]?.n || 0;
  }

  /** Unfiltered per-status totals for the inbox's filter chips. */
  static async countsByStatus() {
    const { rows } = await db.query(`SELECT status, COUNT(*)::int AS n FROM leads GROUP BY status`);
    const out = Object.fromEntries(STATUSES.map(s => [s, 0]));
    for (const r of rows) if (r.status in out) out[r.status] = r.n;
    return out;
  }

  static async findById(id) {
    const { rows } = await db.query(`SELECT ${COLUMNS} ${JOINS} WHERE l.id::text = $1`, [String(id)]);
    return rows[0] || null;
  }

  /**
   * Workflow fields only — the submission itself (name, email, message…) is
   * immutable. `contacted_at`/`contacted_by` are stamped on the FIRST move out
   * of 'new' and never again: they record the first human touch. Undefined
   * fields are left alone; an explicit null clears note / owner.
   */
  static async update(id, { status, note, owner_user_id: ownerUserId } = {}, actorId = null) {
    const setStatus = STATUSES.includes(status) ? status : null;
    const setNote   = note !== undefined;
    const setOwner  = ownerUserId !== undefined;
    const { rows } = await db.query(
      `UPDATE leads SET
         status        = COALESCE($2, status),
         note          = CASE WHEN $3::boolean THEN $4 ELSE note END,
         owner_user_id = CASE WHEN $5::boolean THEN $6 ELSE owner_user_id END,
         contacted_at  = CASE WHEN $2 IS NOT NULL AND $2 <> 'new' AND contacted_at IS NULL THEN NOW() ELSE contacted_at END,
         contacted_by  = CASE WHEN $2 IS NOT NULL AND $2 <> 'new' AND contacted_at IS NULL THEN $7 ELSE contacted_by END
       WHERE id::text = $1
       RETURNING id`,
      [
        String(id), setStatus,
        setNote, setNote ? clamp(note, MAX_NOTE) : null,
        setOwner, setOwner ? (ownerUserId ? String(ownerUserId) : null) : null,
        actorId ? String(actorId) : null,
      ]
    );
    if (!rows[0]) return null;
    return this.findById(id);
  }

  /**
   * The notification email's outcome, recorded on the row so the inbox shows
   * which enquiries nobody was emailed about (migration 108: notified_at /
   * notify_error). `error` null = sent (stamps notified_at, clears the
   * error); else a short reason (kept, capped, notified_at untouched). Keyed
   * by submission_id — the one id the contact path holds before the insert
   * returns. Never throws: an unrecorded outcome must not surface anywhere.
   * Born in rekstrarkerfid (2026-09-15: with no RESEND_API_KEY on PROD every
   * enquiry vanished behind a "received" reply), harvested 2026-09-23.
   */
  static async recordNotification(submissionId, error = null) {
    try {
      await db.query(
        `UPDATE leads
            SET notified_at  = CASE WHEN $2::text IS NULL THEN NOW() ELSE notified_at END,
                notify_error = $2::text
          WHERE submission_id = $1`,
        [String(submissionId), error ? String(error).slice(0, 500) : null]
      );
    } catch (err) {
      logger.error({ submissionId, err: err.message }, 'lead notification outcome not recorded');
    }
  }

  /** Hard delete = PII erasure. Returns true when a row went. */
  static async remove(id) {
    const { rowCount } = await db.query(`DELETE FROM leads WHERE id::text = $1`, [String(id)]);
    return rowCount > 0;
  }

  /** Retention. Returns the number of rows removed. */
  static async pruneOlderThan(days = 730) {
    const d = Math.max(Number(days) || 730, 1);
    const { rowCount } = await db.query(
      `DELETE FROM leads WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(d)]
    );
    return rowCount;
  }
}

Lead.STATUSES = STATUSES;
Lead.MAX_NOTE = MAX_NOTE;

module.exports = Lead;
