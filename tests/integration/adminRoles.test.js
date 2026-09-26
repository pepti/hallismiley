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

  test('cannot delete a role still assigned to a user — 409 with the holder count', async () => {
    await request(app).post('/api/v1/admin/roles')
      .set('Cookie', adminCookie).send({ name: 'inuse', view_access: ['products'] });
    await db.query("UPDATE users SET role = 'inuse' WHERE id = $1", [userId]);
    // A second holder by membership only (user_roles), not as primary.
    await request(app).post('/api/v1/admin/roles/inuse/members').set('Cookie', adminCookie).send({ userId: modId });
    const res = await request(app).delete('/api/v1/admin/roles/inuse').set('Cookie', adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(409);
    expect(res.body.count).toBe(2);
    expect(res.body.reason).toBe('role_in_use');
    expect(res.body.error).toContain('2');
    const { rows } = await db.query("SELECT 1 FROM roles WHERE name = 'inuse'");
    expect(rows).toHaveLength(1);
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

// ── Members board: multi-role membership ─────────────────────────────────────

describe('roles members (multi-role)', () => {
  test('GET /members lists every role with its members + primary flag', async () => {
    const res = await request(app).get('/api/v1/admin/roles/members').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.roles.map(r => [r.name, r]));
    expect(Object.keys(byName)).toEqual(expect.arrayContaining(['admin', 'moderator', 'user']));
    // The migration trigger mirrors each user's primary role into user_roles.
    expect(byName.admin.members.map(m => m.id)).toContain(adminId);
    expect(byName.user.members.map(m => m.id)).toContain(userId);
    expect(byName.admin.members.find(m => m.id === adminId).is_primary).toBe(true);
  });

  test('non-admin cannot reach the member endpoints — 403 / 401', async () => {
    const c = await getTestSessionCookie(modId);
    expect((await request(app).get('/api/v1/admin/roles/members').set('Cookie', c)).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/roles/user/members').set('Cookie', c).send({ userId })).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/roles/members')).status).toBe(401);
  });

  test('add → user gains a 2nd role; effective views are the union', async () => {
    await request(app).post('/api/v1/admin/roles')
      .set('Cookie', adminCookie).send({ name: 'shopkeeper', view_access: ['products'] });
    const add = await request(app).post('/api/v1/admin/roles/shopkeeper/members')
      .set('Cookie', adminCookie).send({ userId });
    expect(add.status).toBe(201);

    const c = await getTestSessionCookie(userId);
    const sess = await request(app).get('/auth/session').set('Cookie', c);
    expect(sess.body.user.roles).toEqual(expect.arrayContaining(['user', 'shopkeeper']));
    expect(sess.body.user.views).toEqual(['products']); // 'user' contributes none
    expect((await request(app).get('/api/v1/admin/shop/products').set('Cookie', c)).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/shop/collections').set('Cookie', c)).status).toBe(403);
  });

  test('adding a role the user already holds → 409', async () => {
    const res = await request(app).post('/api/v1/admin/roles/user/members')
      .set('Cookie', adminCookie).send({ userId });
    expect(res.status).toBe(409);
  });

  test('adding to a missing user → 404; missing userId → 400', async () => {
    expect((await request(app).post('/api/v1/admin/roles/user/members')
      .set('Cookie', adminCookie).send({ userId: 'no-such-id' })).status).toBe(404);
    expect((await request(app).post('/api/v1/admin/roles/user/members')
      .set('Cookie', adminCookie).send({})).status).toBe(400);
  });

  test('union: a user with an admin membership passes requireRole(admin)', async () => {
    await request(app).post('/api/v1/admin/roles/admin/members')
      .set('Cookie', adminCookie).send({ userId });
    const c = await getTestSessionCookie(userId);
    // /api/v1/admin/roles is hard requireRole('admin') — only reachable as admin.
    expect((await request(app).get('/api/v1/admin/roles').set('Cookie', c)).status).toBe(200);
  });

  test('remove a non-primary membership → 204 and it is gone', async () => {
    await request(app).post('/api/v1/admin/roles')
      .set('Cookie', adminCookie).send({ name: 'shopkeeper', view_access: ['products'] });
    await request(app).post('/api/v1/admin/roles/shopkeeper/members')
      .set('Cookie', adminCookie).send({ userId });
    const del = await request(app).delete(`/api/v1/admin/roles/shopkeeper/members/${userId}`)
      .set('Cookie', adminCookie);
    expect(del.status).toBe(204);
    const { rows } = await db.query(
      'SELECT 1 FROM user_roles WHERE user_id = $1 AND role_name = $2', [userId, 'shopkeeper']);
    expect(rows.length).toBe(0);
  });

  test('removing the primary role repoints users.role to a remaining role', async () => {
    await request(app).post('/api/v1/admin/roles/moderator/members')
      .set('Cookie', adminCookie).send({ userId });
    const del = await request(app).delete(`/api/v1/admin/roles/user/members/${userId}`)
      .set('Cookie', adminCookie);
    expect(del.status).toBe(204);
    const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    expect(rows[0].role).toBe('moderator');
  });

  test('an admin cannot strip their own admin role (self-lockout) — 400', async () => {
    const res = await request(app).delete(`/api/v1/admin/roles/admin/members/${adminId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  test('removing one of two admins is allowed; the demoted user loses admin', async () => {
    await request(app).post('/api/v1/admin/roles/admin/members')
      .set('Cookie', adminCookie).send({ userId: modId });
    const del = await request(app).delete(`/api/v1/admin/roles/admin/members/${modId}`)
      .set('Cookie', adminCookie);
    expect(del.status).toBe(204);
    const c = await getTestSessionCookie(modId);
    expect((await request(app).get('/api/v1/admin/roles').set('Cookie', c)).status).toBe(403);
  });
});

// ── Create by display name (harvest 2 G1/G4, ported from icelandicstore #421) ──

describe('roles: create by display name, labels, reserved names', () => {
  const create = (body) => request(app).post('/api/v1/admin/roles').set('Cookie', adminCookie).send(body);

  test('a typed name becomes the label; the slug is derived on the server', async () => {
    const res = await create({ label: '  Bókari á  skrifstofu ', view_access: ['books'] });
    expect(res.status).toBe(201);
    expect(res.body.role.name).toBe('bokari-a-skrifstofu');
    expect(res.body.role.label).toBe('Bókari á skrifstofu');
    expect(res.body.role.view_access).toEqual(['books']);
  });

  test('a slug collision takes -2; a label collision (folded) is 409', async () => {
    // A legacy slug-only role already holds "bokari" (and so its folded name).
    await create({ name: 'bokari', view_access: [] });
    // "Bókari" folds to the same name as the unnamed "bokari" → taken.
    expect((await create({ label: 'Bókari' })).status).toBe(409);
    // Give "bokari" another name: the slug still collides, so -2 is taken.
    await db.query("UPDATE roles SET label = 'Reikningar' WHERE name = 'bokari'");
    const res = await create({ label: 'Bókari' });
    expect(res.status).toBe(201);
    expect(res.body.role.name).toBe('bokari-2');
    // Case, accents and punctuation fold: "BOKARI." is the same name.
    expect((await create({ label: 'BOKARI.' })).status).toBe(409);
  });

  test('reserved and back-office names are refused, folded (409)', async () => {
    for (const label of ['Admin', 'Administrator', 'Admin sala', 'Stjórnandi', 'Kerfi', 'Starfsmaður', 'Root', 'Owner', 'Support', 'Notandi']) {
      expect((await create({ label })).status).toBe(409);
    }
    for (const name of ['staff', 'administrator', 'kerfi', 'root']) {
      expect((await create({ name })).status).toBe(409);
    }
  });

  test('a label outside the rules is 400 (length, script)', async () => {
    expect((await create({ label: 'B' })).status).toBe(400);
    expect((await create({ label: 'x'.repeat(31) })).status).toBe(400);
    expect((await create({ label: 'Бухгалтер' })).status).toBe(400);
  });

  test('the label is editable; the slug never changes', async () => {
    const { body } = await create({ label: 'Sölumenn norður' });
    const slug = body.role.name;
    const res = await request(app).patch(`/api/v1/admin/roles/${slug}`).set('Cookie', adminCookie)
      .send({ label: 'Sölufólk á Akureyri' });
    expect(res.status).toBe(200);
    expect(res.body.role.name).toBe(slug);
    expect(res.body.role.label).toBe('Sölufólk á Akureyri');
    // A reserved rename is refused like a reserved create.
    expect((await request(app).patch(`/api/v1/admin/roles/${slug}`).set('Cookie', adminCookie)
      .send({ label: 'Stjórnandi' })).status).toBe(409);
    // A rename is a staff-audit event (role.updated with the label change).
    const { rows } = await db.query(
      "SELECT summary FROM staff_audit_log WHERE action = 'role.updated' AND entity_id = $1", [slug]);
    expect(rows.map(r => r.summary)).toContainEqual(
      expect.objectContaining({ label_before: 'Sölumenn norður', label_after: 'Sölufólk á Akureyri' }));
  });

  test('a built-in role keeps its name (label edit 400)', async () => {
    for (const name of ['admin', 'moderator', 'user']) {
      const res = await request(app).patch(`/api/v1/admin/roles/${name}`).set('Cookie', adminCookie)
        .send({ label: 'Eitthvað annað' });
      expect(res.status).toBe(400);
    }
  });

  test('the user role (every account holds it) can never GAIN a view; it may shrink', async () => {
    const res = await request(app).patch('/api/v1/admin/roles/user').set('Cookie', adminCookie)
      .send({ view_access: ['customers'] });
    expect(res.status).toBe(400);
    // A downstream that already granted one can take it away again.
    await db.query(`UPDATE roles SET view_access = '["leads"]'::jsonb WHERE name = 'user'`);
    try {
      expect((await request(app).patch('/api/v1/admin/roles/user').set('Cookie', adminCookie)
        .send({ view_access: [] })).status).toBe(200);
    } finally {
      await db.query(`UPDATE roles SET view_access = '[]'::jsonb WHERE name = 'user'`);
    }
  });

  test('the list and the members board carry the label', async () => {
    await create({ label: 'Bókari' });
    const list = await request(app).get('/api/v1/admin/roles').set('Cookie', adminCookie);
    expect(list.body.roles.find(r => r.name === 'bokari').label).toBe('Bókari');
    const members = await request(app).get('/api/v1/admin/roles/members').set('Cookie', adminCookie);
    expect(members.body.roles.find(r => r.name === 'bokari').label).toBe('Bókari');
  });

  test('migration 116 backfilled the built-in roles', async () => {
    const { rows } = await db.query("SELECT name, label FROM roles WHERE name IN ('admin', 'moderator', 'user')");
    const byName = Object.fromEntries(rows.map(r => [r.name, r.label]));
    expect(byName).toEqual({ admin: 'Admin', moderator: 'Moderator', user: 'User' });
  });
});

// ── The Profile badge (harvest 2 G3) ─────────────────────────────────────────

describe('GET /api/v1/users/me names the roles the session holds', () => {
  test('a custom role comes back with its label', async () => {
    await request(app).post('/api/v1/admin/roles').set('Cookie', adminCookie)
      .send({ label: 'Bókari', view_access: ['books'] });
    await request(app).post('/api/v1/admin/roles/bokari/members').set('Cookie', adminCookie).send({ userId });
    const c = await getTestSessionCookie(userId);
    const res = await request(app).get('/api/v1/users/me').set('Cookie', c);
    expect(res.status).toBe(200);
    expect(res.body.roles.map(r => r.name)).toEqual(expect.arrayContaining(['user', 'bokari']));
    expect(res.body.roles.find(r => r.name === 'bokari')).toMatchObject({ label: 'Bókari', is_system: false });
  });

  test('an admin session names admin', async () => {
    const res = await request(app).get('/api/v1/users/me').set('Cookie', adminCookie);
    expect(res.body.roles.map(r => r.name)).toContain('admin');
  });
});
