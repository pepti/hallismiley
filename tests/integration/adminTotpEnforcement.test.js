// Two-factor ENROLMENT, mandatory mode — auth/mfaPolicy.js under
// security.mfa.enrolment = 'required'. The instance default is 'optional'
// (mfa-optional-2026-09-23); this suite sets 'required' for itself through
// CLIENT_CONFIG_SECURITY_MFA_ENROLMENT, which the policy reads per request, and
// the last describe block pins the optional default against the same API.
//
// Until 2026-09-18 (rekstrarkerfid; harvested into the engine 2026-09-23) only
// accounts that had chosen to enrol were ever challenged; an admin who never
// opened the 2FA panel signed in with a password alone. The rule now: an
// account the login path would challenge (admin by role or role SET, an
// `accounts` holder, a published seller) that has not enabled TOTP is not that
// yet — it gets a session (it needs one to enrol) and nothing else.
//
// tests/env.js exempts the suites at large (ADMIN_TOTP_EXEMPT='*'); this one
// clears that, so everything here runs under the rule as a `required`
// production instance applies it. The policy reads both variables per request.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Role    = require('../../server/models/Role');
const { Scrypt } = require('oslo/password');
const totp    = require('../../server/utils/totp');
const secretBox = require('../../server/utils/secretBox');
const { hashToken } = require('../../server/auth/tokens');
const { cleanTables } = require('../helpers');

const scrypt = new Scrypt();
const PASSWORD = 'EnforceTestPass123!';
const ADMIN_ROUTE = '/api/v1/admin/events';
const ACCOUNTS_ROUTE = '/api/v1/admin/accounts';
// The server's default locale is IS; a request that names none gets the
// Icelandic string, one with ?locale=en the English one.
const ENROL_MESSAGE = /two-factor|tveggja þátta/i;

const MODE_ENV = 'CLIENT_CONFIG_SECURITY_MFA_ENROLMENT';
let exemptBefore;
let modeBefore;
beforeAll(() => { exemptBefore = process.env.ADMIN_TOTP_EXEMPT; modeBefore = process.env[MODE_ENV]; });
afterAll(() => {
  process.env.ADMIN_TOTP_EXEMPT = exemptBefore;
  if (modeBefore === undefined) delete process.env[MODE_ENV]; else process.env[MODE_ENV] = modeBefore;
});

beforeEach(async () => {
  delete process.env.ADMIN_TOTP_EXEMPT;
  process.env[MODE_ENV] = 'required';
  await cleanTables();
  await db.query('TRUNCATE TABLE mfa_challenges, user_recovery_codes RESTART IDENTITY CASCADE');
  // Mirror of the 098 role seed (adminRoles.test.js clears non-system roles).
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system) VALUES
       ('solumadur', 'Sölumaður', '["handbok", "leads", "accounts", "commission"]'::jsonb, FALSE),
       ('solufolk',  'Sölufólk',  '["handbok", "leads"]'::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`
  );
  Role.invalidateCache();
});

async function makeUser({ id, username, role, extraRoles = [] }) {
  const hash = await scrypt.hash(PASSWORD);
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, approval_status, email_verified)
     VALUES ($1, $2, $3, $4, $5, 'approved', TRUE)
     ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
       totp_secret = NULL, totp_secret_enc = NULL, totp_enabled = FALSE, totp_last_step = NULL`,
    [id, `${username}@test.com`, username, hash, role]
  );
  await db.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
  for (const r of [role, ...extraRoles]) {
    await db.query(
      'INSERT INTO user_roles (user_id, role_name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, r]);
  }
  return id;
}

const login = (username) => request(app).post('/auth/login').send({ username, password: PASSWORD });
const sessionCookie = (res) => (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

async function csrfFor(cookie) {
  const res = await request(app).get('/api/v1/csrf-token').set('Cookie', cookie);
  const extra = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]);
  return { token: res.body?.csrfToken || res.body?.token, cookie: [cookie, ...extra].join('; ') };
}

const post = (path, csrf, body = {}) =>
  request(app).post(path).set('Cookie', csrf.cookie).set('x-csrf-token', csrf.token).send(body);

async function enrolThrough(csrf) {
  const setup = await post('/auth/totp/setup', csrf);
  expect(setup.status).toBe(200);
  const confirm = await post('/auth/totp/confirm', csrf, { code: totp.generateCode(setup.body.secret) });
  expect(confirm.status).toBe(200);
  expect(confirm.body.recoveryCodes).toHaveLength(10);
  return setup.body;
}

