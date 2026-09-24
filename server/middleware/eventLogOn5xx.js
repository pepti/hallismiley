'use strict';

// Every 5xx response becomes an event_logs row — not just the ones that reach
// the central error handler.
//
// 22 routes answer `res.status(5xx).json(...)` directly (Regla gateway
// failures, AI vision 502/503s, checkout-unavailable 503s, the circuit
// breaker), which bypasses errorHandler.js and therefore Admin → Monitoring.
// The 2026-09-02 Regla 502s left no in-app trace for that reason
// (docs/LOGGING-AUDIT-2026-09-05.md, control C3). Hooking the response end
// covers all of them without touching their bodies or status codes: this
// middleware only observes.
//
// Routes may enrich the row by setting, before they respond:
//   res.locals.errorMessage  — what to show in the Monitoring list
//   res.locals.errorContext  — object, stored as JSONB (kept small)
// errorHandler.js records its own richer row and sets
// res.locals.eventLogRecorded = true so the same failure is not stored twice.

const EventLog = require('../models/EventLog');
const { dbCircuitBreaker } = require('../observability/circuitBreaker');

const STATUS_TEXT = {
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

function eventLogOn5xx(req, res, next) {
  let done = false;
  // 'finish' = fully sent; 'close' = socket gone, possibly BEFORE finish (client
  // or proxy gave up on a slow upstream call). Either way, record once.
  const onDone = () => {
    if (done) return;
    done = true;
    const status = res.statusCode;
    if (status < 500 || res.locals.eventLogRecorded) return;
    res.locals.eventLogRecorded = true;
    // While the DB circuit breaker is open the 503s ARE the database being
    // down; an INSERT per rejected request would hammer the thing the breaker
    // exists to protect. The breaker logs + alerts its own state changes.
    // (.state, not isOpen(): isOpen() advances the half-open timer.)
    if (dbCircuitBreaker.state !== 'closed') return;
    const message = res.locals.errorMessage
      || `${status} ${STATUS_TEXT[status] || 'Server Error'}`;
    // 503 is "not available right now" (feature not configured, breaker open):
    // worth a row, but it is not an error in the code. 500/502/504 are.
    const level = status === 503 ? 'warn' : 'error';
    // Fire-and-forget: EventLog.record swallows its own failures, and a
    // finished response must never wait on a diagnostic write.
    EventLog.record({
      source:    'server',
      level,
      message,
      path:      `${req.method} ${req.originalUrl}`,
      status,
      userId:    req.user?.id || null,
      username:  req.user?.username || null,
      requestId: req.requestId || null,
      userAgent: req.headers?.['user-agent'] || null,
      context:   res.locals.errorContext || null,
    });
  };
  res.on('finish', onDone);
  res.on('close', onDone);
  next();
}

module.exports = eventLogOn5xx;
