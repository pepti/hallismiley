// EventLog — the server-side failure log behind Admin → Monitoring.
//
// Two writers: the central error handler (source 'server') and the SPA's
// error-toast beacon (source 'client'). Reads are admin-only and paginated.
// See migration 093_event_logs.

const db = require('../config/database');

const COLUMNS = `
  id, source, level, message, path, status,
  user_id, username, request_id, user_agent, context, created_at
`;

const SOURCES = ['client', 'server'];
const LEVELS  = ['error', 'warn', 'info'];

// Hard caps. These columns are written from request-shaped input, so a hostile
// or merely buggy caller must not be able to store an unbounded blob.
const MAX_MESSAGE = 1000;
const MAX_PATH    = 512;
const MAX_UA      = 400;
const MAX_CONTEXT = 2000;   // serialized JSON

function clamp(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

class EventLog {
  /**
   * Insert one row. Never throws — callers are error paths and cleanup paths,
   * and a logging failure must not replace or mask the failure being logged.
   * Returns the row on success, null if it was dropped.
   */
  static async record({
    source, level = 'error', message, path = null, status = null,
    userId = null, username = null, requestId = null, userAgent = null, context = null,
  } = {}) {
    try {
      if (!SOURCES.includes(source)) return null;
      const lvl = LEVELS.includes(level) ? level : 'error';
      const msg = clamp(message, MAX_MESSAGE);
      if (!msg) return null;                       // nothing worth a row

      let ctx = '{}';
      if (context && typeof context === 'object') {
        const serialized = JSON.stringify(context);
        // Oversized context is dropped, not truncated — a half-JSON string
        // would fail the JSONB cast and take the whole insert down with it.
        if (serialized.length <= MAX_CONTEXT) ctx = serialized;
      }

      const statusNum = Number.isInteger(Number(status)) && status !== null
        ? Number(status) : null;

      const { rows } = await db.query(
        `INSERT INTO event_logs
           (source, level, message, path, status, user_id, username, request_id, user_agent, context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING ${COLUMNS}`,
        [
          source, lvl, msg, clamp(path, MAX_PATH), statusNum,
          userId ? String(userId) : null, clamp(username, 120),
          clamp(requestId, 120), clamp(userAgent, MAX_UA), ctx,
        ]
      );
      return rows[0] || null;
    } catch {
      return null;   // see the doc comment — logging never escalates
    }
  }

  // Shared WHERE for list() + count() so the two can never disagree about what
  // "matching" means (a paginated list whose total is computed differently is a
  // UI that lies about how many pages it has).
  static _filter({ source = null, level = null, userId = null, q = null } = {}) {
    const clauses = [];
    const params  = [];
    if (SOURCES.includes(source)) { params.push(source); clauses.push(`source = $${params.length}`); }
    if (LEVELS.includes(level))   { params.push(level);  clauses.push(`level  = $${params.length}`); }
    if (userId)                   { params.push(String(userId)); clauses.push(`user_id = $${params.length}`); }
    if (q) {
      // Leading-wildcard ILIKE cannot use a btree index, so this is a sequential
      // scan. Deliberate: the table is bounded by the 90-day retention job and
      // this store's volume keeps it small, while the fix (pg_trgm + a GIN index)
      // needs CREATE EXTENSION at boot — which fails on Azure unless pg_trgm is in
      // the azure.extensions allowlist, and a failed migration takes the deploy
      // down. Revisit with a trigram index if the table ever reaches six figures.
      params.push(`%${String(q).trim()}%`);
      clauses.push(`(message ILIKE $${params.length} OR path ILIKE $${params.length} OR username ILIKE $${params.length})`);
    }
    return { clause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  static async list({ source, level, userId, q, limit = 50, offset = 0 } = {}) {
    const { clause, params } = this._filter({ source, level, userId, q });
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const off = Math.max(Number(offset) || 0, 0);
    params.push(lim, off);
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM event_logs ${clause}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows;
  }

  static async count({ source, level, userId, q } = {}) {
    const { clause, params } = this._filter({ source, level, userId, q });
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM event_logs ${clause}`, params);
    return rows[0]?.n || 0;
  }

  /** Retention. Returns the number of rows removed. */
  static async pruneOlderThan(days = 90) {
    const d = Math.max(Number(days) || 90, 1);
    const { rowCount } = await db.query(
      `DELETE FROM event_logs WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(d)]
    );
    return rowCount;
  }
}

module.exports = EventLog;
