const request = require('supertest');
const app     = require('../server/app');
const db      = require('../server/config/database');
const { generateToken, generateExpiredToken, cleanTables, validProject } = require('./helpers');

let token;

beforeAll(() => {
  token = generateToken();
});

beforeEach(async () => {
  await cleanTables();
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
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject());
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject({ title: 'Second' }));

    const res = await request(app).get('/api/v1/projects');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('filters by category=tech', async () => {
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject({ category: 'tech' }));
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject({ title: 'Wood', category: 'carpentry' }));

    const res = await request(app).get('/api/v1/projects?category=tech');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].category).toBe('tech');
  });

  test('filters by category=carpentry', async () => {
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject({ category: 'tech' }));
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject({ title: 'Wood', category: 'carpentry' }));

    const res = await request(app).get('/api/v1/projects?category=carpentry');
    expect(res.status).toBe(200);
    expect(res.body.every(p => p.category === 'carpentry')).toBe(true);
  });

  test('filters by featured=true', async () => {
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject({ featured: true }));
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject({ title: 'Not featured' }));

    const res = await request(app).get('/api/v1/projects?featured=true');
    expect(res.status).toBe(200);
    expect(res.body.every(p => p.featured === true)).toBe(true);
  });

  test('filters by year', async () => {
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject({ year: 2020 }));
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject({ title: 'Other year', year: 2023 }));

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
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject({ featured: true, title: 'Featured A' }));
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject({ featured: false }));

    const res = await request(app).get('/api/v1/projects/featured');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].featured).toBe(true);
  });

  test('returns empty array when no projects are featured', async () => {
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send(validProject({ featured: false }));

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
      .set('Authorization', `Bearer ${token}`)
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
  test('creates a project and returns 201 with the new resource', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send(validProject());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id:          expect.any(Number),
      title:       validProject().title,
      category:    'tech',
      year:        2024,
      featured:    false,
      tools_used:  ['Node.js', 'PostgreSQL'],
    });
  });

  test('returns 401 without Authorization header', async () => {
    const res = await request(app).post('/api/v1/projects').send(validProject());
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  test('returns 401 with a malformed Bearer token', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', 'Bearer thisisnotajwt')
      .send(validProject());

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid token');
  });

  test('returns 401 with an expired token', async () => {
    const expired = generateExpiredToken();
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${expired}`)
      .send(validProject());

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Token expired');
  });

  test('missing required fields returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Only a title' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  test('invalid category value returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send(validProject({ category: 'furniture' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category/i);
  });

  test('year out of allowed range returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send(validProject({ year: 3000 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/year/i);
  });

  test('non-boolean featured returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send(validProject({ featured: 'yes' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/i);
  });

  test('http:// image_url rejected — must be https://', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send(validProject({ image_url: 'http://example.com/img.jpg' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/https/i);
  });

  test('https:// image_url is accepted', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send(validProject({ image_url: 'https://example.com/img.jpg' }));

    expect(res.status).toBe(201);
    expect(res.body.image_url).toBe('https://example.com/img.jpg');
  });

  test('tools_used must be an array', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send(validProject({ tools_used: 'Node.js' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });

  test('title exceeding 200 chars returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
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
      .set('Authorization', `Bearer ${token}`)
      .send(validProject());

    const id  = create.body.id;
    const res = await request(app)
      .put(`/api/v1/projects/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(validProject({ title: 'Updated Title', year: 2023 }));

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
    expect(res.body.year).toBe(2023);
  });

  test('requires auth — 401 without token', async () => {
    const res = await request(app).put('/api/v1/projects/1').send(validProject());
    expect(res.status).toBe(401);
  });

  test('returns 404 for non-existent id', async () => {
    const res = await request(app)
      .put('/api/v1/projects/99999')
      .set('Authorization', `Bearer ${token}`)
      .send(validProject());

    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/v1/projects/:id ────────────────────────────────────────────────

describe('PATCH /api/v1/projects/:id', () => {
  test('partially updates a project', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send(validProject());

    const id  = create.body.id;
    const res = await request(app)
      .patch(`/api/v1/projects/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Patched Title' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Patched Title');
    expect(res.body.category).toBe('tech'); // unchanged
    expect(res.body.year).toBe(2024);       // unchanged
  });

  test('requires auth — 401 without token', async () => {
    const res = await request(app).patch('/api/v1/projects/1').send({ title: 'Oops' });
    expect(res.status).toBe(401);
  });

  test('PATCH with invalid field value returns 400', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send(validProject());

    const id  = create.body.id;
    const res = await request(app)
      .patch(`/api/v1/projects/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'notvalid' });

    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/v1/projects/:id ───────────────────────────────────────────────

describe('DELETE /api/v1/projects/:id', () => {
  test('deletes an existing project and returns 204', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send(validProject());

    const id  = create.body.id;
    const del = await request(app)
      .delete(`/api/v1/projects/${id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(del.status).toBe(204);

    // Verify it no longer exists
    const get = await request(app).get(`/api/v1/projects/${id}`);
    expect(get.status).toBe(404);
  });

  test('requires auth — 401 without token', async () => {
    const res = await request(app).delete('/api/v1/projects/1');
    expect(res.status).toBe(401);
  });

  test('returns 404 for non-existent id', async () => {
    const res = await request(app)
      .delete('/api/v1/projects/99999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
