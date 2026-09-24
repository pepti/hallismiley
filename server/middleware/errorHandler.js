// A09 Security Logging & Monitoring + A05 Security Misconfiguration
// Log full details server-side; return only a generic message to the client

const EventLog = require('../models/EventLog');
const logger   = require('../logger');

const SAFE_STATUSES = new Set([400, 401, 403, 404, 409, 422, 429]);

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;

  // Always log the full error server-side through pino (never console — the
  // App Insights forwarder and the diagnostic-setting stream only see pino's
  // JSON lines; invariant 6). requestId correlates with the response header
  // and the event_logs row below.
  const reqId = req.requestId || '-';
  const logFields = { err, requestId: reqId, method: req.method, url: logger.scrubUrl(req.originalUrl), status };
  if (status >= 500) logger.error(logFields, 'Unhandled request error');
  else logger.warn(logFields, 'Request failed');

  // Persist 5xx to the event log so Admin → Monitoring can answer "what broke,
  // for whom" after the fact. Deliberately 5xx only: 4xx are routine client
  // mistakes (a bad password, a 404 from a stale link) and would bury the real
  // failures. Fire-and-forget — EventLog.record swallows its own errors, and the
  // response must not wait on a write that exists only for diagnostics.
  if (status >= 500) {
    // Tell the response-finish hook (eventLogOn5xx) this one is already stored.
    if (res.locals) res.locals.eventLogRecorded = true;
    EventLog.record({
      source:    'server',
      level:     'error',
      message:   err.message || 'Internal Server Error',
      path:      `${req.method} ${req.originalUrl}`,
      status,
      userId:    req.user?.id || null,
      username:  req.user?.username || null,
      requestId: req.requestId || null,
      userAgent: req.headers?.['user-agent'] || null,
      // The stack goes in context, never in `message` — the message column is
      // what the admin list renders, and a stack there would make it unreadable.
      context:   { stack: (err.stack || '').split('\n').slice(0, 6).join('\n') },
    });
  }

  // For known client errors, the message is safe to forward.
  // For 5xx, send a generic message so internals are never exposed.
  const clientMessage = SAFE_STATUSES.has(status)
    ? (err.message || 'Request failed')
    : 'Internal Server Error';

  res.status(status).json({ error: clientMessage, code: status });
}

module.exports = errorHandler;
