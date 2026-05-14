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

  // Guestbook entries render in an authenticated-but-shared view (every party
  // attendee sees every other attendee's messages), so stored-XSS would impact
  // everyone if the controller ever accepted raw HTML. The global sanitizeBody
  // middleware strips tags before the handler sees req.body — this test pins
  // that protection at the guestbook entry point so a future refactor that
  // bypasses or moves the middleware fails loudly.
  test('strips HTML via global sanitize middleware (POST and round-trip)', async () => {
    const post = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', adminCookie)
      .send({ message: 'Hi <script>alert(1)</script> <img src=x onerror=alert(2)> there' });
    expect(post.status).toBe(201);
    expect(post.body.message).not.toMatch(/<script/i);
    expect(post.body.message).not.toMatch(/<img/i);
    expect(post.body.message).not.toMatch(/onerror/i);
    expect(post.body.message).toMatch(/Hi/);
    expect(post.body.message).toMatch(/there/);

    // Round-trip via GET — sanitization is on the way IN (storage), so the
    // GET reflects the sanitized form regardless of any later display layer.
    const list = await request(app)
      .get('/api/v1/party/guestbook')
      .set('Cookie', adminCookie);
    expect(list.status).toBe(200);
    expect(list.body[0].message).not.toMatch(/<script/i);
    expect(list.body[0].message).not.toMatch(/<img/i);
    expect(list.body[0].message).not.toMatch(/onerror/i);
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

// ── POST /api/v1/party/cover-image ────────────────────────────────────────────

describe('POST /api/v1/party/cover-image', () => {
  const fakePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  test('admin can upload a cover image, persists to default locale, returns merged info', async () => {
    const res = await request(app)
      .post('/api/v1/party/cover-image')
      .set('Cookie', adminCookie)
      .attach('file', fakePng, { filename: 'cover.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cover_image');
    expect(res.body.cover_image).toMatch(/^\/assets\/party\//);

    const { rows } = await db.query(
      `SELECT locale, value FROM site_content WHERE key = 'party_cover_image'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].locale).toBe('en'); // DEFAULT_LOCALE
    expect(typeof rows[0].value).toBe('string');
    expect(rows[0].value).toMatch(/^\/assets\/party\//);
  });

  test('returns 400 when no file is provided', async () => {
    const res = await request(app)
      .post('/api/v1/party/cover-image')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  test('returns 400 for non-image file type', async () => {
    const res = await request(app)
      .post('/api/v1/party/cover-image')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('GIF89a'), { filename: 'a.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
  });

  test('returns 403 for non-admin user', async () => {
    const res = await request(app)
      .post('/api/v1/party/cover-image')
      .set('Cookie', userCookie)
      .attach('file', fakePng, { filename: 'cover.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });

  test('unauthenticated returns 401', async () => {
    const res = await request(app).post('/api/v1/party/cover-image');
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/v1/party/info { activities } — locale-neutral ─────────────────
//
// Activities are stored once at DEFAULT_LOCALE regardless of which locale the
// admin was editing on, so /en/party and /is/party render the same entries
// without forcing the admin to enter them twice.

describe('PATCH /api/v1/party/info { activities } — locale-neutral', () => {
  const sampleActivities = JSON.stringify({
    daytime: [{ name: 'Face paint', description: 'https://example.com', rulesLabel: 'Rules:', rules: 'Drop in any time' }],
    evening: [{ name: 'TBD', description: 'TBD', rulesLabel: 'Rules:', rules: 'TBD' }],
  });

  beforeEach(async () => {
    await db.query(`DELETE FROM site_content WHERE key = 'party_activities'`);
  });
  afterAll(async () => {
    await db.query(`DELETE FROM site_content WHERE key = 'party_activities'`);
  });

  test('saving on IS still writes to the EN (DEFAULT_LOCALE) row', async () => {
    const res = await request(app)
      .patch('/api/v1/party/info?locale=is')
      .set('Cookie', adminCookie)
      .send({ activities: sampleActivities });
    expect(res.status).toBe(200);

    const { rows } = await db.query(
      `SELECT locale, value FROM site_content WHERE key = 'party_activities'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].locale).toBe('en');
    expect(rows[0].value.daytime[0].name).toBe('Face paint');
  });

  test('both locale GETs return the same activities', async () => {
    await request(app)
      .patch('/api/v1/party/info?locale=en')
      .set('Cookie', adminCookie)
      .send({ activities: sampleActivities });

    const en = await request(app).get('/api/v1/party/info?locale=en');
    const is = await request(app).get('/api/v1/party/info?locale=is');
    // JSONB round-trip may reorder object keys; compare parsed shapes.
    const expected = JSON.parse(sampleActivities);
    expect(JSON.parse(en.body.activities)).toEqual(expected);
    expect(JSON.parse(is.body.activities)).toEqual(expected);
  });

  test('save sweeps a pre-existing per-locale row', async () => {
    // Simulate a legacy IS row left over from before activities became locale-neutral.
    await db.query(
      `INSERT INTO site_content (key, locale, value, updated_by)
         VALUES ('party_activities', 'is', $1::jsonb, $2)`,
      [JSON.stringify({ daytime: [{ name: 'stale-is' }], evening: [] }), adminId]
    );

    await request(app)
      .patch('/api/v1/party/info?locale=en')
      .set('Cookie', adminCookie)
      .send({ activities: sampleActivities });

    const { rows } = await db.query(
      `SELECT locale FROM site_content WHERE key = 'party_activities' ORDER BY locale`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].locale).toBe('en');

    // GET on IS now sees the canonical EN activities, not the stale row.
    const is = await request(app).get('/api/v1/party/info?locale=is');
    expect(JSON.parse(is.body.activities)).toEqual(JSON.parse(sampleActivities));
  });

  test('IS GET prefers a stranded IS-only row as a last resort', async () => {
    // No EN row, only IS — getInfo should backfill with the IS row so a
    // legacy install where activities only live on IS still renders something.
    const stranded = { daytime: [{ name: 'IS-only' }], evening: [] };
    await db.query(
      `INSERT INTO site_content (key, locale, value, updated_by)
         VALUES ('party_activities', 'is', $1::jsonb, $2)`,
      [JSON.stringify(stranded), adminId]
    );

    const is = await request(app).get('/api/v1/party/info?locale=is');
    // Stranded IS row is NOT promoted to neutral (the canonical seat is EN).
    // Without an EN row, GET falls back to DEFAULT_PARTY_INFO.activities.
    const parsed = JSON.parse(is.body.activities);
    expect(parsed.daytime[0].name).toBe('TBD');
  });
});

// ── PATCH /api/v1/party/info { rsvp_message } ────────────────────────────────

describe('PATCH /api/v1/party/info { rsvp_message }', () => {
  test('GET returns the empty default when no row exists', async () => {
    const res = await request(app).get('/api/v1/party/info');
    expect(res.status).toBe(200);
    expect(res.body.rsvp_message).toBe('');
  });

  test('admin can set the message and it persists', async () => {
    const patch = await request(app)
      .patch('/api/v1/party/info')
      .set('Cookie', adminCookie)
      .send({ rsvp_message: 'Please RSVP by July 1st!' });
    expect(patch.status).toBe(200);
    expect(patch.body.rsvp_message).toBe('Please RSVP by July 1st!');

    const get = await request(app).get('/api/v1/party/info');
    expect(get.body.rsvp_message).toBe('Please RSVP by July 1st!');
  });

  test('moderator can also set the message', async () => {
    const modId = await createTestModeratorUser();
    const modCookie = await getTestSessionCookie(modId);
    const res = await request(app)
      .patch('/api/v1/party/info')
      .set('Cookie', modCookie)
      .send({ rsvp_message: 'See you soon' });
    expect(res.status).toBe(200);
    expect(res.body.rsvp_message).toBe('See you soon');
  });

  test('non-admin user gets 403', async () => {
    const res = await request(app)
      .patch('/api/v1/party/info')
      .set('Cookie', userCookie)
      .send({ rsvp_message: 'sneaky' });
    expect(res.status).toBe(403);
  });

  test('writes rsvp_message to the request locale only (per-locale)', async () => {
    await request(app)
      .patch('/api/v1/party/info?locale=is')
      .set('Cookie', adminCookie)
      .send({ rsvp_message: 'Skilaboð á íslensku' });

    const { rows } = await db.query(
      `SELECT locale, value FROM site_content WHERE key = 'party_rsvp_message' ORDER BY locale`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].locale).toBe('is');
    expect(rows[0].value).toBe('Skilaboð á íslensku');
  });

  test('EN and IS rows are independent', async () => {
    await request(app)
      .patch('/api/v1/party/info?locale=en')
      .set('Cookie', adminCookie)
      .send({ rsvp_message: 'English text' });
    await request(app)
      .patch('/api/v1/party/info?locale=is')
      .set('Cookie', adminCookie)
      .send({ rsvp_message: 'Íslenskur texti' });

    const enGet = await request(app).get('/api/v1/party/info?locale=en');
    const isGet = await request(app).get('/api/v1/party/info?locale=is');
    expect(enGet.body.rsvp_message).toBe('English text');
    expect(isGet.body.rsvp_message).toBe('Íslenskur texti');
  });

  test('locale with no row falls back to DEFAULT_PARTY_INFO.rsvp_message', async () => {
    // Seed only the IS row.
    await request(app)
      .patch('/api/v1/party/info?locale=is')
      .set('Cookie', adminCookie)
      .send({ rsvp_message: 'IS-only message' });

    // EN viewer should see the empty default, not the IS row.
    const en = await request(app).get('/api/v1/party/info?locale=en');
    expect(en.body.rsvp_message).toBe('');
  });

  test('preserves newlines so paragraphs survive a round-trip', async () => {
    const body = 'Line one\nLine two\n\nLine four';
    const patch = await request(app)
      .patch('/api/v1/party/info')
      .set('Cookie', adminCookie)
      .send({ rsvp_message: body });
    expect(patch.status).toBe(200);
    expect(patch.body.rsvp_message).toBe(body);
  });

  test('empty string is allowed (clears the message)', async () => {
    await request(app)
      .patch('/api/v1/party/info')
      .set('Cookie', adminCookie)
      .send({ rsvp_message: 'something' });

    const cleared = await request(app)
      .patch('/api/v1/party/info')
      .set('Cookie', adminCookie)
      .send({ rsvp_message: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.rsvp_message).toBe('');
  });

  test('rejects message longer than 2000 chars with 400', async () => {
    const tooLong = 'a'.repeat(2001);
    const res = await request(app)
      .patch('/api/v1/party/info')
      .set('Cookie', adminCookie)
      .send({ rsvp_message: tooLong });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rsvp_message/);
  });

  test('strips HTML via global sanitize middleware', async () => {
    const res = await request(app)
      .patch('/api/v1/party/info')
      .set('Cookie', adminCookie)
      .send({ rsvp_message: 'Hello <script>alert(1)</script> world' });
    expect(res.status).toBe(200);
    expect(res.body.rsvp_message).not.toMatch(/<script>/);
    expect(res.body.rsvp_message).toMatch(/Hello/);
    expect(res.body.rsvp_message).toMatch(/world/);
  });
});

// ── PUT /api/v1/content/party_hero (admin inline-edit hero text) ─────────────

describe('PUT /api/v1/content/party_hero', () => {
  const ENBlob = {
    title_prefix: "HALLI'S",
    title_main:   '40',
    title_suffix: 'th',
    subtitle:     "The big four-zero — let's make it legendary",
  };
  const ISBlob = {
    title_prefix: "HALLI'S",
    title_main:   '40',
    title_suffix: 'ára',
    subtitle:     'Stóru fjórir-núll — gerum þetta goðsagnakennt',
  };

  // cleanTables() does not include site_content; clear party_hero rows
  // explicitly so each test starts from a known state.
  beforeEach(async () => {
    await db.query(`DELETE FROM site_content WHERE key = 'party_hero'`);
  });
  afterAll(async () => {
    await db.query(`DELETE FROM site_content WHERE key = 'party_hero'`);
  });

  test('GET returns 404 when no row exists (client falls back to defaults)', async () => {
    const res = await request(app).get('/api/v1/content/party_hero');
    expect(res.status).toBe(404);
  });

  test('admin PUT ?locale=en persists the EN row and echoes the body', async () => {
    const res = await request(app)
      .put('/api/v1/content/party_hero?locale=en')
      .set('Cookie', adminCookie)
      .send(ENBlob);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(ENBlob);

    const { rows } = await db.query(
      `SELECT value FROM site_content WHERE key = 'party_hero' AND locale = 'en'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toEqual(ENBlob);
  });

  test('admin PUT ?locale=is persists a separate IS row', async () => {
    await request(app)
      .put('/api/v1/content/party_hero?locale=en')
      .set('Cookie', adminCookie)
      .send(ENBlob);

    const res = await request(app)
      .put('/api/v1/content/party_hero?locale=is')
      .set('Cookie', adminCookie)
      .send(ISBlob);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(ISBlob);

    const { rows } = await db.query(
      `SELECT locale, value FROM site_content WHERE key = 'party_hero' ORDER BY locale`
    );
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.locale === 'en').value).toEqual(ENBlob);
    expect(rows.find(r => r.locale === 'is').value).toEqual(ISBlob);
  });

  test('editing EN does not touch the IS row (locale rows are independent)', async () => {
    await request(app).put('/api/v1/content/party_hero?locale=en')
      .set('Cookie', adminCookie).send(ENBlob);
    await request(app).put('/api/v1/content/party_hero?locale=is')
      .set('Cookie', adminCookie).send(ISBlob);

    // Re-edit just EN — IS row must stay exactly as written.
    const newEn = { ...ENBlob, title_main: '41' };
    await request(app).put('/api/v1/content/party_hero?locale=en')
      .set('Cookie', adminCookie).send(newEn);

    const en = await db.query(
      `SELECT value FROM site_content WHERE key = 'party_hero' AND locale = 'en'`
    );
    const is = await db.query(
      `SELECT value FROM site_content WHERE key = 'party_hero' AND locale = 'is'`
    );
    expect(en.rows[0].value.title_main).toBe('41');
    expect(is.rows[0].value).toEqual(ISBlob);
  });

  test('moderator can also save', async () => {
    const modId = await createTestModeratorUser();
    const modCookie = await getTestSessionCookie(modId);
    const res = await request(app)
      .put('/api/v1/content/party_hero?locale=en')
      .set('Cookie', modCookie)
      .send(ENBlob);
    expect(res.status).toBe(200);
  });

  test('regular user gets 403', async () => {
    const res = await request(app)
      .put('/api/v1/content/party_hero?locale=en')
      .set('Cookie', userCookie)
      .send(ENBlob);
    expect(res.status).toBe(403);
  });

  test('unauthenticated request gets 401', async () => {
    const res = await request(app)
      .put('/api/v1/content/party_hero?locale=en')
      .send(ENBlob);
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/v1/party/info clears cover_image ──────────────────────────────

describe('PATCH /api/v1/party/info { cover_image: "" } clears the cover', () => {
  test('admin can clear the cover image via PATCH', async () => {
    // Seed an existing cover image row
    await db.query(
      `INSERT INTO site_content (key, locale, value, updated_by) VALUES
       ('party_cover_image', 'en', '"/assets/party/seeded.jpg"'::jsonb, $1)
       ON CONFLICT (key, locale) DO UPDATE SET value = EXCLUDED.value`,
      [adminId]
    );

    const res = await request(app)
      .patch('/api/v1/party/info')
      .set('Cookie', adminCookie)
      .send({ cover_image: '' });
    expect(res.status).toBe(200);
    expect(res.body.cover_image).toBe('');

    const get = await request(app).get('/api/v1/party/info');
    expect(get.body.cover_image).toBe('');
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

  // Inline editing relies on PATCH accepting a single field without
  // disturbing the rest. Guard against future refactors breaking that.
  test('PATCH with a single field updates only that field', async () => {
    const created = await request(app)
      .post('/api/v1/party/logistics')
      .set('Cookie', adminCookie)
      .send({ name: 'Original', quantity: '50', assigned_to: 'Mom' });
    const id = created.body.id;
    const initialSortOrder = created.body.sort_order;

    const renamed = await request(app)
      .patch(`/api/v1/party/logistics/${id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Renamed');
    expect(renamed.body.quantity).toBe('50');
    expect(renamed.body.assigned_to).toBe('Mom');
    expect(renamed.body.bought).toBe(false);
    expect(renamed.body.at_venue).toBe(false);
    expect(renamed.body.sort_order).toBe(initialSortOrder);
  });

  // ── Reorder ────────────────────────────────────────────────────────────────

  test('POST /logistics/reorder applies new sort order', async () => {
    const a = await request(app).post('/api/v1/party/logistics')
      .set('Cookie', adminCookie).send({ name: 'A' });
    const b = await request(app).post('/api/v1/party/logistics')
      .set('Cookie', adminCookie).send({ name: 'B' });
    const c = await request(app).post('/api/v1/party/logistics')
      .set('Cookie', adminCookie).send({ name: 'C' });

    const reorderRes = await request(app)
      .post('/api/v1/party/logistics/reorder')
      .set('Cookie', adminCookie)
      .send({ ids: [c.body.id, a.body.id, b.body.id] });
    expect(reorderRes.status).toBe(204);

    const list = await request(app)
      .get('/api/v1/party/logistics')
      .set('Cookie', adminCookie);
    expect(list.body.map(i => i.name)).toEqual(['C', 'A', 'B']);
    expect(list.body.map(i => i.sort_order)).toEqual([1, 2, 3]);
  });

  test('POST /logistics/reorder rejects empty / non-array / non-integer ids', async () => {
    const res1 = await request(app).post('/api/v1/party/logistics/reorder')
      .set('Cookie', adminCookie).send({});
    expect(res1.status).toBe(400);

    const res2 = await request(app).post('/api/v1/party/logistics/reorder')
      .set('Cookie', adminCookie).send({ ids: 'foo' });
    expect(res2.status).toBe(400);

    const res3 = await request(app).post('/api/v1/party/logistics/reorder')
      .set('Cookie', adminCookie).send({ ids: [] });
    expect(res3.status).toBe(400);

    const res4 = await request(app).post('/api/v1/party/logistics/reorder')
      .set('Cookie', adminCookie).send({ ids: ['a', 'b'] });
    expect(res4.status).toBe(400);
  });

  test('POST /logistics/reorder requires admin/moderator', async () => {
    const anon = await request(app).post('/api/v1/party/logistics/reorder')
      .send({ ids: [1] });
    expect(anon.status).toBe(401);

    const user = await request(app).post('/api/v1/party/logistics/reorder')
      .set('Cookie', userCookie).send({ ids: [1] });
    expect(user.status).toBe(403);
  });

  // ── Mark all at venue ──────────────────────────────────────────────────────

  test('POST /logistics/all-at-venue flips every item', async () => {
    const a = await request(app).post('/api/v1/party/logistics')
      .set('Cookie', adminCookie).send({ name: 'A' });
    await request(app).post('/api/v1/party/logistics')
      .set('Cookie', adminCookie).send({ name: 'B' });
    await request(app).post('/api/v1/party/logistics')
      .set('Cookie', adminCookie).send({ name: 'C' });

    // Pre-flip one of them so we exercise the "skip rows already true" branch.
    await request(app).patch(`/api/v1/party/logistics/${a.body.id}`)
      .set('Cookie', adminCookie).send({ at_venue: true });

    const res = await request(app)
      .post('/api/v1/party/logistics/all-at-venue')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);

    const list = await request(app)
      .get('/api/v1/party/logistics')
      .set('Cookie', adminCookie);
    expect(list.body.every(i => i.at_venue === true)).toBe(true);
  });

  test('POST /logistics/all-at-venue is idempotent', async () => {
    await request(app).post('/api/v1/party/logistics')
      .set('Cookie', adminCookie).send({ name: 'A' });

    const first = await request(app).post('/api/v1/party/logistics/all-at-venue')
      .set('Cookie', adminCookie);
    expect(first.status).toBe(204);
    const second = await request(app).post('/api/v1/party/logistics/all-at-venue')
      .set('Cookie', adminCookie);
    expect(second.status).toBe(204);
  });

  test('POST /logistics/all-at-venue requires admin/moderator', async () => {
    const anon = await request(app).post('/api/v1/party/logistics/all-at-venue');
    expect(anon.status).toBe(401);

    const user = await request(app).post('/api/v1/party/logistics/all-at-venue')
      .set('Cookie', userCookie);
    expect(user.status).toBe(403);
  });
});
