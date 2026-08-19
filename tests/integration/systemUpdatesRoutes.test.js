// The apply/rollback endpoints. These restart the instance, so the gate matters
// more than the payload: anonymous → 401, non-admin → 403, managed instance →
// 403 with a message a human can act on, and no state change in any of those.
const request = require('supertest');
// The BASE ships the self-update module OFF (no config/client.json). This
// suite tests the module LIVE, so switch it on the way an instance would —
// before the app is required (clientConfig reads env at require time).
process.env.CLIENT_CONFIG_MODULES_SELF_UPDATE_ENABLED = 'true';

const app = require('../../server/app');
const db  = require('../../server/config/database');
const SystemUpdate = require('../../server/models/SystemUpdate');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

const DIGEST = 'sha256:' + '1'.repeat(64);
let adminCookie, userCookie, update;

const applyUrl    = id => `/api/v1/system/updates/${id}/apply`;
const rollbackUrl = id => `/api/v1/system/updates/${id}/rollback`;

let savedTrigger;
beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE system_updates RESTART IDENTITY');
  adminCookie = await getTestSessionCookie(await createTestAdminUser());
  userCookie  = await getTestSessionCookie(await createTestRegularUser());
  update = await SystemUpdate.recordAvailable({
    version: '1.4.2', imageDigest: DIGEST, channel: 'stable',
    detail: { publishedAt: '2026-08-09T00:00:00.000Z', critical: false, compatible: true },
  });
  savedTrigger = process.env.SELF_UPDATE_TRIGGER_URL;
  // Deliberately unset: this instance's config/client.json is `managed`, so
  // every request below must be refused BEFORE anything reaches a trigger.
  delete process.env.SELF_UPDATE_TRIGGER_URL;
});
afterEach(() => {
  if (savedTrigger === undefined) delete process.env.SELF_UPDATE_TRIGGER_URL;
  else process.env.SELF_UPDATE_TRIGGER_URL = savedTrigger;
});

describe('POST /api/v1/system/updates/:id/apply — access', () => {
  test('anonymous is 401', async () => {
    const res = await request(app).post(applyUrl(update.id));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', code: 401 });
  });

  test('a signed-in non-admin is 403', async () => {
    const res = await request(app).post(applyUrl(update.id)).set('Cookie', userCookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden', code: 403 });
  });

  test('none of the refused requests moved the row', async () => {
    await request(app).post(applyUrl(update.id));
    await request(app).post(applyUrl(update.id)).set('Cookie', userCookie);
    expect((await SystemUpdate.findById(update.id)).status).toBe('available');
  });
});

describe('POST .../apply — a managed instance refuses its own admin', () => {
  test('403 with a message that says who is driving', async () => {
    const res = await request(app).post(applyUrl(update.id)).set('Cookie', adminCookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Updates on this instance are managed by Orange Smiley', code: 403 });
  });

  test('the ledger is untouched', async () => {
    await request(app).post(applyUrl(update.id)).set('Cookie', adminCookie);
    const row = await SystemUpdate.findById(update.id);
    expect(row.status).toBe('available');
    expect(row.previous_digest).toBeNull();
  });

  test('rollback is refused on the same grounds', async () => {
    await SystemUpdate.markApplying(update.id, 'sha256:' + '0'.repeat(64));
    await SystemUpdate.markFailed(update.id, 'did not land');
    const res = await request(app).post(rollbackUrl(update.id)).set('Cookie', adminCookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(403);
  });
});

describe('POST .../apply — input validation', () => {
  const badIds = ['abc', '0', '-1', '1.5'];
  test.each(badIds)('id %s is a 400 in the standard envelope', async (id) => {
    const res = await request(app).post(applyUrl(id)).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid update id', code: 400 });
  });

  test('a well-formed id that does not exist is not a 500', async () => {
    // Still 403 here, because this instance is managed and the mode check comes
    // first — refusing before we admit whether the row exists is the right order.
    const res = await request(app).post(applyUrl(999999)).set('Cookie', adminCookie);
    expect(res.status).toBe(403);
  });
});

describe('the routes exist at all (guards against a silent mount regression)', () => {
  test('apply is routed, not a 404 SPA fallback', async () => {
    const res = await request(app).post(applyUrl(update.id)).set('Cookie', adminCookie);
    expect(res.status).not.toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  test('rollback is routed', async () => {
    const res = await request(app).post(rollbackUrl(update.id)).set('Cookie', adminCookie);
    expect(res.status).not.toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });
});
