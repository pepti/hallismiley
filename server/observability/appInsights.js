'use strict';

// Azure Application Insights / Azure Monitor bootstrap.
//
// Ships DARK: a no-op unless APPLICATIONINSIGHTS_CONNECTION_STRING is set
// (mirrors how Sentry gates on SENTRY_DSN). When the connection string is
// present — set as an Azure App Service application setting on the live tier —
// the classic `applicationinsights` SDK auto-collects incoming HTTP requests
// (server response time, failed-request rate), outgoing `pg` and Node
// `http`/`https` dependencies, UNCAUGHT exceptions and Node performance
// counters. Those map to the latency / availability SLIs defined in SLO.md.
//
// What the SDK does NOT collect on its own (docs/LOGGING-AUDIT-2026-09-05.md):
// pino output (no pino hook; stdout is discarded by App Service unless a
// diagnostic setting exists), caught errors, and outbound `fetch()`/undici
// calls. Both gaps are filled in-repo since PR #254 (audit §2.4 / R3–R4):
// `observability/aiLogStream.js` forwards pino warn-and-above as trackTrace /
// trackException, and `observability/trackedFetch.js` records Regla, Microsoft
// Graph and Anthropic as dependencies. Those two write THROUGH this SDK, so
// they stay dark for exactly as long as the connection string is unset.
//
// IMPORTANT: require + start this FIRST in server.js — before pg / http /
// express are loaded — so the SDK can patch those libraries.

/**
 * Initialise Application Insights if configured.
 * @returns {boolean} true if telemetry was started, false if it stayed dark.
 */
function start() {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) return false;

  try {
    const appInsights = require('applicationinsights');

    appInsights
      .setup(connectionString)
      .setAutoCollectRequests(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectPerformance(true, true)
      .setSendLiveMetrics(true);

    // Cloud role name groups telemetry per environment in the Application Map
    // so the TEST/eval tier and PROD don't blur together. Engine port
    // (harvest-ice-f-2026-09-24): every instance of the estate may share one
    // App Insights resource, so the role is the instance's own name —
    // APPLICATIONINSIGHTS_ROLE_NAME if set, else the App Service site name
    // (WEBSITE_SITE_NAME, set by the platform), else the package name.
    const role = process.env.APPLICATIONINSIGHTS_ROLE_NAME
      || process.env.WEBSITE_SITE_NAME
      || require('../../package.json').name;
    const { defaultClient } = appInsights;
    if (defaultClient) {
      defaultClient.context.tags[defaultClient.context.keys.cloudRole] = role;
    }

    appInsights.start();
    return true;
  } catch (err) {
    // Never let telemetry setup crash the app. Use console here because the
    // pino logger may not be loaded yet at this very early boot phase, and the
    // `applicationinsights` package may be absent in a slimmed image.
    // eslint-disable-next-line no-console -- runs before pino is loaded; the SDK may be absent
    console.error('[appInsights] setup failed — continuing without it:', err.message);
    return false;
  }
}

module.exports = { start };
