// Admin two-factor sign-in — the end-to-end contract.
//
// The unit tests (tests/unit/totp.test.js) prove the CODES are right against the
// RFC vectors. This file proves the FLOW is right, and most of it is about the
// ways two-factor auth is usually defeated rather than the happy path:
//
//   * a session must not exist until the second factor passes — the single
//     invariant everything else rests on;
//   * the challenge must not be grindable, replayable, or survive its own use;
//   * social sign-in must not walk around the whole thing;
//   * a half-finished enrolment must not authorise anything;
//   * and the one-admin business must be able to get back in with a recovery code.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const { Scrypt } = require('oslo/password');
const totp    = require('../../server/utils/totp');
const mfaService = require('../../server/services/mfaService');
const { cleanTables, getTestSessionCookie } = require('../helpers');

const scrypt = new Scrypt();
const PASSWORD = 'TotpTestPass123!';

let adminId, adminCookie, csrf;

// The CSRF token + cookie the state-changing enrolment endpoints require.
async function csrfHeaders(cookie) {
  const res = await request(app).get('/api/v1/csrf-token').set('Cookie', cookie);
  const token = res.body?.csrfToken || res.body?.token;
  const setCookie = res.headers['set-cookie'] || [];
  return {
    headers: { 'x-csrf-token': token },
    cookie: [cookie, ...setCookie.map((c) => c.split(';')[0])].join('; '),
  };
}

async function makeUser({ id, username, role }) {
  const hash = await scrypt.hash(PASSWORD);
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, approval_status, email_verified)
     VALUES ($1, $2, $3, $4, $5, 'approved', TRUE)
     ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [id, `${username}@test.com`, username, hash, role]
  );
  return id;
}

/** Put an account into the fully-enrolled state and hand back its secret. */
async function enrol(userId) {
  const secret = totp.generateSecret();
  await db.query(
    `UPDATE users SET totp_secret = $1, totp_enabled = TRUE, totp_confirmed_at = NOW(), totp_last_step = NULL
      WHERE id = $2`,
    [secret, userId]
  );
  return secret;
}

const login = (username, password = PASSWORD) =>
  request(app).post('/auth/login').send({ username, password });

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE mfa_challenges, user_recovery_codes RESTART IDENTITY CASCADE');
  adminId = await makeUser({ id: 'totp-admin', username: 'totpadmin', role: 'admin' });
  adminCookie = await getTestSessionCookie(adminId);
  csrf = await csrfHeaders(adminCookie);
});

describe('Login — accounts WITHOUT 2FA are unaffected', () => {
  test('an admin with no TOTP still signs in normally', async () => {
    const res = await login('totpadmin');
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('totpadmin');
    expect(res.body.mfaRequired).toBeUndefined();
    expect(res.headers['set-cookie'].join()).toMatch(/auth_session/);
  });

  test('a non-admin with TOTP set is NOT challenged (scope is admins only)', async () => {
    const userId = await makeUser({ id: 'totp-user', username: 'totpuser', role: 'user' });
    await enrol(userId);

    const res = await login('totpuser');
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBeUndefined();
  });
});

describe('Login — the session must not exist until the second factor passes', () => {
  let secret;
  beforeEach(async () => { secret = await enrol(adminId); });

  test('a correct password returns a challenge and NO session cookie', async () => {
    const res = await login('totpadmin');
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.challengeId).toEqual(expect.any(String));
    // The whole point: nothing that could authenticate a request came back.
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body.user).toBeUndefined();
  });

  test('the challenge id alone cannot reach an admin route', async () => {
    const res = await login('totpadmin');
    const probe = await request(app)
      .get('/api/v1/admin/shop/orders')
      .set('Cookie', `auth_session=${res.body.challengeId}`);
    expect(probe.status).toBe(401);
  });

  test('a wrong password never produces a challenge', async () => {
    const res = await login('totpadmin', 'wrong-password');
    expect(res.status).toBe(401);
    expect(res.body.challengeId).toBeUndefined();
    expect(res.body.mfaRequired).toBeUndefined();
  });

  test('a correct code completes the sign-in and issues the session', async () => {
    const { body } = await login('totpadmin');
    const res = await request(app)
      .post('/auth/login/totp')
      .send({ challengeId: body.challengeId, code: totp.generateCode(secret) });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('totpadmin');
    expect(res.body.usedRecoveryCode).toBe(false);
    // The SPA holds this payload until the next reload, and the profile 2FA
    // panel paints from it: without the flag an enrolled admin is shown the OFF
    // state and offered "Set up", which then 409s.
    expect(res.body.user.totp_enabled).toBe(true);
    expect(res.headers['set-cookie'].join()).toMatch(/auth_session/);
  });

  test('the issued session actually works on an admin route', async () => {
    const { body } = await login('totpadmin');
    const res = await request(app)
      .post('/auth/login/totp')
      .send({ challengeId: body.challengeId, code: totp.generateCode(secret) });

    const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
    const probe = await request(app).get('/api/v1/admin/shop/orders').set('Cookie', cookie);
    expect(probe.status).toBe(200);
  });
});

