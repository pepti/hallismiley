// A09 Security Logging & Monitoring + A05 Security Misconfiguration
// Log full details server-side; return only a generic message to the client

const logger = require('../observability/logger');
const { trackRequest } = require('../observability/alerts');

const SAFE_STATUSES = new Set([400, 401, 403, 404, 409, 422, 429]);

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;

  // Structured error log with full context — request/trace IDs for correlation
  logger.error({
    err,
    requestId: req.requestId,
    traceId:   req.traceId,
    method:    req.method,
    url:       req.originalUrl,
    status,
    userId:    req.user?.id,
  }, 'Request error');

  // Track 5xx errors for error-rate alerting
  if (status >= 500) {
    trackRequest(true);
  } else {
    trackRequest(false);
  }

  // For known client errors, the message is safe to forward.
  // For 5xx, send a generic message so internals are never exposed.
  const clientMessage = SAFE_STATUSES.has(status)
    ? (err.message || 'Request failed')
    : 'Internal Server Error';

  res.status(status).json({
    error:   clientMessage,
    code:    status,
    traceId: req.traceId, // surface trace ID so users can report support issues
  });
}

module.exports = errorHandler;
