'use strict';

const {
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestSize,
  httpResponseSize,
} = require('./metrics');

/**
 * Normalize an Express request path to a low-cardinality route label.
 * Prefer the matched route pattern over the raw URL to avoid ID explosion.
 */
function normalizeRoute(req) {
  if (req.route) {
    // req.baseUrl is the router prefix (e.g. /api/v1/projects),
    // req.route.path is the local pattern (e.g. /:id)
    return (req.baseUrl || '') + req.route.path;
  }
  // Fallback: strip UUIDs and numeric IDs from the raw path
  return req.path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d{4,}/g, '/:id');
}

/**
 * Express middleware that records Prometheus HTTP metrics for every request.
 * Must be registered early, before routes, so that the 'finish' event fires
 * after all route handlers have completed.
 */
function httpMetricsMiddleware(req, res, next) {
  const startNs = process.hrtime.bigint();
  const reqSize = parseInt(req.headers['content-length'] || '0', 10);

  res.on('finish', () => {
    const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
    const route  = normalizeRoute(req);
    const method = req.method;
    const status = String(res.statusCode);

    httpRequestsTotal.inc({ method, route, status_code: status });
    httpRequestDuration.observe({ method, route, status_code: status }, durationSec);

    if (reqSize > 0) {
      httpRequestSize.observe({ method, route }, reqSize);
    }

    const resSize = parseInt(res.getHeader('content-length') || '0', 10);
    if (resSize > 0) {
      httpResponseSize.observe({ method, route, status_code: status }, resSize);
    }
  });

  next();
}

module.exports = httpMetricsMiddleware;
