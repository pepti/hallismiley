const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  createTestAdminUser,
  createTestRegularUser,
  createTestModeratorUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

let adminId, adminCookie;
let userId, userCookie;

beforeEach(async () => {
  await cleanTables();
  adminId     = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  // Grant party access to admin so we can test party endpoints with a real user
  await db.query('UPDATE users SET party_access = TRUE WHERE id = $1', [adminId]);

  userId     = await createTestRegularUser();
  userCookie = await getTestSessionCookie(userId);
  // Regular user has party_access = FALSE (default)
});

afterAll(async () => {
  await db.pool.end();
});

// ── GET /api/v1/party/access ──────────────────────────────────────────────────

describe('GET /api/v1/party/access', () => {
  test('returns hasAccess true when user has party_access flag', async () => {
    const res = await request(app)
      .get('/api/v1/party/access')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasAccess: true });
  });

  test('returns hasAccess false when user lacks party_access flag', async () => {
    const res = await request(app)
      .get('/api/v1/party/access')
      .set('Cookie', userCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasAccess: false });
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app).get('/api/v1/party/access');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/party/info ────────────────────────────────────────────────────

describe('GET /api/v1/party/info', () => {
  test('returns party info for user with party access', async () => {
    const res = await request(app)
      .get('/api/v1/party/info')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('venue_name');
    expect(res.body).toHaveProperty('schedule');
    expect(res.body).toHaveProperty('activities');
  });

  test('returns party info for user without party access (public)', async () => {
    const res = await request(app)
      .get('/api/v1/party/info')
      .set('Cookie', userCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('venue_name');
  });

  test('unauthenticated returns party info (public)', async () => {
    const res = await request(app).get('/api/v1/party/info');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('venue_name');
  });
});

// ── POST /api/v1/party/rsvp ───────────────────────────────────────────────────

describe('POST /api/v1/party/rsvp', () => {
  test('invited user can submit RSVP with answers', async () => {
    const res = await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', adminCookie)
      .send({ answers: { attend: ["Yes, I'll be there!"], message: 'See you there' } });
    expect(res.status).toBe(200);
    expect(res.body.answers).toMatchObject({ attend: ["Yes, I'll be there!"], message: 'See you there' });
    expect(res.body.user_id).toBe(adminId);
  });

  test('submitting RSVP again updates it (upsert)', async () => {
    await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', adminCookie)
      .send({ answers: { attend: ["Yes"] } });
    const res = await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', adminCookie)
      .send({ answers: { attend: ["No"], message: 'Sorry' } });
    expect(res.status).toBe(200);
    expect(res.body.answers).toMatchObject({ attend: ["No"], message: 'Sorry' });
  });

  test('returns 400 when answers is missing', async () => {
    const res = await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/answers/i);
  });

  test('returns 400 when answers is not an object', async () => {
    const res = await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', adminCookie)
      .send({ answers: 'not-an-object' });
    expect(res.status).toBe(400);
  });

  test('returns 403 for user without party access', async () => {
    const res = await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', userCookie)
      .send({ answers: { attend: ["Yes"] } });
    expect(res.status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app)
      .post('/api/v1/party/rsvp')
      .send({ answers: { attend: ["Yes"] } });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/party/rsvp ────────────────────────────────────────────────────

describe('GET /api/v1/party/rsvp', () => {
  test('returns null when no RSVP submitted yet', async () => {
    const res = await request(app)
      .get('/api/v1/party/rsvp')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  test('returns own RSVP after submitting', async () => {
    await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', adminCookie)
      .send({ answers: { attend: ["Yes"], food: ["Veg"] } });

    const res = await request(app)
      .get('/api/v1/party/rsvp')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.answers).toMatchObject({ attend: ["Yes"], food: ["Veg"] });
  });

  test('returns 403 for user without party access', async () => {
    const res = await request(app)
      .get('/api/v1/party/rsvp')
      .set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app).get('/api/v1/party/rsvp');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/party/rsvps (admin only) ─────────────────────────────────────

describe('GET /api/v1/party/rsvps', () => {
  test('admin can list all RSVPs', async () => {
    await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', adminCookie)
      .send({ answers: { attend: ["Yes"] } });

    const res = await request(app)
      .get('/api/v1/party/rsvps')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toHaveProperty('username');
  });

  test('regular user cannot access all RSVPs — 403', async () => {
    const res = await request(app)
      .get('/api/v1/party/rsvps')
      .set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app).get('/api/v1/party/rsvps');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/v1/party/guestbook ─────────────────────────────────────────────

describe('POST /api/v1/party/guestbook', () => {
  test('invited user can post a message', async () => {
    const res = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', adminCookie)
      .send({ message: 'Happy birthday Halli!' });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Happy birthday Halli!');
    expect(res.body.user_id).toBe(adminId);
  });

  test('returns 400 for empty message', async () => {
    const res = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', adminCookie)
      .send({ message: '' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for message over 1000 characters', async () => {
    const res = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', adminCookie)
      .send({ message: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1000/);
  });

  test('returns 403 for user without party access', async () => {
    const res = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', userCookie)
      .send({ message: 'Hello' });
    expect(res.status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app)
      .post('/api/v1/party/guestbook')
      .send({ message: 'Hello' });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/party/guestbook ──────────────────────────────────────────────

describe('GET /api/v1/party/guestbook', () => {
  test('returns list of messages for invited user', async () => {
    await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', adminCookie)
      .send({ message: 'First message' });

    const res = await request(app)
      .get('/api/v1/party/guestbook')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].message).toBe('First message');
    expect(res.body[0]).toHaveProperty('username');
  });

  test('returns 403 for user without party access', async () => {
    const res = await request(app)
      .get('/api/v1/party/guestbook')
      .set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app).get('/api/v1/party/guestbook');
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/v1/party/guestbook/:id ───────────────────────────────────────

describe('DELETE /api/v1/party/guestbook/:id', () => {
  test('owner can delete their own entry', async () => {
    const post = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', adminCookie)
      .send({ message: 'To be deleted' });
    expect(post.status).toBe(201);

    const res = await request(app)
      .delete(`/api/v1/party/guestbook/${post.body.id}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
  });

  test('returns 404 for non-existent entry', async () => {
    const res = await request(app)
      .delete('/api/v1/party/guestbook/99999')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  test('returns 403 for user without party access', async () => {
    const post = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', adminCookie)
      .send({ message: 'Admin message' });

    const res = await request(app)
      .delete(`/api/v1/party/guestbook/${post.body.id}`)
      .set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app).delete('/api/v1/party/guestbook/1');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/v1/party/photos ─────────────────────────────────────────────────

describe('POST /api/v1/party/photos', () => {
  test('invited user can upload a photo', async () => {
    const fakeImage = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const res = await request(app)
      .post('/api/v1/party/photos')
      .set('Cookie', adminCookie)
      .attach('file', fakeImage, { filename: 'test.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('file_path');
    expect(res.body.user_id).toBe(adminId);
  });

  test('returns 400 when no file is provided', async () => {
    const res = await request(app)
      .post('/api/v1/party/photos')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  test('returns 400 for non-image file type', async () => {
    const res = await request(app)
      .post('/api/v1/party/photos')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('not an image'), { filename: 'file.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  test('returns 403 for user without party access', async () => {
    const res = await request(app)
      .post('/api/v1/party/photos')
      .set('Cookie', userCookie)
      .attach('file', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app).post('/api/v1/party/photos');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/party/photos ──────────────────────────────────────────────────

describe('GET /api/v1/party/photos', () => {
  test('returns list of photos for invited user', async () => {
    // Insert photo directly to avoid disk I/O dependency on upload working
    await db.query(
      `INSERT INTO party_photos (user_id, file_path) VALUES ($1, '/assets/party/test.jpg')`,
      [adminId]
    );

    const res = await request(app)
      .get('/api/v1/party/photos')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toHaveProperty('file_path');
    expect(res.body[0]).toHaveProperty('username');
  });

  test('returns 403 for user without party access', async () => {
    const res = await request(app)
      .get('/api/v1/party/photos')
      .set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app).get('/api/v1/party/photos');
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/v1/party/photos/:id ──────────────────────────────────────────

describe('DELETE /api/v1/party/photos/:id', () => {
  test('owner can delete their own photo', async () => {
    const { rows } = await db.query(
      `INSERT INTO party_photos (user_id, file_path) VALUES ($1, '/assets/party/test.jpg') RETURNING id`,
      [adminId]
    );

    const res = await request(app)
      .delete(`/api/v1/party/photos/${rows[0].id}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
  });

  test('returns 404 for non-existent photo', async () => {
    const res = await request(app)
      .delete('/api/v1/party/photos/99999')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  test('returns 403 for user without party access', async () => {
    const { rows } = await db.query(
      `INSERT INTO party_photos (user_id, file_path) VALUES ($1, '/assets/party/test.jpg') RETURNING id`,
      [adminId]
    );

    const res = await request(app)
      .delete(`/api/v1/party/photos/${rows[0].id}`)
      .set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app).delete('/api/v1/party/photos/1');
    expect(res.status).toBe(401);
  });
});

// ── Non-invited user gets 403 on all protected party endpoints ────────────────

describe('Non-invited user blocked on all party endpoints', () => {
  const protectedEndpoints = [
    { method: 'post',   path: '/api/v1/party/rsvp',       body: { answers: { attend: ['Yes'] } } },
    { method: 'get',    path: '/api/v1/party/rsvp' },
    { method: 'post',   path: '/api/v1/party/guestbook',  body: { message: 'hi' } },
    { method: 'get',    path: '/api/v1/party/guestbook' },
    { method: 'delete', path: '/api/v1/party/guestbook/1' },
    { method: 'get',    path: '/api/v1/party/photos' },
    { method: 'delete', path: '/api/v1/party/photos/1' },
  ];

  protectedEndpoints.forEach(({ method, path: endpoint, body }) => {
    test(`${method.toUpperCase()} ${endpoint} returns 403`, async () => {
      const req = request(app)[method](endpoint).set('Cookie', userCookie);
      if (body) req.send(body);
      const res = await req;
      expect(res.status).toBe(403);
    });
  });
});

// ── Old invite endpoints return 410 Gone ─────────────────────────────────────

describe('Old invite endpoints return 410 Gone', () => {
  test('POST /api/v1/party/invites returns 410', async () => {
    const res = await request(app)
      .post('/api/v1/party/invites')
      .set('Cookie', adminCookie)
      .send({ emails: ['someone@example.com'] });
    expect(res.status).toBe(410);
  });

  test('GET /api/v1/party/invites returns 200 empty array (graceful fallback)', async () => {
    const res = await request(app)
      .get('/api/v1/party/invites')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('DELETE /api/v1/party/invites/:id returns 410', async () => {
    const res = await request(app)
      .delete('/api/v1/party/invites/1')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(410);
  });
});

// ── Logistics endpoints ──────────────────────────────────────────────────────

describe('Logistics endpoints', () => {
  test('GET /api/v1/party/logistics — unauthenticated returns 401', async () => {
    const res = await request(app).get('/api/v1/party/logistics');
    expect(res.status).toBe(401);
  });

  test('GET /api/v1/party/logistics — non-admin user returns 403', async () => {
    const res = await request(app)
      .get('/api/v1/party/logistics')
      .set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });

  test('admin: full CRUD round-trip (create, list, update, delete)', async () => {
    // Create
    const createRes = await request(app)
      .post('/api/v1/party/logistics')
      .set('Cookie', adminCookie)
      .send({ name: 'Cups', quantity: '100', assigned_to: 'Bjarni' });
    expect(createRes.status).toBe(201);
    expect(createRes.body).toMatchObject({
      name: 'Cups', quantity: '100', assigned_to: 'Bjarni',
      bought: false, at_venue: false,
    });
    const id = createRes.body.id;

    // List
    const listRes = await request(app)
      .get('/api/v1/party/logistics')
      .set('Cookie', adminCookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(id);

    // Update — flip bought
    const patch1 = await request(app)
      .patch(`/api/v1/party/logistics/${id}`)
      .set('Cookie', adminCookie)
      .send({ bought: true });
    expect(patch1.status).toBe(200);
    expect(patch1.body.bought).toBe(true);
    expect(patch1.body.at_venue).toBe(false);

    // Update — flip at_venue independently
    const patch2 = await request(app)
      .patch(`/api/v1/party/logistics/${id}`)
      .set('Cookie', adminCookie)
      .send({ at_venue: true });
    expect(patch2.status).toBe(200);
    expect(patch2.body.bought).toBe(true);
    expect(patch2.body.at_venue).toBe(true);

    // Delete
    const delRes = await request(app)
      .delete(`/api/v1/party/logistics/${id}`)
      .set('Cookie', adminCookie);
    expect(delRes.status).toBe(204);

    const afterRes = await request(app)
      .get('/api/v1/party/logistics')
      .set('Cookie', adminCookie);
    expect(afterRes.body).toHaveLength(0);
  });

  test('moderator can also add / update / delete', async () => {
    const modId     = await createTestModeratorUser();
    const modCookie = await getTestSessionCookie(modId);

    const createRes = await request(app)
      .post('/api/v1/party/logistics')
      .set('Cookie', modCookie)
      .send({ name: 'Plates' });
    expect(createRes.status).toBe(201);
    const id = createRes.body.id;

    const patchRes = await request(app)
      .patch(`/api/v1/party/logistics/${id}`)
      .set('Cookie', modCookie)
      .send({ bought: true });
    expect(patchRes.status).toBe(200);

    const delRes = await request(app)
      .delete(`/api/v1/party/logistics/${id}`)
      .set('Cookie', modCookie);
    expect(delRes.status).toBe(204);
  });

  test('POST returns 400 when name is missing or empty', async () => {
    const res1 = await request(app)
      .post('/api/v1/party/logistics')
      .set('Cookie', adminCookie)
      .send({});
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post('/api/v1/party/logistics')
      .set('Cookie', adminCookie)
      .send({ name: '   ' });
    expect(res2.status).toBe(400);
  });

  test('POST returns 400 when name exceeds 200 chars', async () => {
    const res = await request(app)
      .post('/api/v1/party/logistics')
      .set('Cookie', adminCookie)
      .send({ name: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });

  test('POST returns 403 for non-admin user', async () => {
    const res = await request(app)
      .post('/api/v1/party/logistics')
      .set('Cookie', userCookie)
      .send({ name: 'Sneaky' });
    expect(res.status).toBe(403);
  });

  test('PATCH returns 404 for non-existent id', async () => {
    const res = await request(app)
      .patch('/api/v1/party/logistics/999999')
      .set('Cookie', adminCookie)
      .send({ bought: true });
    expect(res.status).toBe(404);
  });

  test('PATCH returns 400 when no recognized fields provided', async () => {
    const createRes = await request(app)
      .post('/api/v1/party/logistics')
      .set('Cookie', adminCookie)
      .send({ name: 'Ice' });
    const id = createRes.body.id;

    const res = await request(app)
      .patch(`/api/v1/party/logistics/${id}`)
      .set('Cookie', adminCookie)
      .send({ unknown_field: 'x' });
    expect(res.status).toBe(400);
  });

  test('DELETE returns 404 for non-existent id', async () => {
    const res = await request(app)
      .delete('/api/v1/party/logistics/999999')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  test('items are returned in sort_order, then id', async () => {
    const a = await request(app).post('/api/v1/party/logistics')
      .set('Cookie', adminCookie).send({ name: 'A' });
    const b = await request(app).post('/api/v1/party/logistics')
      .set('Cookie', adminCookie).send({ name: 'B' });
    const c = await request(app).post('/api/v1/party/logistics')
      .set('Cookie', adminCookie).send({ name: 'C' });

    const list = await request(app)
      .get('/api/v1/party/logistics')
      .set('Cookie', adminCookie);
    expect(list.body.map(i => i.name)).toEqual(['A', 'B', 'C']);
    expect(list.body[0].sort_order).toBeLessThan(list.body[1].sort_order);
    expect(list.body[1].sort_order).toBeLessThan(list.body[2].sort_order);
    // sanity — IDs match
    expect([a.body.id, b.body.id, c.body.id]).toEqual(list.body.map(i => i.id));
  });
});
