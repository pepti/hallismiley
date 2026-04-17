// Integration tests for the Google OAuth routes.
// We stub Arctic's Google client (ESM-loaded via dynamic import) and the global
// fetch used for the userinfo call so the tests never touch accounts.google.com.

const request = require('supertest');

// GOOGLE_* vars must exist *before* the controller checks isConfigured().
process.env.GOOGLE_CLIENT_ID     = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI  = 'http://localhost:3000/auth/google/callback';

// jest.mock() hoists above module code, so factory-referenced state must be
// named with the `mock` prefix to escape Jest's out-of-scope variable guard.
const mockState = {
  authURL: new URL('https://accounts.google.com/o/oauth2/v2/auth?stub=1'),
  validateAuthorizationCode: async () => ({ accessToken: 'fake-access-token' }),
};

jest.mock('../../server/auth/google', () => {
  const real = jest.requireActual('../../server/auth/google');
  return {
    ...real,
    isConfigured: () => true,
    loadArctic: async () => ({
      client: {
        createAuthorizationURL: () => mockState.authURL,
        validateAuthorizationCode: (...args) => mockState.validateAuthorizationCode(...args),
      },
      generateState:        () => 'test-state-123',
      generateCodeVerifier: () => 'test-verifier-abc',
    }),
  };
});

// Stub global fetch for the userinfo call.
const mockUserinfo = {
  response: {
    sub: 'google-sub-1',
    email: 'newgoogleuser@example.com',
    email_verified: true,
    name: 'New Google User',
  },
  ok: true,
};
global.fetch = jest.fn(async () => ({
  ok: mockUserinfo.ok,
  status: mockUserinfo.ok ? 200 : 500,
  json: async () => mockUserinfo.response,
}));

const app = require('../../server/app');
const db  = require('../../server/config/database');
const { cleanTables, createTestAdminUser } = require('../helpers');

beforeEach(async () => {
  await cleanTables();
  await createTestAdminUser();

  // Reset mock state to the default "happy path" before each test.
  mockState.validateAuthorizationCode = async () => ({ accessToken: 'fake-access-token' });
  mockUserinfo.response = {
    sub: 'google-sub-1',
    email: 'newgoogleuser@example.com',
    email_verified: true,
    name: 'New Google User',
  };
  mockUserinfo.ok = true;
  global.fetch.mockClear();
});

afterAll(async () => {
  await db.pool.end();
});

// ── GET /auth/google ──────────────────────────────────────────────────────────

describe('GET /auth/google', () => {
  test('302 redirects to Google and sets state + code_verifier cookies', async () => {
    const res = await request(app).get('/auth/google');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);

    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('google_oauth_state='))).toBe(true);
    expect(cookies.some(c => c.startsWith('google_oauth_code_verifier='))).toBe(true);

    // Cookies must be HttpOnly and SameSite=Lax.
    const stateCookie = cookies.find(c => c.startsWith('google_oauth_state='));
    expect(stateCookie).toMatch(/HttpOnly/i);
    expect(stateCookie).toMatch(/SameSite=Lax/i);
  });
});

// ── GET /auth/google/callback ────────────────────────────────────────────────

