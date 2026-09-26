const { execSync } = require('child_process');
const { Pool }     = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const sweep = require('../tests/lib/testDbSweep');
const { ensureTestServer } = require('../tests/lib/testPg');
const { fileEnvValue } = require('../tests/workerDb');

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
  // The local test cluster may be down: with TEST_PG_DATA known and the
  // database on the TEST_PG_URL server, start it (tests/lib/testPg.js).
  const dataDir = process.env.TEST_PG_DATA || fileEnvValue('TEST_PG_DATA');
  if (dataDir && process.env.TEST_PG_URL && sameServer(dbUrl, process.env.TEST_PG_URL)) {
    await ensureTestServer(dbUrl, { dataDir, log: (m) => console.log(`[e2e] ${m}`) });
  }
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

function sameServer(a, b) {
  const x = new URL(a);
  const y = new URL(b);
  return x.hostname === y.hostname && (x.port || '5432') === (y.port || '5432');
}

// Create the isolated DB if it does not exist yet (non-destructive — never
// drops; idempotent migrate/seed converge on re-run). Refuses any name not
// ending in _test as a safety guard against pointing at the dev DB.
//
// Labels it on every run (tests/lib/testDbSweep.js): kind e2e, branch,
// worktree, pid, host, createdAt kept from the first run, lastUsedAt = now.
// The Jest sweep drops an e2e database only when its branch AND worktree are
// gone, or when lastUsedAt is 14 days old.
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
    let previous = null;
    if (rows.length === 0) {
      await pool.query(`CREATE DATABASE "${name}"`);
      console.log(`[e2e] Created isolated test database "${name}".`);
    } else {
      previous = await sweep.readLabel(pool, name);
    }
    const now = new Date().toISOString();
    const label = sweep.buildLabel('e2e', {
      pid: process.pid,
      createdAt: (previous && previous.createdAt) || now,
      lastUsedAt: now,
    });
    await sweep.labelDatabase(pool, name, label).catch((err) => {
      console.warn(`[e2e] could not label "${name}": ${err.message}`);
    });
  } finally {
    await pool.end();
  }
}
