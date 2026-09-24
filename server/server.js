require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });

// ── Azure Application Insights — MUST init before pg/http/express are required ─
// so the SDK can patch them. No-op unless APPLICATIONINSIGHTS_CONNECTION_STRING
// is set (ships dark, like Sentry below). See server/observability/appInsights.js
// (icelandicstore #254, harvest-ice-f-2026-09-24).
require('./observability/appInsights').start();

// ── Sentry error tracking — init before anything else if DSN is configured ────
if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  Sentry.init({ dsn: process.env.SENTRY_DSN });
}

// ── Required env var validation — fail fast on misconfiguration ────────────────
// CSRF_SECRET and NODE_ENV are load-bearing for security: a missing CSRF_SECRET
// previously fell back to a hardcoded dev value (CSRF bypass), and a missing
// NODE_ENV used to silently skip rate limiters. Both are now hard requirements
// so a misconfigured deploy refuses to start instead of degrading silently.
const logger = require('./logger');
const REQUIRED_ENV = ['DATABASE_URL', 'ALLOWED_ORIGINS', 'CSRF_SECRET', 'NODE_ENV'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
// A silent mail transport on production means verification, resets and
// receipts all no-op while every request returns 200 (ice #180). Fatal at
// boot, where the config error is cheap to see. APP_ENV, not NODE_ENV —
// NODE_ENV is 'production' on TEST stacks and CI boot-smoke too.
if (process.env.APP_ENV === 'production' && !process.env.RESEND_API_KEY) {
  missing.push('RESEND_API_KEY (required when APP_ENV=production)');
}
if (missing.length) {
  logger.fatal({ missing }, '[server] Missing required environment variables');
  // In dev pino writes through the pino-pretty worker thread; exiting on the
  // next statement could lose the one line that says why boot refused.
  logger.flush(() => process.exit(1));
}

// ── Admin two-factor configuration ─────────────────────────────────────────────
// A TOTP_ENC_KEY that is set but malformed must stop the boot: the alternative
// is discovering it when an admin tries to enrol. Unset is allowed for now (the
// secret stays in its plaintext column, as it always was) but said out loud.
// ADMIN_TOTP_EXEMPT is a test/dev convenience that production ignores
// (auth/mfaPolicy.js) — finding it set there means someone expected otherwise.
{
  const secretBox = require('./utils/secretBox');
  try {
    if (!secretBox.isConfigured() && process.env.NODE_ENV === 'production') {
      logger.warn(`[server] ${secretBox.KEY_ENV} is not set — admin TOTP secrets are stored unencrypted (docs/ADMIN-2FA.md)`);
    }
  } catch (err) {
    logger.fatal(`[server] ${err.message}`);
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && process.env.ADMIN_TOTP_EXEMPT) {
    logger.warn('[server] ADMIN_TOTP_EXEMPT is set but IGNORED when NODE_ENV=production — under security.mfa.enrolment=required every protected account must enrol a second factor');
  }
}

const app    = require('./app');
const { pool } = require('./config/database');
const EventLog = require('./models/EventLog');
const { checkMemory } = require('./observability/alerts');
const { migrate } = require('./scripts/migrate');
const { startEventLogCleanup } = require('./services/eventLogCleanup');
const { startLeadsCleanup } = require('./services/leadsCleanup');
const { startTokenCleanup } = require('./services/tokenCleanup');
const { logResolvedConfig } = require('./config/clientConfig');
const { startUpdateChecker } = require('./services/updateChecker');
const { verifyPendingUpdate } = require('./services/updateApplier');

const PORT = process.env.PORT || 3000;

// ── Global error handlers — catch unhandled rejections and exceptions ──────────
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, '[server] Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, '[server] Uncaught exception — shutting down');
  process.exit(1);
});

async function start() {
  // Announce what this instance is configured to be (modules + their settings)
  // before anything acts on it, so a boot log always answers "which flags was
  // this process running with?". Warnings about a bad config/client.json or a
  // stray CLIENT_CONFIG_* env var surface here too.
  logResolvedConfig(logger);

  // Run pending database migrations before accepting traffic. Seeds and
  // admin bootstrap are NOT run here — they live in `npm run bootstrap`
  // so cold boots (especially on Azure with a cross-region DB) don't
  // pay 5–7 extra SELECTs before listen().
  await migrate();

  // The admin's module switches (R5b) — layer 2 over the contract, from
  // app_settings, so it can only be read once the migrations have run. A
  // failure keeps the contract as resolved: every contracted module on.
  await require('./config/modules').loadAdminSwitches()
    .then((summary) => {
      if (summary.switched_off.length) logger.info({ modules: summary }, '[server] modules switched off by an admin');
    })
    .catch((err) => logger.error({ err }, '[server] could not load the admin module switches — keeping the contract'));

  // Did the update we triggered before the last restart actually land? This
  // runs AFTER migrations and BEFORE listen, on purpose: migrations are the
  // riskiest part of a release, and a verdict recorded before they ran would be
  // recording that the container started, not that the release works.
  await verifyPendingUpdate().catch(err => {
    logger.error({ err }, '[server] post-boot update verification failed');
  });

  // One-shot boot-time notice if outbound email isn't configured. RSVP
  // confirmations + admin notifications silently no-op when this is missing.
  if (!process.env.RESEND_API_KEY) {
    logger.warn('[server] RESEND_API_KEY not set — outbound email (RSVP notifications, verification, order receipts) will not send');
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    startEventLogCleanup(); // daily event_logs prune (EVENT_LOG_RETENTION_DAYS)
    startLeadsCleanup();    // daily leads prune (LEAD_RETENTION_DAYS — the /personuvernd promise)
    logger.info({ port: PORT, host: '0.0.0.0' }, 'Portfolio server started');
    // Which Anthropic auth mode is live, proven end to end when it is workload
    // identity (managed identity → token exchange → one cheap API call; ice
    // #326). Fire and forget: it never blocks or fails startup.
    require('./services/anthropicAuth').selfCheck().catch(() => {});
  });

  // Start periodic cleanup of expired sessions (runs every 24h)
  const cleanupTimer = startTokenCleanup();

  // Heap watch: the 'High memory usage' alert in observability/alerts.js had no
  // caller until 2026-09-12 — /ready reported memory but nothing alerted on it.
  // Once a minute, unref'd so it never keeps a shutting-down process alive.
  const memoryTimer = setInterval(checkMemory, 60_000);
  memoryTimer.unref();

  // Ask the release channel whether anything newer than this image exists.
  // No-ops on a dev build (no release identity to compare against), and never
  // applies anything on its own unless this instance is in `auto` mode.
  const updateChecker = startUpdateChecker();

  // Graceful shutdown — finish in-flight requests before exiting
  function shutdown(signal) {
    logger.info({ signal }, '[server] Shutting down gracefully');
    server.close(async () => {
      clearInterval(cleanupTimer);
      clearInterval(memoryTimer);
      updateChecker?.stop();
      logger.info('[server] HTTP server closed');
      // A 5xx answered just before shutdown still has its event_logs insert in
      // flight (eventLogOn5xx / errorHandler fire-and-forget) — let it land
      // before the pool closes, or the failure's own trace is the thing lost.
      await EventLog.flush();
      await pool.end();
      logger.info('[server] Database pool closed');
      process.exit(0);
    });

    // Force exit if still open after 10 seconds
    setTimeout(() => {
      logger.error('[server] Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch(err => {
  logger.error({ err }, '[server] Startup failed');
  process.exit(1);
});
