const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  getTestSessionCookie,
  createTestModeratorUser,
  createTestRegularUser,
  cleanTables,
} = require('../helpers');

let adminCookie;
let modCookie;
let userCookie;

beforeEach(async () => {
  await cleanTables();
  // Reset site_content between tests so each starts clean
  await db.query('DELETE FROM site_content');

  adminCookie = await getTestSessionCookie(); // admin by default

  const modId  = await createTestModeratorUser();
  modCookie    = await getTestSessionCookie(modId);

  const userId = await createTestRegularUser();
  userCookie   = await getTestSessionCookie(userId);
});

afterAll(async () => {
  await db.pool.end();
});

// ── GET /api/v1/content ───────────────────────────────────────────────────────

describe('GET /api/v1/content', () => {
  test('returns 200 and empty object when no content seeded', async () => {
    const res = await request(app).get('/api/v1/content');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
    expect(Array.isArray(res.body)).toBe(false);
  });

  test('returns seeded key/value pairs', async () => {
    await db.query(
      `INSERT INTO site_content (key, value) VALUES ('hero_subtitle', 'Hello world')`
    );
    const res = await request(app).get('/api/v1/content');
    expect(res.status).toBe(200);
    expect(res.body.hero_subtitle).toBe('Hello world');
  });

  test('is accessible without authentication', async () => {
    const res = await request(app).get('/api/v1/content');
    expect(res.status).toBe(200);
  });
});

// ── PATCH /api/v1/content ─────────────────────────────────────────────────────

describe('PATCH /api/v1/content', () => {
  test('admin can update content', async () => {
    const res = await request(app)
      .patch('/api/v1/content')
      .set('Cookie', adminCookie)
      .send({ hero_subtitle: 'Updated subtitle' });

    expect(res.status).toBe(200);
    expect(res.body.hero_subtitle).toBe('Updated subtitle');
  });

  test('moderator can update content', async () => {
    const res = await request(app)
      .patch('/api/v1/content')
      .set('Cookie', modCookie)
      .send({ contact_desc: 'New contact text' });

    expect(res.status).toBe(200);
    expect(res.body.contact_desc).toBe('New contact text');
  });

  test('regular user gets 403', async () => {
    const res = await request(app)
      .patch('/api/v1/content')
      .set('Cookie', userCookie)
      .send({ hero_subtitle: 'Hacked' });

    expect(res.status).toBe(403);
  });

  test('unauthenticated request gets 401', async () => {
    const res = await request(app)
      .patch('/api/v1/content')
      .send({ hero_subtitle: 'Hacked' });

    expect(res.status).toBe(401);
  });

  test('multiple keys are saved atomically and returned', async () => {
    const res = await request(app)
      .patch('/api/v1/content')
      .set('Cookie', adminCookie)
      .send({
        news_heading:     'What\'s New',
        projects_eyebrow: 'Explore',
        skills_tag:       'Decades of craft',
      });

    expect(res.status).toBe(200);
    expect(res.body.news_heading).toBe('What\'s New');
    expect(res.body.projects_eyebrow).toBe('Explore');
    expect(res.body.skills_tag).toBe('Decades of craft');
  });

  test('subsequent PATCH overwrites previous values', async () => {
    await request(app)
      .patch('/api/v1/content')
      .set('Cookie', adminCookie)
      .send({ hero_subtitle: 'First value' });

    const res = await request(app)
      .patch('/api/v1/content')
      .set('Cookie', adminCookie)
      .send({ hero_subtitle: 'Second value' });

    expect(res.status).toBe(200);
    expect(res.body.hero_subtitle).toBe('Second value');
  });

  test('rejects invalid key format', async () => {
    const res = await request(app)
      .patch('/api/v1/content')
      .set('Cookie', adminCookie)
      .send({ 'bad-key!': 'value' });

    expect(res.status).toBe(400);
  });

  test('rejects non-string value', async () => {
    const res = await request(app)
      .patch('/api/v1/content')
      .set('Cookie', adminCookie)
      .send({ hero_subtitle: 123 });

    expect(res.status).toBe(400);
  });

  test('saved content is returned by subsequent GET', async () => {
    await request(app)
      .patch('/api/v1/content')
      .set('Cookie', adminCookie)
      .send({ contact_title: 'Reach Out' });

    const get = await request(app).get('/api/v1/content');
    expect(get.status).toBe(200);
    expect(get.body.contact_title).toBe('Reach Out');
  });
});
