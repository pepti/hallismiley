// Integration tests for the dynamic RBAC feature: the roles admin API, its
// guards, and (the security keystone) per-view enforcement via requireView.
// CSRF is bypassed in test mode (see tests/env.js), like the other admin specs.
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

let adminCookie, adminId, modId, userId;

beforeEach(async () => {
  await cleanTables();
  // cleanTables truncates users (CASCADE) but not the seeded `roles` table, so
  // custom roles would leak between tests — clear them once users are gone (no
  // FK references left), keeping the three system roles the migration seeded.
  await db.query("DELETE FROM roles WHERE is_system = FALSE");
  adminId     = await createTestAdminUser();
  modId       = await createTestModeratorUser();
  userId      = await createTestRegularUser();
  adminCookie = await getTestSessionCookie(adminId);
});

// ── GET /api/v1/admin/roles — auth + listing ─────────────────────────────────

describe('GET /api/v1/admin/roles', () => {
  test('admin lists roles + grantable views (which exclude "roles")', async () => {
    const res = await request(app).get('/api/v1/admin/roles').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const names = res.body.roles.map(r => r.name);
    expect(names).toEqual(expect.arrayContaining(['admin', 'moderator', 'user']));
    expect(res.body.grantableViews).toContain('products');
    expect(res.body.grantableViews).not.toContain('roles'); // escalation guard
  });

  test('moderator cannot read roles — 403', async () => {
    const c = await getTestSessionCookie(modId);
    expect((await request(app).get('/api/v1/admin/roles').set('Cookie', c)).status).toBe(403);
  });

  test('regular user cannot read roles — 403', async () => {
    const c = await getTestSessionCookie(userId);
    expect((await request(app).get('/api/v1/admin/roles').set('Cookie', c)).status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    expect((await request(app).get('/api/v1/admin/roles')).status).toBe(401);
  });
});

// ── CRUD + validation + guards (admin) ───────────────────────────────────────

describe('roles CRUD + validation', () => {
  test('create → update → delete a custom role', async () => {
    const create = await request(app).post('/api/v1/admin/roles')
      .set('Cookie', adminCookie)
      .send({ name: 'shopkeeper', description: 'Shop', view_access: ['products', 'orders'] });
    expect(create.status).toBe(201);
    expect(create.body.role.view_access).toEqual(['products', 'orders']);

    const update = await request(app).patch('/api/v1/admin/roles/shopkeeper')
      .set('Cookie', adminCookie)
      .send({ view_access: ['products'] });
    expect(update.status).toBe(200);
    expect(update.body.role.view_access).toEqual(['products']);

    const del = await request(app).delete('/api/v1/admin/roles/shopkeeper').set('Cookie', adminCookie);
    expect(del.status).toBe(204);
  });

  test('invalid name → 400', async () => {
    const res = await request(app).post('/api/v1/admin/roles')
      .set('Cookie', adminCookie).send({ name: 'Bad Name', view_access: [] });
    expect(res.status).toBe(400);
  });

  test('reserved name → 409', async () => {
    const res = await request(app).post('/api/v1/admin/roles')
      .set('Cookie', adminCookie).send({ name: 'admin', view_access: [] });
    expect(res.status).toBe(409);
  });

  test('invalid view id → 400', async () => {
    const res = await request(app).post('/api/v1/admin/roles')
      .set('Cookie', adminCookie).send({ name: 'tmprole', view_access: ['nope'] });
    expect(res.status).toBe(400);
  });

  test('cannot edit the admin role\'s view_access — 400', async () => {
    const res = await request(app).patch('/api/v1/admin/roles/admin')
      .set('Cookie', adminCookie).send({ view_access: [] });
    expect(res.status).toBe(400);
  });

  test('cannot delete a system role — 400', async () => {
    const res = await request(app).delete('/api/v1/admin/roles/moderator').set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  test('cannot delete a role still assigned to a user — 409', async () => {
    await request(app).post('/api/v1/admin/roles')
      .set('Cookie', adminCookie).send({ name: 'inuse', view_access: ['products'] });
    await db.query("UPDATE users SET role = 'inuse' WHERE id = $1", [userId]);
    const res = await request(app).delete('/api/v1/admin/roles/inuse').set('Cookie', adminCookie);
    expect(res.status).toBe(409);
  });

  test('moderator cannot create roles — 403 (hard admin-only, no escalation)', async () => {
    const c = await getTestSessionCookie(modId);
    const res = await request(app).post('/api/v1/admin/roles')
      .set('Cookie', c).send({ name: 'evil', view_access: [] });
    expect(res.status).toBe(403);
  });
});

// ── Per-view enforcement (requireView) — the security keystone ────────────────

describe('requireView enforcement', () => {
  let shopCookie;

  beforeEach(async () => {
    await request(app).post('/api/v1/admin/roles')
      .set('Cookie', adminCookie)
      .send({ name: 'shopkeeper', view_access: ['products', 'orders'] });
    await db.query("UPDATE users SET role = 'shopkeeper' WHERE id = $1", [userId]);
    shopCookie = await getTestSessionCookie(userId);
  });

  test('granted views return 200', async () => {
    expect((await request(app).get('/api/v1/admin/shop/products').set('Cookie', shopCookie)).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/shop/orders').set('Cookie', shopCookie)).status).toBe(200);
  });

  test('ungranted views return 403 — including collections/reports in the same router', async () => {
    const forbidden = [
      '/api/v1/admin/shop/collections',  // same router as products, different view
      '/api/v1/admin/shop/reports',      // same router, 'sales' view
      '/api/v1/admin/analytics/summary',
      '/api/v1/admin/discounts',
      '/api/v1/admin/general-settings',
      '/api/v1/admin/background/media',
      '/api/v1/admin/change-requests',
      '/api/v1/admin/users',
    ];
    for (const url of forbidden) {
      expect((await request(app).get(url).set('Cookie', shopCookie)).status).toBe(403);
    }
  });

  test('the roles API is unreachable via a granted view — 403', async () => {
    expect((await request(app).get('/api/v1/admin/roles').set('Cookie', shopCookie)).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/roles')
      .set('Cookie', shopCookie).send({ name: 'evil', view_access: [] })).status).toBe(403);
  });

  test('session payload exposes the resolved views', async () => {
    const res = await request(app).get('/auth/session').set('Cookie', shopCookie);
    expect(res.status).toBe(200);
    expect(res.body.user.views).toEqual(['products', 'orders']);
  });

  test('admin session resolves to all-access ["*"]', async () => {
    const res = await request(app).get('/auth/session').set('Cookie', adminCookie);
    expect(res.body.user.views).toEqual(['*']);
  });
});
