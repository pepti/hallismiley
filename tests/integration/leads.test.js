// Integration tests for the leads inbox (migration 097): the /hafa-samband
// submission is persisted alongside the notification email, the inbox API
// and its RBAC (read + workflow writes = requireView('leads') via the seeded
// `solufolk` role; delete + CSV = admin), the first-touch stamp, the no-store
// posture, the never-throwing insert, the retention prune, the id shapes the
// routes accept (integer or uuid, compared as text — rk-feed) and the
// notification outcome on the row (migration 108).
// CSRF is bypassed in test mode (see tests/env.js).
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Lead    = require('../../server/models/Lead');
const Role    = require('../../server/models/Role');
const {
  createTestAdminUser,
  createTestModeratorUser,
  createTestRegularUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

let adminCookie, modCookie, userCookie, salesCookie;
let adminId, modId, userId;
const SALES_ID = 'test-sales-id';

// Mirror of the migration seeds: 090 creates the role, 097 appends `leads`.
// Other suites clear non-system roles between tests, and migrations run once
// per DB, so this suite re-seeds with the migrations' own statements. The
// role cache must be dropped too — a previous suite may have cached the
// 090-only grant list in this worker process.
async function ensureSolufolkRole() {
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system) VALUES
       ('solufolk', 'Sölufólk — aðgangur að handbók sölufólks',
        '["handbok"]'::jsonb, FALSE)
     ON CONFLICT (name) DO NOTHING`
  );
  await db.query(
    `UPDATE roles SET view_access = view_access || '["leads"]'::jsonb
      WHERE name = 'solufolk' AND is_system = FALSE
        AND NOT (view_access @> '["leads"]'::jsonb)`
  );
  if (typeof Role.invalidateCache === 'function') Role.invalidateCache();
}

const validPayload = (over = {}) => ({
  name: 'Jóna Jónsdóttir',
  email: 'jona@example.is',
  message: 'Við erum með Shopify og viljum skoða Rekstrarkerfið.',
  company: 'Ísprjón ehf.',
  phone: '555 1234',
  current_platform: 'shopify',
  ...over,
});

async function insertLead(over = {}) {
  const { randomUUID } = require('crypto');
  const row = await Lead.create({
    submissionId: randomUUID(),
    name: 'Prufa', email: 'prufa@example.is', message: 'Halló, ég vil vita meira um kerfið.',
    company: 'Prufufyrirtæki', phone: null, platform: 'wix', locale: 'is',
    ...over,
  });
  return row.id;
}

async function pollLeadBySubmission(email, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const { rows } = await db.query('SELECT * FROM leads WHERE email = $1', [email]);
    if (rows[0]) return rows[0];
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE leads RESTART IDENTITY');
  await ensureSolufolkRole();
  adminId = await createTestAdminUser();
  modId   = await createTestModeratorUser();
  userId  = await createTestRegularUser();
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ($1, 'sales@test.com', 'testsales',
             (SELECT password_hash FROM users WHERE id = $2), 'solufolk', TRUE)`,
    [SALES_ID, userId]
  );
  adminCookie = await getTestSessionCookie(adminId);
  modCookie   = await getTestSessionCookie(modId);
  userCookie  = await getTestSessionCookie(userId);
  salesCookie = await getTestSessionCookie(SALES_ID);
});

// ── Migration seed ───────────────────────────────────────────────────────────

describe('solufolk role seed (097)', () => {
  test('role holds handbok AND leads', async () => {
    const { rows } = await db.query("SELECT view_access FROM roles WHERE name = 'solufolk'");
    expect(rows[0].view_access).toEqual(expect.arrayContaining(['handbok', 'leads']));
  });
});

// ── Insert on contact ────────────────────────────────────────────────────────

