// Retention for the server-side event log. Diagnostic rows, not accounting
// data — they age out so the table can't grow without bound. Mirrors the shape
// of tokenCleanup.js: run once at boot, then daily, and never crash the server
// over a cleanup failure.

const EventLog = require('../models/EventLog');
const logger = require('../logger');

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETENTION_DAYS = Number(process.env.EVENT_LOG_RETENTION_DAYS) || 90;

async function pruneEventLogs() {
  try {
    const removed = await EventLog.pruneOlderThan(RETENTION_DAYS);
    logger.info({ removed, retentionDays: RETENTION_DAYS }, 'eventLogCleanup ran');
  } catch (err) {
    logger.error({ err: err.message }, 'eventLogCleanup failed');
  }
}

function startEventLogCleanup() {
  pruneEventLogs();
  return setInterval(pruneEventLogs, INTERVAL_MS);
}

module.exports = { startEventLogCleanup, pruneEventLogs, RETENTION_DAYS };
