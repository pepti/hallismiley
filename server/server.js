require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// ── Sentry error tracking — init before anything else if DSN is configured ────
if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  Sentry.init({ dsn: process.env.SENTRY_DSN });
}

// ── Required env var validation — fail fast on misconfiguration ────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'ALLOWED_ORIGINS'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[server] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const logger = require('./logger');
const app    = require('./app');
const { pool } = require('./config/database');
const { migrate } = require('./scripts/migrate');
const { startTokenCleanup } = require('./services/tokenCleanup');

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
  // Run pending database migrations before accepting traffic
  await migrate();

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Portfolio server started');
  });

  // Start periodic cleanup of expired sessions (runs every 24h)
  const cleanupTimer = startTokenCleanup();

  // Graceful shutdown — finish in-flight requests before exiting
  function shutdown(signal) {
    logger.info({ signal }, '[server] Shutting down gracefully');
    server.close(async () => {
      clearInterval(cleanupTimer);
      logger.info('[server] HTTP server closed');
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