describe('POST /api/v1/contact → leads row', () => {
  test('a valid submission is persisted with normalised fields, status new', async () => {
    const emailService = require('../../server/services/emailService');
    const spy = jest.spyOn(emailService, 'sendLeadNotification').mockResolvedValue(undefined);
    try {
      const res = await request(app).post('/api/v1/contact')
        .set('Accept-Language', 'is')
        .send(validPayload({ name: '  Jóna Jónsdóttir  ', current_platform: 'SHOPIFY' }));
      expect(res.status).toBe(200);
      const row = await pollLeadBySubmission('jona@example.is');
      expect(row).not.toBeNull();
      expect(row.name).toBe('Jóna Jónsdóttir');
      expect(row.company).toBe('Ísprjón ehf.');
      expect(row.phone).toBe('555 1234');
      expect(row.current_platform).toBe('shopify');
      expect(row.status).toBe('new');
      expect(row.source).toBe('hafa-samband');
      expect(row.submission_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.contacted_at).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });

  test('an unknown platform is stored as "other"', async () => {
    const spy = jest.spyOn(require('../../server/services/emailService'), 'sendLeadNotification').mockResolvedValue(undefined);
    try {
      await request(app).post('/api/v1/contact').send(validPayload({ email: 'x@example.is', current_platform: 'excel-sheets' }));
      const row = await pollLeadBySubmission('x@example.is');
      expect(row.current_platform).toBe('other');
    } finally { spy.mockRestore(); }
  });

  test('the honeypot path stores nothing', async () => {
    await request(app).post('/api/v1/contact').send(validPayload({ website: 'http://spam.bot' }));
    await new Promise(r => setTimeout(r, 150));
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM leads');
    expect(rows[0].n).toBe(0);
  });

  test('a validation failure stores nothing', async () => {
    const res = await request(app).post('/api/v1/contact').send(validPayload({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
    await new Promise(r => setTimeout(r, 150));
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM leads');
    expect(rows[0].n).toBe(0);
  });

  test('a database failure never reaches the visitor and never stops the email', async () => {
    const emailService = require('../../server/services/emailService');
    const mail = jest.spyOn(emailService, 'sendLeadNotification').mockResolvedValue(undefined);
    const persist = jest.spyOn(Lead, 'create').mockRejectedValue(new Error('db down'));
    try {
      const res = await request(app).post('/api/v1/contact').send(validPayload());
      expect(res.status).toBe(200);
      await new Promise(resolve => setImmediate(resolve));
      expect(mail).toHaveBeenCalledTimes(1);
      expect(persist).toHaveBeenCalledTimes(1);
    } finally { mail.mockRestore(); persist.mockRestore(); }
  });

  test('Lead.create itself never throws on a bad row', async () => {
    // A duplicate submission_id violates the UNIQUE constraint — the model
    // must swallow it (logging the id) rather than propagate.
    const { randomUUID } = require('crypto');
    const sid = randomUUID();
    const a = await Lead.create({ submissionId: sid, name: 'A', email: 'a@x.is', message: 'first message here' });
    const b = await Lead.create({ submissionId: sid, name: 'B', email: 'b@x.is', message: 'second message here' });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });
});

// ── The notification outcome on the row (migration 108) ──────────────────────

describe('the notification outcome (notified_at / notify_error)', () => {
  const emailService = require('../../server/services/emailService');
  const rowOf = async (email) => {
    // Poll until the outcome has been recorded — it lands after the insert
    // AND the send have both settled, strictly after the visitor's 200.
    for (let i = 0; i < 30; i++) {
      const { rows } = await db.query('SELECT * FROM leads WHERE email = $1', [email]);
      if (rows[0] && (rows[0].notified_at || rows[0].notify_error)) return rows[0];
      await new Promise(r => setTimeout(r, 50));
    }
    const { rows } = await db.query('SELECT * FROM leads WHERE email = $1', [email]);
    return rows[0] || null;
  };

  test('Lead.recordNotification: sent stamps notified_at and clears the error; a failure keeps the reason, capped', async () => {
    const { randomUUID } = require('crypto');
    const sid = randomUUID();
    const row = await Lead.create({ submissionId: sid, name: 'A', email: 'rn@x.is', message: 'first message here' });
    await Lead.recordNotification(sid, 'x'.repeat(900));
    let got = await Lead.findById(row.id);
    expect(got.notified_at).toBeNull();
    expect(got.notify_error).toBe('x'.repeat(500));
    await Lead.recordNotification(sid, null);
    got = await Lead.findById(row.id);
    expect(got.notified_at).not.toBeNull();
    expect(got.notify_error).toBeNull();
  });

  test('Lead.recordNotification never throws — an unknown submission id or a bad value is swallowed', async () => {
    await expect(Lead.recordNotification('no-such-submission', 'x')).resolves.toBeUndefined();
    await expect(Lead.recordNotification(undefined, null)).resolves.toBeUndefined();
  });

  test('the contact path: a sent email stamps notified_at', async () => {
    const spy = jest.spyOn(emailService, 'sendLeadNotification').mockResolvedValue(true);
    try {
      expect((await request(app).post('/api/v1/contact').send(validPayload({ email: 'sent@example.is' }))).status).toBe(200);
      const row = await rowOf('sent@example.is');
      expect(row.notified_at).not.toBeNull();
      expect(row.notify_error).toBeNull();
    } finally { spy.mockRestore(); }
  });

  test('the contact path: no transport → "email not configured"; a send error → its message; the visitor still gets 200', async () => {
    const off = jest.spyOn(emailService, 'sendLeadNotification').mockResolvedValue(false);
    try {
      expect((await request(app).post('/api/v1/contact').send(validPayload({ email: 'off@example.is' }))).status).toBe(200);
      const row = await rowOf('off@example.is');
      expect(row.notified_at).toBeNull();
      expect(row.notify_error).toBe('email not configured');
    } finally { off.mockRestore(); }

    const boom = jest.spyOn(emailService, 'sendLeadNotification').mockRejectedValue(new Error('Resend error: 502'));
    try {
      expect((await request(app).post('/api/v1/contact').send(validPayload({ email: 'boom@example.is' }))).status).toBe(200);
      const row = await rowOf('boom@example.is');
      expect(row.notified_at).toBeNull();
      expect(row.notify_error).toBe('Resend error: 502');
    } finally { boom.mockRestore(); }
  });

  test('the inbox carries the outcome, so the view can mark a row that was not emailed', async () => {
    const off = jest.spyOn(emailService, 'sendLeadNotification').mockResolvedValue(false);
    try {
      await request(app).post('/api/v1/contact').send(validPayload({ email: 'mark@example.is' }));
      await rowOf('mark@example.is');
    } finally { off.mockRestore(); }
    const res = await request(app).get('/api/v1/admin/leads').set('Cookie', salesCookie);
    expect(res.status).toBe(200);
    const lead = res.body.leads.find(l => l.email === 'mark@example.is');
    expect(lead.notify_error).toBe('email not configured');
    expect(lead.notified_at).toBeNull();
    const one = await request(app).get(`/api/v1/admin/leads/${lead.id}`).set('Cookie', salesCookie);
    expect(one.body.lead.notify_error).toBe('email not configured');
  });
});

// ── Read access (requireView('leads')) ───────────────────────────────────────

describe('GET /api/v1/admin/leads', () => {
  test('unauthenticated → 401', async () => {
    expect((await request(app).get('/api/v1/admin/leads')).status).toBe(401);
  });

  test('plain user → 403', async () => {
    expect((await request(app).get('/api/v1/admin/leads').set('Cookie', userCookie)).status).toBe(403);
  });

  test('solufolk reads the list, newest first, no-store', async () => {
    const first = await insertLead({ email: 'first@example.is' });
    await db.query(`UPDATE leads SET created_at = NOW() - interval '1 hour' WHERE id = $1`, [first]);
    const second = await insertLead({ email: 'second@example.is' });
    const res = await request(app).get('/api/v1/admin/leads').set('Cookie', salesCookie);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.leads.map(l => l.id)).toEqual([second, first]);
    expect(res.body.total).toBe(2);
    expect(res.body.counts).toEqual({ new: 2, contacted: 0, won: 0, lost: 0 });
    expect(res.body.retentionDays).toBe(730);
  });

  test('admin reads too; filters by status, search and owner=me', async () => {
    const a = await insertLead({ email: 'a@example.is', company: 'Alpha ehf.' });
    const b = await insertLead({ email: 'b@example.is', company: 'Beta ehf.' });
    await request(app).patch(`/api/v1/admin/leads/${b}`).set('Cookie', salesCookie).send({ status: 'contacted', owner_user_id: SALES_ID });

    const byStatus = await request(app).get('/api/v1/admin/leads?status=contacted').set('Cookie', adminCookie);
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.leads.map(l => l.id)).toEqual([b]);

    const byQ = await request(app).get('/api/v1/admin/leads?q=alpha').set('Cookie', adminCookie);
    expect(byQ.body.leads.map(l => l.id)).toEqual([a]);

    const mineSales = await request(app).get('/api/v1/admin/leads?owner=me').set('Cookie', salesCookie);
    expect(mineSales.body.leads.map(l => l.id)).toEqual([b]);
    const mineAdmin = await request(app).get('/api/v1/admin/leads?owner=me').set('Cookie', adminCookie);
    expect(mineAdmin.body.leads).toEqual([]);
  });

  test('solufolk is still 403 on the customer list (the tiny-sidebar promise)', async () => {
    expect((await request(app).get('/api/v1/admin/customers').set('Cookie', salesCookie)).status).toBe(403);
  });

  test('GET /:id → 200 for the view, 404 unknown, 400 non-numeric', async () => {
    const id = await insertLead();
    const ok = await request(app).get(`/api/v1/admin/leads/${id}`).set('Cookie', salesCookie);
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.body.lead.email).toBe('prufa@example.is');
    expect((await request(app).get('/api/v1/admin/leads/999999').set('Cookie', salesCookie)).status).toBe(404);
    expect((await request(app).get('/api/v1/admin/leads/abc').set('Cookie', salesCookie)).status).toBe(400);
  });

  // Ids are strings end to end (rk-feed, 2026-09-23): a product whose leads
  // table predates the engine's holds TEXT uuids. The routes accept a uuid
  // and compare as text — here, against SERIAL ids, that is a clean 404,
  // never a 400 (rejected shape) and never a 500 (pg 22P02 on `id = $1`).
  test('a uuid-shaped id is accepted by every route and compared as text (404 here, never 400/500)', async () => {
    const uuid = '8d3e1c2a-4b5f-4e6d-9a7b-0c1d2e3f4a5b';
    expect((await request(app).get(`/api/v1/admin/leads/${uuid}`).set('Cookie', salesCookie)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/admin/leads/${uuid}`).set('Cookie', salesCookie).send({ status: 'contacted' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/admin/leads/${uuid}`).set('Cookie', adminCookie)).status).toBe(404);
    for (const bad of ['0', '-1', '1.5', '1e3', '12abc', '8d3e1c2a-4b5f-4e6d-9a7b']) {
      expect((await request(app).get(`/api/v1/admin/leads/${encodeURIComponent(bad)}`).set('Cookie', salesCookie)).status).toBe(400);
    }
    // The integer path still round-trips through the text compare.
    const id = await insertLead();
    const r = await request(app).patch(`/api/v1/admin/leads/${id}`).set('Cookie', salesCookie).send({ note: 'texti' });
    expect(r.status).toBe(200);
    expect(String(r.body.lead.id)).toBe(String(id));
    expect(r.body.lead.note).toBe('texti');
  });
});

