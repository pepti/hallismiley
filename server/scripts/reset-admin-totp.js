// BREAK-GLASS: clear an account's two-factor enrolment.
//
// For the admin who has lost BOTH the authenticator and every recovery code.
// Nothing in the running app can do this — the disable endpoint needs a signed-in
// session, and an admin who cannot pass the challenge cannot get one. So the way
// back in is database access, which is a different, stronger credential than
// anything the web app accepts (docs/ADMIN-2FA.md).
//
// What it does: removes the TOTP secret (both columns), the recovery codes and any
// login challenge in flight, and ends every session the account has. It does NOT
// touch the password or the role. At the next password sign-in the account is
// an admin who owes enrolment: it gets a session, is held out of every admin
// route (auth/mfaPolicy.js) and is walked through setting up a new authenticator.
//
// Run: node server/scripts/reset-admin-totp.js <username>
// Requires DATABASE_URL in environment (or .env file).
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });

const { pool } = require('../config/database');

const [username] = process.argv.slice(2);

if (!username) {
  console.error('Usage: node server/scripts/reset-admin-totp.js <username>');
  process.exit(1);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, username, role, totp_enabled FROM users WHERE LOWER(username) = LOWER($1) FOR UPDATE',
      [username]
    );
    const user = rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      console.error(`No user named "${username}".`);
      process.exitCode = 1;
      return;
    }

    await client.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [user.id]);
    await client.query('DELETE FROM mfa_challenges WHERE user_id = $1', [user.id]);
    const { rowCount: sessions } = await client.query('DELETE FROM user_sessions WHERE user_id = $1', [user.id]);
    await client.query(
      `UPDATE users SET totp_secret = NULL, totp_secret_enc = NULL, totp_enabled = FALSE,
                        totp_confirmed_at = NULL, totp_last_step = NULL
        WHERE id = $1`,
      [user.id]
    );
    await client.query('COMMIT');

    console.log(`\nTwo-factor reset for ${user.username} (${user.role}):`);
    console.log(`  was enabled:    ${user.totp_enabled ? 'yes' : 'no'}`);
    console.log(`  sessions ended: ${sessions}`);
    console.log('  The account must enrol a new authenticator at its next sign-in');
    console.log('  before any admin route is reachable.\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('reset-admin-totp failed:', err.message);
  process.exit(1);
});