describe('an admin who has not enrolled is not an admin yet', () => {
  test('signs in, but is told — and treated — as a plain user who owes enrolment', async () => {
    await makeUser({ id: 'enf-admin', username: 'enfadmin', role: 'admin' });
    const res = await login('enfadmin');

    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBeUndefined();
    expect(res.body.user).toMatchObject({
      username: 'enfadmin', role: 'user', roles: ['user'], views: [],
      mfa_enrolment_required: true,
    });

    const cookie = sessionCookie(res);
    const probe = await request(app).get(ADMIN_ROUTE).set('Cookie', cookie);
    expect(probe.status).toBe(403);
    expect(probe.body.code).toBe(403);
    expect(probe.body.error).toMatch(ENROL_MESSAGE);   // says why, same {error, code} envelope

    const session = await request(app).get('/auth/session').set('Cookie', cookie);
    expect(session.body.user).toMatchObject({
      role: 'user', roles: ['user'], mfa_enrolment_required: true, totp_enabled: false,
    });
  });

  test('every kind of admin guard refuses: a view-guarded router and a role-guarded write', async () => {
    await makeUser({ id: 'enf-admin', username: 'enfadmin', role: 'admin' });
    const csrf = await csrfFor(sessionCookie(await login('enfadmin')));

    expect((await request(app).get('/api/v1/admin/shop/orders').set('Cookie', csrf.cookie)).status).toBe(403);
    const write = await request(app).put('/api/v1/content/home?locale=is')
      .set('Cookie', csrf.cookie).set('x-csrf-token', csrf.token).send({ title: 'x' });
    expect(write.status).toBe(403);
    expect(write.body.error).toMatch(ENROL_MESSAGE);
  });

  test('admin held through the role SET (primary role "user") is caught the same way', async () => {
    await makeUser({ id: 'enf-set', username: 'enfset', role: 'user', extraRoles: ['admin'] });
    const res = await login('enfset');
    expect(res.body.user).toMatchObject({ role: 'user', roles: ['user'], mfa_enrolment_required: true });
    expect((await request(app).get(ADMIN_ROUTE).set('Cookie', sessionCookie(res))).status).toBe(403);
  });

  test('only `admin` is withheld — another role the account holds keeps working', async () => {
    await makeUser({ id: 'enf-both', username: 'enfboth', role: 'admin', extraRoles: ['moderator'] });
    const res = await login('enfboth');
    expect(res.body.user).toMatchObject({ role: 'moderator', roles: ['moderator'], mfa_enrolment_required: true });
  });

  test('a moderator and a plain user are untouched', async () => {
    await makeUser({ id: 'enf-mod', username: 'enfmod', role: 'moderator' });
    await makeUser({ id: 'enf-user', username: 'enfuser', role: 'user' });
    expect((await login('enfmod')).body.user).toMatchObject({ role: 'moderator', mfa_enrolment_required: false });
    expect((await login('enfuser')).body.user).toMatchObject({ role: 'user', mfa_enrolment_required: false });
  });
});

describe('the wider engine gate: an accounts holder owes enrolment too (ENHANCEMENTS #17)', () => {
  test('keeps its role, loses the accounts view, and the accounts router refuses with the reason', async () => {
    await makeUser({ id: 'enf-seller', username: 'enfseller', role: 'solumadur' });
    const res = await login('enfseller');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'solumadur', roles: ['solumadur'], mfa_enrolment_required: true });
    expect(res.body.user.views).toEqual(expect.arrayContaining(['handbok', 'leads', 'commission']));
    expect(res.body.user.views).not.toContain('accounts');

    const cookie = sessionCookie(res);
    const refused = await request(app).get(ACCOUNTS_ROUTE).set('Cookie', cookie);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(ENROL_MESSAGE);
    // The other views the role grants still work.
    expect((await request(app).get('/api/v1/admin/handbok').set('Cookie', cookie)).status).toBe(200);
  });

  test('enrolling on the same session opens the accounts view', async () => {
    await makeUser({ id: 'enf-seller', username: 'enfseller', role: 'solumadur' });
    const csrf = await csrfFor(sessionCookie(await login('enfseller')));
    await enrolThrough(csrf);

    expect((await request(app).get(ACCOUNTS_ROUTE).set('Cookie', csrf.cookie)).status).toBe(200);
    const session = await request(app).get('/auth/session').set('Cookie', csrf.cookie);
    expect(session.body.user).toMatchObject({ mfa_enrolment_required: false, totp_enabled: true });
    expect(session.body.user.views).toContain('accounts');
  });

  test('a handbook-only seller is not protected and owes nothing', async () => {
    await makeUser({ id: 'enf-folk', username: 'enffolk', role: 'solufolk' });
    const res = await login('enffolk');
    expect(res.body.user).toMatchObject({ role: 'solufolk', mfa_enrolment_required: false });
    expect((await request(app).get('/api/v1/admin/handbok').set('Cookie', sessionCookie(res))).status).toBe(200);
  });
});

