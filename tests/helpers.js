const crypto    = require('crypto');
const db        = require('../server/config/database');
const EventLog  = require('../server/models/EventLog');
const { lucia } = require('../server/auth/lucia');
const UserRole  = require('../server/models/UserRole');
const ledgerService = require('../server/services/bookkeeping/ledgerService');
const { Scrypt } = require('oslo/password');

const scrypt = new Scrypt();

// The fixture password is a per-run constant (tests/env.js pins
// ADMIN_PASSWORD), but oslo pure-JS scrypt costs ~100-200ms per hash and
// the create*User helpers run in per-test beforeEach hooks — a big admin
// suite pays ~100+ identical hashes per run. Memoise by plaintext so each
// distinct password is hashed once per Jest worker (ice #224). Server-side
// hashing in the auth routes is untouched; only fixture setup takes the
// cached hash.
const passwordHashCache = new Map();
function getPasswordHash(password) {
  if (!passwordHashCache.has(password)) {
    passwordHashCache.set(password, scrypt.hash(password));
  }
  return passwordHashCache.get(password);
}

// Lucia validates sessions by primary-key lookup, not by format, so any
// unique opaque string works as a session id in tests. 30d expiry is just
// "far enough in the future that no test trips the expiry check."
const SESSION_EXPIRES_MS = 30 * 24 * 60 * 60 * 1000;

function generateSessionId() {
  return crypto.randomBytes(25).toString('hex');
}

// Centralised so the admin spec is defined once. Both createTestAdminUser
// and getTestSessionCookie's default-admin path read from this.
function adminUserSpec(password_hash) {
  return {
    id:            'test-admin-id',
    email:         'admin@test.com',
    username:      process.env.ADMIN_USERNAME,
    password_hash,
    role:          'admin',
  };
}

/**
 * Upsert a user row using a caller-provided client so it shares a connection
 * with any downstream insert (e.g. user_sessions). pool.query() picks a
 * different client each call; under load that client can race ahead of the
 * commit and see no user row yet — the FK on user_sessions.user_id then
 * fails. Sharing one client serialises the work and dodges the race.
 */
async function upsertUserOn(client, { id, email, username, password_hash, role }) {
  const { rows } = await client.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           failed_login_attempts = 0,
           locked_until = NULL,
           disabled = FALSE,
           email_verified = TRUE
     RETURNING id`,
    [id, email, username, password_hash, role]
  );
  return rows[0].id;
}

/**
 * Inserts the test admin user (hashing ADMIN_PASSWORD with oslo Scrypt).
 * Uses ON CONFLICT so it is safe to call multiple times per test run.
 * Returns the user's id.
 */
async function createTestAdminUser() {
  const hash = await getPasswordHash(process.env.ADMIN_PASSWORD);
  const client = await db.pool.connect();
  try {
    return await upsertUserOn(client, adminUserSpec(hash));
  } finally {
    client.release();
  }
}

/**
 * Inserts a test moderator user. Returns the user's id.
 */
async function createTestModeratorUser() {
  const hash = await getPasswordHash(process.env.ADMIN_PASSWORD);
  const client = await db.pool.connect();
  try {
    return await upsertUserOn(client, {
      id:            'test-mod-id',
      email:         'moderator@test.com',
      username:      'testmoderator',
      password_hash: hash,
      role:          'moderator',
    });
  } finally {
    client.release();
  }
}

/**
 * Inserts a test regular user. Returns the user's id.
 */
async function createTestRegularUser() {
  const hash = await getPasswordHash(process.env.ADMIN_PASSWORD);
  const client = await db.pool.connect();
  try {
    return await upsertUserOn(client, {
      id:            'test-user-id',
      email:         'user@test.com',
      username:      'testuser',
      password_hash: hash,
      role:          'user',
    });
  } finally {
    client.release();
  }
}

/**
 * Inserts a passwordless party guest awaiting approval (approval_status =
 * 'pending', party_access = FALSE, no password). The DB generates the id so
 * callers can create several distinct guests in one test by overriding the
 * email + username. Returns { id, email, username, display_name }.
 */
async function createTestPendingGuest(overrides = {}) {
  const spec = {
    email:        'pending@test.com',
    username:     'pendingguest',
    display_name: 'Pending Guest',
    ...overrides,
  };
  const { rows } = await db.query(
    `INSERT INTO users
       (email, username, password_hash, role, email_verified,
        party_access, approval_status, display_name, requested_at)
     VALUES ($1, $2, NULL, 'user', FALSE, FALSE, 'pending', $3, NOW())
     RETURNING id`,
    [spec.email, spec.username, spec.display_name]
  );
  return { id: rows[0].id, ...spec };
}

/**
 * Creates the test admin user (if no userId is given) and a session row for
 * the resulting user. Returns the full `Cookie: auth_session=<id>` string
 * ready for supertest.
 *
 * Why we don't call lucia.createSession here:
 *   lucia.createSession runs the user_sessions INSERT through the shared pool
 *   — a different client than the one that just inserted the user. On a
 *   slow / contended pool that client can run the FK check before the
 *   user-insert commit is visible, surfacing user_sessions_user_id_fkey.
 *   Doing the user-upsert + session-insert on the same pooled client makes
 *   the FK check trivially succeed (same backend, same snapshot order).
 */
async function getTestSessionCookie(userId) {
  const client = await db.pool.connect();
  try {
    const id = userId ?? await upsertUserOn(
      client,
      adminUserSpec(await getPasswordHash(process.env.ADMIN_PASSWORD))
    );

    const sessionId = generateSessionId();
    const expiresAt = new Date(Date.now() + SESSION_EXPIRES_MS);
    await client.query(
      `INSERT INTO user_sessions (id, user_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, id, expiresAt, '127.0.0.1', 'test-agent']
    );

    const cookie = lucia.createSessionCookie(sessionId);
    return `${cookie.name}=${cookie.value}`;
  } finally {
    client.release();
  }
}

