// The two-step REMINDER (mfa-reminder-2026-09-23) — the session flag
// `mfa_reminder` and POST /auth/mfa-reminder/dismiss.
//
// Halli: two-factor enrolment is optional, "but put a reminder somewhere, and
// a checkmark not to see the reminder again". What must hold:
//   • the flag is true only under `optional`, only for a protected account
//     (admin by role or role set, `accounts` holder, published seller) without
//     TOTP, only while it has not been dismissed — never for anyone else, and
//     never under `required` (the forced flow applies there);
//   • dismissing needs a session and a CSRF token, is idempotent, and only
//     ever touches the caller's own row — whatever the body says.
// The browser half (the notice, the checkbox, the reload) is
// e2e/mfa-reminder.spec.js.
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const Role = require('../../server/models/Role');
const { createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables } = require('../helpers');

const MODE_ENV = 'CLIENT_CONFIG_SECURITY_MFA_ENROLMENT';
const DISMISS = '/auth/mfa-reminder/dismiss';

let modeBefore;
beforeAll(() => { modeBefore = process.env[MODE_ENV]; });
afterAll(() => {
  if (modeBefore === undefined) delete process.env[MODE_ENV]; else process.env[MODE_ENV] = modeBefore;
});

let adminId, adminCookie, regularId, regularCookie;

beforeEach(async () => {
  delete process.env[MODE_ENV];
  await cleanTables();
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system) VALUES
       ('solumadur', 'Sölumaður', '["handbok", "leads", "accounts", "commission"]'::jsonb, FALSE),
       ('solufolk',  'Sölufólk',  '["handbok", "leads"]'::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`
  );
  Role.invalidateCache();
  adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  regularId = await createTestRegularUser();
  regularCookie = await getTestSessionCookie(regularId);
});

// Skipped as a whole on a product that hides, disables or forks the feature
// this suite belongs to (features/local.json — see tests/lib/featureGate.js).
const { describeForSpec } = require('../lib/featureGate');
const describe = describeForSpec(__filename);

const session = async (cookie) => (await request(app).get('/auth/session').set('Cookie', cookie)).body.user;
const dismissedAt = async (id) =>
  (await db.query('SELECT mfa_reminder_dismissed_at FROM users WHERE id = $1', [id])).rows[0].mfa_reminder_dismissed_at;

async function extraUser(id, role, roleSet = [role]) {
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ($1, $2, $3, (SELECT password_hash FROM users WHERE id = $4), $5, TRUE)`,
    [id, `${id}@test.com`, id.replace(/[^a-z0-9]/g, ''), adminId, role]
  );
  for (const r of roleSet) {
    await db.query('INSERT INTO user_roles (user_id, role_name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, r]);
  }
  return getTestSessionCookie(id);
}

describe('mfa_reminder on the session payload', () => {
  test('the instance default is optional', () => {
    expect(require('../../server/auth/mfaPolicy').enrolmentMode()).toBe('optional');
  });

  test('an unenrolled admin: true, and nothing is withheld', async () => {
    const user = await session(adminCookie);
    expect(user).toMatchObject({ role: 'admin', mfa_enrolment_required: false, mfa_reminder: true });
  });

  test('an admin through the role SET only, and an `accounts` holder: true', async () => {
    const setAdmin = await extraUser('set-admin', 'user', ['user', 'admin']);
    expect((await session(setAdmin)).mfa_reminder).toBe(true);
    const holder = await extraUser('holder', 'solumadur');
    expect((await session(holder)).mfa_reminder).toBe(true);
  });

  test('never for an account without a protected role', async () => {
    expect((await session(regularCookie)).mfa_reminder).toBe(false);
    // `leads` alone is not protected (solufolk: handbok + leads).
    const trainee = await extraUser('trainee', 'solufolk');
    expect((await session(trainee)).mfa_reminder).toBe(false);
  });

  test('false once enrolled', async () => {
    await db.query('UPDATE users SET totp_enabled = TRUE WHERE id = $1', [adminId]);
    expect((await session(adminCookie)).mfa_reminder).toBe(false);
  });

  test('false once dismissed', async () => {
    await db.query('UPDATE users SET mfa_reminder_dismissed_at = NOW() WHERE id = $1', [adminId]);
    expect((await session(adminCookie)).mfa_reminder).toBe(false);
  });

  test('never under `required` — the forced flow applies there instead', async () => {
    process.env[MODE_ENV] = 'required';
    // tests/env.js exempts every account from the forced flow, so the admin
    // keeps its role here; the reminder is off all the same.
    const user = await session(adminCookie);
    expect(user.mfa_reminder).toBe(false);
    const holder = await extraUser('holder2', 'solumadur');
    expect((await session(holder)).mfa_reminder).toBe(false);
  });

  test('the password sign-in payload carries it too', async () => {
    const res = await request(app).post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.mfa_reminder).toBe(true);
  });
});