describe('enrolling is what makes the account an admin', () => {
  test('setup → confirm on the SAME session unlocks the admin routes, no re-login', async () => {
    await makeUser({ id: 'enf-admin', username: 'enfadmin', role: 'admin' });
    const csrf = await csrfFor(sessionCookie(await login('enfadmin')));
    expect((await request(app).get(ADMIN_ROUTE).set('Cookie', csrf.cookie)).status).toBe(403);

    await enrolThrough(csrf);

    expect((await request(app).get(ADMIN_ROUTE).set('Cookie', csrf.cookie)).status).toBe(200);
    const session = await request(app).get('/auth/session').set('Cookie', csrf.cookie);
    expect(session.body.user).toMatchObject({
      role: 'admin', roles: ['admin'], mfa_enrolment_required: false, totp_enabled: true,
    });
  });

  test('from then on the password alone yields a challenge, never a session', async () => {
    await makeUser({ id: 'enf-admin', username: 'enfadmin', role: 'admin' });
    const { secret } = await enrolThrough(await csrfFor(sessionCookie(await login('enfadmin'))));
    await db.query('UPDATE users SET totp_last_step = NULL WHERE id = $1', ['enf-admin']);

    const again = await login('enfadmin');
    expect(again.body.mfaRequired).toBe(true);
    expect(again.headers['set-cookie']).toBeUndefined();

    const done = await request(app).post('/auth/login/totp')
      .send({ challengeId: again.body.challengeId, code: totp.generateCode(secret) });
    expect(done.status).toBe(200);
    expect(done.body.user).toMatchObject({ role: 'admin', mfa_enrolment_required: false });
    expect((await request(app).get(ADMIN_ROUTE).set('Cookie', sessionCookie(done))).status).toBe(200);
  });

  test('an admin-by-role-set can enrol — the old primary-role check refused it', async () => {
    await makeUser({ id: 'enf-set', username: 'enfset', role: 'user', extraRoles: ['admin'] });
    const csrf = await csrfFor(sessionCookie(await login('enfset')));
    await enrolThrough(csrf);
    expect((await request(app).get(ADMIN_ROUTE).set('Cookie', csrf.cookie)).status).toBe(200);
  });

  test('a plain user still cannot enrol', async () => {
    await makeUser({ id: 'enf-user', username: 'enfuser', role: 'user' });
    const csrf = await csrfFor(sessionCookie(await login('enfuser')));
    expect((await post('/auth/totp/setup', csrf)).status).toBe(403);
  });

  test('the authenticator entry is named after THIS instance (identity seam), not customer #1', async () => {
    const { identity } = require('../../server/config/identity');
    await makeUser({ id: 'enf-admin', username: 'enfadmin', role: 'admin' });
    const setup = await post('/auth/totp/setup', await csrfFor(sessionCookie(await login('enfadmin'))));
    expect(setup.status).toBe(200);
    // The query uses URLSearchParams (space → "+"), the label encodeURIComponent
    // (space → "%20") — utils/totp.js otpauthUri; a brand with a space, like
    // this instance's, tells the two apart.
    expect(setup.body.uri).toContain(new URLSearchParams({ issuer: identity.brand.name }).toString());
    expect(setup.body.uri).toContain(encodeURIComponent(`${identity.brand.name}:`));
    expect(setup.body.uri).not.toMatch(/Icelandic/i);
  });

  test('turning 2FA off puts the admin back behind the gate until they enrol again', async () => {
    await makeUser({ id: 'enf-admin', username: 'enfadmin', role: 'admin' });
    const csrf = await csrfFor(sessionCookie(await login('enfadmin')));
    await enrolThrough(csrf);

    expect((await post('/auth/totp/disable', csrf, { password: PASSWORD })).status).toBe(200);
    expect((await request(app).get(ADMIN_ROUTE).set('Cookie', csrf.cookie)).status).toBe(403);
  });
});