const CLEAN_ROOTS = [
  'page_views', 'analytics_events', 'news_media', 'party_photos', 'party_guestbook', 'party_rsvps',
  'party_logistics_items', 'party_logistics_categories', 'party_plan_tasks', 'party_plan_phases',
  'party_todo_subtasks', 'party_todos', 'news_articles', 'projects', 'user_sessions', 'users',
];

// cleanTables() empties the tables with DELETE, not TRUNCATE (measured
// 2026-09-26, docs/TESTING.md → "TRUNCATE vs DELETE"): a full run took 347 s
// with TRUNCATE and 49 s with DELETE on an fsync=on cluster, 389 s and 49 s on
// the fsync=off test cluster. Every TRUNCATE gives each table of the users FK
// closure (and its indexes, toast and sequences) new files; the old ones are
// unlinked at the next checkpoint, and every DROP DATABASE
// forces one — minutes of it on Windows, fsync or not.
//
// This is the DELETE equivalent of `TRUNCATE <roots> RESTART IDENTITY
// CASCADE`: every table an FK chain leads back to a root (what CASCADE
// empties), deleted with FK triggers off (session_replication_role = replica,
// so order and cycles do not matter and ordinary triggers do not fire — as
// with TRUNCATE), then every sequence those tables own reset to its start
// (what RESTART IDENTITY does). The plan is read from the catalog once per
// suite. TEST_CLEAN_MODE=truncate restores the old statement; so does a test
// role that may not set session_replication_role (not a superuser).
let deletePlan = null;
let deleteRefused = false;
async function deleteCleanTables() {
  if (!deletePlan) {
    const { rows: rels } = await db.query(
      `WITH RECURSIVE t(oid) AS (
         SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema() AND c.relname = ANY($1::text[])
         UNION
         SELECT con.conrelid FROM pg_constraint con JOIN t ON con.confrelid = t.oid
          WHERE con.contype = 'f'
       )
       SELECT t.oid, t.oid::regclass::text AS rel FROM t`,
      [CLEAN_ROOTS]
    );
    const { rows: seqs } = await db.query(
      `SELECT DISTINCT s.seqrelid::regclass::text AS seq, s.seqstart::text AS start
         FROM pg_sequence s
         JOIN pg_depend d ON d.objid = s.seqrelid AND d.classid = 'pg_class'::regclass
                         AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
        WHERE d.refobjid = ANY($1::oid[])`,
      [rels.map((r) => r.oid)]
    );
    deletePlan = { rels: rels.map((r) => r.rel), seqs };
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(deletePlan.rels.map((r) => `DELETE FROM ${r}`).join('; '));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '42501') { // insufficient_privilege on the SET
      deleteRefused = true;
      return false;
    }
    throw err;
  } finally {
    client.release();
  }
  if (deletePlan.seqs.length) {
    await db.query(
      `SELECT setval(x.seq::regclass, x.start::bigint, false)
         FROM unnest($1::text[], $2::text[]) AS x(seq, start)`,
      [deletePlan.seqs.map((s) => s.seq), deletePlan.seqs.map((s) => s.start)]
    );
  }
  return true;
}

