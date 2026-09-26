'use strict';
// The demo instance's reset (R2b, D-020): every night at DEMO_RESET_HOUR_UTC
// and on an admin's request, the sample data is thrown away and seeded again.
//
// HOW. The books are append-only by design (gapless invoice numbers, posted
// journals, triggers that refuse hand edits), so a reset cannot delete rows.
// It rebuilds instead:
//   1. SNAPSHOT: the kept accounts are copied, as JSON, into one table in a
//      schema of their own (demo_keep.demo_keep_snapshot) and committed —
//      before anything is dropped;
//   2. `public` is dropped and recreated empty, and the WHOLE migration chain
//      runs on it — exactly what a first boot does, and what the boot smoke
//      test proves on every release;
//   3. RESTORE: one INSERT … SELECT FROM jsonb_populate_recordset per table,
//      in one transaction (a foreign key is checked per statement, so the
//      order the rows come back in does not matter);
//   4. the product's seed (server/demo/seed.js, product-owned) fills it;
//   5. the snapshot is dropped and the upload folders emptied — only now.
// Why a JSON snapshot and not a renamed `public`: several migrations ask
// information_schema whether a column exists without naming the schema, so a
// renamed copy of the old tables makes them skip work and then fail (found
// building this: 045_shop_sections). One table of JSON looks like nothing.
// A failure after step 1 keeps the snapshot, keeps the site answering 503,
// alerts and exits; the next boot's recoverInterruptedReset() restores from it
// and seeds. Nothing a failed reset held is lost.
//
// WHAT SURVIVES. The users holding a role in DEMO_KEEP_ROLES (default `admin`;
// rekstrarkerfid's demo sets `admin,kynning` — sellers and prospect logins),
// unless their login has expired (users.expires_at), with their role
// memberships and recovery codes; the live sessions of kept users whose login
// does not expire; and every role definition. Everything else is sample data.
//
// SAFETY. A reset destroys a database, so it refuses unless ALL hold
// (assertDemoEnvironment — also checked at BOOT, where a failure stops the
// process, so a demo flag set on the wrong stack is a failed deploy, not a
// silently de-indexed site that sends no email):
//   - DEMO_INSTANCE=true (config/demoInstance.js);
//   - APP_ENV is exactly `demo` (config/appEnv.js — an unset APP_ENV reads
//     as production there, and so fails here);
//   - DEMO_DATABASE_NAME is set and equals the connected database's name;
//   - that name carries "demo" as a word;
//   - it does not end in `_test`, unless the caller passes allowTestDatabase
//     (only the reset test's child process, on a database it created).

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../logger');
const { appEnv } = require('../config/appEnv');
const { isDemoInstance, nextResetAt } = require('../config/demoInstance');

const RESET_LOCK_KEY = 7_421_026_926; // fixed; distinct from migrate.js's key
const DEMO_DB_NAME = /(^|[_-])demo([_-]|$)/i;
const KEEP_SCHEMA = 'demo_keep';
const KEEP_TABLE = 'demo_keep.demo_keep_snapshot';
const ADMIN_COOLDOWN_MS = 15 * 60 * 1000;

// What a snapshot holds, in restore order. `where` runs at SNAPSHOT time over
// public.<table>: $1 = the kept user ids, $2 = those whose login never expires.
const PLAN = [
  // A role the migrations just (re)created keeps its migrated definition, so a
  // reset returns the system roles to a known state; a custom role (the
  // product's prospect role) comes back as saved — its seed may re-assert it.
  { table: 'roles',               where: 'TRUE',                           conflict: '(name) DO NOTHING' },
  { table: 'users',               where: 'id = ANY($1::text[])',           conflict: 'DO NOTHING' },
  { table: 'user_roles',          where: 'user_id = ANY($1::text[])',      conflict: 'DO NOTHING', restoreWhere: 'role_name IN (SELECT name FROM public.roles)' },
  { table: 'user_recovery_codes', where: 'user_id = ANY($1::text[])',      conflict: 'DO NOTHING' },
  { table: 'user_sessions',       where: 'user_id = ANY($1::text[]) AND user_id = ANY($2::text[]) AND expires_at > NOW()', conflict: 'DO NOTHING' },
];

let resetting = false;
let timer = null;

