const request = require('supertest');
const path    = require('path');
const fs      = require('fs');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  getTestSessionCookie,
  createTestModeratorUser,
  createTestRegularUser,
  cleanTables,
  validArticle,
} = require('../helpers');

// Minimal 1x1 transparent PNG for upload tests
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

let adminCookie;
let modCookie;
let userCookie;
let articleId;

const uploadDirs = new Set();

function cleanupUploadDir(id) {
  const dir = path.join(__dirname, '../../public/assets/news', String(id));
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

beforeEach(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie();

  const modId  = await createTestModeratorUser();
  const userId = await createTestRegularUser();
  modCookie    = await getTestSessionCookie(modId);
  userCookie   = await getTestSessionCookie(userId);

  // Create an article to attach media to
  const res = await request(app)
    .post('/api/v1/news')
    .set('Cookie', adminCookie)
    .send(validArticle());
  articleId = res.body.id;
  uploadDirs.add(articleId);
});

afterEach(() => {
  uploadDirs.forEach(id => cleanupUploadDir(id));
  uploadDirs.clear();
});

afterAll(async () => {
  await db.pool.end();
});

// ── Helper: seed a media row directly ────────────────────────────────────────

async function seedMedia(overrides = {}) {
  const { rows } = await db.query(
    `INSERT INTO news_media (article_id, kind, file_path, caption, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      overrides.article_id ?? articleId,
      overrides.kind       ?? 'image',
      overrides.file_path  ?? '/assets/news/test/img.jpg',
      overrides.caption    ?? null,
      overrides.sort_order ?? 0,
    ]
  );
  return rows[0];
}

async function seedYouTube(overrides = {}) {
  const { rows } = await db.query(
    `INSERT INTO news_media (article_id, kind, youtube_id, caption, sort_order)
     VALUES ($1, 'youtube', $2, $3, $4)
     RETURNING *`,
    [
      overrides.article_id ?? articleId,
      overrides.youtube_id ?? 'dQw4w9WgXcQ',
      overrides.caption    ?? null,
      overrides.sort_order ?? 0,
    ]
  );
  return rows[0];
}

// ── GET /api/v1/news/:id/media ──────────────────────────────────────────────

describe('GET /api/v1/news/:id/media', () => {
  test('returns empty array when no media', async () => {
    const res = await request(app).get(`/api/v1/news/${articleId}/media`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns media ordered by sort_order', async () => {
    await seedMedia({ sort_order: 2, caption: 'Second' });
    await seedMedia({ sort_order: 1, caption: 'First' });

    const res = await request(app).get(`/api/v1/news/${articleId}/media`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].caption).toBe('First');
    expect(res.body[1].caption).toBe('Second');
  });
});

// ── POST /api/v1/news/:id/media (file upload) ──────────────────────────────

describe('POST /api/v1/news/:id/media', () => {
  test('uploads image file', async () => {
    const res = await request(app)
      .post(`/api/v1/news/${articleId}/media`)
      .set('Cookie', adminCookie)
      .attach('file', PNG_BUFFER, 'test.png');
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.kind).toBe('image');
    expect(res.body.file_path).toMatch(/^\/assets\/news\//);
    expect(res.body.article_id).toBe(articleId);
  });

  test('returns 400 without file', async () => {
    const res = await request(app)
      .post(`/api/v1/news/${articleId}/media`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  test('returns 403 for regular user', async () => {
    const res = await request(app)
      .post(`/api/v1/news/${articleId}/media`)
      .set('Cookie', userCookie)
      .attach('file', PNG_BUFFER, 'test.png');
    expect(res.status).toBe(403);
  });

  test('moderator can upload', async () => {
    const res = await request(app)
      .post(`/api/v1/news/${articleId}/media`)
      .set('Cookie', modCookie)
      .attach('file', PNG_BUFFER, 'test.png');
    expect(res.status).toBe(201);
  });

  test('returns 404 for non-existent article', async () => {
    const res = await request(app)
      .post('/api/v1/news/99999/media')
      .set('Cookie', adminCookie)
      .attach('file', PNG_BUFFER, 'test.png');
    expect(res.status).toBe(404);
  });
});

// ── POST /api/v1/news/:id/media/youtube ─────────────────────────────────────

describe('POST /api/v1/news/:id/media/youtube', () => {
  test('adds YouTube video by URL', async () => {
    const res = await request(app)
      .post(`/api/v1/news/${articleId}/media/youtube`)
      .set('Cookie', adminCookie)
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('youtube');
    expect(res.body.youtube_id).toBe('dQw4w9WgXcQ');
  });

  test('accepts short YouTube URL', async () => {
    const res = await request(app)
      .post(`/api/v1/news/${articleId}/media/youtube`)
      .set('Cookie', adminCookie)
      .send({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(res.status).toBe(201);
    expect(res.body.youtube_id).toBe('dQw4w9WgXcQ');
  });

  test('returns 400 for invalid URL', async () => {
    const res = await request(app)
      .post(`/api/v1/news/${articleId}/media/youtube`)
      .set('Cookie', adminCookie)
      .send({ url: 'not-a-youtube-url' });
    expect(res.status).toBe(400);
  });

  test('returns 400 without url', async () => {
    const res = await request(app)
      .post(`/api/v1/news/${articleId}/media/youtube`)
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  test('returns 403 for regular user', async () => {
    const res = await request(app)
      .post(`/api/v1/news/${articleId}/media/youtube`)
      .set('Cookie', userCookie)
      .send({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/v1/news/:id/media/:mediaId ───────────────────────────────────

describe('PATCH /api/v1/news/:id/media/:mediaId', () => {
  test('updates caption', async () => {
    const media = await seedMedia();
    const res = await request(app)
      .patch(`/api/v1/news/${articleId}/media/${media.id}`)
      .set('Cookie', adminCookie)
      .send({ caption: 'New caption' });
    expect(res.status).toBe(200);
    expect(res.body.caption).toBe('New caption');
  });

  test('returns 404 for wrong article', async () => {
    const media = await seedMedia();
    const res = await request(app)
      .patch(`/api/v1/news/99999/media/${media.id}`)
      .set('Cookie', adminCookie)
      .send({ caption: 'test' });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/v1/news/:id/media/:mediaId ──────────────────────────────────

describe('DELETE /api/v1/news/:id/media/:mediaId', () => {
  test('deletes media', async () => {
    const media = await seedMedia();
    const res = await request(app)
      .delete(`/api/v1/news/${articleId}/media/${media.id}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);

    // Verify gone
    const list = await request(app).get(`/api/v1/news/${articleId}/media`);
    expect(list.body).toHaveLength(0);
  });

  test('returns 404 for non-existent media', async () => {
    const res = await request(app)
      .delete(`/api/v1/news/${articleId}/media/99999`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  test('returns 403 for regular user', async () => {
    const media = await seedMedia();
    const res = await request(app)
      .delete(`/api/v1/news/${articleId}/media/${media.id}`)
      .set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });
});

// ── PUT /api/v1/news/:id/media/reorder ──────────────────────────────────────

describe('PUT /api/v1/news/:id/media/reorder', () => {
  test('reorders media', async () => {
    const m1 = await seedMedia({ sort_order: 0, caption: 'First' });
    const m2 = await seedMedia({ sort_order: 1, caption: 'Second' });

    const res = await request(app)
      .put(`/api/v1/news/${articleId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [
        { id: m2.id, sort_order: 0 },
        { id: m1.id, sort_order: 1 },
      ]});
    expect(res.status).toBe(200);
    expect(res.body[0].caption).toBe('Second');
    expect(res.body[1].caption).toBe('First');
  });

  test('returns 400 for invalid order', async () => {
    const res = await request(app)
      .put(`/api/v1/news/${articleId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: 'invalid' });
    expect(res.status).toBe(400);
  });

  test('returns 400 if media IDs do not belong to article', async () => {
    const res = await request(app)
      .put(`/api/v1/news/${articleId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [{ id: 99999, sort_order: 0 }] });
    expect(res.status).toBe(400);
  });
});
