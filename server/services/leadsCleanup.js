// Retention for the leads inbox. Personal data, so it MUST age out: the
// /personuvernd policy promises enquiries are deleted 24 months after receipt
// (LEAD_RETENTION_DAYS, default 730). Mirrors eventLogCleanup.js: run once at
// boot, then daily, and never crash the server over a cleanup failure.
//
// Every status is pruned alike, won leads included — a won lead's lasting
// record is the customer account / the books, not the enquiry that started it.

const Lead = require('../models/Lead');
const logger = require('../logger');

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETENTION_DAYS = Number(process.env.LEAD_RETENTION_DAYS) || 730;

async function pruneLeads() {
  try {
    const removed = await Lead.pruneOlderThan(RETENTION_DAYS);
    logger.info({ removed, retentionDays: RETENTION_DAYS }, 'leadsCleanup ran');
  } catch (err) {
    logger.error({ err: err.message }, 'leadsCleanup failed');
  }
}

function startLeadsCleanup() {
  pruneLeads();
  return setInterval(pruneLeads, INTERVAL_MS);
}

module.exports = { startLeadsCleanup, pruneLeads, RETENTION_DAYS };
