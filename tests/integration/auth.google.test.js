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

  test('persists a safe returnTo as an HttpOnly cookie', async () => {
    const res = await request(app).get('/auth/google?returnTo=%2Fis%2Fparty');

    expect(res.status).toBe(302);
    const cookies = res.headers['set-cookie'] ?? [];
    const rt = cookies.find(c => c.startsWith('google_oauth_return_to='));
    expect(rt).toBeDefined();
    expect(rt).toMatch(/HttpOnly/i);
    expect(rt).toMatch(/SameSite=Lax/i);
    expect(rt).toMatch(/google_oauth_return_to=%2Fis%2Fparty/);
  });

  test('drops an unsafe returnTo (open redirect) silently', async () => {
    const res = await request(app).get('/auth/google?returnTo=https%3A%2F%2Fevil.com');

    expect(res.status).toBe(302);
    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('google_oauth_return_to='))).toBe(false);
  });

  test('drops a protocol-relative returnTo silently', async () => {
    const res = await request(app).get('/auth/google?returnTo=%2F%2Fevil.com');

    expect(res.status).toBe(302);
    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('google_oauth_return_to='))).toBe(false);
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
    expect(res.headers.location).toBe('/en/#/?error=invalid_state');
  });

  test('missing state cookie redirects with invalid_state error', async () => {
    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123');
    // no Cookie header
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/en/#/?error=invalid_state');
  });

  test('unverified Google email redirects with google_profile_invalid', async () => {
    mockUserinfo.response.email_verified = false;

    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/en/#/?error=google_profile_invalid');
  });

  test('new user — creates row with google_id, verified, and auto-username', async () => {
    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/en/');

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

  test('Icelandic profile name produces a username with Icelandic letters intact', async () => {
    // Override the userinfo response for this test only — beforeEach resets it.
    mockUserinfo.response = {
      sub: 'google-sub-icelandic',
      email: 'jon@example.is',
      email_verified: true,
      name: 'Jón Þórsson',
    };

    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/en/');

    const { rows } = await db.query(
      `SELECT username FROM users WHERE email = $1`,
      ['jon@example.is'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe('jónþórsson');
    // Stored username must satisfy the signup validator's USERNAME_RE
    // so subsequent profile updates can re-submit it without 400ing.
    expect(rows[0].username).toMatch(/^[a-zA-Z0-9_áéíóúýðþæöÁÉÍÓÚÝÐÞÆÖ]{3,40}$/);
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
    expect(res.headers.location).toBe('/en/');

    const countAfter = (await db.query(`SELECT COUNT(*)::int AS n FROM users`)).rows[0].n;
    expect(countAfter).toBe(countBefore);
  });

  test('auto-link: existing password user with same email gets google_id attached', async () => {
    // Insert a password-only user with email matching what Google will return.
    await db.query(
      `INSERT INTO users (email, username, password_hash, role, email_verified, avatar)
       VALUES ('linkme@example.com', 'linkuser', 'fakehash', 'user', FALSE, 'avatar-01.svg')`,
    );

    mockUserinfo.response.email = 'linkme@example.com';
    mockUserinfo.response.sub   = 'google-sub-link';

    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/en/');

    const { rows } = await db.query(
      `SELECT google_id, oauth_provider, email_verified
         FROM users WHERE email = 'linkme@example.com'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].google_id).toBe('google-sub-link');
    expect(rows[0].oauth_provider).toBe('google');
    expect(rows[0].email_verified).toBe(true);
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
    expect(res.headers.location).toBe('/en/#/?error=account_disabled');
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
    expect(res.headers.location).toBe('/en/#/?error=oauth_failed');
  });

  test('redirects to the returnTo cookie when present and clears it', async () => {
    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', `${cookieHeader}; google_oauth_return_to=%2Fis%2Fparty`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/is/party');

    // The returnTo cookie should have been cleared on the response.
    const cookies = res.headers['set-cookie'] ?? [];
    const cleared = cookies.find(c => c.startsWith('google_oauth_return_to='));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  // The /auth/google entry-point only persists a returnTo cookie if
  // isSafeReturnTo() accepts it (see line 91-117 tests). But the cookie is
  // HttpOnly + SameSite=Lax, not signed — an attacker who can write cookies
  // (XSS in a sibling subdomain, an MITM with a CA mistake, a future Set-Cookie
  // bug, an adjacent app sharing the same parent domain) could still place a
  // hostile value there. The callback's defense is to re-run isSafeReturnTo()
  // before honoring the cookie. These cases pin that the callback rejects
  // every attack vector PR #33's validator added — without them, a refactor
  // that drops the re-validation (e.g. "we already validated on the way in,
  // we can trust the cookie") would compile, lint, and pass every other
  // existing test.
  //
  // Each vector tests a specific shape we have seen in the wild:
  //   - https://evil.com                : classic open redirect via absolute URL
  //   - //evil.com/x                    : protocol-relative URL
  //   - /\\evil.com                     : backslash-prefixed (some browsers parse as host)
  //   - %5c%5cevil.com                  : URL-encoded backslashes
  //   - javascript:alert(1)             : javascript: scheme (XSS via redirect)
  //   - /admin\\..\\..\\evil.com        : mixed backslash path traversal
  test.each([
    ['absolute URL',          'https%3A%2F%2Fevil.com'],
    ['protocol-relative',     '%2F%2Fevil.com%2Fx'],
    ['backslash-prefixed',    '%2F%5Cevil.com'],
    ['url-encoded backslash', '%5C%5Cevil.com'],
    ['javascript scheme',     'javascript%3Aalert(1)'],
    ['data scheme',           'data%3Atext%2Fhtml%2C%3Cscript%3Ealert(1)%3C%2Fscript%3E'],
  ])('ignores tampered returnTo cookie — %s', async (_label, encodedReturnTo) => {
    const res = await request(app)
      .get('/auth/google/callback?code=abc&state=test-state-123')
      .set('Cookie', `${cookieHeader}; google_oauth_return_to=${encodedReturnTo}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/en/');
  });
});
