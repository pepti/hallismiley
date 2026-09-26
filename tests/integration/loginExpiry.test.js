// Time-limited logins (login-expiry-2026-09-26, migration 114, roadmap R2b).
//
// users.expires_at: NULL = never; once it has passed, EVERY sign-in path
// refuses the account with the stable reason `account_expired` — but only
// after the credential itself checked out, so a wrong password on an expired
// account is answered exactly like any wrong password — and a live session of
// such an account stops working on its next request. The Google/Facebook
// callbacks are covered in auth.google.test.js / auth.facebook.test.js (they
// need their providers mocked); everything else is here.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const totp    = require('../../server/utils/totp');
const { hashToken } = require('../../server/auth/tokens');
const { ownerMayUseMcp } = require('../../server/mcp/owner');
const { isExpired, parseExpiresAt } = require('../../server/auth/accountExpiry');
const {
  cleanTables,
  createTestAdminUser,
  createTestRegularUser,
  getTestSessionCookie,
} = require('../helpers');
const { t } = require('../../server/i18n');
// Expected strings in the visitor-default locale (engine tests never pin one).
const { tx, OTHER_LOCALE, PUBLIC_DEFAULT_LOCALE } = require('../lib/locale');

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = process.env.ADMIN_PASSWORD; // the fixture users' password

let adminId, adminCookie, userId;

const setExpiry = (id, at) =>
  db.query('UPDATE users SET expires_at = $1 WHERE id = $2', [at, id]);
const login = (username, password = PASSWORD) =>
  request(app).post('/auth/login').send({ username, password });
const past   = () => new Date(Date.now() - 60 * 1000);
const future = (days = 7) => new Date(Date.now() + days * DAY);

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE mfa_challenges, user_recovery_codes, staff_audit_log RESTART IDENTITY CASCADE');
  adminId     = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  userId      = await createTestRegularUser(); // username 'testuser'
});

// ── The predicate + the parser ──────────────────────────────────────────────

describe('accountExpiry helpers', () => {
  test('isExpired: null/absent never expires; past expired; future not', () => {
    expect(isExpired({ expires_at: null })).toBe(false);
    expect(isExpired({})).toBe(false);
    expect(isExpired({ expires_at: past() })).toBe(true);
    expect(isExpired({ expires_at: future() })).toBe(false);
    expect(isExpired({ expires_at: 'not a date' })).toBe(true); // fails closed
  });

  test('parseExpiresAt: null clears, date-only is the end of that day UTC, past/garbage refused', () => {
    expect(parseExpiresAt(null)).toEqual({ ok: true, value: null });
    expect(parseExpiresAt('')).toEqual({ ok: true, value: null });
    const now = Date.parse('2026-09-26T12:00:00Z');
    expect(parseExpiresAt('2026-10-03', now).value.toISOString()).toBe('2026-10-03T23:59:59.999Z');
    expect(parseExpiresAt('2026-09-26', now).ok).toBe(true); // end of today is still ahead
    expect(parseExpiresAt('2026-09-25', now)).toEqual({ ok: false, messageKey: 'errors.admin.expiresAtPast' });
    expect(parseExpiresAt('2026-10-03T10:00:00Z', now).ok).toBe(true);
    expect(parseExpiresAt('next tuesday', now).ok).toBe(false);
    expect(parseExpiresAt(20261003, now).ok).toBe(false);
    expect(parseExpiresAt('9999-01-01', now).ok).toBe(false); // beyond the 10-year cap
  });
});

// ── Password sign-in ────────────────────────────────────────────────────────

describe('POST /auth/login with a time-limited login', () => {
  test('an expired account with the RIGHT password is refused: 403 account_expired, no session', async () => {
    await setExpiry(userId, past());
    const res = await login('testuser');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: tx('errors.auth.accountExpired'),
      code: 403,
      reason: 'account_expired',
    });
    expect((res.headers['set-cookie'] || []).some(c => c.startsWith('auth_session=') && !/auth_session=;/.test(c))).toBe(false);
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM user_sessions WHERE user_id = $1', [userId]);
    expect(rows[0].n).toBe(0);
  });

  test('the refusal is translated for the request locale', async () => {
    await setExpiry(userId, past());
    const res = await login('testuser').set('X-Locale', OTHER_LOCALE);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('account_expired');
    expect(res.body.error).toBe(t(OTHER_LOCALE, 'errors.auth.accountExpired'));
  });

  test('an expired account with a WRONG password gets the ordinary invalid-credentials answer', async () => {
    await setExpiry(userId, past());
    const expired = await login('testuser', 'wrong-password');

    // The same wrong password against a live account: the two must be
    // indistinguishable, or the refusal tells a guesser the account exists.
    await setExpiry(userId, null);
    await db.query('UPDATE users SET failed_login_attempts = 0 WHERE id = $1', [userId]);
    const live = await login('testuser', 'wrong-password');

    expect(expired.status).toBe(401);
    expect(expired.body).toEqual(live.body);
    expect(expired.body.reason).toBeUndefined();
    expect(JSON.stringify(expired.body)).not.toMatch(/expired|útrunn/i);
  });

  test('a login that has NOT expired yet signs in normally', async () => {
    await setExpiry(userId, future(3));
    const res = await login('testuser');
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('testuser');
    expect(res.headers['set-cookie'].join()).toMatch(/auth_session=[^;]+/);
  });

  test('a login with no expiry (NULL) is untouched', async () => {
    const res = await login('testuser');
    expect(res.status).toBe(200);
  });
});