/** Empty all mutable tables and reset sequences between tests. */
async function cleanTables() {
  // event_logs is emptied with the users closure (it references users); a
  // fire-and-forget EventLog.record() from the previous test (errorHandler,
  // eventLogOn5xx) can still be inserting, and the clean + that INSERT
  // deadlock. Let the writes land first (icelandicstore #254).
  await EventLog.flush();
  const useDelete = process.env.TEST_CLEAN_MODE !== 'truncate' && !deleteRefused;
  if (!useDelete || !(await deleteCleanTables())) {
    await db.query(
      `TRUNCATE TABLE ${CLEAN_ROOTS.join(', ')} RESTART IDENTITY CASCADE`
    );
  }
  // party_logistics_categories is listed above only for clarity — it would be
  // emptied regardless, because the clean (like TRUNCATE ... CASCADE) sweeps
  // every table with an FK to `users` (created_by), ON DELETE SET NULL or not. Its
  // three built-in rows are seeded by migration 068, not written by any test,
  // so without this re-seed every category-aware endpoint would 400 after the
  // first cleanTables() call. Mirrors the 068 seed exactly.
  await db.query(
    `INSERT INTO party_logistics_categories (key, label, icon, sort_order, is_builtin)
     VALUES ('food', NULL, '🍽️', 1, TRUE),
            ('drinks', NULL, '🥤', 2, TRUE),
            ('other', NULL, '📦', 3, TRUE)
     ON CONFLICT (key) DO NOTHING`
  );
  // party_plan_phases is swept by the same users CASCADE for the same reason;
  // re-seed migration 069's five built-ins or every plan endpoint 400s on an
  // unknown phase after the first cleanTables() call.
  await db.query(
    `INSERT INTO party_plan_phases (key, label, icon, sort_order, is_builtin)
     VALUES ('pickup',   NULL, '🚗', 1, TRUE),
            ('setup',    NULL, '🔨', 2, TRUE),
            ('during',   NULL, '🎉', 3, TRUE),
            ('teardown', NULL, '🧹', 4, TRUE),
            ('other',    NULL, '📦', 5, TRUE)
     ON CONFLICT (key) DO NOTHING`
  );
  // Every bookkeeping table FKs to users (created_by / filed_by / locked_by), so
  // the same CASCADE sweeps the whole of migration 072's reference data: the chart
  // of accounts, the document counters, and the fiscal periods. None of it is
  // written by tests — it is seeded by the migration — so it has to be restored
  // here or the first cleanTables() call leaves the books unable to post anything
  // ("Unknown ledger account code", "Document counter is missing"), and a
  // period-lock test silently passes because the period row it locked is gone.
  await reseedBooksReferenceData();

  // The chart of accounts is cached per process by ledgerService; the re-seed
  // above hands out fresh row ids, so a stale cache would point at accounts that
  // no longer exist.
  ledgerService.invalidateAccountCache();

  // user_roles is cleared via the users CASCADE above; also drop the in-process
  // per-user role cache so a fresh DB starts with a fresh cache (tests mutate
  // users.role directly, bypassing the model's own invalidation).
  UserRole.invalidateAll();
}

/**
 * Restore the reference rows migration 072 seeds. Re-runs the migration's own
 * statements rather than a hand-copied duplicate, so the two can never drift —
 * the failure mode of a copy would be tests passing against a chart of accounts
 * that no longer matches production.
 */
async function reseedBooksReferenceData() {
  const { migrations } = require('../server/config/schema');
  const books = migrations.find(m => m.name === '072_bookkeeping');
  if (!books) return;
  const seeds = books.statements.filter(s => /^\s*INSERT INTO/i.test(s));
  for (const stmt of seeds) {
    await db.query(stmt);
  }
}

/** A minimal valid project body for POST requests. */
function validProject(overrides = {}) {
  return {
    title:       'Test Project',
    description: 'A test project description for integration tests.',
    category:    'tech',
    year:        2024,
    tools_used:  ['Node.js', 'PostgreSQL'],
    featured:    false,
    ...overrides,
  };
}

/** A minimal valid news article body for POST /api/v1/news requests. */
function validArticle(overrides = {}) {
  return {
    title:    'Test Article',
    summary:  'A short summary of the test article.',
    body:     'The full body content of the test article.',
    category: 'news',
    published: false,
    ...overrides,
  };
}

module.exports = {
  createTestAdminUser,
  createTestModeratorUser,
  createTestRegularUser,
  createTestPendingGuest,
  getTestSessionCookie,
  cleanTables,
  reseedBooksReferenceData,
  validProject,
  validArticle,
};
