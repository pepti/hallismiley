const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  createTestAdminUser,
  createTestModeratorUser,
  createTestRegularUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

let adminCookie;
let adminId;
let modId;
let userId;

beforeEach(async () => {
  await cleanTables();
  adminId     = await createTestAdminUser();
  modId       = await createTestModeratorUser();
  userId      = await createTestRegularUser();
  adminCookie = await getTestSessionCookie(adminId);
});


// ── GET /api/v1/admin/users ───────────────────────────────────────────────────

describe('GET /api/v1/admin/users', () => {
  test('admin can list all users', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('users');
    expect(res.body).toHaveProperty('total');
    expect(res.body.users.length).toBe(3);
  });

  test('pagination works with limit/offset', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users?limit=2&offset=0')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.users.length).toBe(2);
    expect(res.body.total).toBe(3);
  });

  test('moderator cannot access admin users list — 403', async () => {
    const modCookie = await getTestSessionCookie(modId);
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Cookie', modCookie);

    expect(res.status).toBe(403);
  });

  test('regular user cannot access admin users list — 403', async () => {
    const userCookie = await getTestSessionCookie(userId);
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Cookie', userCookie);

    expect(res.status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app).get('/api/v1/admin/users');
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/v1/admin/users/:id/role ───────────────────────────────────────

describe('PATCH /api/v1/admin/users/:id/role', () => {
  test('admin can change another user role', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/users/${userId}/role`)
      .set('Cookie', adminCookie)
      .send({ role: 'moderator' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('moderator');
  });

  test('invalid role returns 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/users/${userId}/role`)
      .set('Cookie', adminCookie)
      .send({ role: 'superadmin' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/i);
  });

  test('admin cannot change their own role', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/users/${adminId}/role`)
      .set('Cookie', adminCookie)
      .send({ role: 'user' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own role/i);
  });

  test('non-existent user returns 404', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/users/nonexistent-id/role')
      .set('Cookie', adminCookie)
      .send({ role: 'user' });

    expect(res.status).toBe(404);
  });

  test('moderator cannot change roles — 403', async () => {
    const modCookie = await getTestSessionCookie(modId);
    const res = await request(app)
      .patch(`/api/v1/admin/users/${userId}/role`)
      .set('Cookie', modCookie)
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/v1/admin/users/:id/disable ────────────────────────────────────

describe('PATCH /api/v1/admin/users/:id/disable', () => {
  test('admin can disable a user', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/users/${userId}/disable`)
      .set('Cookie', adminCookie)
      .send({ disabled: true, reason: 'Violated terms of service' });

    expect(res.status).toBe(200);
    expect(res.body.disabled).toBe(true);
    expect(res.body.disabled_reason).toBe('Violated terms of service');
    expect(res.body.disabled_at).toBeTruthy();
  });

  test('admin can re-enable a user', async () => {
    await db.query(
      `UPDATE users SET disabled = TRUE, disabled_at = NOW() WHERE id = $1`,
      [userId]
    );

    const res = await request(app)
      .patch(`/api/v1/admin/users/${userId}/disable`)
      .set('Cookie', adminCookie)
      .send({ disabled: false });

    expect(res.status).toBe(200);
    expect(res.body.disabled).toBe(false);
    expect(res.body.disabled_at).toBeNull();
  });

  test('disabled field must be boolean — 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/users/${userId}/disable`)
      .set('Cookie', adminCookie)
      .send({ disabled: 'yes' });

    expect(res.status).toBe(400);
  });

  test('admin cannot disable themselves', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/users/${adminId}/disable`)
      .set('Cookie', adminCookie)
      .send({ disabled: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own account/i);
  });

  test('disabled user session is invalidated', async () => {
    const userCookie = await getTestSessionCookie(userId);

    // Verify user can authenticate before
    const before = await request(app)
      .get('/api/v1/users/me')
      .set('Cookie', userCookie);
    expect(before.status).toBe(200);

    // Disable the user
    await request(app)
      .patch(`/api/v1/admin/users/${userId}/disable`)
      .set('Cookie', adminCookie)
      .send({ disabled: true });

    // Session should now be rejected
    const after = await request(app)
      .get('/api/v1/users/me')
      .set('Cookie', userCookie);
    expect(after.status).toBe(401);
  });

  test('moderator cannot disable users — 403', async () => {
    const modCookie = await getTestSessionCookie(modId);
    const res = await request(app)
      .patch(`/api/v1/admin/users/${userId}/disable`)
      .set('Cookie', modCookie)
      .send({ disabled: true });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/v1/admin/users/:id ───────────────────────────────────────────

describe('DELETE /api/v1/admin/users/:id', () => {
  test('admin can delete a user (hard delete)', async () => {
    const res = await request(app)
      .delete(`/api/v1/admin/users/${userId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);

    // Verify user is removed from DB
    const { rows } = await db.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );
    expect(rows).toHaveLength(0);
  });

  test('admin cannot delete themselves', async () => {
    const res = await request(app)
      .delete(`/api/v1/admin/users/${adminId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own account/i);
  });

  test('non-existent user returns 404', async () => {
    const res = await request(app)
      .delete('/api/v1/admin/users/nonexistent-id')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });

  test('moderator cannot delete users — 403', async () => {
    const modCookie = await getTestSessionCookie(modId);
    const res = await request(app)
      .delete(`/api/v1/admin/users/${userId}`)
      .set('Cookie', modCookie);

    expect(res.status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app).delete(`/api/v1/admin/users/${userId}`);
    expect(res.status).toBe(401);
  });
});
