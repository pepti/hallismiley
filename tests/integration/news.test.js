const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  getTestSessionCookie,
  createTestModeratorUser,
  createTestRegularUser,
  cleanTables,
  validArticle,
} = require('../helpers');

let adminCookie;

beforeEach(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie(); // admin session
});

afterAll(async () => {
  await db.pool.end();
});

// ── GET /api/v1/news ─────────────────────────────────────────────────────────

describe('GET /api/v1/news', () => {
  test('returns 200 with empty articles array when no articles exist', async () => {
    const res = await request(app).get('/api/v1/news');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('articles');
    expect(Array.isArray(res.body.articles)).toBe(true);
    expect(res.body.articles).toHaveLength(0);
    expect(res.body).toHaveProperty('total', 0);
  });

  test('only returns published articles to public', async () => {
    // Create published and draft
    await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Published', published: true }));
    await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Draft', published: false }));

    const res = await request(app).get('/api/v1/news');
    expect(res.status).toBe(200);
    expect(res.body.articles).toHaveLength(1);
    expect(res.body.articles[0].title).toBe('Published');
  });

  test('pagination: limit and offset work', async () => {
    for (let i = 1; i <= 5; i++) {
      await request(app)
        .post('/api/v1/news')
        .set('Cookie', adminCookie)
        .send(validArticle({ title: `Article ${i}`, published: true }));
    }

    const page1 = await request(app).get('/api/v1/news?limit=3&offset=0');
    expect(page1.status).toBe(200);
    expect(page1.body.articles).toHaveLength(3);
    expect(page1.body.total).toBe(5);

    const page2 = await request(app).get('/api/v1/news?limit=3&offset=3');
    expect(page2.status).toBe(200);
    expect(page2.body.articles).toHaveLength(2);
  });

  test('filters by category', async () => {
    await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Tech Article', category: 'tech', published: true }));
    await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'News Article', category: 'news', published: true }));

    const res = await request(app).get('/api/v1/news?category=tech');
    expect(res.status).toBe(200);
    expect(res.body.articles).toHaveLength(1);
    expect(res.body.articles[0].category).toBe('tech');
  });

  test('returns articles sorted by published_at desc', async () => {
    // Create with slight delay via different published_at values
    await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Older', published: true, published_at: '2026-01-01T00:00:00Z' }));
    await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Newer', published: true, published_at: '2026-06-01T00:00:00Z' }));

    const res = await request(app).get('/api/v1/news');
    expect(res.status).toBe(200);
    expect(res.body.articles[0].title).toBe('Newer');
    expect(res.body.articles[1].title).toBe('Older');
  });
});

// ── GET /api/v1/news/:slug ────────────────────────────────────────────────────