describe('GET /auth/google/callback', () => {
  // Simulate the state/verifier cookies that the /start endpoint sets.
  const cookieHeader =
    'google_oauth_state=test-state-123; google_oauth_code_verifier=test-verifier-abc';

  test('state mismatch redirects with invalid_state error', async () => {
    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=WRONG')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/login?error=invalid_state');
  });

  test('missing state cookie redirects with invalid_state error', async () => {
    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123');
    // no Cookie header
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/login?error=invalid_state');
  });

  test('unverified Google email redirects with google_profile_invalid', async () => {
    mockUserinfo.response.email_verified = false;

    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/login?error=google_profile_invalid');
  });

  test('new user — creates row with google_id, verified, and auto-username', async () => {
    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/?welcome=google');

    // Sets an auth_session cookie (Lucia).
    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('auth_session='))).toBe(true);

    // DB row exists and is verified.
    const { rows } = await db.query(
      `SELECT username, email, email_verified, google_id, oauth_provider
         FROM users WHERE email = $1`,
      ['newgoogleuser@example.com'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].google_id).toBe('google-sub-1');
    expect(rows[0].oauth_provider).toBe('google');
    expect(rows[0].email_verified).toBe(true);
    expect(rows[0].username).toMatch(/^[a-z0-9]+$/);
    expect(rows[0].username.length).toBeGreaterThanOrEqual(3);
  });

  test('returning user (existing google_id) logs in without creating a new row', async () => {
    // Insert a user already linked to google-sub-1.
    await db.query(
      `INSERT INTO users (email, username, role, email_verified, google_id, oauth_provider, avatar)
       VALUES ('existing@example.com', 'existinguser', 'user', TRUE,
               'google-sub-1', 'google', 'avatar-01.svg')`,
    );
    const countBefore = (await db.query(`SELECT COUNT(*)::int AS n FROM users`)).rows[0].n;

    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/?welcome=google');

    const countAfter = (await db.query(`SELECT COUNT(*)::int AS n FROM users`)).rows[0].n;
    expect(countAfter).toBe(countBefore);
  });

  test('auto-link: existing VERIFIED password user with same email gets google_id attached', async () => {
    // Insert a verified password user — legitimate owner of the email, so
    // Google sign-in can safely attach to the same account.
    await db.query(
      `INSERT INTO users (email, username, password_hash, role, email_verified, avatar)
       VALUES ('linkme@example.com', 'linkuser', 'fakehash', 'user', TRUE, 'avatar-01.svg')`,
    );

    mockUserinfo.response.email = 'linkme@example.com';
    mockUserinfo.response.sub   = 'google-sub-link';

    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/?welcome=google');

    const { rows } = await db.query(
      `SELECT google_id, oauth_provider, email_verified
         FROM users WHERE email = 'linkme@example.com'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].google_id).toBe('google-sub-link');
    expect(rows[0].oauth_provider).toBe('google');
    expect(rows[0].email_verified).toBe(true);
  });

  test('auto-link rejected when existing password account is UNVERIFIED', async () => {
    // Simulates the pre-registration attack: attacker signs up with victim's
    // email but never verifies. The victim then signs in via Google — we must
    // NOT silently attach google_id to the unverified account.
    await db.query(
      `INSERT INTO users (email, username, password_hash, role, email_verified, avatar)
       VALUES ('unverified@example.com', 'unverifieduser', 'attackerhash', 'user', FALSE, 'avatar-01.svg')`,
    );

    mockUserinfo.response.email = 'unverified@example.com';
    mockUserinfo.response.sub   = 'google-sub-attack';

    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/login?error=email_unverified_conflict');

    // Ensure google_id was NOT written and no session was issued.
    const { rows } = await db.query(
      `SELECT google_id, oauth_provider, email_verified
         FROM users WHERE email = 'unverified@example.com'`,
    );
    expect(rows[0].google_id).toBeNull();
    expect(rows[0].oauth_provider).toBeNull();
    expect(rows[0].email_verified).toBe(false);
    expect(res.headers['set-cookie']?.some((c) => c.startsWith('auth_session='))).not.toBe(true);
  });

  test('disabled account redirects with account_disabled', async () => {
    await db.query(
      `INSERT INTO users (email, username, role, email_verified, google_id, oauth_provider, avatar,
                          disabled, disabled_at)
       VALUES ('disabled@example.com', 'disableduser', 'user', TRUE,
               'google-sub-1', 'google', 'avatar-01.svg',
               TRUE, NOW())`,
    );

    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/login?error=account_disabled');
    // No auth_session cookie should be set.
    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('auth_session='))).toBe(false);
  });

  test('token-exchange failure redirects with oauth_failed', async () => {
    mockState.validateAuthorizationCode = async () => { throw new Error('bad code'); };

    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/login?error=oauth_failed');
  });

  test('userinfo 5xx redirects with oauth_failed', async () => {
    // Token exchange succeeds but the userinfo fetch returns 500. Should
    // bail cleanly instead of 500-ing the whole request.
    mockUserinfo.ok = false;
    mockUserinfo.response = { error: 'internal' };

    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/login?error=oauth_failed');
  });
});
