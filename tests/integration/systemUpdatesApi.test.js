// GET /api/v1/system/updates and PATCH /api/v1/system/settings — the two calls
// the admin screen makes.
//
// The split under test: reads are delegable to a role holding the `updates`
// view, writes are hard admin. An ops role that can watch a fleet must not be
// able to switch an instance to auto and let it restart itself at 03:00.
const request = require('supertest');
// The BASE ships the self-update module OFF (no config/client.json). This
// suite tests the module LIVE, so switch it on the way an instance would —
// before the app is required (clientConfig reads env at require time).
process.env.CLIENT_CONFIG_MODULES_SELF_UPDATE_ENABLED = 'true';

const app = require('../../server/app');
const db  = require('../../server/config/database');
const Role = require('../../server/models/Role');
const SystemUpdate = require('../../server/models/SystemUpdate');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

const DIGEST = 'sha256:' + '1'.repeat(64);
let adminCookie, plainCookie, watcherCookie;

/** A non-admin role granted exactly the `updates` view — the ops-watcher case. */
async function createUpdateWatcher() {
  await db.query(
    `INSERT INTO roles (name, view_access) VALUES ('updatewatcher', '["updates"]'::jsonb)
     ON CONFLICT (name) DO UPDATE SET view_access = '["updates"]'::jsonb`
  );
  Role.invalidateCache();
  const { rows } = await db.query(
    `INSERT INTO users (email, username, password_hash, role)
     VALUES ('watcher@test.com', 'watcher', NULL, 'updatewatcher') RETURNING id`
  );
  return rows[0].id;
}

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE system_updates RESTART IDENTITY');
  await db.query('DELETE FROM app_settings WHERE key LIKE $1', ['selfupdate.%']);
  adminCookie   = await getTestSessionCookie(await createTestAdminUser());
  plainCookie   = await getTestSessionCookie(await createTestRegularUser());
  watcherCookie = await getTestSessionCookie(await createUpdateWatcher());
});

describe('GET /api/v1/system/updates — access', () => {
  test('anonymous is 401', async () => {
    expect((await request(app).get('/api/v1/system/updates')).status).toBe(401);
  });

  test('a signed-in user with no updates view is 403', async () => {
    const res = await request(app).get('/api/v1/system/updates').set('Cookie', plainCookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden', code: 403 });
  });

  test('a role holding only the updates view can read', async () => {
    const res = await request(app).get('/api/v1/system/updates').set('Cookie', watcherCookie);
    expect(res.status).toBe(200);
    expect(res.body.build.version).toBe('dev');
  });

  test('an admin can read', async () => {
    expect((await request(app).get('/api/v1/system/updates').set('Cookie', adminCookie)).status).toBe(200);
  });
});

describe('GET /api/v1/system/updates — payload', () => {
  test('an empty ledger reports no available update and no history', async () => {
    const res = await request(app).get('/api/v1/system/updates').set('Cookie', adminCookie);
    expect(res.body.available).toBeNull();
    expect(res.body.history).toEqual([]);
  });

  test('describes how updates behave on this instance', async () => {
    const res = await request(app).get('/api/v1/system/updates').set('Cookie', adminCookie);
    expect(res.body.settings).toMatchObject({
      mode: 'managed',
      channel: 'stable',
      managed: true,
      manifestHost: 'releases.orangesmiley.is',
      maintenanceWindow: { days: ['tue', 'wed', 'thu'], fromHour: 3, toHour: 5, tz: 'Atlantic/Reykjavik' },
    });
    // Computed server-side so the browser's clock cannot disagree with the
    // scheduler that will actually fire.
    expect(res.body.settings.nextWindowStart).toEqual(expect.any(String));
    expect(new Date(res.body.settings.nextWindowStart).toISOString())
      .toBe(res.body.settings.nextWindowStart);
  });

  test('surfaces an available update with its changelog rendered and sanitized', async () => {
    await SystemUpdate.recordAvailable({
      version: '1.4.2', imageDigest: DIGEST, channel: 'stable',
      changelogMd: '## 1.4.2\n\n- Fixed <script>alert(1)</script> the thing',
      detail: { publishedAt: '2026-08-09T00:00:00.000Z', critical: true, compatible: true },
    });
    const res = await request(app).get('/api/v1/system/updates').set('Cookie', adminCookie);

    expect(res.body.available).toMatchObject({
      version: '1.4.2', status: 'available', critical: true, compatible: true, imageDigest: DIGEST,
    });
    expect(res.body.available.changelogHtml).toContain('<h3>1.4.2</h3>');
    expect(res.body.available.changelogHtml).not.toContain('<script');
  });

  test('an update on another channel is not offered to this instance', async () => {
    await SystemUpdate.recordAvailable({ version: '1.9.0', imageDigest: DIGEST, channel: 'canary' });
    const res = await request(app).get('/api/v1/system/updates').set('Cookie', adminCookie);
    expect(res.body.available).toBeNull();
    // …but it is still history: the admin can see it happened.
    expect(res.body.history.map(h => h.version)).toEqual(['1.9.0']);
  });

  test('history is newest first and carries the failure reason', async () => {
    const a = await SystemUpdate.recordAvailable({ version: '1.4.1', imageDigest: DIGEST, channel: 'stable' });
    await SystemUpdate.markApplying(a.id, null);
    await SystemUpdate.markFailed(a.id, 'did not land');
    await SystemUpdate.recordAvailable({ version: '1.4.2', imageDigest: DIGEST, channel: 'stable' });

    const res = await request(app).get('/api/v1/system/updates').set('Cookie', adminCookie);
    expect(res.body.history).toHaveLength(2);
    expect(res.body.history[0].version).toBe('1.4.2');
    expect(res.body.history[1]).toMatchObject({ version: '1.4.1', status: 'failed', failureReason: 'did not land' });
  });

  test('the operational breadcrumbs in detail are not shipped to the browser', async () => {
    const u = await SystemUpdate.recordAvailable({ version: '1.4.2', imageDigest: DIGEST, channel: 'stable' });
    await SystemUpdate.markApplying(u.id, null, { triggeredBy: { id: 1, username: 'halli' } });

    const res = await request(app).get('/api/v1/system/updates').set('Cookie', adminCookie);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('triggeredBy');
    expect(body).not.toContain('halli');
  });
});

describe('PATCH /api/v1/system/settings', () => {
  const patch = (cookie, payload) =>
    request(app).patch('/api/v1/system/settings').set('Cookie', cookie).send(payload);

  test('anonymous is 401', async () => {
    expect((await request(app).patch('/api/v1/system/settings').send({ mode: 'auto' })).status).toBe(401);
  });

  test('a watcher who can READ updates still cannot change them', async () => {
    const res = await patch(watcherCookie, { mode: 'auto' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden', code: 403 });
  });

  test('on a managed instance even an admin is refused, with the reason', async () => {
    const res = await patch(adminCookie, { mode: 'auto' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Updates on this instance are managed by Orange Smiley', code: 403 });
  });

  test('nothing is written when the instance is managed', async () => {
    await patch(adminCookie, { mode: 'auto', channel: 'canary' });
    const { rows } = await db.query('SELECT * FROM app_settings WHERE key LIKE $1', ['selfupdate.%']);
    expect(rows).toEqual([]);
  });
});