class DemoResetRefused extends Error {
  constructor(message, { status = 409, reason = 'refused' } = {}) {
    super(message);
    this.name = 'DemoResetRefused';
    this.status = status;
    this.reason = reason;
  }
}

const isResetting = () => resetting;

function keepRoles() {
  const raw = process.env.DEMO_KEEP_ROLES;
  const list = (raw == null || raw.trim() === '' ? 'admin' : raw).split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set(list)];
}

async function assertDemoEnvironment(client, { allowTestDatabase = false } = {}) {
  if (!isDemoInstance()) throw new DemoResetRefused('not a demo instance (DEMO_INSTANCE is not true)');
  if (appEnv() !== 'demo') throw new DemoResetRefused(`APP_ENV must be "demo" on a demo instance (it is "${appEnv()}")`);
  const pinned = String(process.env.DEMO_DATABASE_NAME || '').trim();
  if (!pinned) throw new DemoResetRefused('DEMO_DATABASE_NAME is not set');
  const { rows } = await client.query('SELECT current_database() AS name');
  const name = rows[0].name;
  if (name !== pinned) throw new DemoResetRefused(`connected to "${name}", but DEMO_DATABASE_NAME is "${pinned}"`);
  if (!DEMO_DB_NAME.test(name)) throw new DemoResetRefused(`database "${name}" is not a demo database (its name must carry "demo")`);
  if (/_test$/.test(name) && !allowTestDatabase) throw new DemoResetRefused(`database "${name}" is a test database`);
  return name;
}

async function schemaExists(client, schema) {
  const { rows } = await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema]);
  return rows.length > 0;
}

async function publicTable(client, table) {
  const { rows } = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${table}`]);
  return rows[0].ok;
}

async function publicColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]);
  return new Set(rows.map((r) => r.column_name));
}

// Columns of public.<table> that reference public.users(id).
async function userRefColumns(client, table) {
  const { rows } = await client.query(
    `SELECT a.attname AS col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.contype = 'f' AND c.conrelid = $1::regclass AND c.confrelid = 'public.users'::regclass`,
    [`public.${table}`]);
  return new Set(rows.map((r) => r.col));
}

// ── 1. Snapshot the kept accounts (committed before anything is dropped) ──
async function snapshotAccounts(client) {
  const roles = keepRoles();
  const cols = await publicColumns(client, 'users');
  const notExpired = cols.has('expires_at') ? '(u.expires_at IS NULL OR u.expires_at > NOW())' : 'TRUE';
  const never = cols.has('expires_at') ? 'u.expires_at IS NULL' : 'TRUE';
  const hasRoles = await publicTable(client, 'user_roles');
  await client.query('BEGIN');
  try {
    const { rows } = await client.query(
      `SELECT u.id, (${never}) AS permanent FROM public.users u
        WHERE ${notExpired}
          AND (u.role = ANY($1::text[])
               ${hasRoles ? 'OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id AND ur.role_name = ANY($1::text[]))' : ''})`,
      [roles]);
    const kept = rows.map((r) => r.id);
    const permanent = rows.filter((r) => r.permanent).map((r) => r.id);
    await client.query(`CREATE SCHEMA ${KEEP_SCHEMA}`);
    await client.query(`CREATE TABLE ${KEEP_TABLE} (tbl TEXT PRIMARY KEY, data JSONB NOT NULL)`);
    await client.query(`INSERT INTO ${KEEP_TABLE} (tbl, data) VALUES ('_kept', $1::jsonb)`, [JSON.stringify(kept)]);
    for (const step of PLAN) {
      if (!(await publicTable(client, step.table))) continue;
      const params = step.where.includes('$2') ? [kept, permanent] : step.where.includes('$1') ? [kept] : [];
      await client.query(
        `INSERT INTO ${KEEP_TABLE} (tbl, data)
         SELECT $${params.length + 1}::text, COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
           FROM public.${client.escapeIdentifier(step.table)} t WHERE ${step.where}`,
        [...params, step.table]);
    }
    await client.query('COMMIT');
    return { kept: kept.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

// ── 3. Restore from the snapshot, one statement per table, one transaction ─
async function restoreFromSnapshot(client) {
  const q = (s) => client.escapeIdentifier(s);
  const { rows: keptRow } = await client.query(`SELECT data FROM ${KEEP_TABLE} WHERE tbl = '_kept'`);
  const kept = keptRow[0] ? keptRow[0].data : [];
  const counts = {};
  await client.query('BEGIN');
  try {
    for (const step of PLAN) {
      if (!(await publicTable(client, step.table))) continue;
      const { rows: present } = await client.query(`SELECT 1 FROM ${KEEP_TABLE} WHERE tbl = $1`, [step.table]);
      if (!present.length) continue;
      // Only the columns both the snapshot and the new table have.
      const { rows: keyRows } = await client.query(
        `SELECT DISTINCT k FROM ${KEEP_TABLE} s, jsonb_array_elements(s.data) e, jsonb_object_keys(e) k WHERE s.tbl = $1`,
        [step.table]);
      const have = new Set(keyRows.map((r) => r.k));
      const cols = [...(await publicColumns(client, step.table))].filter((c) => have.has(c));
      if (!cols.length) { counts[step.table] = 0; continue; }
      const refs = await userRefColumns(client, step.table);
      const select = cols.map((c) => (refs.has(c) && c !== 'user_id'
        ? `CASE WHEN r.${q(c)} = ANY($2::text[]) THEN r.${q(c)} END`
        : `r.${q(c)}`));
      const { rowCount } = await client.query(
        `INSERT INTO public.${q(step.table)} (${cols.map(q).join(', ')})
         SELECT ${select.join(', ')}
           FROM jsonb_populate_recordset(NULL::public.${q(step.table)}, (SELECT data FROM ${KEEP_TABLE} WHERE tbl = $1)) r
          ${step.restoreWhere ? `WHERE ${step.restoreWhere}` : ''}
         ON CONFLICT ${step.conflict}`,
        select.some((s) => s.includes('$2')) ? [step.table, kept] : [step.table]);
      counts[step.table] = rowCount;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
  return { keptUsers: kept.length, counts };
}

// The product's seed. server/demo/seed.js is PRODUCT-OWNED: the engine ships
// a stub that seeds nothing; a product replaces it (rekstrarkerfid: the
// Kaffibrennslan Glóð business). Required lazily so a test can swap it.
async function runProductSeed() {
  const seedPath = require.resolve('../demo/seed');
  delete require.cache[seedPath];
  const { seed } = require(seedPath);
  return seed({ db, logger });
}

async function recordReset(client, trigger) {
  const at = new Date().toISOString();
  await client.query(
    `INSERT INTO app_settings (key, value) VALUES ('demo.last_reset', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ at, trigger })]);
  return at;
}

