// Integration tests for Handbók sölufólks (the sales-staff handbook, migration
// 090): the guides CRUD API, its RBAC (read = requireView('handbok') via the
// seeded `solufolk` role; write = admin/moderator; delete = admin), the
// IS-canonical / EN-COALESCE locale resolution, and the no-store cache
// posture. CSRF is bypassed in test mode (see tests/env.js).
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  createTestAdminUser,
  createTestModeratorUser,
  createTestRegularUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

let adminCookie, modCookie, userCookie, salesCookie;
let adminId, modId, userId;

const validGuide = {
  title:   'Sölusagan',
  summary: 'Hvernig við kynnum Rekstrarkerfið',
  body:    '<p>Eitt kerfi, ein áskrift.</p>',
  section: 'sala',
};

// Mirror of the migration-090 role seed. Other suites clear non-system roles
// between tests (adminRoles.test.js), and migrations run once per DB — so this
// suite re-seeds idempotently with the exact same statement the migration uses.
async function ensureSolufolkRole() {
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system) VALUES
       ('solufolk', 'Sölufólk — aðgangur að handbók sölufólks',
        '["handbok"]'::jsonb, FALSE)
     ON CONFLICT (name) DO NOTHING`
  );
}

beforeEach(async () => {
  await cleanTables();
  await ensureSolufolkRole();
  adminId = await createTestAdminUser();
  modId   = await createTestModeratorUser();
  userId  = await createTestRegularUser();

  // A sales-staff user: regular account whose primary role is `solufolk`.
  // requireAuth floors req.user.roles to [users.role] when user_roles is empty.
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ('test-sales-id', 'sales@test.com', 'testsales',
             (SELECT password_hash FROM users WHERE id = $1), 'solufolk', TRUE)`,
    [userId]
  );

  adminCookie = await getTestSessionCookie(adminId);
  modCookie   = await getTestSessionCookie(modId);
  userCookie  = await getTestSessionCookie(userId);
  salesCookie = await getTestSessionCookie('test-sales-id');
});

async function createGuide(cookie, overrides = {}) {
  return request(app).post('/api/v1/admin/handbok')
    .set('Cookie', cookie)
    .send({ ...validGuide, ...overrides });
}

// ── Migration seed ───────────────────────────────────────────────────────────

describe('solufolk role seed', () => {
  test('role exists with exactly the handbok view', async () => {
    const { rows } = await db.query("SELECT view_access, is_system FROM roles WHERE name = 'solufolk'");
    expect(rows[0]).toBeDefined();
    expect(rows[0].view_access).toEqual(['handbok']);
    expect(rows[0].is_system).toBe(false);
  });
});

// ── Read access (requireView('handbok')) ─────────────────────────────────────

describe('GET /api/v1/admin/handbok', () => {
  test('unauthenticated → 401', async () => {
    expect((await request(app).get('/api/v1/admin/handbok')).status).toBe(401);
  });

  test('plain user role → 403', async () => {
    expect((await request(app).get('/api/v1/admin/handbok').set('Cookie', userCookie)).status).toBe(403);
  });

  test('solufolk sees published guides only, never drafts, with no-store', async () => {
    await createGuide(adminCookie, { published: true });
    await createGuide(adminCookie, { title: 'Drög', slug: 'drog', published: false });

    const res = await request(app).get('/api/v1/admin/handbok').set('Cookie', salesCookie);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.guides).toHaveLength(1);
    expect(res.body.guides[0].title).toBe('Sölusagan');
    expect(res.body.sections).toEqual(['grunnur', 'sala', 'thjonusta', 'vara']);
  });

  test('admin can read the list too (implicit all-views)', async () => {
    await createGuide(adminCookie, { published: true });
    const res = await request(app).get('/api/v1/admin/handbok').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.guides).toHaveLength(1);
  });

  test('list is ordered by section then sort_order', async () => {
    await createGuide(adminCookie, { title: 'B', section: 'sala',    sort_order: 1, published: true });
    await createGuide(adminCookie, { title: 'A', section: 'grunnur', sort_order: 5, published: true });
    await createGuide(adminCookie, { title: 'C', section: 'sala',    sort_order: 0, published: true });
    const res = await request(app).get('/api/v1/admin/handbok').set('Cookie', salesCookie);
    expect(res.body.guides.map(g => g.title)).toEqual(['A', 'C', 'B']);
  });
});

describe('GET /api/v1/admin/handbok/:slug', () => {
  test('solufolk reads a published guide; drafts 404', async () => {
    const pub   = await createGuide(adminCookie, { published: true });
    const draft = await createGuide(adminCookie, { title: 'Drög', slug: 'drog', published: false });

    const ok = await request(app).get(`/api/v1/admin/handbok/${pub.body.slug}`).set('Cookie', salesCookie);
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.body.body).toBe('<p>Eitt kerfi, ein áskrift.</p>');

    const miss = await request(app).get(`/api/v1/admin/handbok/${draft.body.slug}`).set('Cookie', salesCookie);
    expect(miss.status).toBe(404);
  });

  test('EN locale gets _en fields with COALESCE fallback to Icelandic', async () => {
    await createGuide(adminCookie, {
      published: true,
      title_en: 'The sales story', body_en: null, // body_en missing → IS body
    });
    // Locale resolution honors ?locale= (resolveLocale candidates), not
    // Accept-Language.
    const res = await request(app)
      .get('/api/v1/admin/handbok/solusagan?locale=en')
      .set('Cookie', salesCookie);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('The sales story');
    expect(res.body.body).toBe('<p>Eitt kerfi, ein áskrift.</p>');
  });
});

