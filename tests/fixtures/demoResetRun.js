'use strict';
// Child-process half of tests/integration/demoReset.test.js. The reset renames
// and rebuilds the public schema, so it runs in its own process against a
// database the test created for it (DATABASE_URL = …/demo_reset_<pid>_test,
// DEMO_DATABASE_NAME = the same) — never a Jest worker database. Prints one
// JSON line with what survived.
process.env.NODE_ENV = 'test';
process.env.DEMO_INSTANCE = 'true';
process.env.APP_ENV = 'demo';
process.env.DB_SSL = 'false';
process.env.DEMO_KEEP_ROLES = 'admin,demo_guest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../../server/config/database');
const { migrate } = require('../../server/scripts/migrate');
const demoReset = require('../../server/services/demoReset');

const T = { allowTestDatabase: true };
const q = async (sql, p) => (await db.query(sql, p)).rows;

async function snapshot() {
  return {
    users: await q('SELECT id, role, approved_by FROM users ORDER BY id'),
    roles: await q(`SELECT name, view_access FROM roles WHERE name = 'demo_guest'`),
    memberships: await q('SELECT user_id, role_name FROM user_roles ORDER BY user_id, role_name'),
    sessions: await q('SELECT id, user_id FROM user_sessions ORDER BY id'),
    probe: (await q(`SELECT 1 FROM app_settings WHERE key = 'demo.probe'`)).length,
    lastReset: (await q(`SELECT value FROM app_settings WHERE key = 'demo.last_reset'`))[0]?.value || null,
    prev: (await q(`SELECT 1 FROM pg_namespace WHERE nspname = 'demo_keep'`)).length,
    migrations: (await q('SELECT COUNT(*)::int AS n FROM schema_migrations'))[0].n,
  };
}

async function main() {
  // Upload roots: two outside the app (wiped), one inside it (refused).
  const upA = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-up-'));
  const upB = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-books-'));
  fs.mkdirSync(path.join(upA, 'products'));
  fs.writeFileSync(path.join(upA, 'products', 'x.jpg'), 'x');
  fs.writeFileSync(path.join(upB, 'receipt.pdf'), 'x');
  process.env.UPLOAD_ROOT = upA;
  process.env.BOOKS_UPLOAD_ROOT = upB;

  await migrate();
  const bootChecked = await demoReset.verifyDemoBoot(T);
  const first = await demoReset.seedIfFresh(T);

  // Before: a custom role; sellerA approves sellerB, and sellerA is UPDATED
  // afterwards so its tuple moves AFTER sellerB's (the order that broke a
  // row-by-row restore); a prospect in the custom role (with a session), an
  // expired prospect, a customer, a seller session, and some sample data.
  await db.query(`INSERT INTO roles (name, description, view_access) VALUES ('demo_guest', 'Prospect', '["dashboard"]'::jsonb)`);
  const user = (id, role, approvedBy = null, expires = null) => db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified, approved_by, expires_at)
     VALUES ($1, $1 || '@example.is', $1, 'x', $2, TRUE, $3, $4)`, [id, role, approvedBy, expires]);
  await user('customer1', 'user');
  await user('sellerA', 'admin', 'customer1');
  await user('sellerB', 'admin', 'sellerA');
  await db.query(`UPDATE users SET display_name = 'moved' WHERE id = 'sellerA'`);
  await user('prospect1', 'demo_guest', 'sellerB', new Date(Date.now() + 7 * 864e5));
  await user('prospectOld', 'demo_guest', 'sellerB', new Date(Date.now() - 864e5));
  await db.query(`INSERT INTO user_sessions (id, user_id, expires_at) VALUES
    ('sess-sellerB', 'sellerB', NOW() + interval '1 day'),
    ('sess-sellerB-old', 'sellerB', NOW() - interval '1 day'),
    ('sess-prospect1', 'prospect1', NOW() + interval '1 day')`);
  await db.query(`INSERT INTO app_settings (key, value) VALUES ('demo.probe', '1'::jsonb)`);
  const heapOrder = (await q(`SELECT id FROM users WHERE id IN ('sellerA','sellerB') ORDER BY ctid`)).map((r) => r.id);

  const summary = await demoReset.resetDemo({ trigger: 'admin', exit: false, ...T });
  const afterReset = await snapshot();
  const uploads = { a: fs.readdirSync(upA), b: fs.readdirSync(upB) };
  const cooldownRefusal = await demoReset.preflight({ trigger: 'admin', ...T }).then(() => null, (e) => e.message);

  // An interrupted reset: the accounts set aside, public dropped and rebuilt,
  // then the process died before the restore.
  await db.query(`INSERT INTO app_settings (key, value) VALUES ('demo.probe', '1'::jsonb)`);
  const c = await db.pool.connect();
  try { await demoReset.snapshotAccounts(c); } finally { c.release(); }
  await db.query('DROP SCHEMA public CASCADE');
  await db.query('CREATE SCHEMA public');
  await migrate();
  const preflightInterrupted = await demoReset.preflight({ trigger: 'nightly', ...T }).then(() => null, (e) => e.reason);
  const recovered = await demoReset.recoverInterruptedReset(T);
  const seededAfterRecovery = await demoReset.seedIfFresh(T);
  const afterRecovery = await snapshot();

  // An upload root inside the app is never wiped.
  process.env.UPLOAD_ROOT = path.join(__dirname, '..', '..', 'public', 'assets');
  process.env.BOOKS_UPLOAD_ROOT = '';
  const insideApp = demoReset.wipeUploadRoots();

  fs.rmSync(upA, { recursive: true, force: true });
  fs.rmSync(upB, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({
    bootChecked, first, heapOrder, summary, afterReset, uploads, cooldownRefusal,
    preflightInterrupted, recovered, seededAfterRecovery, afterRecovery, insideApp,
  }) + '\n');
}

main()
  .then(() => db.pool.end())
  .catch(async (err) => {
    process.stdout.write(JSON.stringify({ error: err.message, stack: err.stack }) + '\n');
    await db.pool.end().catch(() => {});
    process.exit(1);
  });