// Empty the upload folders: uploads are demo data too, and the public ones are
// reachable by URL. Only a root set explicitly by env, absolute, not a
// filesystem root and not inside the app itself (in development UPLOAD_ROOT
// falls back to public/assets — that must never be touched).
function wipeUploadRoots() {
  const appDir = path.resolve(__dirname, '..', '..');
  const inside = (p) => p === appDir || p.startsWith(appDir + path.sep);
  const out = {};
  for (const key of ['UPLOAD_ROOT', 'BOOKS_UPLOAD_ROOT']) {
    const raw = process.env[key];
    if (!raw) { out[key] = 'unset'; continue; }
    const root = path.resolve(raw);
    if (path.parse(root).root === root || inside(root)) {
      out[key] = 'refused';
      logger.warn({ key, root }, '[demoReset] upload root not wiped (a filesystem root or inside the app)');
      continue;
    }
    let n = 0;
    try {
      for (const entry of fs.readdirSync(root)) { fs.rmSync(path.join(root, entry), { recursive: true, force: true }); n += 1; }
      out[key] = n;
    } catch (err) {
      out[key] = 'error';
      logger.error({ err, key }, '[demoReset] could not empty an upload root');
    }
  }
  return out;
}

function failHard(err, trigger) {
  logger.fatal({ err, trigger }, `[demoReset] reset failed after the accounts were set aside in ${KEEP_TABLE} — the site stays down until the next boot restores them`);
  try {
    require('../observability/alerts').alert('critical', 'Demo reset failed',
      { trigger, error: err.message, recovery: `the next boot restores the accounts from ${KEEP_TABLE}` }).catch(() => {});
  } catch { /* alerts are best effort */ }
}

