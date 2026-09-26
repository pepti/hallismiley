// A09 Security Logging & Monitoring + A05 Security Misconfiguration
// Log full details server-side; return only a generic message to the client

const EventLog = require('../models/EventLog');
const logger   = require('../logger');
const { t }    = require('../i18n');

const SAFE_STATUSES = new Set([400, 401, 403, 404, 409, 422, 429]);

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // Postgres picked this request's transaction as a deadlock victim (40P01). It
  // was rolled back whole — nothing happened — so the honest answer is "busy,
  // send it again": a retryable 409, not a 500 in the event log. The stock lock
  // order (models/Inventory.js) is designed so this cannot happen; this is the
  // backstop for a cycle nobody has found yet (harvested from icelandicstore #380).
  const deadlock = !err.status && err.code === '40P01';
  const status = deadlock ? 409 : (err.status || 500);

  // Always log the full error server-side through pino (never console — the
  // App Insights forwarder and the diagnostic-setting stream only see pino's
  // JSON lines; invariant 6). requestId correlates with the response header
  // and the event_logs row below.
  const reqId = req.requestId || '-';
  const logFields = { err, requestId: reqId, method: req.method, url: logger.scrubUrl(req.originalUrl), status };
  if (status >= 500) logger.error(logFields, 'Unhandled request error');
  // A deadlock victim is a warn, not an error: nothing happened, the client
  // is told to retry, and it stays out of the 5xx event log below.
  else if (deadlock) logger.warn(logFields, 'Deadlock victim (40P01), answered 409 busy-retry');
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

  if (deadlock) {
    return res.status(409).json({
      error: t(req.locale, 'errors.busyRetry'), code: 409, reason: 'BUSY', retryable: true,
    });
  }

  // A typed "come back later" (services/aiGate.js AiBusyError, harvest2 from
  // icelandicstore #218): Retry-After in seconds, a localised message from the
  // error's messageKey, and its `reason` in the envelope. Only for a safe
  // client status — a 5xx never gets to choose its own message.
  if (SAFE_STATUSES.has(status) && err.messageKey) {
    if (Number.isFinite(err.retryAfterSeconds) && err.retryAfterSeconds > 0) {
      res.setHeader('Retry-After', String(Math.ceil(err.retryAfterSeconds)));
    }
    return res.status(status).json({
      error: t(req.locale, err.messageKey), code: status,
      ...(err.reason ? { reason: err.reason, retryable: status === 429 } : {}),
    });
  }
  res.status(status).json({ error: clientMessage, code: status });
}

module.exports = errorHandler;
