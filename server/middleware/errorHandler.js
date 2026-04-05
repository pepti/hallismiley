// A09 Security Logging & Monitoring + A05 Security Misconfiguration
// Log full details server-side; return only a generic message to the client

const SAFE_STATUSES = new Set([400, 401, 403, 404, 409, 422, 429]);

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;

  // Always log the full error server-side — include request ID for log correlation
  const reqId = req.requestId || '-';
  console.error(`[${new Date().toISOString()}] [${reqId}] ${req.method} ${req.originalUrl} → ${status}`);
  console.error(err.stack || err.message);

  // For known client errors, the message is safe to forward.
  // For 5xx, send a generic message so internals are never exposed.
  const clientMessage = SAFE_STATUSES.has(status)
    ? (err.message || 'Request failed')
    : 'Internal Server Error';

  res.status(status).json({ error: clientMessage, code: status });
}

module.exports = errorHandler;