describe('no way around the second factor', () => {
  test('a magic link does not mint a session for an admin account', async () => {
    await makeUser({ id: 'enf-admin', username: 'enfadmin', role: 'admin' });
    await makeUser({ id: 'enf-guest', username: 'enfguest', role: 'user' });
    await db.query('UPDATE users SET magic_login_token_hash = $1 WHERE id = $2', [hashToken('admin-magic'), 'enf-admin']);
    await db.query('UPDATE users SET magic_login_token_hash = $1 WHERE id = $2', [hashToken('guest-magic'), 'enf-guest']);

    const admin = await request(app).post('/auth/party-magic-login').send({ token: 'admin-magic' });
    expect(admin.status).toBe(403);
    expect(admin.headers['set-cookie']).toBeUndefined();

    // …while the guest it was built for is unaffected.
    const guest = await request(app).post('/auth/party-magic-login').send({ token: 'guest-magic' });
    expect(guest.status).toBe(200);
  });
});

describe('the TOTP secret at rest (migration 107, expand phase)', () => {
  const row = async (id) => (await db.query(
    'SELECT totp_secret, totp_secret_enc, totp_enabled FROM users WHERE id = $1', [id])).rows[0];

  async function signInWithCode(username, secret) {
    const first = await login(username);
    return request(app).post('/auth/login/totp')
      .send({ challengeId: first.body.challengeId, code: totp.generateCode(secret) });
  }

  test('enrolment writes both columns; the sealed one opens only for its own account', async () => {
    await makeUser({ id: 'enf-admin', username: 'enfadmin', role: 'admin' });
    const setup = await post('/auth/totp/setup', await csrfFor(sessionCookie(await login('enfadmin'))));

    const r = await row('enf-admin');
    expect(r.totp_secret).toBe(setup.body.secret);          // the previous release still reads this
    expect(r.totp_secret_enc).toMatch(/^v1:/);
    expect(r.totp_secret_enc).not.toContain(setup.body.secret);
    expect(secretBox.open(r.totp_secret_enc, 'enf-admin')).toBe(setup.body.secret);
    expect(() => secretBox.open(r.totp_secret_enc, 'someone-else')).toThrow();
  });

  test('an admin enrolled before 107 signs in from the plaintext, and is sealed on the way', async () => {
    await makeUser({ id: 'enf-admin', username: 'enfadmin', role: 'admin' });
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET totp_secret = $1, totp_enabled = TRUE WHERE id = $2', [secret, 'enf-admin']);
    expect((await row('enf-admin')).totp_secret_enc).toBeNull();

    expect((await signInWithCode('enfadmin', secret)).status).toBe(200);
    const after = await row('enf-admin');
    expect(after.totp_secret).toBe(secret);                   // still there: expand phase
    expect(secretBox.open(after.totp_secret_enc, 'enf-admin')).toBe(secret);
  });

  test('the sealed copy alone is enough — the contract step can drop the plaintext', async () => {
    await makeUser({ id: 'enf-admin', username: 'enfadmin', role: 'admin' });
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET totp_secret = NULL, totp_secret_enc = $1, totp_enabled = TRUE WHERE id = $2',
      [secretBox.seal(secret, 'enf-admin'), 'enf-admin']);

    expect((await signInWithCode('enfadmin', secret)).status).toBe(200);
  });

  test('a sealed copy lifted from another account does not authenticate', async () => {
    await makeUser({ id: 'enf-admin', username: 'enfadmin', role: 'admin' });
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET totp_secret = NULL, totp_secret_enc = $1, totp_enabled = TRUE WHERE id = $2',
      [secretBox.seal(secret, 'some-other-user'), 'enf-admin']);

    expect((await signInWithCode('enfadmin', secret)).status).not.toBe(200);
  });

  test('with no TOTP_ENC_KEY the plaintext path still works — an instance without the key keeps its admins', async () => {
    const key = process.env.TOTP_ENC_KEY;
    delete process.env.TOTP_ENC_KEY;
    try {
      await makeUser({ id: 'enf-admin', username: 'enfadmin', role: 'admin' });
      const setup = await post('/auth/totp/setup', await csrfFor(sessionCookie(await login('enfadmin'))));
      expect(setup.status).toBe(200);
      const r = await row('enf-admin');
      expect(r.totp_secret).toBe(setup.body.secret);
      expect(r.totp_secret_enc).toBeNull();
    } finally {
      process.env.TOTP_ENC_KEY = key;
    }
  });
});