// ── Write access (admin/moderator only) ──────────────────────────────────────

describe('write endpoints RBAC', () => {
  test('solufolk cannot create/update/delete/manage/preview', async () => {
    const created = await createGuide(adminCookie, { published: true });

    expect((await createGuide(salesCookie)).status).toBe(403);
    expect((await request(app).patch(`/api/v1/admin/handbok/${created.body.id}`)
      .set('Cookie', salesCookie).send({ title: 'Hacked' })).status).toBe(403);
    expect((await request(app).delete(`/api/v1/admin/handbok/${created.body.id}`)
      .set('Cookie', salesCookie)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/handbok/manage')
      .set('Cookie', salesCookie)).status).toBe(403);
    expect((await request(app).get(`/api/v1/admin/handbok/${created.body.slug}/preview`)
      .set('Cookie', salesCookie)).status).toBe(403);
    expect((await request(app).put('/api/v1/admin/handbok/reorder')
      .set('Cookie', salesCookie).send({ order: [{ id: created.body.id, sort_order: 1 }] })).status).toBe(403);
  });

  test('solufolk gets 403 on OTHER admin APIs (the tiny-sidebar promise)', async () => {
    expect((await request(app).get('/api/v1/admin/customers').set('Cookie', salesCookie)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/shop/orders').set('Cookie', salesCookie)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/roles').set('Cookie', salesCookie)).status).toBe(403);
  });

  test('moderator: create draft → publish stamps published_at once → reorder', async () => {
    const created = await createGuide(modCookie);
    expect(created.status).toBe(201);
    expect(created.body.published).toBe(false);
    expect(created.body.published_at).toBeNull();
    expect(created.body.slug).toBe('solusagan'); // ö→o, auto-slug

    const pub = await request(app).patch(`/api/v1/admin/handbok/${created.body.id}`)
      .set('Cookie', modCookie).send({ published: true });
    expect(pub.status).toBe(200);
    expect(pub.body.published_at).not.toBeNull();

    // Re-publishing does not restamp
    await request(app).patch(`/api/v1/admin/handbok/${created.body.id}`)
      .set('Cookie', modCookie).send({ published: false });
    const repub = await request(app).patch(`/api/v1/admin/handbok/${created.body.id}`)
      .set('Cookie', modCookie).send({ published: true });
    expect(repub.body.published_at).toBe(pub.body.published_at);

    const reorder = await request(app).put('/api/v1/admin/handbok/reorder')
      .set('Cookie', modCookie)
      .send({ order: [{ id: created.body.id, section: 'vara', sort_order: 3 }] });
    expect(reorder.status).toBe(200);
    expect(reorder.body.guides[0].section).toBe('vara');
    expect(reorder.body.guides[0].sort_order).toBe(3);
  });

  test('moderator cannot hard-delete (403); admin can (204)', async () => {
    const created = await createGuide(adminCookie);
    expect((await request(app).delete(`/api/v1/admin/handbok/${created.body.id}`)
      .set('Cookie', modCookie)).status).toBe(403);
    expect((await request(app).delete(`/api/v1/admin/handbok/${created.body.id}`)
      .set('Cookie', adminCookie)).status).toBe(204);
  });

  test('manage list surfaces drafts and both locales raw', async () => {
    await createGuide(adminCookie, { title_en: 'The sales story', published: false });
    const res = await request(app).get('/api/v1/admin/handbok/manage').set('Cookie', modCookie);
    expect(res.status).toBe(200);
    expect(res.body.guides).toHaveLength(1);
    expect(res.body.guides[0].title).toBe('Sölusagan');
    expect(res.body.guides[0].title_en).toBe('The sales story');
    expect(res.body.guides[0].published).toBe(false);
  });
});

// ── Validation + sanitization ────────────────────────────────────────────────

describe('validation and sanitization', () => {
  test('missing title/body on POST → 400', async () => {
    expect((await request(app).post('/api/v1/admin/handbok')
      .set('Cookie', adminCookie).send({ section: 'sala' })).status).toBe(400);
  });

  test('invalid section → 400', async () => {
    expect((await createGuide(adminCookie, { section: 'nope' })).status).toBe(400);
  });

  test('explicit duplicate slug → deduped with suffix (news convention)', async () => {
    const a = await createGuide(adminCookie, { slug: 'minn-slug' });
    const b = await createGuide(adminCookie, { title: 'Önnur', slug: 'minn-slug' });
    expect(a.body.slug).toBe('minn-slug');
    expect(b.status).toBe(201);
    expect(b.body.slug).toBe('minn-slug-2');
  });

  test('script tags are stripped from body; body_en rich HTML survives', async () => {
    const res = await createGuide(adminCookie, {
      body:    '<p>Í lagi</p><script>alert(1)</script>',
      body_en: '<p>Fine <strong>bold</strong></p>',
    });
    expect(res.status).toBe(201);
    expect(res.body.body).not.toContain('<script>');
    expect(res.body.body).toContain('<p>Í lagi</p>');
    expect(res.body.body_en).toBe('<p>Fine <strong>bold</strong></p>');
  });

  test('reorder with unknown id → 400', async () => {
    const res = await request(app).put('/api/v1/admin/handbok/reorder')
      .set('Cookie', adminCookie).send({ order: [{ id: 999999, sort_order: 0 }] });
    expect(res.status).toBe(400);
  });
});
