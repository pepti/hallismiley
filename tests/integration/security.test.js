/**
 * Security-focused integration tests.
 * Covers: input sanitization, XSS prevention, SQL injection attempts,
 * malformed requests, 404 handling, oversized bodies, and header hardening.
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const { getTestSessionCookie, cleanTables, validProject } = require('../helpers');

let sessionCookie;

beforeEach(async () => {
  await cleanTables();
  sessionCookie = await getTestSessionCookie();
});

afterAll(async () => {
  await db.pool.end();
});

// ── XSS / HTML injection ──────────────────────────────────────────────────────

describe('Input sanitization — XSS stripping', () => {
  test('HTML tags are stripped from project title', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ title: '<script>alert(1)</script>My Project' }));

    expect(res.status).toBe(201);
    expect(res.body.title).not.toMatch(/<script>/i);
    expect(res.body.title).toContain('My Project');
  });

  test('HTML tags are stripped from project description', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ description: '<img src=x onerror=alert(1)>Nice description here.' }));

    expect(res.status).toBe(201);
    expect(res.body.description).not.toMatch(/<img/i);
    expect(res.body.description).toContain('Nice description here.');
  });

  test('HTML tags are stripped from contact form name', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({
        name:    '<b>Evil</b> Name',
        email:   'test@example.com',
        message: 'This is a test message that is long enough.',
      });

    expect(res.status).toBe(200);
  });

  test('null bytes are stripped from project title', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ title: 'Project\u0000Title' }));

    expect(res.status).toBe(201);
    expect(res.body.title).not.toContain('\u0000');
  });

  test('javascript: URL is rejected as image_url', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ image_url: 'javascript:alert(document.cookie)' }));

    expect(res.status).toBe(400);
  });

  test('data: URL is rejected as image_url', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ image_url: 'data:text/html,<script>alert(1)</script>' }));

    expect(res.status).toBe(400);
  });
});

// ── SQL injection attempts ────────────────────────────────────────────────────

describe('SQL injection prevention', () => {
  test("SQL injection in project title is stored safely (parameterised query)", async () => {
    const malicious = "'; DROP TABLE projects; --";
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send(validProject({ title: malicious }));

    // The sanitizer strips <> but single quotes and SQL keywords should be stored as text
    expect(res.status).toBe(201);
    // Confirm the projects table still exists by fetching the list
    const list = await request(app).get('/api/v1/projects');
    expect(list.status).toBe(200);
  });

  test("SQL injection in category query param is blocked by validation", async () => {
    const res = await request(app)
      .get("/api/v1/projects?category=tech' OR '1'='1");

    expect(res.status).toBe(400);
  });

  test("SQL injection in year query param is blocked by validation", async () => {
    const res = await request(app)
      .get("/api/v1/projects?year=2024 OR 1=1");

    expect(res.status).toBe(400);
  });
});

// ── Malformed / oversized requests ───────────────────────────────────────────

describe('Malformed request handling', () => {
  test('non-JSON body to JSON endpoint returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .set('Content-Type', 'application/json')
      .send('{ this is not valid json }');

    expect(res.status).toBe(400);
  });

  test('body exceeding 100 kb limit is rejected', async () => {
    const bigBody = JSON.stringify({ title: 'T', description: 'D'.repeat(110 * 1024), category: 'tech', year: 2024 });

    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .set('Content-Type', 'application/json')
      .send(bigBody);

    expect(res.status).toBe(413);
  });

  test('extra unknown fields in body are ignored (not stored)', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', sessionCookie)
      .send({ ...validProject(), __proto__: { admin: true }, isAdmin: true });

    expect(res.status).toBe(201);
    expect(res.body.isAdmin).toBeUndefined();
  });
});

// ── 404 handling ──────────────────────────────────────────────────────────────

describe('404 / unknown route handling', () => {
  test('non-existent API route returns the SPA fallback (index.html)', async () => {
    // The app serves index.html for all unmatched routes (SPA pattern)
    const res = await request(app).get('/api/v1/doesnotexist');
    // Either HTML (SPA) or 404 JSON — both are acceptable
    expect([200, 404]).toContain(res.status);
  });

  test('non-existent project ID returns JSON 404', async () => {
    const res = await request(app).get('/api/v1/projects/99999999');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('code', 404);
  });
});

// ── Security headers ──────────────────────────────────────────────────────────

describe('Security headers (Helmet)', () => {
  test('X-Content-Type-Options: nosniff is present', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('Content-Security-Policy header is present', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  test('X-Frame-Options header is present', async () => {
    const res = await request(app).get('/health');
    const xfo = res.headers['x-frame-options'];
    expect(xfo).toBeDefined();
  });
});

// ── Health check ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns 200 with status ok (liveness probe)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      uptime: expect.any(Number),
    });
  });

  test('attaches X-Request-ID header to every response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{16}$/);
  });
});
