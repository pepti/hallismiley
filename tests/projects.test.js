const request = require('supertest');
const app     = require('../server/app');
const db      = require('../server/config/database');
const {
  getTestSessionCookie,
  createTestModeratorUser,
  createTestRegularUser,
  cleanTables,
  validProject,
} = require('./helpers');

let sessionCookie;

beforeEach(async () => {
  await cleanTables();
  sessionCookie = await getTestSessionCookie(); // admin session
});

afterAll(async () => {
  await db.pool.end();
});

// ── GET /api/v1/projects ──────────────────────────────────────────────────────

describe('GET /api/v1/projects', () => {
  test('returns 200 and empty array when no projects exist', async () => {
    const res = await request(app).get('/api/v1/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  test('returns all created projects', async () => {
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject());
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject({ title: 'Second' }));

    const res = await request(app).get('/api/v1/projects');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('filters by category=tech', async () => {
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject({ category: 'tech' }));
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject({ title: 'Wood', category: 'carpentry' }));

    const res = await request(app).get('/api/v1/projects?category=tech');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].category).toBe('tech');
  });

  test('filters by category=carpentry', async () => {
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject({ category: 'tech' }));
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject({ title: 'Wood', category: 'carpentry' }));

    const res = await request(app).get('/api/v1/projects?category=carpentry');
    expect(res.status).toBe(200);
    expect(res.body.every(p => p.category === 'carpentry')).toBe(true);
  });

  test('filters by featured=true', async () => {
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject({ featured: true }));
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject({ title: 'Not featured' }));

    const res = await request(app).get('/api/v1/projects?featured=true');
    expect(res.status).toBe(200);
    expect(res.body.every(p => p.featured === true)).toBe(true);
  });

  test('filters by year', async () => {
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject({ year: 2020 }));
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject({ title: 'Other year', year: 2023 }));

    const res = await request(app).get('/api/v1/projects?year=2020');
    expect(res.status).toBe(200);
    expect(res.body.every(p => p.year === 2020)).toBe(true);
  });

  test('invalid category query param returns 400', async () => {
    const res = await request(app).get('/api/v1/projects?category=woodworking');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category/i);
  });

  test('invalid featured value returns 400', async () => {
    const res = await request(app).get('/api/v1/projects?featured=maybe');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/featured/i);
  });

  test('year below 1900 returns 400', async () => {
    const res = await request(app).get('/api/v1/projects?year=1800');
    expect(res.status).toBe(400);
  });

  test('year above 2100 returns 400', async () => {
    const res = await request(app).get('/api/v1/projects?year=2200');
    expect(res.status).toBe(400);
  });
});

// ── GET /api/v1/projects/featured ────────────────────────────────────────────

