'use strict';

const securityLogger = require('./securityLogger');

// ── In-memory tracking for rate-based alerts ───────────────────────────────────

// Track failed logins per IP: ip → [timestamp, ...]
const failedLoginsByIp = new Map();
const FAILED_LOGIN_WINDOW_MS   = 5 * 60 * 1000; // 5 minutes
const FAILED_LOGIN_THRESHOLD   = 5;

// Track request outcomes for error-rate alerting: { total, errors, windowStart }
let requestWindow = { total: 0, errors: 0, windowStart: Date.now() };
const ERROR_RATE_WINDOW_MS  = 5 * 60 * 1000;
const ERROR_RATE_THRESHOLD  = 0.05; // 5 %

// Memory alert threshold
const MEMORY_ALERT_THRESHOLD = 0.90; // 90 %

// ── Core alert function ────────────────────────────────────────────────────────

/**
 * Fire an alert.
 * @param {'info'|'warning'|'critical'} severity
 * @param {string} title
 * @param {object} [details]
 */
async function alert(severity, title, details = {}) {
  // Always log
  securityLogger.alert(severity, title, details);

  // Webhook (Slack / Discord / PagerDuty) if configured
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const emoji = severity === 'critical' ? ':rotating_light:' : severity === 'warning' ? ':warning:' : ':information_source:';
  const body  = JSON.stringify({
    text: `${emoji} *[${severity.toUpperCase()}]* ${title}`,
    attachments: [{
      color:  severity === 'critical' ? 'danger' : severity === 'warning' ? 'warning' : 'good',
      fields: Object.entries(details).map(([k, v]) => ({
        title: k,
        value: String(v),
        short: true,
      })),
      footer: `portfolio-server • ${new Date().toISOString()}`,
    }],
  });

  try {
    await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Never let a webhook failure crash the app
    securityLogger.alert('warning', 'Alert webhook delivery failed', { webhookUrl });
  }
}

// ── Failed-login IP tracking ───────────────────────────────────────────────────

/**
 * Record a failed login attempt for an IP address.
 * Fires a 'critical' alert if 5+ failures occur within 5 minutes.
 */
function trackFailedLogin(ip) {
  const now = Date.now();
  const attempts = (failedLoginsByIp.get(ip) || [])
    .filter(t => now - t < FAILED_LOGIN_WINDOW_MS);
  attempts.push(now);
  failedLoginsByIp.set(ip, attempts);

  if (attempts.length >= FAILED_LOGIN_THRESHOLD) {
    alert('critical', 'Brute-force login attempt detected', {
      ip,
      attempts: attempts.length,
      windowMinutes: FAILED_LOGIN_WINDOW_MS / 60000,
    });
    // Reset so we don't spam
    failedLoginsByIp.set(ip, []);
  }
}

// Prune stale IP entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - FAILED_LOGIN_WINDOW_MS;
  for (const [ip, times] of failedLoginsByIp) {
    const recent = times.filter(t => t > cutoff);
    if (recent.length === 0) failedLoginsByIp.delete(ip);
    else failedLoginsByIp.set(ip, recent);
  }
}, 10 * 60 * 1000).unref();

// ── Error-rate tracking ────────────────────────────────────────────────────────

/**
 * Record the outcome of a request for error-rate tracking.
 * Call this from the error handler or http metrics middleware.
 */
function trackRequest(isError) {
  const now = Date.now();
  if (now - requestWindow.windowStart > ERROR_RATE_WINDOW_MS) {
    requestWindow = { total: 0, errors: 0, windowStart: now };
  }
  requestWindow.total++;
  if (isError) requestWindow.errors++;

  if (requestWindow.total >= 50) { // only alert after enough volume
    const rate = requestWindow.errors / requestWindow.total;
    if (rate > ERROR_RATE_THRESHOLD) {
      alert('critical', 'High error rate detected', {
        errorRate:  `${(rate * 100).toFixed(1)}%`,
        errors:     requestWindow.errors,
        total:      requestWindow.total,
        windowMins: ERROR_RATE_WINDOW_MS / 60000,
      });
      requestWindow = { total: 0, errors: 0, windowStart: now }; // reset
    }
  }
}

// ── Memory monitoring ──────────────────────────────────────────────────────────

/**
 * Check process memory and alert if above threshold.
 * Called periodically from server.js.
 */
function checkMemory() {
  const mem = process.memoryUsage();
  const ratio = mem.heapUsed / mem.heapTotal;
  if (ratio > MEMORY_ALERT_THRESHOLD) {
    alert('critical', 'High memory usage', {
      heapUsed:   `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
      heapTotal:  `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
      ratio:      `${(ratio * 100).toFixed(1)}%`,
    });
  }
}

/**
 * Alert on a health-check failure.
 */
function healthCheckFailed(checkName, details) {
  alert('critical', `Health check failed: ${checkName}`, details);
}

module.exports = {
  alert,
  trackFailedLogin,
  trackRequest,
  checkMemory,
  healthCheckFailed,
};