async function refuseIfInterrupted(client) {
  if (await schemaExists(client, KEEP_SCHEMA)) {
    throw new DemoResetRefused(`an interrupted reset left schema "${KEEP_SCHEMA}" — restart the site to recover it first`, { reason: 'interrupted' });
  }
}

/**
 * Checks a reset would be allowed, without starting one — the route answers
 * 202 only after this passes. Refusals are DemoResetRefused (409; 429 for the
 * admin cooldown).
 */
async function preflight({ trigger = 'admin', allowTestDatabase = false } = {}) {
  if (resetting) throw new DemoResetRefused('a demo reset is already running', { reason: 'busy' });
  const client = await db.pool.connect();
  try {
    await assertDemoEnvironment(client, { allowTestDatabase });
    await refuseIfInterrupted(client);
    if (trigger === 'admin') {
      const { rows } = await client.query(`SELECT value FROM app_settings WHERE key = 'demo.last_reset'`);
      const last = rows[0] && rows[0].value;
      if (last && last.trigger === 'admin' && Date.now() - new Date(last.at).getTime() < ADMIN_COOLDOWN_MS) {
        throw new DemoResetRefused('the demo data was reset less than 15 minutes ago', { status: 429, reason: 'cooldown' });
      }
    }
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [RESET_LOCK_KEY]);
    if (!rows[0].ok) throw new DemoResetRefused('a demo reset is already running (another instance holds the lock)', { reason: 'busy' });
    await client.query('SELECT pg_advisory_unlock($1)', [RESET_LOCK_KEY]);
  } finally {
    client.release();
  }
}

/**
 * Reset the demo data. Resolves with a summary; rejects with DemoResetRefused
 * when a check fails (nothing changed). A failure AFTER the accounts were set
 * aside alerts and — unless options.exit is false — exits the process.
 *   options.exit (default true in a server, false under NODE_ENV=test):
 *     exit afterwards so the platform starts a clean container.
 *   options.trigger: 'nightly' | 'admin' | 'test' — for the log and the cooldown.
 *   options.allowTestDatabase: tests only (see the header).
 */
async function resetDemo({ trigger = 'admin', exit = process.env.NODE_ENV !== 'test', allowTestDatabase = false } = {}) {
  if (resetting) throw new DemoResetRefused('a demo reset is already running', { reason: 'busy' });
  const client = await db.pool.connect();
  let locked = false;
  let setAside = false;
  let done = false;
  const t0 = Date.now();
  try {
    const dbName = await assertDemoEnvironment(client, { allowTestDatabase });
    await refuseIfInterrupted(client);
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [RESET_LOCK_KEY]);
    if (!rows[0].ok) throw new DemoResetRefused('a demo reset is already running (another instance holds the lock)', { reason: 'busy' });
    locked = true;
    // From here the site answers 503 (app.js); a refused reset changed nothing.
    resetting = true;
    await client.query('SET statement_timeout = 0');
    logger.warn({ trigger, db: dbName, keep: keepRoles() }, '[demoReset] resetting the demo data');

    await snapshotAccounts(client);
    setAside = true;
    // One transaction: a connection lost between the two must never leave a
    // database without `public` (the next boot's migrate() could not start).
    await client.query('BEGIN');
    try {
      await client.query('DROP SCHEMA public CASCADE');
      await client.query('CREATE SCHEMA public');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
    const { migrate } = require('../scripts/migrate');
    await migrate();
    const restored = await restoreFromSnapshot(client);
    const seeded = await runProductSeed();
    const at = await recordReset(client, trigger);
    await client.query(`DROP SCHEMA ${KEEP_SCHEMA} CASCADE`);
    const uploads = wipeUploadRoots();
    done = true;
    const summary = { at, trigger, ...restored, seeded, uploads, ms: Date.now() - t0 };
    logger.warn(summary, '[demoReset] demo data reset');
    if (exit) {
      logger.warn('[demoReset] exiting so the platform starts a clean container');
      setTimeout(() => process.exit(0), 500).unref();
    }
    return summary;
  } catch (err) {
    if (setAside && !done) {
      failHard(err, trigger);
      if (exit) setTimeout(() => process.exit(1), 500).unref();
    }
    throw err;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [RESET_LOCK_KEY]).catch(() => {});
    await client.query('RESET statement_timeout').catch(() => {});
    client.release();
    // A reset that ends in an exit keeps answering 503 until the process is
    // gone: its caches were built over a schema that no longer exists.
    if (!exit || !setAside) resetting = false;
  }
}

