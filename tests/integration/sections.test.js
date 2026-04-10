const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  getTestSessionCookie,
  createTestModeratorUser,
  createTestRegularUser,
  cleanTables,
  validProject,
} = require('../helpers');

let adminCookie;
let modCookie;
let userCookie;
let projectId;

beforeEach(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie();

  const modId  = await createTestModeratorUser();
  const userId = await createTestRegularUser();
  modCookie  = await getTestSessionCookie(modId);
  userCookie = await getTestSessionCookie(userId);

  const res = await request(app)
    .post('/api/v1/projects')
    .set('Cookie', adminCookie)
    .send(validProject());
  projectId = res.body.id;
});

afterAll(async () => {
  await db.pool.end();
});

async function seedSection(name, sortOrder = 0) {
  const { rows } = await db.query(
    `INSERT INTO project_sections (project_id, name, sort_order)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [projectId, name, sortOrder]
  );
  return rows[0];
}

async function seedMedia(sectionId = null, sortOrder = 0) {
  const { rows } = await db.query(
    `INSERT INTO project_media (project_id, file_path, media_type, sort_order, section_id)
     VALUES ($1, $2, 'image', $3, $4)
     RETURNING *`,
    [projectId, `/assets/test-${Date.now()}-${Math.random()}.jpg`, sortOrder, sectionId]
  );
  return rows[0];
}

// ── GET /api/v1/projects/:id/sections ────────────────────────────────────────

describe('GET /api/v1/projects/:id/sections', () => {
  test('returns empty array for a project with no sections', async () => {
    const res = await request(app).get(`/api/v1/projects/${projectId}/sections`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns sections ordered by sort_order', async () => {
    await seedSection('Exterior', 2);
    await seedSection('Kitchen', 0);
    await seedSection('Living Room', 1);

    const res = await request(app).get(`/api/v1/projects/${projectId}/sections`);
    expect(res.status).toBe(200);
    expect(res.body.map(s => s.name)).toEqual(['Kitchen', 'Living Room', 'Exterior']);
  });

  test('is public — no auth required', async () => {
    const res = await request(app).get(`/api/v1/projects/${projectId}/sections`);
    expect(res.status).toBe(200);
  });

  test('404 for a non-existent project', async () => {
    const res = await request(app).get('/api/v1/projects/999999/sections');
    expect(res.status).toBe(404);
  });
});

// ── POST /api/v1/projects/:id/sections ───────────────────────────────────────

describe('POST /api/v1/projects/:id/sections', () => {
  test('admin can create a section', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sections`)
      .set('Cookie', adminCookie)
      .send({ name: 'Kitchen' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Kitchen', project_id: projectId, sort_order: 0 });
  });

  test('moderator can create a section', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sections`)
      .set('Cookie', modCookie)
      .send({ name: 'Kitchen' });
    expect(res.status).toBe(201);
  });

  test('regular user gets 403', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sections`)
      .set('Cookie', userCookie)
      .send({ name: 'Kitchen' });
    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sections`)
      .send({ name: 'Kitchen' });
    expect(res.status).toBe(401);
  });

  test('empty name is rejected', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sections`)
      .set('Cookie', adminCookie)
      .send({ name: '' });
    expect(res.status).toBe(400);
  });

  test('assigns increasing sort_order on repeated creates', async () => {
    const r1 = await request(app).post(`/api/v1/projects/${projectId}/sections`).set('Cookie', adminCookie).send({ name: 'A' });
    const r2 = await request(app).post(`/api/v1/projects/${projectId}/sections`).set('Cookie', adminCookie).send({ name: 'B' });
    const r3 = await request(app).post(`/api/v1/projects/${projectId}/sections`).set('Cookie', adminCookie).send({ name: 'C' });
    expect(r1.body.sort_order).toBe(0);
    expect(r2.body.sort_order).toBe(1);
    expect(r3.body.sort_order).toBe(2);
  });
});

// ── PATCH /api/v1/projects/:id/sections/:sectionId ───────────────────────────