// ── Workflow writes (requireView('leads')) ───────────────────────────────────

describe('PATCH /api/v1/admin/leads/:id', () => {
  test('solufolk marks contacted: first touch stamped once, never restamped', async () => {
    const id = await insertLead();
    const r1 = await request(app).patch(`/api/v1/admin/leads/${id}`).set('Cookie', salesCookie).send({ status: 'contacted' });
    expect(r1.status).toBe(200);
    expect(r1.headers['cache-control']).toBe('no-store');
    expect(r1.body.lead.status).toBe('contacted');
    expect(r1.body.lead.contacted_at).not.toBeNull();
    expect(r1.body.lead.contacted_by).toBe(SALES_ID);
    expect(r1.body.lead.contacted_by_name).toBe('testsales');
    const stamp = r1.body.lead.contacted_at;

    await new Promise(r => setTimeout(r, 20));
    const r2 = await request(app).patch(`/api/v1/admin/leads/${id}`).set('Cookie', adminCookie).send({ status: 'won' });
    expect(r2.body.lead.status).toBe('won');
    expect(r2.body.lead.contacted_at).toBe(stamp);
    expect(r2.body.lead.contacted_by).toBe(SALES_ID);
  });

  test('note and owner round-trip; owner can be released', async () => {
    const id = await insertLead();
    const r1 = await request(app).patch(`/api/v1/admin/leads/${id}`).set('Cookie', salesCookie)
      .send({ note: 'Hringdi, á að hringja aftur á fimmtudag.', owner_user_id: SALES_ID });
    expect(r1.status).toBe(200);
    expect(r1.body.lead.note).toBe('Hringdi, á að hringja aftur á fimmtudag.');
    expect(r1.body.lead.owner_user_id).toBe(SALES_ID);
    expect(r1.body.lead.owner_name).toBe('testsales');
    // A note alone does NOT count as contact.
    expect(r1.body.lead.contacted_at).toBeNull();

    const r2 = await request(app).patch(`/api/v1/admin/leads/${id}`).set('Cookie', salesCookie).send({ owner_user_id: null });
    expect(r2.body.lead.owner_user_id).toBeNull();
  });

  test('submission fields are immutable — extra keys are ignored, not applied', async () => {
    const id = await insertLead();
    const res = await request(app).patch(`/api/v1/admin/leads/${id}`).set('Cookie', salesCookie)
      .send({ status: 'lost', name: 'Hacker', email: 'evil@example.is', message: 'changed' });
    expect(res.status).toBe(200);
    expect(res.body.lead.name).toBe('Prufa');
    expect(res.body.lead.email).toBe('prufa@example.is');
    expect(res.body.lead.status).toBe('lost');
  });

  test('validation: bad status 400, unknown owner 400, empty body 400, over-long note 400', async () => {
    const id = await insertLead();
    const c = salesCookie;
    expect((await request(app).patch(`/api/v1/admin/leads/${id}`).set('Cookie', c).send({ status: 'archived' })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/admin/leads/${id}`).set('Cookie', c).send({ owner_user_id: 'no-such-user' })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/admin/leads/${id}`).set('Cookie', c).send({ name: 'x' })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/admin/leads/${id}`).set('Cookie', c).send({ note: 'x'.repeat(4001) })).status).toBe(400);
  });

  test('plain user 403, unauthenticated 401, unknown id 404', async () => {
    const id = await insertLead();
    expect((await request(app).patch(`/api/v1/admin/leads/${id}`).set('Cookie', userCookie).send({ status: 'won' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/admin/leads/${id}`).send({ status: 'won' })).status).toBe(401);
    expect((await request(app).patch('/api/v1/admin/leads/999999').set('Cookie', adminCookie).send({ status: 'won' })).status).toBe(404);
  });
});

