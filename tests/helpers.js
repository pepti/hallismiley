const db     = require('../server/config/database');
const { lucia } = require('../server/auth/lucia');
const { Scrypt } = require('oslo/password');
const { generateIdFromEntropySize } = require('lucia/dist/crypto.js');

const scrypt = new Scrypt();

// 30 days — must match lucia's sessionExpiresIn default
const SESSION_EXPIRES_MS = 30 * 24 * 60 * 60 * 1000;

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
  const hash = await scrypt.hash(process.env.ADMIN_PASSWORD);
  const client = await db.pool.connect();
  try {
    return await upsertUserOn(client, {
      id:            'test-admin-id',
      email:         'admin@test.com',
      username:      process.env.ADMIN_USERNAME,
      password_hash: hash,
      role:          'admin',
    });
  } finally {
    client.release();
  }
}

/**
 * Inserts a test moderator user. Returns the user's id.
 */
async function createTestModeratorUser() {
  const hash = await scrypt.hash(process.env.ADMIN_PASSWORD);
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
  const hash = await scrypt.hash(process.env.ADMIN_PASSWORD);
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
    const id = userId ?? await upsertUserOn(client, {
      id:            'test-admin-id',
      email:         'admin@test.com',
      username:      process.env.ADMIN_USERNAME,
      password_hash: await scrypt.hash(process.env.ADMIN_PASSWORD),
      role:          'admin',
    });

    const sessionId = generateIdFromEntropySize(25);
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

/** Truncate all mutable tables and reset sequences between tests. */
async function cleanTables() {
  await db.query(
    'TRUNCATE TABLE news_media, party_photos, party_guestbook, party_rsvps, party_logistics_items, news_articles, projects, user_sessions, users RESTART IDENTITY CASCADE'
  );
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
  getTestSessionCookie,
  cleanTables,
  validProject,
  validArticle,
};
