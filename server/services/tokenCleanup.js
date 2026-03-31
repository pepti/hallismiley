// Periodic cleanup of expired and revoked refresh tokens
// Runs automatically every 24 hours while the server is live;
// also exported so migrate/seed scripts can call it manually.

const db = require('../config/database');

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function cleanExpiredTokens() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM refresh_tokens
       WHERE expires_at < NOW() OR revoked = TRUE`
    );
    if (rowCount > 0) {
      console.log(`[tokenCleanup] Removed ${rowCount} expired/revoked token(s).`);
    } else {
      console.log('[tokenCleanup] ran — 0 rows removed.');
    }
  } catch (err) {
    // Log but never crash the server over cleanup
    console.error('[tokenCleanup] Error during cleanup:', err.message);
  }
}

function startTokenCleanup() {
  // Run once at startup, then every 24 hours
  cleanExpiredTokens();
  return setInterval(cleanExpiredTokens, INTERVAL_MS);
}

module.exports = { cleanExpiredTokens, startTokenCleanup };