describe('PATCH /api/v1/projects/:id/sections/:sectionId', () => {
  test('admin can rename a section', async () => {
    const sec = await seedSection('Kitchen');
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/sections/${sec.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Main Kitchen' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Main Kitchen');
  });

  test('regular user gets 403', async () => {
    const sec = await seedSection('Kitchen');
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/sections/${sec.id}`)
      .set('Cookie', userCookie)
      .send({ name: 'Main Kitchen' });
    expect(res.status).toBe(403);
  });

  test('404 for non-existent section', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/sections/99999`)
      .set('Cookie', adminCookie)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/v1/projects/:id/sections/reorder ──────────────────────────────

describe('PATCH /api/v1/projects/:id/sections/reorder', () => {
  test('admin can reorder sections', async () => {
    const a = await seedSection('A', 0);
    const b = await seedSection('B', 1);
    const c = await seedSection('C', 2);

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/sections/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [
        { id: c.id, sort_order: 0 },
        { id: a.id, sort_order: 1 },
        { id: b.id, sort_order: 2 },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.map(s => s.name)).toEqual(['C', 'A', 'B']);
  });

  test('rejects section IDs from another project', async () => {
    const otherRes = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', adminCookie)
      .send(validProject());
    const other = otherRes.body.id;
    const { rows } = await db.query(
      `INSERT INTO project_sections (project_id, name, sort_order) VALUES ($1, 'Foreign', 0) RETURNING id`,
      [other]
    );
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/sections/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [{ id: rows[0].id, sort_order: 0 }] });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/v1/projects/:id/sections/:sectionId ──────────────────────────

describe('DELETE /api/v1/projects/:id/sections/:sectionId', () => {
  test('admin can delete a section', async () => {
    const sec = await seedSection('Kitchen');
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/sections/${sec.id}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
  });

  test('moderator gets 403 on delete (admin only)', async () => {
    const sec = await seedSection('Kitchen');
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/sections/${sec.id}`)
      .set('Cookie', modCookie);
    expect(res.status).toBe(403);
  });

  test('deleting a section detaches its media (section_id → null)', async () => {
    const sec   = await seedSection('Kitchen');
    const media = await seedMedia(sec.id, 0);

    const delRes = await request(app)
      .delete(`/api/v1/projects/${projectId}/sections/${sec.id}`)
      .set('Cookie', adminCookie);
    expect(delRes.status).toBe(204);

    // Media still exists but section_id is null
    const { rows } = await db.query(
      'SELECT section_id FROM project_media WHERE id = $1',
      [media.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].section_id).toBeNull();
  });

  test('404 for non-existent section', async () => {
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/sections/99999`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/v1/projects/:id/media/reorder — now with section_id ──────────

describe('PATCH /api/v1/projects/:id/media/reorder (with section_id)', () => {
  test('admin can reassign media to a section in one request', async () => {
    const sec = await seedSection('Kitchen');
    const m1  = await seedMedia(null, 0);
    const m2  = await seedMedia(null, 1);

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [
        { id: m1.id, sort_order: 0, section_id: sec.id },
        { id: m2.id, sort_order: 1, section_id: sec.id },
      ] });
    expect(res.status).toBe(200);
    const m1Row = res.body.find(m => m.id === m1.id);
    const m2Row = res.body.find(m => m.id === m2.id);
    expect(m1Row.section_id).toBe(sec.id);
    expect(m2Row.section_id).toBe(sec.id);
  });

  test('null section_id moves a media item back to Ungrouped', async () => {
    const sec   = await seedSection('Kitchen');
    const media = await seedMedia(sec.id, 0);

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [{ id: media.id, sort_order: 0, section_id: null }] });
    expect(res.status).toBe(200);
    const row = res.body.find(m => m.id === media.id);
    expect(row.section_id).toBeNull();
  });

  test('rejects section_id from another project', async () => {
    const media = await seedMedia(null, 0);
    // Create a second project + section
    const otherRes = await request(app).post('/api/v1/projects').set('Cookie', adminCookie).send(validProject());
    const { rows } = await db.query(
      `INSERT INTO project_sections (project_id, name, sort_order) VALUES ($1, 'Foreign', 0) RETURNING id`,
      [otherRes.body.id]
    );
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [{ id: media.id, sort_order: 0, section_id: rows[0].id }] });
    expect(res.status).toBe(400);
  });

  test('order without section_id keeps existing section', async () => {
    const sec   = await seedSection('Kitchen');
    const media = await seedMedia(sec.id, 0);

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [{ id: media.id, sort_order: 5 }] });
    expect(res.status).toBe(200);
    const row = res.body.find(m => m.id === media.id);
    expect(row.section_id).toBe(sec.id); // unchanged
    expect(row.sort_order).toBe(5);
  });
});

// ── PATCH /api/v1/projects/:id/media/:mediaId — section_id field ─────────────

describe('PATCH /api/v1/projects/:id/media/:mediaId (section_id field)', () => {
  test('admin can set section_id on a media item', async () => {
    const sec   = await seedSection('Kitchen');
    const media = await seedMedia(null, 0);

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/${media.id}`)
      .set('Cookie', adminCookie)
      .send({ section_id: sec.id });
    expect(res.status).toBe(200);
    expect(res.body.section_id).toBe(sec.id);
  });

  test('admin can clear section_id with null', async () => {
    const sec   = await seedSection('Kitchen');
    const media = await seedMedia(sec.id, 0);

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/${media.id}`)
      .set('Cookie', adminCookie)
      .send({ section_id: null });
    expect(res.status).toBe(200);
    expect(res.body.section_id).toBeNull();
  });

  test('rejects section_id from another project', async () => {
    const media = await seedMedia(null, 0);
    const otherRes = await request(app).post('/api/v1/projects').set('Cookie', adminCookie).send(validProject());
    const { rows } = await db.query(
      `INSERT INTO project_sections (project_id, name, sort_order) VALUES ($1, 'Foreign', 0) RETURNING id`,
      [otherRes.body.id]
    );
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/media/${media.id}`)
      .set('Cookie', adminCookie)
      .send({ section_id: rows[0].id });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/v1/projects/:id/media — includes section_id and orders by it ───

describe('GET /api/v1/projects/:id/media (with sections)', () => {
  test('returned items include section_id field', async () => {
    const sec = await seedSection('Kitchen');
    await seedMedia(sec.id, 0);

    const res = await request(app).get(`/api/v1/projects/${projectId}/media`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toHaveProperty('section_id');
    expect(res.body[0].section_id).toBe(sec.id);
  });

  test('ungrouped (section_id = null) items appear before sectioned items', async () => {
    const sec = await seedSection('Kitchen');
    await seedMedia(null, 0);   // ungrouped
    await seedMedia(sec.id, 0); // in Kitchen

    const res = await request(app).get(`/api/v1/projects/${projectId}/media`);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].section_id).toBeNull();
    expect(res.body[1].section_id).toBe(sec.id);
  });
});
