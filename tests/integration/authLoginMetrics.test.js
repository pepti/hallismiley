// auth_login_attempts_total{result} (server/observability/metrics.js) counts
// every sign-in outcome. It was defined long ago and never incremented; wired
// in harvest2 lane 1b (ported from icelandicstore #55, which wired
// success/failure/locked — the engine also counts `refused` and the 2FA
// step: `totp_required` on /login, then success/failure on /login/totp).
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const { Scrypt } = require('oslo/password');
const totp    = require('../../server/utils/totp');
const { authLoginAttempts } = require('../../server/observability/metrics');
const { cleanTables } = require('../helpers');

const scrypt = new Scrypt();
const PASSWORD = 'MetricsTestPass123!';

async function makeUser({ id, username, role = 'user', extra = '' }) {
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, approval_status, email_verified)
     VALUES ($1, $2, $3, $4, $5, 'approved', TRUE)`,
    [id, `${username}@test.com`, username, await scrypt.hash(PASSWORD), role]
  );
  if (extra) await db.query(`UPDATE users SET ${extra} WHERE id = $1`, [id]);
  return id;
}

async function count(result) {
  const m = await authLoginAttempts.get();
  const row = m.values.find((v) => v.labels.result === result);
  return row ? row.value : 0;
}

// Snapshot every label, run `fn`, return the per-label deltas.
async function deltas(fn) {
  const labels = ['success', 'failure', 'locked', 'refused', 'totp_required'];
  const before = Object.fromEntries(await Promise.all(labels.map(async (l) => [l, await count(l)])));
  await fn();
  const out = {};
  for (const l of labels) {
    const d = (await count(l)) - before[l];
    if (d) out[l] = d;
  }
  return out;
}

const login = (username, password = PASSWORD) =>
  request(app).post('/auth/login').send({ username, password });

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE mfa_challenges, user_recovery_codes RESTART IDENTITY CASCADE');
});

describe('auth_login_attempts_total', () => {
  test('success', async () => {
    await makeUser({ id: 'm-ok', username: 'metricsok' });
    expect(await deltas(async () => {
      expect((await login('metricsok')).status).toBe(200);
    })).toEqual({ success: 1 });
  });

  test('failure: wrong password, and an unknown username', async () => {
    await makeUser({ id: 'm-bad', username: 'metricsbad' });
    expect(await deltas(async () => {
      expect((await login('metricsbad', 'nope-nope-nope')).status).toBe(401);
      expect((await login('nobody-here', 'nope-nope-nope')).status).toBe(401);
    })).toEqual({ failure: 2 });
  });

  test('locked', async () => {
    await makeUser({ id: 'm-lock', username: 'metricslock', extra: "locked_until = NOW() + INTERVAL '10 minutes'" });
    expect(await deltas(async () => {
      expect((await login('metricslock')).status).toBe(401);
    })).toEqual({ locked: 1 });
  });

  test('refused: the right password on a disabled account', async () => {
    await makeUser({ id: 'm-off', username: 'metricsoff', extra: 'disabled = TRUE' });
    expect(await deltas(async () => {
      expect((await login('metricsoff')).status).toBe(403);
    })).toEqual({ refused: 1 });
  });

  test('two-step: totp_required, then failure and success on /login/totp', async () => {
    const secret = totp.generateSecret();
    await makeUser({
      id: 'm-2fa', username: 'metrics2fa', role: 'admin',
      extra: `totp_secret = '${secret}', totp_enabled = TRUE, totp_confirmed_at = NOW(), totp_last_step = NULL`,
    });

    let challengeId;
    expect(await deltas(async () => {
      const res = await login('metrics2fa');
      expect(res.status).toBe(200);
      expect(res.body.mfaRequired).toBe(true);
      challengeId = res.body.challengeId;
    })).toEqual({ totp_required: 1 });

    expect(await deltas(async () => {
      const bad = await request(app).post('/auth/login/totp').send({ challengeId, code: '000000' === totp.generateCode(secret) ? '111111' : '000000' });
      expect(bad.status).toBe(401);
    })).toEqual({ failure: 1 });

    expect(await deltas(async () => {
      const ok = await request(app).post('/auth/login/totp').send({ challengeId, code: totp.generateCode(secret) });
      expect(ok.status).toBe(200);
    })).toEqual({ success: 1 });
  });
});
