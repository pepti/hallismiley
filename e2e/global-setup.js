const { execSync } = require('child_process');
const { Pool }     = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');

// Provisions a deterministic, ISOLATED test database for the e2e suite:
// ensure the _test DB exists → migrate → admin → project fixture. Each step
// runs as its own child process with DATABASE_URL pinned to the isolated DB —
// until the 2026-08-22 harvest these steps inherited `.env` and wrote into
// the DEV database on every run (see e2e/lib/dbUrl.js for the full history).
//
// Run as the webServer COMMAND PREFIX (`node e2e/global-setup.js && node
// server/server.js` in playwright.config.js), NOT as Playwright's
// globalSetup: Playwright starts the webServer BEFORE globalSetup, so a
// globalSetup that creates the DB is too late — the server can't connect on a
// fresh machine or CI where the DB doesn't pre-exist. Running here guarantees
// the DB is ready before the server boots. (Ported from icelandicstore #197.)
module.exports = async function globalSetup() {
  const dbUrl = e2eDatabaseUrl();
  await ensureDatabase(dbUrl);

  const env  = { ...process.env, DATABASE_URL: dbUrl, NODE_ENV: 'test', DB_SSL: 'false' };
  const opts = { stdio: 'inherit', env };

  execSync('node server/scripts/migrate.js', opts);
  execSync('node server/scripts/setup-admin.js testadmin admin@e2e.test AdminPass123', opts);
  execSync('node server/scripts/seed-stofan-bakhus.js', opts);
};

// Standalone entrypoint (the webServer command prefix runs `node e2e/global-setup.js`).
if (require.main === module) {
  module.exports()
    .then(() => process.exit(0))
    .catch(err => { console.error('[e2e provision] failed:', err); process.exit(1); });
}

// Create the isolated DB if it does not exist yet (non-destructive — never
// drops; idempotent migrate/seed converge on re-run). Refuses any name not
// ending in _test as a safety guard against pointing at the dev DB.
async function ensureDatabase(dbUrl) {
  const name = new URL(dbUrl).pathname.replace(/^\//, '');
  if (!/_test$/.test(name)) {
    throw new Error(`Refusing to use DB "${name}" for e2e — name must end in _test.`);
  }
  const adminUrl = new URL(dbUrl);
  adminUrl.pathname = '/postgres';
  const pool = new Pool({ connectionString: adminUrl.toString(), ssl: false });
  try {
    const { rows } = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rows.length === 0) {
      await pool.query(`CREATE DATABASE "${name}"`);
      console.log(`[e2e] Created isolated test database "${name}".`);
    }
  } finally {
    await pool.end();
  }
}
