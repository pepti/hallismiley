const request = require('supertest');
const app     = require('../server/app');
const db      = require('../server/config/database');
const {
  createTestAdminUser,
  getTestSessionCookie,
  cleanTables,
} = require('./helpers');

let sessionCookie;
let adminId;

beforeEach(async () => {
  await cleanTables();
  adminId       = await createTestAdminUser();
  sessionCookie = await getTestSessionCookie(adminId);
});

afterAll(async () => {
  await db.pool.end();
});

// ── GET /api/v1/users/me ──────────────────────────────────────────────────────

describe('GET /api/v1/users/me', () => {
  test('returns current user profile', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      username:       process.env.ADMIN_USERNAME,
      email:          'admin@test.com',
      role:           'admin',
      email_verified: false,
    });
    expect(res.body).toHaveProperty('avatar');
    expect(res.body).toHaveProperty('display_name');
    expect(res.body).toHaveProperty('phone');
  });

  test('requires auth — 401 without session', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/v1/users/me ────────────────────────────────────────────────────

describe('PATCH /api/v1/users/me', () => {
  test('updates display_name', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ display_name: 'Test Admin' });

    expect(res.status).toBe(200);
    expect(res.body.display_name).toBe('Test Admin');
  });

  test('updates avatar with valid value', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ avatar: 'avatar-10.png' });

    expect(res.status).toBe(200);
    expect(res.body.avatar).toBe('avatar-10.png');
  });

  test('invalid avatar returns 400', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ avatar: 'avatar-99.png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/avatar/i);
  });

  test('invalid phone returns 400', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ phone: 'not-a-phone!!!' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone/i);
  });

  test('valid phone is accepted', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ phone: '+1 555-123-4567' });

    expect(res.status).toBe(200);
    expect(res.body.phone).toBe('+1 555-123-4567');
  });

  test('empty body returns 400', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({});

    expect(res.status).toBe(400);
  });

  test('requires auth', async () => {
    const res = await request(app).patch('/api/v1/users/me').send({ display_name: 'X' });
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/v1/users/me/password ──────────────────────────────────────────

describe('PATCH /api/v1/users/me/password', () => {
  test('changes password with correct current password', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/password')
      .set('Cookie', sessionCookie)
      .send({
        current_password: process.env.ADMIN_PASSWORD,
        new_password:     'newpassword99',
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/updated/i);
  });

  test('wrong current password returns 401', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/password')
      .set('Cookie', sessionCookie)
      .send({
        current_password: 'wrongpassword1',
        new_password:     'newpassword99',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  test('weak new password returns 400', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/password')
      .set('Cookie', sessionCookie)
      .send({
        current_password: process.env.ADMIN_PASSWORD,
        new_password:     'weakpass',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/number/i);
  });

  test('requires auth', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/password')
      .send({ current_password: 'x1234567', new_password: 'y1234567' });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/users/me/sessions ────────────────────────────────────────────

describe('GET /api/v1/users/me/sessions', () => {
  test('returns list of active sessions with current marked', async () => {
    const res = await request(app)
      .get('/api/v1/users/me/sessions')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const current = res.body.find(s => s.is_current === true);
    expect(current).toBeDefined();
  });

  test('requires auth', async () => {
    const res = await request(app).get('/api/v1/users/me/sessions');
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/v1/users/me/sessions/:sessionId ───────────────────────────────

describe('DELETE /api/v1/users/me/sessions/:sessionId', () => {
  test('revokes a specific session', async () => {
    // Create a second session
    const session2Cookie = await getTestSessionCookie(adminId);

    // Get actual session id from DB (Lucia stores its own ID)
    const { rows } = await db.query(
      `SELECT id FROM user_sessions WHERE user_id = $1 ORDER BY created_at ASC`,
      [adminId]
    );
    // Revoke the older session (first one) using the current (second) session's cookie
    const olderSessionId = rows[0].id;

    const res = await request(app)
      .delete(`/api/v1/users/me/sessions/${olderSessionId}`)
      .set('Cookie', session2Cookie);

    expect(res.status).toBe(204);
  });

  test('returns 404 for non-existent session', async () => {
    const res = await request(app)
      .delete('/api/v1/users/me/sessions/nonexistentsession')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(404);
  });

  test('requires auth', async () => {
    const res = await request(app).delete('/api/v1/users/me/sessions/someid');
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/v1/users/me/sessions — revoke all others ──────────────────────

describe('DELETE /api/v1/users/me/sessions (revoke all others)', () => {
  test('revokes all sessions except current', async () => {
    // Create two more sessions
    await getTestSessionCookie(adminId);
    await getTestSessionCookie(adminId);

    // Should have 3 sessions total
    const { rows: before } = await db.query(
      `SELECT id FROM user_sessions WHERE user_id = $1`,
      [adminId]
    );
    expect(before.length).toBeGreaterThanOrEqual(3);

    const res = await request(app)
      .delete('/api/v1/users/me/sessions')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(204);

    // Should have exactly 1 session left (the current one)
    const { rows: after } = await db.query(
      `SELECT id FROM user_sessions WHERE user_id = $1`,
      [adminId]
    );
    expect(after.length).toBe(1);
  });

  test('requires auth', async () => {
    const res = await request(app).delete('/api/v1/users/me/sessions');
    expect(res.status).toBe(401);
  });
});
