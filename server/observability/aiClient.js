'use strict';

// The one place that knows how to reach the Application Insights client.
//
// `applicationinsights` is started (or not) in appInsights.js before anything
// else loads. Everything that wants to emit custom telemetry — the pino
// forwarder, the tracked fetch wrapper — asks here, so the "ships dark"
// invariant lives in a single function: no connection string → no client →
// every caller is a no-op, and the SDK is never even required in test/dev.

let cached = null;
let looked = false;

/**
 * @returns {object|null} the SDK's defaultClient, or null when telemetry is dark.
 */
function getClient() {
  if (cached) return cached;
  if (!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) return null;
  if (looked) return cached;
  looked = true;
  try {
    const ai = require('applicationinsights');
    cached = ai.defaultClient || null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test seam: forget the cached client (and the "already looked" flag). */
function _reset() {
  cached = null;
  looked = false;
}

module.exports = { getClient, _reset };
