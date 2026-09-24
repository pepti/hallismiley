'use strict';

// pino → Application Insights `traces` / `exceptions`.
//
// Why this exists: on App Service the container's stdout is discarded unless a
// diagnostic setting streams it, and the classic `applicationinsights` SDK has
// no pino hook (it patches console/bunyan/winston only). Until 2026-09-05 every
// `logger.warn(... 'Regla send-invoice failed')` on PROD went nowhere — see
// docs/LOGGING-AUDIT-2026-09-05.md §2.3. This stream forwards warn-and-above
// lines to App Insights so a failure is queryable next to its `requests` row.
//
// Design constraints (audit §2.4a):
//   • Registered in pino.multistream at level `warn` — pino's numeric level
//     check drops the ~117k monthly pino-http success lines BEFORE write() is
//     called; the statusCode guard below is only a backstop.
//   • write() is synchronous in the caller's async context, so the SDK's
//     AsyncLocalStorage correlation stamps operation_Id automatically. A
//     worker-thread pino transport would lose that, which is why this is a
//     plain destination object and not a `transport`.
//   • Dark without a connection string: getClient() returns null → no-op.
//   • Lines are already redacted by pino (logger.js `redact`); nothing here
//     adds fields, it only forwards what pino serialised.

const { getClient } = require('./aiClient');

// applicationinsights Contracts.SeverityLevel — numeric so the SDK is not
// required just to read the enum.
const SEVERITY = { Verbose: 0, Information: 1, Warning: 2, Error: 3, Critical: 4 };

function severityFor(level) {
  if (level >= 60) return SEVERITY.Critical;
  if (level >= 50) return SEVERITY.Error;
  if (level >= 40) return SEVERITY.Warning;
  if (level >= 30) return SEVERITY.Information;
  return SEVERITY.Verbose;
}

// App Insights custom dimensions are string-valued. Nested objects (err,
// reglaMessages, req) are JSON-encoded so they survive as one dimension each.
function toProperties(rest) {
  const out = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

function errorFrom(err, msg) {
  const e = new Error(err.message || msg || 'error');
  if (err.type) e.name = err.type;
  if (err.stack) e.stack = err.stack;
  return e;
}

/**
 * Build a pino destination that forwards warn+ lines to App Insights.
 * @param {{ getClient?: () => object|null }} [opts] test seam
 */
function createAiLogStream(opts = {}) {
  const resolveClient = opts.getClient || getClient;
  return {
    write(line) {
      const client = resolveClient();
      if (!client) return;

      let obj;
      try { obj = JSON.parse(line); } catch { return; }
      if (!obj || typeof obj !== 'object') return;

      const level = Number(obj.level) || 0;
      if (level < 40) return;
      // pino-http completions: app.js's customLogLevel logs 5xx at error and
      // everything else at info, so only 5xx completions normally arrive here.
      // Backstop for any sub-500 completion that reaches warn some other way —
      // it is already in `requests`, so do not duplicate it.
      if (obj.res && Number(obj.res.statusCode) < 500 && level < 50) return;

      const { level: _l, time: _t, pid: _p, hostname: _h, msg, err, ...rest } = obj;
      const severity = severityFor(level);
      const properties = toProperties(rest);
      if (msg) properties.message = msg;

      try {
        if (err && level >= 50) {
          client.trackException({ exception: errorFrom(err, msg), severity, properties });
        } else {
          if (err) properties.err = JSON.stringify(err);
          client.trackTrace({ message: msg || '(no message)', severity, properties });
        }
      } catch {
        // Telemetry must never take the app down.
      }
    },
  };
}

module.exports = { createAiLogStream, severityFor, SEVERITY };