describe('security.mfa.enrolment = optional — the instance default (mfa-optional-2026-09-23)', () => {
  // The outer beforeEach asked for `required`; drop it so config/client.json
  // (and the schema default) decide, as on a real instance.
  beforeEach(() => { delete process.env[MODE_ENV]; });

  test('an unenrolled admin signs in as an admin: nothing withheld, nothing owed', async () => {
    await makeUser({ id: 'opt-admin', username: 'optadmin', role: 'admin' });
    const res = await login('optadmin');

    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBeUndefined();
    expect(res.body.user).toMatchObject({
      username: 'optadmin', role: 'admin', roles: ['admin'], views: ['*'],
      mfa_enrolment_required: false,
    });
    const cookie = sessionCookie(res);
    expect((await request(app).get(ADMIN_ROUTE).set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).get(ACCOUNTS_ROUTE).set('Cookie', cookie)).status).toBe(200);
    const session = await request(app).get('/auth/session').set('Cookie', cookie);
    expect(session.body.user).toMatchObject({
      role: 'admin', roles: ['admin'], mfa_enrolment_required: false, totp_enabled: false,
    });
  });

  test('an unenrolled accounts holder keeps the accounts view', async () => {
    await makeUser({ id: 'opt-seller', username: 'optseller', role: 'solumadur' });
    const res = await login('optseller');
    expect(res.body.user).toMatchObject({ role: 'solumadur', mfa_enrolment_required: false });
    expect(res.body.user.views).toContain('accounts');
    expect((await request(app).get(ACCOUNTS_ROUTE).set('Cookie', sessionCookie(res))).status).toBe(200);
  });

  test('enrolling is still offered, and an enrolled admin is challenged at every sign-in', async () => {
    await makeUser({ id: 'opt-admin', username: 'optadmin', role: 'admin' });
    const { secret } = await enrolThrough(await csrfFor(sessionCookie(await login('optadmin'))));
    await db.query('UPDATE users SET totp_last_step = NULL WHERE id = $1', ['opt-admin']);

    const again = await login('optadmin');
    expect(again.body.mfaRequired).toBe(true);
    expect(again.headers['set-cookie']).toBeUndefined();
    const done = await request(app).post('/auth/login/totp')
      .send({ challengeId: again.body.challengeId, code: totp.generateCode(secret) });
    expect(done.status).toBe(200);
    expect(done.body.user).toMatchObject({ role: 'admin', mfa_enrolment_required: false, totp_enabled: true });
  });

  test('switching the instance to `required` withholds admin on the very next request', async () => {
    await makeUser({ id: 'opt-admin', username: 'optadmin', role: 'admin' });
    const cookie = sessionCookie(await login('optadmin'));
    expect((await request(app).get(ADMIN_ROUTE).set('Cookie', cookie)).status).toBe(200);

    process.env[MODE_ENV] = 'required';
    const refused = await request(app).get(ADMIN_ROUTE).set('Cookie', cookie);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(ENROL_MESSAGE);
  });
});

describe('GET /metrics bearer token', () => {
  const TOKEN = 'metrics-token-for-this-test';
  beforeEach(() => { process.env.METRICS_TOKEN = TOKEN; });
  afterEach(() => { delete process.env.METRICS_TOKEN; });

  test('the exact token is accepted; a wrong one, a prefix and a longer one are not', async () => {
    const get = (auth) => request(app).get('/metrics').set('Authorization', auth);
    expect((await get(`Bearer ${TOKEN}`)).status).toBe(200);
    for (const bad of [`Bearer ${TOKEN.slice(0, -1)}`, `Bearer ${TOKEN}x`, 'Bearer nope', TOKEN, '']) {
      expect((await get(bad)).status).toBe(401);
    }
  });
});
