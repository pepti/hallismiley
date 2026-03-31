const request = require('supertest');
const app     = require('../server/app');
const db      = require('../server/config/database');
const {
  getTestSessionCookie,
  cleanTables,
  validProject,
} = require('./helpers');

let sessionCookie;
let projectId;

beforeEach(async () => {
  await cleanTables();
  sessionCookie = await getTestSessionCookie();

  // Create a project to attach media to
  const res = await request(app)
    .post('/api/v1/projects')
    .set('Cookie', sessionCookie)
    .send(validProject());
  projectId = res.body.id;
});

afterAll(async () => {
  await db.pool.end();
});

// ── GET /api/v1/projects/:id/media ────────────────────────────────────────────

describe('GET /api/v1/projects/:id/media', () => {
  test('returns 200 and empty array for a project with no media', async () => {
    const res = await request(app).get(`/api/v1/projects/${projectId}/media`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  test('returns media items for a project', async () => {
    await db.query(
      `INSERT INTO project_media (project_id, file_path, media_type, sort_order)
       VALUES ($1, '/assets/img1.jpg', 'image', 1),
              ($1, '/assets/img2.jpg', 'image', 2)`,
      [projectId]
    );

    const res = await request(app).get(`/api/v1/projects/${projectId}/media`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      project_id: projectId,
      file_path:  '/assets/img1.jpg',
      media_type: 'image',
      sort_order: 1,
    });
  });

  test('returns media ordered by sort_order ascending', async () => {
    await db.query(
      `INSERT INTO project_media (project_id, file_path, media_type, sort_order)
       VALUES ($1, '/assets/c.jpg', 'image', 3),
              ($1, '/assets/a.jpg', 'image', 1),
              ($1, '/assets/b.mp4', 'video', 2)`,
      [projectId]
    );

    const res = await request(app).get(`/api/v1/projects/${projectId}/media`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].sort_order).toBe(1);
    expect(res.body[1].sort_order).toBe(2);
    expect(res.body[2].sort_order).toBe(3);
  });

  test('returns 404 for a non-existent project id', async () => {
    const res = await request(app).get('/api/v1/projects/99999/media');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('is a public endpoint — no auth required', async () => {
    const res = await request(app).get(`/api/v1/projects/${projectId}/media`);
    expect(res.status).toBe(200);
  });

  test('returned items include expected fields', async () => {
    await db.query(
      `INSERT INTO project_media (project_id, file_path, media_type, sort_order, caption)
       VALUES ($1, '/assets/hero.jpg', 'image', 1, 'The main shot')`,
      [projectId]
    );

    const res = await request(app).get(`/api/v1/projects/${projectId}/media`);
    expect(res.status).toBe(200);
    const item = res.body[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('project_id');
    expect(item).toHaveProperty('file_path');
    expect(item).toHaveProperty('media_type');
    expect(item).toHaveProperty('sort_order');
    expect(item).toHaveProperty('caption', 'The main shot');
    expect(item).toHaveProperty('created_at');
  });

  test('only returns media for the requested project', async () => {
    // Create a second project
    const res2 = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ title: 'Second Project' }));
    const otherId = res2.body.id;

    await db.query(
      `INSERT INTO project_media (project_id, file_path, media_type, sort_order)
       VALUES ($1, '/assets/p1.jpg', 'image', 1),
              ($2, '/assets/p2.jpg', 'image', 1)`,
      [projectId, otherId]
    );

    const res = await request(app).get(`/api/v1/projects/${projectId}/media`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].file_path).toBe('/assets/p1.jpg');
  });
});
