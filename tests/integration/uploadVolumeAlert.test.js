// Large uploads must ALWAYS complete — the product decision (Halli, 2026-09-01)
// is that throttling a bulk upload is a broken-product experience. So
// POST /api/v1/admin/background/media is exempt from the global limiter and the
// old blocking backstop is replaced by detection: a warn row in Admin →
// Monitoring saying the action was large.
//
// These tests pin the half of that policy that is testable in-process. The
// limiter itself skips under NODE_ENV=test (server/app.js), so what is asserted
// here is the alerting contract and the route wiring; the exemption itself is
// pinned by BG_MEDIA_UPLOAD_PATH in app.js next to the isStaticAsset carve-out.
const fs      = require('fs');
const path    = require('path');
const request = require('supertest');
const app      = require('../../server/app');
const db       = require('../../server/config/database');
const EventLog = require('../../server/models/EventLog');
const alert    = require('../../server/services/uploadVolumeAlert');
const {
  createTestAdminUser,
  createTestRegularUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

// 1x1 PNG — the smallest thing that survives the MIME allowlist.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const ORIGINAL_THRESHOLD = process.env.BG_UPLOAD_ALERT_THRESHOLD;

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE event_logs RESTART IDENTITY CASCADE');
  alert.reset();
});

afterAll(async () => {
  if (ORIGINAL_THRESHOLD === undefined) delete process.env.BG_UPLOAD_ALERT_THRESHOLD;
  else process.env.BG_UPLOAD_ALERT_THRESHOLD = ORIGINAL_THRESHOLD;
});

describe('uploadVolumeAlert — notifies, never blocks', () => {
  // event_logs.user_id is a real FK (TEXT REFERENCES users(id)), so a made-up
  // id makes EventLog.record drop the row and the assertion passes for the
  // wrong reason. Always alert against users that exist.
  let adminId, userId;
  beforeEach(async () => {
    process.env.BG_UPLOAD_ALERT_THRESHOLD = '5';
    adminId = await createTestAdminUser();
    userId  = await createTestRegularUser();
  });

  it('stays silent below the threshold', async () => {
    for (let i = 0; i < 4; i += 1) {
      const row = await alert.recordUpload({ userId: adminId, username: 'admin' });
      expect(row).toBeNull();
    }
    expect(await EventLog.count({})).toBe(0);
  });

  it('raises exactly one warn row when the burst crosses the threshold', async () => {
    for (let i = 0; i < 5; i += 1) await alert.recordUpload({ userId: adminId, username: 'admin' });

    const events = await EventLog.list({ limit: 10, offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0].level).toBe('warn');
    expect(events[0].source).toBe('server');
    expect(events[0].message).toMatch(/Large upload burst: 5 files/);

    const ctx = typeof events[0].context === 'string'
      ? JSON.parse(events[0].context) : events[0].context;
    expect(ctx.kind).toBe('upload_volume');
    expect(ctx.files).toBe(5);
    expect(ctx.threshold).toBe(5);
    // The row must never be mistaken for something that stopped the user.
    expect(ctx.action).toBe('allowed');
  });

  it('escalates on a genuinely huge batch instead of firing once and going quiet', async () => {
    for (let i = 0; i < 15; i += 1) await alert.recordUpload({ userId: adminId, username: 'admin' });
    const events = await EventLog.list({ limit: 10, offset: 0 });
    expect(events).toHaveLength(3);           // 5, 10, 15
    expect(events.map(e => e.message).join(' ')).toMatch(/15 files/);
  });

  it('counts each admin separately, so one busy user does not alert on another', async () => {
    for (let i = 0; i < 4; i += 1) await alert.recordUpload({ userId: adminId });
    for (let i = 0; i < 4; i += 1) await alert.recordUpload({ userId: userId });
    expect(await EventLog.count({})).toBe(0);

    await alert.recordUpload({ userId: adminId });
    expect(await EventLog.count({})).toBe(1);
  });

  it('never throws, whatever it is handed — alerting must not break an upload', async () => {
    await expect(alert.recordUpload()).resolves.toBeNull();
    await expect(alert.recordUpload({ userId: null })).resolves.toBeNull();
    await expect(alert.recordUpload({ userId: {}, username: {} })).resolves.not.toThrow;
  });
});

describe('POST /api/v1/admin/background/media — the upload still completes', () => {
  let adminCookie;
  const BG_DIR = path.join(__dirname, '..', '..', 'public', 'assets', 'backgrounds');
  fs.mkdirSync(BG_DIR, { recursive: true });
  const before = new Set(fs.readdirSync(BG_DIR));

  beforeEach(async () => {
    process.env.BG_UPLOAD_ALERT_THRESHOLD = '1';   // alert on the first file
    await createTestAdminUser();
    adminCookie = await getTestSessionCookie();
  });

  afterAll(() => {
    // Uploads land under UPLOAD_ROOT, which in test resolves to the COMMITTED
    // public/assets tree — so a test that does not clean up leaves real files in
    // the repo. Diff the directory rather than trusting the response shape: the
    // upload handler's payload key is not part of this test's contract, and
    // guessing it wrong fails silently and litters every run.
    for (const name of fs.readdirSync(BG_DIR)) {
      if (!before.has(name)) {
        try { fs.unlinkSync(path.join(BG_DIR, name)); } catch { /* already gone */ }
      }
    }
  });

  it('accepts the file AND records a warn row marked "allowed"', async () => {
    const res = await request(app)
      .post('/api/v1/admin/background/media')
      .set('Cookie', adminCookie)
      .attach('file', PNG, { filename: 'still.png', contentType: 'image/png' });

    // The upload is NOT refused — that is the whole point of the policy.
    expect(res.status).toBeLessThan(400);
    expect(res.status).not.toBe(429);

    // The insert is fire-and-forget; poll rather than race it.
    const deadline = Date.now() + 2000;
    let n = 0;
    while (Date.now() < deadline && n === 0) {
      n = await EventLog.count({});
      if (n === 0) await new Promise(r => setTimeout(r, 25));
    }
    expect(n).toBe(1);

    const events = await EventLog.list({ limit: 5, offset: 0 });
    const ctx = typeof events[0].context === 'string'
      ? JSON.parse(events[0].context) : events[0].context;
    expect(ctx.kind).toBe('upload_volume');
    expect(ctx.action).toBe('allowed');
    expect(events[0].path).toMatch(/POST \/api\/v1\/admin\/background\/media/);
  });
});