describe('Challenge — not grindable, not replayable, not reusable', () => {
  let secret;
  beforeEach(async () => { secret = await enrol(adminId); });

  test('a wrong code is refused and counts down the attempts', async () => {
    const { body } = await login('totpadmin');
    const res = await request(app)
      .post('/auth/login/totp')
      .send({ challengeId: body.challengeId, code: '000000' });

    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body.attemptsRemaining).toBe(mfaService.MAX_CHALLENGE_ATTEMPTS - 1);
  });

  test('the challenge is destroyed after too many wrong codes', async () => {
    const { body } = await login('totpadmin');
    for (let i = 0; i < mfaService.MAX_CHALLENGE_ATTEMPTS - 1; i++) {
      await request(app).post('/auth/login/totp').send({ challengeId: body.challengeId, code: '000000' });
    }
    const last = await request(app)
      .post('/auth/login/totp').send({ challengeId: body.challengeId, code: '000000' });
    expect(last.status).toBe(401);

    // Even the RIGHT code cannot rescue a spent challenge.
    const after = await request(app)
      .post('/auth/login/totp').send({ challengeId: body.challengeId, code: totp.generateCode(secret) });
    expect(after.status).toBe(401);
    expect(after.headers['set-cookie']).toBeUndefined();

    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM mfa_challenges WHERE id = $1', [body.challengeId]);
    expect(rows[0].n).toBe(0);
  });

  test('a challenge cannot be redeemed twice', async () => {
    const { body } = await login('totpadmin');
    const code = totp.generateCode(secret);
    const first = await request(app).post('/auth/login/totp').send({ challengeId: body.challengeId, code });
    expect(first.status).toBe(200);

    const second = await request(app).post('/auth/login/totp').send({ challengeId: body.challengeId, code });
    expect(second.status).toBe(401);
    expect(second.headers['set-cookie']).toBeUndefined();
  });

  test('the same code cannot be replayed on a NEW challenge in the same window', async () => {
    // Over-the-shoulder defence: within one 30s step the code is unchanged, so
    // without the spent-step guard a shouted code would open a second session.
    const first = await login('totpadmin');
    const code = totp.generateCode(secret);
    await request(app).post('/auth/login/totp').send({ challengeId: first.body.challengeId, code });

    const second = await login('totpadmin');
    const replay = await request(app)
      .post('/auth/login/totp').send({ challengeId: second.body.challengeId, code });
    expect(replay.status).toBe(401);
    expect(replay.headers['set-cookie']).toBeUndefined();
  });

  test('an expired challenge is refused', async () => {
    const { body } = await login('totpadmin');
    await db.query(`UPDATE mfa_challenges SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [body.challengeId]);

    const res = await request(app)
      .post('/auth/login/totp').send({ challengeId: body.challengeId, code: totp.generateCode(secret) });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('a forged challenge id is refused', async () => {
    for (const id of ['not-a-uuid', '00000000-0000-0000-0000-000000000000', '']) {
      const res = await request(app).post('/auth/login/totp').send({ challengeId: id, code: '123456' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  test('an account disabled between the two steps cannot complete sign-in', async () => {
    const { body } = await login('totpadmin');
    await db.query('UPDATE users SET disabled = TRUE WHERE id = $1', [adminId]);

    const res = await request(app)
      .post('/auth/login/totp').send({ challengeId: body.challengeId, code: totp.generateCode(secret) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('Enrolment', () => {
  test('setup then confirm switches 2FA on and returns recovery codes once', async () => {
    const setup = await request(app)
      .post('/auth/totp/setup').set('Cookie', csrf.cookie).set(csrf.headers).send({});
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toEqual(expect.any(String));
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\//);
    // The QR is how enrolment actually happens; without it people are back to
    // typing a 32-character key into a phone. The manual secret above stays as
    // the fallback for when scanning isn't possible.
    expect(setup.body.qr).toMatch(/^data:image\/svg\+xml;base64,/);

    // Until confirmed, the account is NOT protected — a secret on its own must
    // never gate anything, or a half-finished setup would lock the user out.
    const midway = await login('totpadmin');
    expect(midway.body.mfaRequired).toBeUndefined();

    const confirm = await request(app)
      .post('/auth/totp/confirm').set('Cookie', csrf.cookie).set(csrf.headers)
      .send({ code: totp.generateCode(setup.body.secret) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.enabled).toBe(true);
    expect(confirm.body.recoveryCodes).toHaveLength(mfaService.RECOVERY_CODE_COUNT);

    // Now it bites.
    const after = await login('totpadmin');
    expect(after.body.mfaRequired).toBe(true);
  });

  test('enrolment still works when QR generation fails', async () => {
    // The QR is a CONVENIENCE; losing it must not take enrolment down with it.
    // qrcode-generator signals an over-capacity payload by throwing a bare
    // string, so an unguarded call would reach the error middleware with no
    // .message and surface as an opaque 500 — on an endpoint that would have
    // worked fine via manual key entry.
    const qrUtil = require('../../server/utils/qr');
    const spy = jest.spyOn(qrUtil, 'svgDataUri').mockImplementation(() => { throw 'code length overflow.'; });
    try {
      const setup = await request(app)
        .post('/auth/totp/setup').set('Cookie', csrf.cookie).set(csrf.headers).send({});

      expect(setup.status).toBe(200);
      expect(setup.body.qr).toBeNull();                       // the UI's fallback branch
      expect(setup.body.secret).toEqual(expect.any(String));  // manual entry still possible

      // And the account can still be enrolled end to end without ever seeing a QR.
      const confirm = await request(app)
        .post('/auth/totp/confirm').set('Cookie', csrf.cookie).set(csrf.headers)
        .send({ code: totp.generateCode(setup.body.secret) });
      expect(confirm.status).toBe(200);
      expect(confirm.body.enabled).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test('confirm refuses a wrong code and leaves 2FA off', async () => {
    await request(app).post('/auth/totp/setup').set('Cookie', csrf.cookie).set(csrf.headers).send({});
    const confirm = await request(app)
      .post('/auth/totp/confirm').set('Cookie', csrf.cookie).set(csrf.headers).send({ code: '000000' });
    expect(confirm.status).toBe(400);

    const { rows } = await db.query('SELECT totp_enabled FROM users WHERE id = $1', [adminId]);
    expect(rows[0].totp_enabled).toBe(false);
  });

  test('recovery codes are stored hashed, never in plaintext', async () => {
    const setup = await request(app).post('/auth/totp/setup').set('Cookie', csrf.cookie).set(csrf.headers).send({});
    const confirm = await request(app)
      .post('/auth/totp/confirm').set('Cookie', csrf.cookie).set(csrf.headers)
      .send({ code: totp.generateCode(setup.body.secret) });

    const { rows } = await db.query('SELECT code_hash FROM user_recovery_codes WHERE user_id = $1', [adminId]);
    expect(rows).toHaveLength(mfaService.RECOVERY_CODE_COUNT);
    const stored = rows.map((r) => r.code_hash).join('|');
    for (const plain of confirm.body.recoveryCodes) {
      expect(stored).not.toContain(plain);
      expect(stored).not.toContain(mfaService.normaliseRecovery(plain));
    }
  });

  test('a non-admin cannot enrol into a flow that would never challenge them', async () => {
    const userId = await makeUser({ id: 'totp-user2', username: 'totpuser2', role: 'user' });
    const cookie = await getTestSessionCookie(userId);
    const c = await csrfHeaders(cookie);
    const res = await request(app).post('/auth/totp/setup').set('Cookie', c.cookie).set(c.headers).send({});
    expect(res.status).toBe(403);
  });

  test('disabling requires the password', async () => {
    await enrol(adminId);
    const bad = await request(app)
      .post('/auth/totp/disable').set('Cookie', csrf.cookie).set(csrf.headers).send({ password: 'wrong' });
    expect(bad.status).toBe(401);

    const still = await db.query('SELECT totp_enabled FROM users WHERE id = $1', [adminId]);
    expect(still.rows[0].totp_enabled).toBe(true);

    const ok = await request(app)
      .post('/auth/totp/disable').set('Cookie', csrf.cookie).set(csrf.headers).send({ password: PASSWORD });
    expect(ok.status).toBe(200);

    const { rows } = await db.query('SELECT totp_enabled, totp_secret FROM users WHERE id = $1', [adminId]);
    expect(rows[0].totp_enabled).toBe(false);
    expect(rows[0].totp_secret).toBeNull();
  });
});

describe('Recovery codes — the way back in for a one-admin business', () => {
  let codes;
  beforeEach(async () => {
    const setup = await request(app).post('/auth/totp/setup').set('Cookie', csrf.cookie).set(csrf.headers).send({});
    const confirm = await request(app)
      .post('/auth/totp/confirm').set('Cookie', csrf.cookie).set(csrf.headers)
      .send({ code: totp.generateCode(setup.body.secret) });
    codes = confirm.body.recoveryCodes;
  });

  test('a recovery code completes sign-in when the phone is gone', async () => {
    const { body } = await login('totpadmin');
    const res = await request(app)
      .post('/auth/login/totp').send({ challengeId: body.challengeId, code: codes[0] });

    expect(res.status).toBe(200);
    expect(res.body.usedRecoveryCode).toBe(true);
    expect(res.body.recoveryCodesRemaining).toBe(mfaService.RECOVERY_CODE_COUNT - 1);
    expect(res.headers['set-cookie'].join()).toMatch(/auth_session/);
  });

  test('a recovery code is single-use', async () => {
    const first = await login('totpadmin');
    await request(app).post('/auth/login/totp').send({ challengeId: first.body.challengeId, code: codes[0] });

    const second = await login('totpadmin');
    const reuse = await request(app)
      .post('/auth/login/totp').send({ challengeId: second.body.challengeId, code: codes[0] });
    expect(reuse.status).toBe(401);
    expect(reuse.headers['set-cookie']).toBeUndefined();
  });

  test('formatting is forgiven — codes get copied off paper', async () => {
    const { body } = await login('totpadmin');
    const messy = `  ${codes[1].toLowerCase().replace('-', ' ')}  `;
    const res = await request(app)
      .post('/auth/login/totp').send({ challengeId: body.challengeId, code: messy });
    expect(res.status).toBe(200);
  });

  test('re-enrolling invalidates the previous codes', async () => {
    await mfaService.disable(adminId);
    const setup = await request(app).post('/auth/totp/setup').set('Cookie', csrf.cookie).set(csrf.headers).send({});
    await request(app).post('/auth/totp/confirm').set('Cookie', csrf.cookie).set(csrf.headers)
      .send({ code: totp.generateCode(setup.body.secret) });

    const { body } = await login('totpadmin');
    const res = await request(app)
      .post('/auth/login/totp').send({ challengeId: body.challengeId, code: codes[2] });
    expect(res.status).toBe(401);
  });
});

describe('Social sign-in must not walk around 2FA', () => {
  test('the admin OAuth guard is present in BOTH provider callbacks', () => {
    // A bypass on one provider is a bypass. This asserts the guard exists in the
    // source of each callback: exercising the real OAuth round-trip needs live
    // provider credentials, so the round-trip itself stays a manual check
    // (TEST-PLAN §7), but "someone added the guard to Google and forgot
    // Facebook" is exactly the regression worth catching automatically.
    const fs = require('fs');
    for (const f of ['googleAuthController.js', 'facebookAuthController.js']) {
      const src = fs.readFileSync(require('path').join(__dirname, '../../server/controllers', f), 'utf8');
      // Since the 2026-08-22 harvest the guard asks the role SET, not the
      // primary-role column (utils/adminRole.js) — an account holding admin
      // through user_roles must be refused too.
      expect(src).toMatch(/userIsAdminAnywhere/);
      expect(src).toMatch(/admin_oauth_blocked/);
      // The guard must come BEFORE the session is minted, or it guards nothing.
      expect(src.indexOf('admin_oauth_blocked')).toBeLessThan(src.indexOf('lucia.createSession'));
    }
  });
});

// ── The role SET counts, not just the primary-role column ────────────────────
// Migration 061 made user_roles the source of truth ("admin in the set ⇒ all
// views") while users.role stayed a denormalized primary. The 2FA gate used to
// read only users.role — so an account holding admin through user_roles had
// every admin permission and NO challenge. Harvest 2026-08-22 closes it
// (utils/adminRole.js); this pins it closed.
describe('Login — admin held via the role SET faces the same challenge', () => {
  test('role=user + user_roles admin + enrolled → mfaRequired', async () => {
    const id = await makeUser({ id: 'totp-set-admin', username: 'setadmin', role: 'user' });
    await db.query(
      `INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`,
      [id]
    );
    await enrol(id);

    const res = await login('setadmin');
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.user).toBeUndefined(); // no session until the second factor
  });

  test('role=user with no admin in the set stays unchallenged', async () => {
    await makeUser({ id: 'totp-plain', username: 'plainuser', role: 'user' });
    const res = await login('plainuser');
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBeUndefined();
  });
});
