// The one outer door on /api/v1/admin (app.js; harvested from icelandicstore
// #418, 2026-09-24): whatever an admin router does or forgets to do, a plain
// customer account never gets past the prefix. Each router still carries its
// own (often narrower) guard; this only proves the floor. A path no router
// answers is the easiest way to see the outer guard alone.
//
// Engine adaptation: staff = admin, moderator, or ANY role that grants an admin
// view (the dynamic roles — a seller holding only `handbok` must still reach
// /api/v1/admin/handbok), so the door is requireStaff, not ice's
// requireRole('admin', 'moderator').
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Role    = require('../../server/models/Role');
const {
  createTestAdminUser, createTestModeratorUser, createTestRegularUser,
  getTestSessionCookie, cleanTables,
} = require('../helpers');

const NOWHERE = '/api/v1/admin/no-such-router/anything';
let cookies;

async function createViewHolder() {
  // solufolk = the seeded seller role that grants the handbook view (migration 090).
  // adminRoles.test.js deletes every non-system role, solufolk included, and
  // workers share a DB across suites — so re-seed it here (as leads/salesGuides
  // do) and drop the role cache, or this suite fails on users_role_fkey
  // whenever it runs after adminRoles on the same worker.
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system) VALUES
       ('solufolk', 'Sölufólk — aðgangur að handbók sölufólks', '["handbok"]'::jsonb, FALSE)
     ON CONFLICT (name) DO NOTHING`);
  Role.invalidateCache();
  const id = 'outer-guard-seller';
  await db.query(
    `INSERT INTO users (id, email, username, role, approval_status, email_verified)
     VALUES ($1, 'outer-seller@test.com', 'outerseller', 'solufolk', 'approved', TRUE)
     ON CONFLICT (id) DO NOTHING`, [id]);
  return id;
}

beforeEach(async () => {
  await cleanTables();
  const ids = {
    admin:     await createTestAdminUser(),
    moderator: await createTestModeratorUser(),
    user:      await createTestRegularUser(),
    seller:    await createViewHolder(),
  };
  cookies = {};
  for (const [k, id] of Object.entries(ids)) cookies[k] = await getTestSessionCookie(id);
});

test('signed out → 401', async () => {
  expect((await request(app).get(NOWHERE)).status).toBe(401);
});

// The row that guards the change: without the outer door a customer reached
// this path and got 404 from the routers.
test('a plain customer account → 403 before any admin router is consulted', async () => {
  for (const method of ['get', 'post', 'patch', 'delete']) {
    const res = await request(app)[method](NOWHERE).set('Cookie', cookies.user).send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ code: 403 }));
  }
});

test.each(['admin', 'moderator', 'seller'])('%s passes the outer door (an unknown path is then a 404)', async (who) => {
  const res = await request(app).get(NOWHERE).set('Cookie', cookies[who]);
  expect(res.status).toBe(404);
});

test('a view holder reaches the view it holds, and nothing wider', async () => {
  expect((await request(app).get('/api/v1/admin/handbok').set('Cookie', cookies.seller)).status).toBe(200);
  expect((await request(app).get('/api/v1/admin/users').set('Cookie', cookies.seller)).status).toBe(403);
});

test('the routers\' own narrower guards still apply behind it', async () => {
  // Moderators pass the outer door, but the Users list needs the `users` view.
  expect((await request(app).get('/api/v1/admin/users').set('Cookie', cookies.moderator)).status).toBe(403);
  expect((await request(app).get('/api/v1/admin/users').set('Cookie', cookies.admin)).status).toBe(200);
});

// The till's scan box (ScanInput on /admin/pos, harvest-ice-c) calls
// /api/v1/admin/bookkeeping/pos/lookup. Someone on the till holds only the
// `pos` view — no admin, no moderator — so the outer door must let them
// through to the router's own requireView('pos'), and the lookup itself must
// answer (404 for a code nothing carries), not 403.
test('a till-only role (the pos view alone) reaches the POS code lookup', async () => {
  await db.query(
    `INSERT INTO roles (name, view_access) VALUES ('outer-till', '["pos"]'::jsonb)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`);
  await db.query(
    `INSERT INTO users (id, email, username, role, approval_status, email_verified)
     VALUES ('outer-guard-till', 'outer-till@test.com', 'outertill', 'outer-till', 'approved', TRUE)
     ON CONFLICT (id) DO NOTHING`);
  const till = await getTestSessionCookie('outer-guard-till');
  const url = '/api/v1/admin/bookkeeping/pos/lookup?code=NO-SUCH-CODE-OUTER';
  const res = await request(app).get(url).set('Cookie', till);
  expect(res.status).toBe(404);
  expect(res.body).toEqual(expect.objectContaining({ code: 404 }));
  expect((await request(app).get(url).set('Cookie', cookies.user)).status).toBe(403);
  // ...and nothing wider than the till.
  expect((await request(app).get('/api/v1/admin/users').set('Cookie', till)).status).toBe(403);
});
