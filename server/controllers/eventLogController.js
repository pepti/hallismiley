// Event log endpoints.
//   collect — the SPA's error-toast beacon. Signed-in OR anonymous (softAuth).
//   list    — ADMIN only, paginated + filtered, for Admin → Monitoring.
//
// collect is fire-and-forget in the same spirit as the analytics beacon: it
// responds 204 immediately and never surfaces a failure to the user. That
// matters more here than for analytics — this endpoint fires *because*
// something already went wrong, and a logging error that produced another error
// toast would loop.

const logger   = require('../observability/logger');
const EventLog = require('../models/EventLog');
const { RETENTION_DAYS } = require('../services/eventLogCleanup');

const LEVELS = ['error', 'warn', 'info'];

// What produced the client row. 'toast' = a failure the app showed the user;
// the other two are failures nobody showed, caught by the global handlers.
const KINDS = ['toast', 'uncaught', 'unhandledrejection'];

// Client context is picked field by field with per-field caps, never spread
// wholesale into the JSONB column — the body is attacker-controlled.
function safeContext(body) {
  const ctx = (body.context && typeof body.context === 'object') ? body.context : {};
  const str = (v, max) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);
  return {
    locale: str(body.locale, 8),
    kind:   KINDS.includes(ctx.kind) ? ctx.kind : 'toast',
    where:  str(ctx.where, 300),
    stack:  str(ctx.stack, 1200),
  };
}

// POST /api/v1/events/collect
async function collect(req, res) {
  res.status(204).end();
  try {
    const body = req.body || {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return;                                  // nothing to record

    // The client may only file its own client-side observations. `source` is
    // NOT read from the body — a browser cannot claim to be the server.
    await EventLog.record({
      source:    'client',
      level:     LEVELS.includes(body.level) ? body.level : 'error',
      message,
      path:      typeof body.path === 'string' ? body.path : null,
      userId:    req.user?.id || null,
      username:  req.user?.username || null,
      requestId: req.requestId || null,
      userAgent: req.headers['user-agent'] || null,
      context:   safeContext(body),
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'event log collect failed');
  }
}

// GET /api/v1/admin/events?limit&offset&source&level&q
async function list(req, res, next) {
  try {
    const limit  = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const source = req.query.source === 'client' || req.query.source === 'server'
      ? req.query.source : null;
    const level  = LEVELS.includes(req.query.level) ? req.query.level : null;
    const q      = (req.query.q && String(req.query.q).trim()) || null;

    const [events, total] = await Promise.all([
      EventLog.list({ source, level, q, limit, offset }),
      EventLog.count({ source, level, q }),
    ]);
    // retentionDays travels with the list so the UI can state the real window
    // instead of hard-coding the default.
    return res.json({ events, total, limit, offset, retentionDays: RETENTION_DAYS });
  } catch (err) { next(err); }
}

module.exports = { collect, list };
