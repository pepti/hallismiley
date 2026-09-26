'use strict';

const pino = require('pino');

// Use pino-pretty for human-readable output in development
const usePretty = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

// Strip single-use secrets that ride in the URL query string before a URL is
// logged. Password-reset / email-verify links arrive as
// GET /<locale>/reset-password?token=… and the OAuth callbacks carry code/state;
// the param name is kept, only its value is redacted.
function scrubUrl(url) {
  if (typeof url !== 'string' || url.indexOf('?') === -1) return url;
  // `q` joined the list when the leads inbox shipped: staff search it by name
  // and email, so the search term is visitor PII and must not sit in the
  // access log, which has none of the no-store discipline the module keeps.
  return url.replace(/([?&](?:token|code|state|verify|reset|secret|api[_-]?key|q)=)[^&#]*/gi, '$1[REDACTED]');
}

const LEVEL = process.env.LOG_LEVEL || 'info';

// Production destination: stdout (the container log, kept only when an App
// Service diagnostic setting streams it) PLUS a warn+ forwarder into
// Application Insights `traces`/`exceptions`. The forwarder is a no-op without
// APPLICATIONINSIGHTS_CONNECTION_STRING, so dev/CI/TEST-without-AI see plain
// stdout exactly as before. Dev keeps pino-pretty (a transport, which pino
// cannot combine with multistream in one call). Ported from icelandicstore
// #254 (harvest-ice-f-2026-09-24; its LOGGING-AUDIT-2026-09-05.md §2.4a).
function productionDestination() {
  if (!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) return process.stdout;
  const { createAiLogStream } = require('./aiLogStream');
  return pino.multistream([
    { level: LEVEL,  stream: process.stdout },
    { level: 'warn', stream: createAiLogStream() },
  ]);
}

// Redact sensitive fields before they reach the log sink. Exported so
// tests/unit/loggerRedact.test.js can build a pino with the SAME config (the
// app logger is disabled under NODE_ENV=test).
//
// pino's `*` wildcard matches exactly ONE level, so `*.password` does NOT cover
// a top-level `logger.info({ password }, '…')` — the shape a generated or
// rotated credential takes. Ported from icelandicstore #382 (the top-level
// `password` path) and widened to every credential field this engine's own
// routes read (harvest 2, 2026-09-26): the password-change pair
// (current_password / new_password, validatePasswordChange), their camelCase
// spellings, and the two-factor secret. The TOTP `code` is redacted only
// under req.body — a bare `code` is an error code everywhere else.
const REDACT = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-csrf-token"]',
    'req.body.password',
    'req.body.current_password',
    'req.body.new_password',
    'req.body.code',
    'req.body.token',
    'req.body.kennitala',
    // top level — see above
    'password',
    'password_hash',
    'current_password',
    'new_password',
    'currentPassword',
    'newPassword',
    'token',
    'secret',
    'totp_secret',
    'totp_secret_enc',
    'kennitala',
    // one level down
    '*.password',
    '*.password_hash',
    '*.current_password',
    '*.new_password',
    '*.currentPassword',
    '*.newPassword',
    '*.token',
    '*.secret',
    '*.totp_secret',
    '*.totp_secret_enc',
    '*.kennitala',       // Icelandic national ID — GDPR personal data
  ],
  censor: '[REDACTED]',
};

const logger = pino({
  level: LEVEL,
  // Suppress all output during tests to keep test output clean
  enabled: process.env.NODE_ENV !== 'test',
  redact: REDACT,
  serializers: {
    err: pino.stdSerializers.err,
    // Wrap the std req serializer to scrub secrets that travel in the query
    // string — the std serializer logs req.url verbatim, which would otherwise
    // leak reset/verify tokens and OAuth code/state to the log sink.
    req(req) {
      const s = pino.stdSerializers.req(req);
      if (s) s.url = scrubUrl(s.url);
      return s;
    },
    res: pino.stdSerializers.res,
  },
  ...(usePretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
      }
    : {}),
}, usePretty ? undefined : productionDestination());

/**
 * Create a child logger bound to a specific HTTP request context.
 * Attach requestId, traceId, and optionally userId for log correlation.
 */
function createRequestLogger(req) {
  return logger.child({
    requestId: req.requestId,
    traceId:   req.traceId,
    ...(req.user ? { userId: req.user.id, userRole: req.user.role } : {}),
  });
}

module.exports = logger;
module.exports.createRequestLogger = createRequestLogger;
module.exports.scrubUrl = scrubUrl;
module.exports.REDACT = REDACT;
