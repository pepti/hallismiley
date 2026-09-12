'use strict';

const {
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestSize,
  httpResponseSize,
} = require('./metrics');
const { trackRequest } = require('./alerts');

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

    // Feed the rolling error-rate window (fires a 'High error rate' alert past
    // 5 % over 50+ requests). This is the single place that sees every request;
    // until 2026-09-12 nothing called trackRequest with a real outcome, so the
    // alert had no input. (Same wiring as orangesmiley 7cf7b1d.)
    trackRequest(res.statusCode >= 500);
  });

  next();
}

module.exports = httpMetricsMiddleware;
