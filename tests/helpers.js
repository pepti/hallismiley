const db     = require('../server/config/database');
const { lucia } = require('../server/auth/lucia');
const { Scrypt } = require('oslo/password');

const scrypt = new Scrypt();

/**
 * Inserts the test admin user (hashing ADMIN_PASSWORD with oslo Scrypt).
 * Uses ON CONFLICT so it is safe to call multiple times per test run.
 * Returns the user's id.
 */
async function createTestAdminUser() {
  const hash = await scrypt.hash(process.env.ADMIN_PASSWORD);
  const { rows } = await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ('test-admin-id', 'admin@test.com', $1, $2, 'admin', TRUE)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           failed_login_attempts = 0,
           locked_until = NULL,
           disabled = FALSE,
           email_verified = TRUE
     RETURNING id`,
    [process.env.ADMIN_USERNAME, hash]
  );
  return rows[0].id;
}

/**
 * Inserts a test moderator user. Returns the user's id.
 */
async function createTestModeratorUser() {
  const hash = await scrypt.hash(process.env.ADMIN_PASSWORD);
  const { rows } = await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ('test-mod-id', 'moderator@test.com', 'testmoderator', $1, 'moderator', TRUE)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           failed_login_attempts = 0,
           locked_until = NULL,
           disabled = FALSE,
           email_verified = TRUE
     RETURNING id`,
    [hash]
  );
  return rows[0].id;
}

/**
 * Inserts a test regular user. Returns the user's id.
 */
async function createTestRegularUser() {
  const hash = await scrypt.hash(process.env.ADMIN_PASSWORD);
  const { rows } = await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ('test-user-id', 'user@test.com', 'testuser', $1, 'user', TRUE)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           failed_login_attempts = 0,
           locked_until = NULL,
           disabled = FALSE,
           email_verified = TRUE
     RETURNING id`,
    [hash]
  );
  return rows[0].id;
}

/**
 * Creates the test admin user and a Lucia session for it.
 * Returns the full `Cookie: auth_session=<id>` string ready for supertest.
 */
async function getTestSessionCookie(userId) {
  const id = userId ?? await createTestAdminUser();
  const session = await lucia.createSession(id, {
    ip_address: '127.0.0.1',
    user_agent:  'test-agent',
  });
  const cookie = lucia.createSessionCookie(session.id);
  return `${cookie.name}=${cookie.value}`;
}

/** Truncate all mutable tables and reset sequences between tests. */
async function cleanTables() {
  await db.query(
    'TRUNCATE TABLE news_media, party_photos, party_guestbook, party_rsvps, news_articles, projects, user_sessions, users RESTART IDENTITY CASCADE'
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