describe('GET /api/v1/news/:slug', () => {
  test('returns 200 for a published article', async () => {
    const created = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Hello World', published: true }));
    expect(created.status).toBe(201);

    const res = await request(app).get(`/api/v1/news/${created.body.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Hello World');
  });

  test('returns 404 for an unpublished article (public)', async () => {
    const created = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Draft Article', published: false }));
    expect(created.status).toBe(201);

    const res = await request(app).get(`/api/v1/news/${created.body.slug}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 for a non-existent slug', async () => {
    const res = await request(app).get('/api/v1/news/this-does-not-exist');
    expect(res.status).toBe(404);
  });

  test('response includes author info', async () => {
    const created = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ published: true }));

    const res = await request(app).get(`/api/v1/news/${created.body.slug}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('author_username');
  });
});

// ── POST /api/v1/news ─────────────────────────────────────────────────────────

describe('POST /api/v1/news', () => {
  test('admin can create an article', async () => {
    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'My First Article' }));

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('My First Article');
    expect(res.body).toHaveProperty('slug');
    expect(res.body.published).toBe(false);
  });

  test('moderator can create an article', async () => {
    const modId     = await createTestModeratorUser();
    const modCookie = await getTestSessionCookie(modId);

    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', modCookie)
      .send(validArticle({ title: 'Moderator Article' }));

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Moderator Article');
  });

  test('regular user cannot create an article', async () => {
    const userId     = await createTestRegularUser();
    const userCookie = await getTestSessionCookie(userId);

    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', userCookie)
      .send(validArticle());

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .post('/api/v1/news')
      .send(validArticle());
    expect(res.status).toBe(401);
  });

  test('slug is auto-generated from title when not provided', async () => {
    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Hello World Post' }));

    expect(res.status).toBe(201);
    expect(res.body.slug).toMatch(/hello-world-post/);
  });

  test('explicit slug is accepted', async () => {
    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ slug: 'my-custom-slug' }));

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('my-custom-slug');
  });

  test('duplicate slug is auto-deduplicated (appended -2)', async () => {
    await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Same Title' }));

    const res2 = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Same Title' }));

    expect(res2.status).toBe(201);
    expect(res2.body.slug).toMatch(/-2$/);
  });

  test('returns 400 when title is missing', async () => {
    const { title: _title, ...rest } = validArticle();
    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  test('returns 400 when summary exceeds 300 chars', async () => {
    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ summary: 'x'.repeat(301) }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/summary/i);
  });

  test('returns 400 for invalid cover_image URL', async () => {
    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ cover_image: 'javascript:alert(1)' }));
    expect(res.status).toBe(400);
  });

  test('returns 400 for non-boolean published', async () => {
    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send({ ...validArticle(), published: 'yes' });
    expect(res.status).toBe(400);
  });

  test('published_at is set automatically when published=true and none given', async () => {
    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ published: true }));
    expect(res.status).toBe(201);
    expect(res.body.published_at).toBeTruthy();
  });
});

// ── PATCH /api/v1/news/:id ────────────────────────────────────────────────────

describe('PATCH /api/v1/news/:id', () => {
  test('admin can update an article', async () => {
    const created = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle());

    const res = await request(app)
      .patch(`/api/v1/news/${created.body.id}`)
      .set('Cookie', adminCookie)
      .send({ title: 'Updated Title', published: true });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
    expect(res.body.published).toBe(true);
  });

  test('moderator can update an article', async () => {
    const modId     = await createTestModeratorUser();
    const modCookie = await getTestSessionCookie(modId);

    const created = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle());

    const res = await request(app)
      .patch(`/api/v1/news/${created.body.id}`)
      .set('Cookie', modCookie)
      .send({ title: 'Mod Updated' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Mod Updated');
  });

  test('regular user cannot update an article', async () => {
    const created = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle());

    const userId     = await createTestRegularUser();
    const userCookie = await getTestSessionCookie(userId);

    const res = await request(app)
      .patch(`/api/v1/news/${created.body.id}`)
      .set('Cookie', userCookie)
      .send({ title: 'Hacked' });

    expect(res.status).toBe(403);
  });

  test('returns 404 for non-existent article', async () => {
    const res = await request(app)
      .patch('/api/v1/news/99999')
      .set('Cookie', adminCookie)
      .send({ title: 'Updated' });
    expect(res.status).toBe(404);
  });

  test('updating to a taken slug auto-deduplicates', async () => {
    await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Article One', slug: 'article-one' }));
    const a2 = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Article Two', slug: 'article-two' }));

    // Try to update a2's slug to a1's slug — controller deduplicates (returns article-one-2)
    const res = await request(app)
      .patch(`/api/v1/news/${a2.body.id}`)
      .set('Cookie', adminCookie)
      .send({ slug: 'article-one' });

    expect(res.status).toBe(200);
    expect(res.body.slug).toMatch(/article-one-\d+/);
  });
});

// ── DELETE /api/v1/news/:id ───────────────────────────────────────────────────

describe('DELETE /api/v1/news/:id', () => {
  test('admin can delete an article', async () => {
    const created = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle());

    const res = await request(app)
      .delete(`/api/v1/news/${created.body.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);

    // Verify it is gone
    const check = await request(app)
      .patch(`/api/v1/news/${created.body.id}`)
      .set('Cookie', adminCookie)
      .send({ title: 'Gone' });
    expect(check.status).toBe(404);
  });

  test('moderator cannot delete an article', async () => {
    const modId     = await createTestModeratorUser();
    const modCookie = await getTestSessionCookie(modId);

    const created = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle());

    const res = await request(app)
      .delete(`/api/v1/news/${created.body.id}`)
      .set('Cookie', modCookie);

    expect(res.status).toBe(403);
  });

  test('regular user cannot delete an article', async () => {
    const userId     = await createTestRegularUser();
    const userCookie = await getTestSessionCookie(userId);

    const created = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle());

    const res = await request(app)
      .delete(`/api/v1/news/${created.body.id}`)
      .set('Cookie', userCookie);

    expect(res.status).toBe(403);
  });

  test('returns 404 for non-existent article', async () => {
    const res = await request(app)
      .delete('/api/v1/news/99999')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});

// ── GET /api/v1/news/admin/list ───────────────────────────────────────────────

describe('GET /api/v1/news/admin/list', () => {
  test('admin sees all articles including drafts', async () => {
    await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Published', published: true }));
    await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Draft', published: false }));

    const res = await request(app)
      .get('/api/v1/news/admin/list')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.articles).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  test('unauthenticated cannot access admin list', async () => {
    const res = await request(app).get('/api/v1/news/admin/list');
    expect(res.status).toBe(401);
  });

  test('regular user cannot access admin list', async () => {
    const userId     = await createTestRegularUser();
    const userCookie = await getTestSessionCookie(userId);

    const res = await request(app)
      .get('/api/v1/news/admin/list')
      .set('Cookie', userCookie);

    expect(res.status).toBe(403);
  });
});

// ── Slug uniqueness ───────────────────────────────────────────────────────────

describe('Slug uniqueness', () => {
  test('two articles with the same auto-generated slug get deduplicated', async () => {
    const r1 = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Unique Title' }));
    const r2 = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Unique Title' }));
    const r3 = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Unique Title' }));

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r3.status).toBe(201);

    const slugs = [r1.body.slug, r2.body.slug, r3.body.slug];
    const unique = new Set(slugs);
    expect(unique.size).toBe(3);
  });

  test('explicit duplicate slug on creation is deduplicated', async () => {
    await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ slug: 'fixed-slug' }));

    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ slug: 'fixed-slug' }));

    expect(res.status).toBe(201);
    expect(res.body.slug).not.toBe('fixed-slug');
    expect(res.body.slug).toMatch(/fixed-slug-\d+/);
  });
});
