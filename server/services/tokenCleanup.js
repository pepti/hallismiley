// Periodic cleanup of expired Lucia sessions.
// Runs automatically every 24 hours while the server is live.

const db = require('../config/database');

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function cleanExpiredSessions() {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM user_sessions WHERE expires_at < NOW()'
    );
    if (rowCount > 0) {
      console.log(`[sessionCleanup] Removed ${rowCount} expired session(s).`);
    } else {
      console.log('[sessionCleanup] ran — 0 rows removed.');
    }
  } catch (err) {
    // Log but never crash the server over cleanup
    console.error('[sessionCleanup] Error during cleanup:', err.message);
  }
}

function startTokenCleanup() {
  // Run once at startup, then every 24 hours
  cleanExpiredSessions();
  return setInterval(cleanExpiredSessions, INTERVAL_MS);
}

module.exports = { cleanExpiredSessions, startTokenCleanup };