// ── The 2FA step ────────────────────────────────────────────────────────────

describe('POST /auth/login/totp when the login expires between the two steps', () => {
  test('a correct code for an account that expired meanwhile is refused with account_expired', async () => {
    const secret = totp.generateSecret();
    await db.query(
      `UPDATE users SET totp_secret = $1, totp_enabled = TRUE, totp_confirmed_at = NOW(), totp_last_step = NULL
        WHERE id = $2`,
      [secret, adminId]
    );
    const first = await login(process.env.ADMIN_USERNAME);
    expect(first.status).toBe(200);
    expect(first.body.mfaRequired).toBe(true);

    await setExpiry(adminId, past());
    const res = await request(app).post('/auth/login/totp')
      .send({ challengeId: first.body.challengeId, code: totp.generateCode(secret) });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('account_expired');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

// ── The magic sign-in link ──────────────────────────────────────────────────

describe('POST /auth/party-magic-login with a time-limited login', () => {
  async function guestWithLink() {
    const { rows } = await db.query(
      `INSERT INTO users (email, username, role, email_verified, party_access, approval_status, magic_login_token_hash)
       VALUES ('magic@test.com', 'magicguest', 'user', TRUE, TRUE, 'approved', $1) RETURNING id`,
      [hashToken('magic-token-expiry')]
    );
    return rows[0].id;
  }

  test('a valid link for an expired account is refused: 403 account_expired', async () => {
    const guestId = await guestWithLink();
    await setExpiry(guestId, past());
    const res = await request(app).post('/auth/party-magic-login').send({ token: 'magic-token-expiry' });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('account_expired');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('an unknown link is still the plain invalid-link answer (no expiry leak)', async () => {
    const res = await request(app).post('/auth/party-magic-login').send({ token: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBeUndefined();
  });

  test('a valid link for a not-yet-expired account signs in', async () => {
    const guestId = await guestWithLink();
    await setExpiry(guestId, future(1));
    const res = await request(app).post('/auth/party-magic-login').send({ token: 'magic-token-expiry' });
    expect(res.status).toBe(200);
  });
});

// ── A live session dies once the login expires ──────────────────────────────

describe('a live session of a login that expires', () => {
  test('works before, is refused after (401 account_expired), and every session row is gone', async () => {
    const cookie  = await getTestSessionCookie(userId);
    const cookie2 = await getTestSessionCookie(userId); // a second device
    await setExpiry(userId, future(1));

    const before = await request(app).get('/api/v1/users/me').set('Cookie', cookie);
    expect(before.status).toBe(200);

    await setExpiry(userId, past());
    const after = await request(app).get('/api/v1/users/me').set('Cookie', cookie);
    expect(after.status).toBe(401);
    expect(after.body.reason).toBe('account_expired');
    expect(after.body.code).toBe(401);
    // The cookie is blanked like any dead session's.
    expect(after.headers['set-cookie'].join()).toMatch(/auth_session=;/);

    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM user_sessions WHERE user_id = $1', [userId]);
    expect(rows[0].n).toBe(0);

    // Extending the login does not revive the deleted sessions.
    await setExpiry(userId, future(7));
    const other = await request(app).get('/api/v1/users/me').set('Cookie', cookie2);
    expect(other.status).toBe(401);
    expect(other.body.reason).toBeUndefined();
  });

  test('GET /auth/session reads an expired login as signed out, with the reason', async () => {
    const cookie = await getTestSessionCookie(userId);
    await setExpiry(userId, past());
    const res = await request(app).get('/auth/session').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, reason: 'account_expired' });
  });

  test('an admin route refuses an expired admin session too', async () => {
    const otherAdmin = await db.query(
      `INSERT INTO users (email, username, role, email_verified) VALUES ('a2@test.com', 'admin2', 'admin', TRUE) RETURNING id`
    );
    const id = otherAdmin.rows[0].id;
    const cookie = await getTestSessionCookie(id);
    await setExpiry(id, past());
    const res = await request(app).get('/api/v1/admin/users').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('account_expired');
  });
});

// ── MCP owner check ─────────────────────────────────────────────────────────

describe('MCP: an expired owner may no longer use a token', () => {
  test('ownerMayUseMcp is false once the admin login has expired', async () => {
    expect(await ownerMayUseMcp(adminId)).toBe(true);
    await setExpiry(adminId, future(2));
    expect(await ownerMayUseMcp(adminId)).toBe(true);
    await setExpiry(adminId, past());
    expect(await ownerMayUseMcp(adminId)).toBe(false);
  });
});

// ── Admin users API ─────────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/users/:id/expiry', () => {
  const patch = (id, body, cookie = adminCookie) =>
    // X-Locale pins the answer's language: a signed-in admin's own
    // preferred_locale would otherwise win over the visitor default.
    request(app).patch(`/api/v1/admin/users/${id}/expiry`)
      .set('Cookie', cookie).set('X-Locale', PUBLIC_DEFAULT_LOCALE).send(body);

  test('sets a future expiry, lists it, and records it in the staff audit', async () => {
    const at = future(14).toISOString();
    const res = await patch(userId, { expires_at: at });
    expect(res.status).toBe(200);
    expect(new Date(res.body.expires_at).toISOString()).toBe(at);

    const list = await request(app).get('/api/v1/admin/users?q=testuser').set('Cookie', adminCookie);
    expect(list.status).toBe(200);
    const row = list.body.users.find(u => u.id === userId);
    expect(new Date(row.expires_at).toISOString()).toBe(at);

    const { rows } = await db.query(
      `SELECT action, actor_id, summary FROM staff_audit_log WHERE entity_type = 'user' AND entity_id = $1`, [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'user.expiry_set', actor_id: adminId });
    expect(rows[0].summary.expires_at).toBe(at);
  });

  test('a bare date means the end of that day (UTC)', async () => {
    const d = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10);
    const res = await patch(userId, { expires_at: d });
    expect(res.status).toBe(200);
    expect(new Date(res.body.expires_at).toISOString()).toBe(`${d}T23:59:59.999Z`);
  });

  test('null clears it (audited as cleared)', async () => {
    await setExpiry(userId, future(3));
    const res = await patch(userId, { expires_at: null });
    expect(res.status).toBe(200);
    expect(res.body.expires_at).toBeNull();
    const { rows } = await db.query(`SELECT action FROM staff_audit_log WHERE entity_id = $1`, [userId]);
    expect(rows.map(r => r.action)).toEqual(['user.expiry_cleared']);
  });

  test('clearing revives an expired login for a fresh sign-in', async () => {
    await setExpiry(userId, past());
    expect((await login('testuser')).status).toBe(403);
    expect((await patch(userId, { expires_at: null })).status).toBe(200);
    expect((await login('testuser')).status).toBe(200);
  });

  test('a past date is refused — 400', async () => {
    const res = await patch(userId, { expires_at: new Date(Date.now() - DAY).toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(tx('errors.admin.expiresAtPast'));
    const { rows } = await db.query('SELECT expires_at FROM users WHERE id = $1', [userId]);
    expect(rows[0].expires_at).toBeNull();
  });

  test('garbage and a missing field are refused — 400', async () => {
    expect((await patch(userId, { expires_at: 'soon' })).status).toBe(400);
    expect((await patch(userId, { expires_at: 7 })).status).toBe(400);
    expect((await patch(userId, {})).status).toBe(400);
  });

  test('an admin cannot time-limit their own account — 400', async () => {
    const res = await patch(adminId, { expires_at: future(7).toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(tx('errors.admin.cannotExpireSelf'));
    const { rows } = await db.query('SELECT expires_at FROM users WHERE id = $1', [adminId]);
    expect(rows[0].expires_at).toBeNull();
  });

  test('an unknown user — 404', async () => {
    const res = await patch('no-such-user', { expires_at: future(7).toISOString() });
    expect(res.status).toBe(404);
  });

  test('a non-admin cannot set an expiry — 403', async () => {
    const userCookie = await getTestSessionCookie(userId);
    const res = await patch(adminId, { expires_at: future(7).toISOString() }, userCookie);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/admin/customers with expires_at', () => {
  const create = (body) =>
    request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie).send(body);

  test('a name-only demo login is created with its expiry', async () => {
    const at = future(7).toISOString();
    const res = await create({ no_email: true, display_name: 'Prufa Viðskiptavinur', expires_at: at });
    expect(res.status).toBe(201);
    const { rows } = await db.query('SELECT expires_at FROM users WHERE username = $1', [res.body.username]);
    expect(rows[0].expires_at.toISOString()).toBe(at);
    // …and it signs in until then.
    expect((await login(res.body.username, res.body.password)).status).toBe(200);
  });

  test('an emailed invite carries its expiry too', async () => {
    const res = await create({ email: 'demo-prospect@example.com', expires_at: future(14).toISOString() });
    expect(res.status).toBe(201);
    const { rows } = await db.query('SELECT expires_at FROM users WHERE email = $1', ['demo-prospect@example.com']);
    expect(rows[0].expires_at).not.toBeNull();
  });

  test('without expires_at the login never expires', async () => {
    const res = await create({ email: 'forever@example.com' });
    expect(res.status).toBe(201);
    const { rows } = await db.query('SELECT expires_at FROM users WHERE email = $1', ['forever@example.com']);
    expect(rows[0].expires_at).toBeNull();
  });

  test('a past expiry is refused before anything is created — 400', async () => {
    const res = await create({ email: 'late@example.com', expires_at: past().toISOString() });
    expect(res.status).toBe(400);
    const { rows } = await db.query('SELECT 1 FROM users WHERE email = $1', ['late@example.com']);
    expect(rows).toHaveLength(0);
  });
});