describe('GET /api/v1/projects/featured', () => {
  test('returns only featured projects', async () => {
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject({ featured: true, title: 'Featured A' }));
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject({ featured: false }));

    const res = await request(app).get('/api/v1/projects/featured');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].featured).toBe(true);
  });

  test('returns empty array when no projects are featured', async () => {
    await request(app).post('/api/v1/projects').set('Cookie', sessionCookie).send(validProject({ featured: false }));

    const res = await request(app).get('/api/v1/projects/featured');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ── GET /api/v1/projects/:id ──────────────────────────────────────────────────

describe('GET /api/v1/projects/:id', () => {
  test('returns a project by id', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject());

    const id  = create.body.id;
    const res = await request(app).get(`/api/v1/projects/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.title).toBe(validProject().title);
  });

  test('returns 404 for a non-existent id', async () => {
    const res = await request(app).get('/api/v1/projects/99999');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ── POST /api/v1/projects ─────────────────────────────────────────────────────

describe('POST /api/v1/projects', () => {
  test('admin can create a project', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id:         expect.any(Number),
      title:      validProject().title,
      category:   'tech',
      year:       2024,
      featured:   false,
      tools_used: ['Node.js', 'PostgreSQL'],
    });
  });

  test('moderator can create a project', async () => {
    const modId     = await createTestModeratorUser();
    const modCookie = await getTestSessionCookie(modId);

    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', modCookie)
      .send(validProject({ title: 'Mod Project' }));

    expect(res.status).toBe(201);
  });

  test('regular user cannot create a project — 403', async () => {
    const userId     = await createTestRegularUser();
    const userCookie = await getTestSessionCookie(userId);

    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', userCookie)
      .send(validProject());

    expect(res.status).toBe(403);
  });

  test('returns 401 without session cookie', async () => {
    const res = await request(app).post('/api/v1/projects').send(validProject());
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  test('returns 401 with an invalid session cookie', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', 'auth_session=notarealsession')
      .send(validProject());

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  test('missing required fields returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send({ title: 'Only a title' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  test('invalid category value returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ category: 'furniture' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category/i);
  });

  test('year out of allowed range returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ year: 3000 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/year/i);
  });

  test('non-boolean featured returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ featured: 'yes' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/i);
  });

  test('http:// image_url rejected — must be https://', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ image_url: 'http://example.com/img.jpg' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/https/i);
  });

  test('https:// image_url is accepted', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ image_url: 'https://example.com/img.jpg' }));

    expect(res.status).toBe(201);
    expect(res.body.image_url).toBe('https://example.com/img.jpg');
  });

  test('tools_used must be an array', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ tools_used: 'Node.js' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });

  test('title exceeding 200 chars returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ title: 'A'.repeat(201) }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/200/);
  });
});

// ── PUT /api/v1/projects/:id ──────────────────────────────────────────────────

describe('PUT /api/v1/projects/:id', () => {
  test('replaces a project with valid data', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject());

    const id  = create.body.id;
    const res = await request(app)
      .put(`/api/v1/projects/${id}`)
      .set('Cookie', sessionCookie)
      .send(validProject({ title: 'Updated Title', year: 2023 }));

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
    expect(res.body.year).toBe(2023);
  });

  test('moderator can update a project', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject());

    const modId     = await createTestModeratorUser();
    const modCookie = await getTestSessionCookie(modId);

    const res = await request(app)
      .put(`/api/v1/projects/${create.body.id}`)
      .set('Cookie', modCookie)
      .send(validProject({ title: 'Mod Update' }));

    expect(res.status).toBe(200);
  });

  test('regular user cannot update — 403', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject());

    const userId     = await createTestRegularUser();
    const userCookie = await getTestSessionCookie(userId);

    const res = await request(app)
      .put(`/api/v1/projects/${create.body.id}`)
      .set('Cookie', userCookie)
      .send(validProject());

    expect(res.status).toBe(403);
  });

  test('requires auth — 401 without session cookie', async () => {
    const res = await request(app).put('/api/v1/projects/1').send(validProject());
    expect(res.status).toBe(401);
  });

  test('returns 404 for non-existent id', async () => {
    const res = await request(app)
      .put('/api/v1/projects/99999')
      .set('Cookie', sessionCookie)
      .send(validProject());

    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/v1/projects/:id ────────────────────────────────────────────────

describe('PATCH /api/v1/projects/:id', () => {
  test('partially updates a project', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject());

    const id  = create.body.id;
    const res = await request(app)
      .patch(`/api/v1/projects/${id}`)
      .set('Cookie', sessionCookie)
      .send({ title: 'Patched Title' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Patched Title');
    expect(res.body.category).toBe('tech'); // unchanged
    expect(res.body.year).toBe(2024);       // unchanged
  });

  test('requires auth — 401 without session cookie', async () => {
    const res = await request(app).patch('/api/v1/projects/1').send({ title: 'Oops' });
    expect(res.status).toBe(401);
  });

  test('PATCH with invalid field value returns 400', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject());

    const id  = create.body.id;
    const res = await request(app)
      .patch(`/api/v1/projects/${id}`)
      .set('Cookie', sessionCookie)
      .send({ category: 'notvalid' });

    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/v1/projects/:id ───────────────────────────────────────────────

describe('DELETE /api/v1/projects/:id', () => {
  test('admin can delete a project', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject());

    const id  = create.body.id;
    const del = await request(app)
      .delete(`/api/v1/projects/${id}`)
      .set('Cookie', sessionCookie);

    expect(del.status).toBe(204);

    const get = await request(app).get(`/api/v1/projects/${id}`);
    expect(get.status).toBe(404);
  });

  test('moderator cannot delete — 403', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject());

    const modId     = await createTestModeratorUser();
    const modCookie = await getTestSessionCookie(modId);

    const res = await request(app)
      .delete(`/api/v1/projects/${create.body.id}`)
      .set('Cookie', modCookie);

    expect(res.status).toBe(403);
  });

  test('regular user cannot delete — 403', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject());

    const userId     = await createTestRegularUser();
    const userCookie = await getTestSessionCookie(userId);

    const res = await request(app)
      .delete(`/api/v1/projects/${create.body.id}`)
      .set('Cookie', userCookie);

    expect(res.status).toBe(403);
  });

  test('requires auth — 401 without session cookie', async () => {
    const res = await request(app).delete('/api/v1/projects/1');
    expect(res.status).toBe(401);
  });

  test('returns 404 for non-existent id', async () => {
    const res = await request(app)
      .delete('/api/v1/projects/99999')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(404);
  });
});
