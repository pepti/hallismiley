// Periodic cleanup of expired Lucia sessions.
// Runs automatically every 24 hours while the server is live.

const logger = require('../logger');
const db = require('../config/database');

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function cleanExpiredSessions() {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM user_sessions WHERE expires_at < NOW()'
    );
    if (rowCount > 0) {
      logger.info({ rowCount }, '[sessionCleanup] Removed expired session(s)');
    } else {
      logger.info('[sessionCleanup] ran — 0 rows removed.');
    }
  } catch (err) {
    // Log but never crash the server over cleanup
    logger.error({ err }, '[sessionCleanup] Error during cleanup');
  }
}

function startTokenCleanup() {
  // Run once at startup, then every 24 hours
  cleanExpiredSessions();
  return setInterval(cleanExpiredSessions, INTERVAL_MS);
}

module.exports = { cleanExpiredSessions, startTokenCleanup };
