// Integration tests for the Facebook OAuth routes.
// We stub Arctic's Facebook client (ESM-loaded via dynamic import) and the
// global fetch used for the Graph API /me call so the tests never touch
// facebook.com.

const request = require('supertest');

// FACEBOOK_* vars must exist *before* the controller checks isConfigured().
process.env.FACEBOOK_APP_ID       = 'test-app-id';
process.env.FACEBOOK_APP_SECRET   = 'test-app-secret';
process.env.FACEBOOK_REDIRECT_URI = 'http://localhost:3000/auth/facebook/callback';

// jest.mock() hoists above module code, so factory-referenced state must be
// named with the `mock` prefix to escape Jest's out-of-scope variable guard.
const mockState = {
  authURL: new URL('https://www.facebook.com/v16.0/dialog/oauth?stub=1'),
  validateAuthorizationCode: async () => ({ accessToken: 'fake-access-token' }),
};

jest.mock('../../server/auth/facebook', () => {
  const real = jest.requireActual('../../server/auth/facebook');
  return {
    ...real,
    isConfigured: () => true,
    loadArctic: async () => ({
      client: {
        createAuthorizationURL: () => mockState.authURL,
        validateAuthorizationCode: (...args) => mockState.validateAuthorizationCode(...args),
      },
      generateState: () => 'test-state-xyz',
    }),
  };
});

// Stub global fetch for the Graph API /me call. Facebook returns `id` (not
// `sub`) and does NOT include an `email_verified` flag.
const mockUserinfo = {
  response: {
    id: 'fb-id-1',
    email: 'newfbuser@example.com',
    name: 'New FB User',
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
    id: 'fb-id-1',
    email: 'newfbuser@example.com',
    name: 'New FB User',
  };
  mockUserinfo.ok = true;
  global.fetch.mockClear();
});

afterAll(async () => {
  await db.pool.end();
});

// ── GET /auth/facebook ────────────────────────────────────────────────────────

describe('GET /auth/facebook', () => {
  test('302 redirects to Facebook and sets only the state cookie', async () => {
    const res = await request(app).get('/auth/facebook');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/www\.facebook\.com\//);

    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('facebook_oauth_state='))).toBe(true);
    // Facebook flow has no PKCE — no code_verifier cookie should be set.
    expect(cookies.some(c => c.startsWith('facebook_oauth_code_verifier='))).toBe(false);

    // Cookies must be HttpOnly and SameSite=Lax.
    const stateCookie = cookies.find(c => c.startsWith('facebook_oauth_state='));
    expect(stateCookie).toMatch(/HttpOnly/i);
    expect(stateCookie).toMatch(/SameSite=Lax/i);
  });
});

// ── GET /auth/facebook/callback ──────────────────────────────────────────────

