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
  return url.replace(/([?&](?:token|code|state|verify|reset|secret|api[_-]?key)=)[^&#]*/gi, '$1[REDACTED]');
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Suppress all output during tests to keep test output clean
  enabled: process.env.NODE_ENV !== 'test',
  // Redact sensitive fields before they reach the log sink
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'req.body.password',
      'req.body.token',
      'req.body.kennitala',
      '*.password',
      '*.password_hash',
      '*.token',
      '*.secret',
      '*.kennitala',       // Icelandic national ID — GDPR personal data
    ],
    censor: '[REDACTED]',
  },
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
});

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