// ── Erasure + export (admin only) ────────────────────────────────────────────

describe('DELETE /api/v1/admin/leads/:id', () => {
  test('solufolk 403, moderator 403, admin 204 then 404', async () => {
    const id = await insertLead();
    expect((await request(app).delete(`/api/v1/admin/leads/${id}`).set('Cookie', salesCookie)).status).toBe(403);
    expect((await request(app).delete(`/api/v1/admin/leads/${id}`).set('Cookie', modCookie)).status).toBe(403);
    expect((await request(app).delete(`/api/v1/admin/leads/${id}`).set('Cookie', adminCookie)).status).toBe(204);
    expect((await request(app).get(`/api/v1/admin/leads/${id}`).set('Cookie', adminCookie)).status).toBe(404);
  });
});

describe('GET /api/v1/admin/leads/export.csv', () => {
  test('solufolk 403; admin gets CSV, no-store, formula-neutralised', async () => {
    await insertLead({ email: 'csv@example.is', message: '=SUM(1,2) sjá töflu' });
    expect((await request(app).get('/api/v1/admin/leads/export.csv').set('Cookie', salesCookie)).status).toBe(403);
    const res = await request(app).get('/api/v1/admin/leads/export.csv').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toMatch(/fyrirspurnir-\d{4}-\d{2}-\d{2}\.csv/);
    expect(res.text).toContain('csv@example.is');
    expect(res.text).toContain("'=SUM(1");
  });
});

// ── Retention ────────────────────────────────────────────────────────────────

describe('retention', () => {
  test('pruneOlderThan removes only rows past the window', async () => {
    const old = await insertLead({ email: 'old@example.is' });
    await insertLead({ email: 'fresh@example.is' });
    await db.query(`UPDATE leads SET created_at = NOW() - interval '800 days' WHERE id = $1`, [old]);
    expect(await Lead.pruneOlderThan(730)).toBe(1);
    const { rows } = await db.query('SELECT email FROM leads');
    expect(rows.map(r => r.email)).toEqual(['fresh@example.is']);
  });

  test('pruneLeads never throws', async () => {
    const { pruneLeads } = require('../../server/services/leadsCleanup');
    const spy = jest.spyOn(Lead, 'pruneOlderThan').mockRejectedValue(new Error('db down'));
    try {
      await expect(pruneLeads()).resolves.toBeUndefined();
    } finally { spy.mockRestore(); }
  });
});