describe('GET /auth/facebook/callback', () => {
  // Simulate the state cookie that the /start endpoint sets.
  const cookieHeader = 'facebook_oauth_state=test-state-xyz';

  test('state mismatch redirects with invalid_state error', async () => {
    const res = await request(app)
      .get('/auth/facebook/callback?code=abc&state=WRONG')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/login?error=invalid_state');
  });

  test('missing state cookie redirects with invalid_state error', async () => {
    const res = await request(app)
      .get('/auth/facebook/callback?code=abc&state=test-state-xyz');
    // no Cookie header
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/login?error=invalid_state');
  });

  test('missing email redirects with facebook_profile_invalid', async () => {
    // Facebook can return a profile with no email if user declined the scope
    // or has no email on file.
    delete mockUserinfo.response.email;

    const res = await request(app)
      .get('/auth/facebook/callback?code=abc&state=test-state-xyz')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/login?error=facebook_profile_invalid');
  });

  test('new user — creates row with facebook_id, verified, and auto-username', async () => {
    const res = await request(app)
      .get('/auth/facebook/callback?code=abc&state=test-state-xyz')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/?welcome=facebook');

    // Sets an auth_session cookie (Lucia).
    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('auth_session='))).toBe(true);

    // DB row exists and is verified.
    const { rows } = await db.query(
      `SELECT username, email, email_verified, facebook_id, oauth_provider
         FROM users WHERE email = $1`,
      ['newfbuser@example.com'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].facebook_id).toBe('fb-id-1');
    expect(rows[0].oauth_provider).toBe('facebook');
    expect(rows[0].email_verified).toBe(true);
    expect(rows[0].username).toMatch(/^[a-z0-9]+$/);
    expect(rows[0].username.length).toBeGreaterThanOrEqual(3);
  });

  test('returning user (existing facebook_id) logs in without creating a new row', async () => {
    // Insert a user already linked to fb-id-1.
    await db.query(
      `INSERT INTO users (email, username, role, email_verified, facebook_id, oauth_provider, avatar)
       VALUES ('existing@example.com', 'existingfbuser', 'user', TRUE,
               'fb-id-1', 'facebook', 'avatar-01.svg')`,
    );
    const countBefore = (await db.query(`SELECT COUNT(*)::int AS n FROM users`)).rows[0].n;

    const res = await request(app)
      .get('/auth/facebook/callback?code=abc&state=test-state-xyz')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/?welcome=facebook');

    const countAfter = (await db.query(`SELECT COUNT(*)::int AS n FROM users`)).rows[0].n;
    expect(countAfter).toBe(countBefore);
  });

  test('auto-link: existing VERIFIED password user with same email gets facebook_id attached', async () => {
    // Verified password account — safe to attach Facebook to.
    await db.query(
      `INSERT INTO users (email, username, password_hash, role, email_verified, avatar)
       VALUES ('linkme@example.com', 'linkfbuser', 'fakehash', 'user', TRUE, 'avatar-01.svg')`,
    );

    mockUserinfo.response.email = 'linkme@example.com';
    mockUserinfo.response.id    = 'fb-id-link';

    const res = await request(app)
      .get('/auth/facebook/callback?code=abc&state=test-state-xyz')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/?welcome=facebook');

    const { rows } = await db.query(
      `SELECT facebook_id, oauth_provider, email_verified
         FROM users WHERE email = 'linkme@example.com'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].facebook_id).toBe('fb-id-link');
    expect(rows[0].oauth_provider).toBe('facebook');
    expect(rows[0].email_verified).toBe(true);
  });

  test('auto-link rejected when existing password account is UNVERIFIED', async () => {
    // Pre-registration attack: unverified account with the same email must
    // NOT be silently linked when the Facebook user arrives.
    await db.query(
      `INSERT INTO users (email, username, password_hash, role, email_verified, avatar)
       VALUES ('unverifiedfb@example.com', 'unverifiedfb', 'attackerhash', 'user', FALSE, 'avatar-01.svg')`,
    );

    mockUserinfo.response.email = 'unverifiedfb@example.com';
    mockUserinfo.response.id    = 'fb-id-attack';

    const res = await request(app)
      .get('/auth/facebook/callback?code=abc&state=test-state-xyz')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/login?error=email_unverified_conflict');

    const { rows } = await db.query(
      `SELECT facebook_id, oauth_provider, email_verified
         FROM users WHERE email = 'unverifiedfb@example.com'`,
    );
    expect(rows[0].facebook_id).toBeNull();
    expect(rows[0].oauth_provider).toBeNull();
    expect(rows[0].email_verified).toBe(false);
    expect(res.headers['set-cookie']?.some((c) => c.startsWith('auth_session='))).not.toBe(true);
  });

  test('disabled account redirects with account_disabled', async () => {
    await db.query(
      `INSERT INTO users (email, username, role, email_verified, facebook_id, oauth_provider, avatar,
                          disabled, disabled_at)
       VALUES ('disabled@example.com', 'disabledfbuser', 'user', TRUE,
               'fb-id-1', 'facebook', 'avatar-01.svg',
               TRUE, NOW())`,
    );

    const res = await request(app)
      .get('/auth/facebook/callback?code=abc&state=test-state-xyz')
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
      .get('/auth/facebook/callback?code=abc&state=test-state-xyz')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/#/login?error=oauth_failed');
  });
});