describe('POST /auth/mfa-reminder/dismiss', () => {
  test('401 without a session, in the error envelope', async () => {
    const res = await request(app).post(DISMISS).send({});
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 401 });
    expect(typeof res.body.error).toBe('string');
  });

  test('stamps the caller, and the session flag follows', async () => {
    const res = await request(app).post(DISMISS).set('Cookie', adminCookie).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mfa_reminder: false });
    expect(await dismissedAt(adminId)).toBeInstanceOf(Date);
    expect((await session(adminCookie)).mfa_reminder).toBe(false);
  });

  test('idempotent: a repeat is 200 and keeps the first time', async () => {
    await request(app).post(DISMISS).set('Cookie', adminCookie).send({});
    await db.query(`UPDATE users SET mfa_reminder_dismissed_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [adminId]);
    const again = await request(app).post(DISMISS).set('Cookie', adminCookie).send({});
    expect(again.status).toBe(200);
    expect((await dismissedAt(adminId)).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  test('only ever the caller\'s own row — the body is ignored', async () => {
    const res = await request(app).post(DISMISS).set('Cookie', regularCookie)
      .send({ user_id: adminId, id: adminId, userId: adminId });
    expect(res.status).toBe(200);
    expect(await dismissedAt(adminId)).toBeNull();
    expect((await session(adminCookie)).mfa_reminder).toBe(true);
    expect(await dismissedAt(regularId)).toBeInstanceOf(Date);
  });

  test('a dismissal leaves sign-in alone: an admin can still enrol, and is then challenged', async () => {
    await request(app).post(DISMISS).set('Cookie', adminCookie).send({});
    const setup = await request(app).post('/auth/totp/setup').set('Cookie', adminCookie).send({});
    expect(setup.status).toBe(200);
  });

  describe('CSRF (the test-mode bypass switched off for these requests)', () => {
    let envBefore;
    beforeEach(() => { envBefore = process.env.NODE_ENV; process.env.NODE_ENV = 'development'; });
    afterEach(() => { process.env.NODE_ENV = envBefore; });

    test('403 without a token, 200 with one', async () => {
      const bare = await request(app).post(DISMISS).set('Cookie', adminCookie).send({});
      expect(bare.status).toBe(403);
      expect(bare.body).toMatchObject({ code: 403 });
      expect(await dismissedAt(adminId)).toBeNull();

      const csrfRes = await request(app).get('/api/v1/csrf-token').set('Cookie', adminCookie);
      const token = csrfRes.body.csrfToken || csrfRes.body.token;
      const cookie = [adminCookie, ...(csrfRes.headers['set-cookie'] || []).map(c => c.split(';')[0])].join('; ');
      const ok = await request(app).post(DISMISS).set('Cookie', cookie).set('x-csrf-token', token).send({});
      expect(ok.status).toBe(200);
      expect(await dismissedAt(adminId)).toBeInstanceOf(Date);
    });
  });
});