/**
 * BOOT, before migrations: the demo checks. Resolves false when this is not a
 * demo instance; rejects (server.js exits) when the flag is on but the
 * environment is not a demo — a misplaced flag must fail the deploy.
 */
async function verifyDemoBoot({ allowTestDatabase = false } = {}) {
  if (!isDemoInstance()) return false;
  const client = await db.pool.connect();
  try {
    await assertDemoEnvironment(client, { allowTestDatabase });
    if (await schemaExists(client, KEEP_SCHEMA)) await client.query('CREATE SCHEMA IF NOT EXISTS public');
  } finally { client.release(); }
  return true;
}

/**
 * BOOT, after migrations: a reset interrupted after the accounts were set
 * aside left the snapshot. Restore from it (idempotent), then drop it.
 * Resolves with the restore summary, or null when there was nothing to do.
 */
// Both boot steps below take the reset lock: a second process booting while a
// reset runs (an overlapped restart, a scale-out, an image swap near the
// nightly hour) must not consume the snapshot under it. Held → skip.
async function withResetLock(client, what, fn) {
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [RESET_LOCK_KEY]);
  if (!rows[0].ok) { logger.warn(`[demoReset] ${what} skipped: a reset holds the lock`); return null; }
  try { return await fn(); } finally { await client.query('SELECT pg_advisory_unlock($1)', [RESET_LOCK_KEY]).catch(() => {}); }
}

async function recoverInterruptedReset({ allowTestDatabase = false } = {}) {
  if (!isDemoInstance()) return null;
  const client = await db.pool.connect();
  try {
    await assertDemoEnvironment(client, { allowTestDatabase });
    return await withResetLock(client, 'boot recovery', async () => {
      if (!(await schemaExists(client, KEEP_SCHEMA))) return null;
      const restored = await restoreFromSnapshot(client);
      await client.query(`DROP SCHEMA ${KEEP_SCHEMA} CASCADE`);
      logger.warn(restored, '[demoReset] recovered the accounts of an interrupted reset');
      return restored;
    });
  } finally { client.release(); }
}

// First boot of a demo instance (or the boot after a recovery): a database
// with no demo.last_reset gets the product's seed without a rebuild.
async function seedIfFresh({ allowTestDatabase = false } = {}) {
  if (!isDemoInstance()) return null;
  const client = await db.pool.connect();
  try {
    await assertDemoEnvironment(client, { allowTestDatabase });
    return await withResetLock(client, 'first-boot seed', async () => {
      // An unrecovered snapshot means the accounts are not back yet: seeding
      // now would hide that. Recovery must succeed first.
      if (await schemaExists(client, KEEP_SCHEMA)) return null;
      const { rows } = await client.query(`SELECT 1 FROM app_settings WHERE key = 'demo.last_reset'`);
      if (rows.length) return null;
      const seeded = await runProductSeed();
      await recordReset(client, 'boot');
      logger.warn({ seeded }, '[demoReset] fresh demo database seeded');
      return seeded;
    });
  } finally { client.release(); }
}

async function lastReset() {
  const { rows } = await db.query(`SELECT value FROM app_settings WHERE key = 'demo.last_reset'`);
  return rows[0] ? rows[0].value : null;
}

// The nightly timer: a self-rescheduling setTimeout to the next reset hour,
// unref'd so it never keeps a stopping process alive.
function startDemoScheduler() {
  if (!isDemoInstance() || timer) return null;
  const arm = () => {
    const ms = Math.max(1000, nextResetAt().getTime() - Date.now());
    timer = setTimeout(async () => {
      timer = null;
      try { await resetDemo({ trigger: 'nightly' }); } catch (err) { logger.error({ err }, '[demoReset] nightly reset failed'); }
      arm();
    }, ms);
    timer.unref();
  };
  arm();
  logger.info({ next: nextResetAt().toISOString() }, '[demoReset] nightly demo reset armed');
  return timer;
}

module.exports = {
  resetDemo, preflight, verifyDemoBoot, recoverInterruptedReset, seedIfFresh, lastReset, startDemoScheduler,
  snapshotAccounts, isResetting, keepRoles, wipeUploadRoots, DemoResetRefused, DEMO_DB_NAME, KEEP_SCHEMA,
};
