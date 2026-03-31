// Creates (or updates) the initial admin user in the database.
// Run: node server/scripts/setup-admin.js <username> <email> <password>
// Requires DATABASE_URL in environment (or .env file).
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { Scrypt }  = require('oslo/password');
const { pool }    = require('../config/database');

const [username, email, password] = process.argv.slice(2);

if (!username || !email || !password) {
  console.error('Usage: node server/scripts/setup-admin.js <username> <email> <password>');
  process.exit(1);
}

async function main() {
  const scrypt = new Scrypt();
  const hash   = await scrypt.hash(password);

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO users (email, username, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (username) DO UPDATE
         SET email         = EXCLUDED.email,
             password_hash = EXCLUDED.password_hash,
             updated_at    = NOW()
       RETURNING id, username, email, role`,
      [email, username, hash]
    );
    const u = rows[0];
    console.log(`\nAdmin user ready:`);
    console.log(`  id:       ${u.id}`);
    console.log(`  username: ${u.username}`);
    console.log(`  email:    ${u.email}`);
    console.log(`  role:     ${u.role}\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('setup-admin failed:', err.message);
  process.exit(1);
});
