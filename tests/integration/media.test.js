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
  validProject,
} = require('../helpers');

// Minimal 1×1 transparent PNG for upload tests
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

let adminCookie;
let modCookie;
let userCookie;
let projectId;

// Track upload directories created during tests so we can clean them up
const uploadDirs = new Set();

function cleanupUploadDir(id) {
  const dir = path.join(__dirname, '../../public/assets/projects', String(id));
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

  // Create a project to attach media to
  const res = await request(app)
    .post('/api/v1/projects')
    .set('Cookie', adminCookie)
    .send(validProject());
  projectId = res.body.id;
  uploadDirs.add(projectId);
});

afterEach(() => {
  // Clean up any files written to disk during tests
  uploadDirs.forEach(id => cleanupUploadDir(id));
  uploadDirs.clear();
});

afterAll(async () => {
  await db.pool.end();
});

// ── Helper: seed a media row directly ────────────────────────────────────────

async function seedMedia(overrides = {}) {
  const { rows } = await db.query(
    `INSERT INTO project_media (project_id, file_path, media_type, sort_order, caption)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      overrides.project_id ?? projectId,
      overrides.file_path  ?? '/assets/projects/test/img.jpg',
      overrides.media_type ?? 'image',
      overrides.sort_order ?? 0,
      overrides.caption    ?? null,
    ]
  );
  return rows[0];
}

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

    const res  = await request(app).get(`/api/v1/projects/${projectId}/media`);
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
    const res2    = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', adminCookie)
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

// ── POST /api/v1/projects/:id/media ──────────────────────────────────────────

describe('POST /api/v1/projects/:id/media', () => {
  test('admin can upload a file and receives 201 with media item', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Cookie', adminCookie)
      .attach('file', PNG_BUFFER, { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      project_id: projectId,
      media_type: 'image',
    });
    expect(res.body.file_path).toMatch(new RegExp(`/assets/projects/${projectId}/`));
    expect(res.body.id).toBeDefined();
  });

  test('moderator can upload a file', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Cookie', modCookie)
      .attach('file', PNG_BUFFER, { filename: 'mod.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.media_type).toBe('image');
  });

  test('regular user gets 403', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Cookie', userCookie)
      .attach('file', PNG_BUFFER, { filename: 'u.png', contentType: 'image/png' });

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .attach('file', PNG_BUFFER, { filename: 'u.png', contentType: 'image/png' });

    expect(res.status).toBe(401);
  });

  test('invalid MIME type gets 400', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('fake pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allowed/i);
  });

  test('JSON body with file_path creates media item', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Cookie', adminCookie)
      .send({ file_path: '/assets/projects/test/existing.jpg', media_type: 'image', caption: 'A caption' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      project_id: projectId,
      file_path:  '/assets/projects/test/existing.jpg',
      media_type: 'image',
      caption:    'A caption',
    });
  });

  test('JSON body missing file_path gets 400', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Cookie', adminCookie)
      .send({ media_type: 'image' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/file_path/i);
  });

  test('JSON body with invalid media_type gets 400', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Cookie', adminCookie)
      .send({ file_path: '/assets/x.jpg', media_type: 'audio' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/media_type/i);
  });

  test('non-existent project gets 404', async () => {
    const res = await request(app)
      .post('/api/v1/projects/99999/media')
      .set('Cookie', adminCookie)
      .send({ file_path: '/assets/x.jpg', media_type: 'image' });

    expect(res.status).toBe(404);
  });

  test('upload stores file on disk and path is accessible', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Cookie', adminCookie)
      .attach('file', PNG_BUFFER, { filename: 'disk-test.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    const diskPath = path.join(__dirname, '../../public', res.body.file_path);
    expect(fs.existsSync(diskPath)).toBe(true);
  });
});

// ── PATCH /api/v1/projects/:id/media/:mediaId ─────────────────────────────────

describe('PATCH /api/v1/projects/:id/media/:mediaId', () => {
  let mediaId;

  beforeEach(async () => {
    const item = await seedMedia({ caption: 'original', sort_order: 5 });
    mediaId    = item.id;
  });

  test('admin can update caption', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/${mediaId}`)
      .set('Cookie', adminCookie)
      .send({ caption: 'updated caption' });

    expect(res.status).toBe(200);
    expect(res.body.caption).toBe('updated caption');
  });

  test('admin can update sort_order', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/${mediaId}`)
      .set('Cookie', adminCookie)
      .send({ sort_order: 10 });

    expect(res.status).toBe(200);
    expect(res.body.sort_order).toBe(10);
  });

  test('moderator can update media', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/${mediaId}`)
      .set('Cookie', modCookie)
      .send({ caption: 'mod caption' });

    expect(res.status).toBe(200);
    expect(res.body.caption).toBe('mod caption');
  });

  test('regular user gets 403', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/${mediaId}`)
      .set('Cookie', userCookie)
      .send({ caption: 'hacked' });

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/${mediaId}`)
      .send({ caption: 'hacked' });

    expect(res.status).toBe(401);
  });

  test('non-existent media item gets 404', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/99999`)
      .set('Cookie', adminCookie)
      .send({ caption: 'x' });

    expect(res.status).toBe(404);
  });

  test('invalid sort_order (negative) gets 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/${mediaId}`)
      .set('Cookie', adminCookie)
      .send({ sort_order: -1 });

    expect(res.status).toBe(400);
  });

  test('caption exceeding max length gets 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/${mediaId}`)
      .set('Cookie', adminCookie)
      .send({ caption: 'x'.repeat(501) });

    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/v1/projects/:id/media/:mediaId ────────────────────────────────

describe('DELETE /api/v1/projects/:id/media/:mediaId', () => {
  let mediaId;

  beforeEach(async () => {
    const item = await seedMedia();
    mediaId    = item.id;
  });

  test('admin can delete media and receives 204', async () => {
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/media/${mediaId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);

    // Verify it is gone from the DB
    const { rows } = await db.query(
      'SELECT id FROM project_media WHERE id = $1', [mediaId]
    );
    expect(rows).toHaveLength(0);
  });

  test('moderator gets 403 on delete', async () => {
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/media/${mediaId}`)
      .set('Cookie', modCookie);

    expect(res.status).toBe(403);
  });

  test('regular user gets 403', async () => {
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/media/${mediaId}`)
      .set('Cookie', userCookie);

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/media/${mediaId}`);

    expect(res.status).toBe(401);
  });

  test('non-existent media item gets 404', async () => {
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/media/99999`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });

  test('cannot delete media belonging to a different project', async () => {
    const res2   = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', adminCookie)
      .send(validProject({ title: 'Other' }));
    const other  = res2.body.id;

    const res = await request(app)
      .delete(`/api/v1/projects/${other}/media/${mediaId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });

  test('deletes disk file when file_path starts with /assets/projects/', async () => {
    // Upload a real file first so there is something to delete
    const uploadRes = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Cookie', adminCookie)
      .attach('file', PNG_BUFFER, { filename: 'del-test.png', contentType: 'image/png' });

    expect(uploadRes.status).toBe(201);
    const diskPath  = path.join(__dirname, '../../public', uploadRes.body.file_path);
    expect(fs.existsSync(diskPath)).toBe(true);

    const delRes = await request(app)
      .delete(`/api/v1/projects/${projectId}/media/${uploadRes.body.id}`)
      .set('Cookie', adminCookie);

    expect(delRes.status).toBe(204);
    expect(fs.existsSync(diskPath)).toBe(false);
  });
});

// ── PATCH /api/v1/projects/:id/media/reorder ─────────────────────────────────

describe('PATCH /api/v1/projects/:id/media/reorder', () => {
  let mediaItems;

  beforeEach(async () => {
    const a = await seedMedia({ sort_order: 0, file_path: '/assets/a.jpg' });
    const b = await seedMedia({ sort_order: 1, file_path: '/assets/b.jpg' });
    const c = await seedMedia({ sort_order: 2, file_path: '/assets/c.jpg' });
    mediaItems = [a, b, c];
  });

  test('admin can reorder and receives updated list', async () => {
    const order = [
      { id: mediaItems[2].id, sort_order: 0 },
      { id: mediaItems[0].id, sort_order: 1 },
      { id: mediaItems[1].id, sort_order: 2 },
    ];

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({ order });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe(mediaItems[2].id);
    expect(res.body[1].id).toBe(mediaItems[0].id);
    expect(res.body[2].id).toBe(mediaItems[1].id);
  });

  test('moderator can reorder', async () => {
    const order = [
      { id: mediaItems[1].id, sort_order: 0 },
      { id: mediaItems[0].id, sort_order: 1 },
      { id: mediaItems[2].id, sort_order: 2 },
    ];

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .set('Cookie', modCookie)
      .send({ order });

    expect(res.status).toBe(200);
  });

  test('regular user gets 403', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .set('Cookie', userCookie)
      .send({ order: [{ id: mediaItems[0].id, sort_order: 0 }] });

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .send({ order: [{ id: mediaItems[0].id, sort_order: 0 }] });

    expect(res.status).toBe(401);
  });

  test('empty order array gets 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [] });

    expect(res.status).toBe(400);
  });

  test('missing order field gets 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({});

    expect(res.status).toBe(400);
  });

  test('order item with invalid id gets 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [{ id: 0, sort_order: 0 }] });

    expect(res.status).toBe(400);
  });

  test('order item with negative sort_order gets 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [{ id: mediaItems[0].id, sort_order: -1 }] });

    expect(res.status).toBe(400);
  });

  test('media ID from another project gets 400', async () => {
    const res2       = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', adminCookie)
      .send(validProject({ title: 'Other' }));
    const foreignItem = await seedMedia({ project_id: res2.body.id });

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [{ id: foreignItem.id, sort_order: 0 }] });

    expect(res.status).toBe(400);
  });

  test('non-existent project gets 404', async () => {
    const res = await request(app)
      .patch('/api/v1/projects/99999/media/reorder')
      .set('Cookie', adminCookie)
      .send({ order: [{ id: 1, sort_order: 0 }] });

    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/v1/projects/:id/cover ─────────────────────────────────────────

describe('PATCH /api/v1/projects/:id/cover', () => {
  let mediaId;

  beforeEach(async () => {
    const item = await seedMedia({ file_path: '/assets/projects/1/hero.jpg' });
    mediaId    = item.id;
  });

  test('admin can set cover and receives updated project', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/cover`)
      .set('Cookie', adminCookie)
      .send({ media_id: mediaId });

    expect(res.status).toBe(200);
    expect(res.body.image_url).toBe('/assets/projects/1/hero.jpg');
    expect(res.body.id).toBe(projectId);
  });

  test('moderator can set cover', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/cover`)
      .set('Cookie', modCookie)
      .send({ media_id: mediaId });

    expect(res.status).toBe(200);
    expect(res.body.image_url).toBe('/assets/projects/1/hero.jpg');
  });

  test('regular user gets 403', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/cover`)
      .set('Cookie', userCookie)
      .send({ media_id: mediaId });

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/cover`)
      .send({ media_id: mediaId });

    expect(res.status).toBe(401);
  });

  test('missing media_id gets 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/cover`)
      .set('Cookie', adminCookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/media_id/i);
  });

  test('media item from different project gets 404', async () => {
    const res2       = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', adminCookie)
      .send(validProject({ title: 'Other' }));
    const foreignItem = await seedMedia({ project_id: res2.body.id });

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/cover`)
      .set('Cookie', adminCookie)
      .send({ media_id: foreignItem.id });

    expect(res.status).toBe(404);
  });

  test('non-existent project gets 404', async () => {
    const res = await request(app)
      .patch('/api/v1/projects/99999/cover')
      .set('Cookie', adminCookie)
      .send({ media_id: mediaId });

    expect(res.status).toBe(404);
  });

  test('non-existent media_id gets 404', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/cover`)
      .set('Cookie', adminCookie)
      .send({ media_id: 99999 });

    expect(res.status).toBe(404);
  });
});
