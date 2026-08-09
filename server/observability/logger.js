'use strict';

const pino = require('pino');

// Use pino-pretty for human-readable output in development
const usePretty = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Suppress all output during tests to keep test output clean
  enabled: process.env.NODE_ENV !== 'test',
  // Redact sensitive fields before they reach the log sink
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.token',
      '*.password',
      '*.password_hash',
      '*.token',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
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
