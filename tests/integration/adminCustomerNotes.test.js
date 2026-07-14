// Integration tests for the customer-notes log: CRUD, per-note visibility
// ('admin' = admins only, 'staff' = anyone holding the 'customers' view),
// non-admin restrictions, and lifecycle (owner cascade, author snapshot).
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Role    = require('../../server/models/Role');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

let adminCookie, staffCookie, adminId, staffId, customerId;

// A non-admin staff role holding the grantable 'customers' view (the route gate).
async function createStaffUser() {
  await db.query(
    `INSERT INTO roles (name, view_access)
     VALUES ('notekeeper', '["customers"]'::jsonb)
     ON CONFLICT (name) DO UPDATE SET view_access = '["customers"]'::jsonb`
  );
  Role.invalidateCache();
  const { rows } = await db.query(
    `INSERT INTO users (email, username, password_hash, role)
     VALUES ('staff@test.com', 'staffnotes', NULL, 'notekeeper') RETURNING id`
  );
  return rows[0].id;
}

const base = '/api/v1/admin/customer-notes';
const listNotes = (cookie) =>
  request(app).get(`${base}?customerId=${encodeURIComponent(customerId)}`).set('Cookie', cookie);
const createNote = (cookie, payload) =>
  request(app).post(base).set('Cookie', cookie).send({ customerId, ...payload });

beforeEach(async () => {
  await cleanTables();
  adminId     = await createTestAdminUser();
  customerId  = await createTestRegularUser();
  staffId     = await createStaffUser();
  adminCookie = await getTestSessionCookie(adminId);
  staffCookie = await getTestSessionCookie(staffId);
});

describe('customer notes CRUD (admin)', () => {
  test('create → list → update → delete round-trip', async () => {
    const created = await createNote(adminCookie, { category: 'order_prefs', body: 'Prefers pickup', visibility: 'staff' });
    expect(created.status).toBe(201);
    expect(created.body.note).toMatchObject({ category: 'order_prefs', body: 'Prefers pickup', visibility: 'staff' });
    expect(created.body.note.author_display).toBeTruthy();
    const id = created.body.note.id;

    const listed = await listNotes(adminCookie);
    expect(listed.status).toBe(200);
    expect(listed.body.notes).toHaveLength(1);

    const updated = await request(app).patch(`${base}/${id}`).set('Cookie', adminCookie).send({ body: 'Prefers delivery' });
    expect(updated.status).toBe(200);
    expect(updated.body.note.body).toBe('Prefers delivery');

    const removed = await request(app).delete(`${base}/${id}`).set('Cookie', adminCookie);
    expect(removed.status).toBe(200);
    expect((await listNotes(adminCookie)).body.notes).toHaveLength(0);
  });

  test('defaults: category general, visibility admin; invalid category on PATCH → 400', async () => {
    const res = await createNote(adminCookie, { body: 'plain note' });
    expect(res.status).toBe(201);
    expect(res.body.note).toMatchObject({ category: 'general', visibility: 'admin' });

    const bad = await request(app).patch(`${base}/${res.body.note.id}`).set('Cookie', adminCookie).send({ category: 'nope' });
    expect(bad.status).toBe(400);
  });

  test('400 without a customer owner; 400 when target is not a customer', async () => {
    expect((await request(app).post(base).set('Cookie', adminCookie).send({ body: 'x' })).status).toBe(400);
    // staff/admin accounts don't take customer notes
    const res = await request(app).post(base).set('Cookie', adminCookie).send({ customerId: adminId, body: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('visibility scoping (staff viewer)', () => {
  test("staff sees only 'staff' notes; hidden admin note 404s on patch/delete", async () => {
    const adminNote = (await createNote(adminCookie, { body: 'admins only', visibility: 'admin' })).body.note;
    await createNote(adminCookie, { body: 'for the team', visibility: 'staff' });

    const listed = await listNotes(staffCookie);
    expect(listed.status).toBe(200);
    expect(listed.body.notes).toHaveLength(1);
    expect(listed.body.notes[0].body).toBe('for the team');

    // Invisible note → 404, not 403 (existence isn't leaked)
    expect((await request(app).patch(`${base}/${adminNote.id}`).set('Cookie', staffCookie).send({ body: 'x' })).status).toBe(404);
    expect((await request(app).delete(`${base}/${adminNote.id}`).set('Cookie', staffCookie)).status).toBe(404);
  });

  test("staff creates are forced to 'staff' and can't promote to 'admin'", async () => {
    const created = await createNote(staffCookie, { body: 'ops note', visibility: 'admin' });
    expect(created.status).toBe(201);
    expect(created.body.note.visibility).toBe('staff'); // requested 'admin' ignored

    const promote = await request(app).patch(`${base}/${created.body.note.id}`).set('Cookie', staffCookie).send({ visibility: 'admin' });
    expect(promote.status).toBe(403);
  });

  test('special_needs pinning data is exposed (category round-trips)', async () => {
    await createNote(adminCookie, { body: 'allergy info', category: 'special_needs', visibility: 'staff' });
    const listed = await listNotes(staffCookie);
    expect(listed.body.notes[0].category).toBe('special_needs');
  });
});

describe('access control', () => {
  test('regular customer 403 on all endpoints', async () => {
    const c = await getTestSessionCookie(customerId);
    expect((await listNotes(c)).status).toBe(403);
    expect((await createNote(c, { body: 'x' })).status).toBe(403);
  });

  test('unauthenticated — 401', async () => {
    expect((await request(app).get(`${base}?customerId=${customerId}`)).status).toBe(401);
  });
});

describe('lifecycle', () => {
  test('deleting the customer cascades their notes', async () => {
    await createNote(adminCookie, { body: 'soon gone' });
    await db.query('DELETE FROM users WHERE id = $1', [customerId]);
    const { rows } = await db.query('SELECT 1 FROM customer_notes');
    expect(rows).toHaveLength(0);
  });

  test('deleting the author keeps the note with the snapshotted name', async () => {
    const note = (await createNote(staffCookie, { body: 'authored by staff' })).body.note;
    await db.query('DELETE FROM users WHERE id = $1', [staffId]);
    const listed = await listNotes(adminCookie);
    expect(listed.status).toBe(200);
    const kept = listed.body.notes.find(n => n.id === note.id);
    expect(kept).toBeTruthy();
    expect(kept.author_id).toBeNull();
    expect(kept.author_display).toBeTruthy(); // falls back to author_name snapshot
  });
});
