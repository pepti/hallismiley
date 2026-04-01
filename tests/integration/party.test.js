const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  getTestSessionCookie,
  createTestRegularUser,
  cleanTables,
} = require('../helpers');

let adminCookie;
let userCookie;
let userId;

// ── Helper: add a user email to party_invites ─────────────────────────────────
async function inviteEmail(email, adminCookieParam) {
  await request(app)
    .post('/api/v1/party/invites')
    .set('Cookie', adminCookieParam || adminCookie)
    .send({ emails: [email] });
}

beforeEach(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie(); // creates test-admin-id with email admin@test.com
  userId = await createTestRegularUser();     // creates test-user-id with email user@test.com
  userCookie = await getTestSessionCookie(userId);
});

afterAll(async () => {
  await db.pool.end();
});

// ── POST /api/v1/party/invites ────────────────────────────────────────────────

describe('POST /api/v1/party/invites', () => {
  test('admin can add invites', async () => {
    const res = await request(app)
      .post('/api/v1/party/invites')
      .set('Cookie', adminCookie)
      .send({ emails: ['alice@example.com', 'bob@example.com'] });

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ email: 'alice@example.com', status: 'pending' });
    expect(res.body[0].invite_token).toBeTruthy();
  });

  test('emails are normalised to lowercase', async () => {
    const res = await request(app)
      .post('/api/v1/party/invites')
      .set('Cookie', adminCookie)
      .send({ emails: ['ALICE@EXAMPLE.COM'] });

    expect(res.status).toBe(201);
    expect(res.body[0].email).toBe('alice@example.com');
  });

  test('duplicate email is upserted, not duplicated', async () => {
    await request(app)
      .post('/api/v1/party/invites')
      .set('Cookie', adminCookie)
      .send({ emails: ['dup@example.com'] });

    const res = await request(app)
      .post('/api/v1/party/invites')
      .set('Cookie', adminCookie)
      .send({ emails: ['dup@example.com'] });

    expect(res.status).toBe(201);

    const list = await request(app)
      .get('/api/v1/party/invites')
      .set('Cookie', adminCookie);
    const entries = list.body.filter(i => i.email === 'dup@example.com');
    expect(entries).toHaveLength(1);
  });

  test('non-admin gets 403', async () => {
    const res = await request(app)
      .post('/api/v1/party/invites')
      .set('Cookie', userCookie)
      .send({ emails: ['x@example.com'] });

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app)
      .post('/api/v1/party/invites')
      .send({ emails: ['x@example.com'] });

    expect(res.status).toBe(401);
  });

  test('missing emails array returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/party/invites')
      .set('Cookie', adminCookie)
      .send({ emails: [] });

    expect(res.status).toBe(400);
  });
});

// ── GET /api/v1/party/invites ─────────────────────────────────────────────────

describe('GET /api/v1/party/invites', () => {
  test('admin can list all invites', async () => {
    await inviteEmail('list@example.com');
    const res = await request(app)
      .get('/api/v1/party/invites')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(i => i.email === 'list@example.com')).toBe(true);
  });

  test('non-admin gets 403', async () => {
    const res = await request(app)
      .get('/api/v1/party/invites')
      .set('Cookie', userCookie);

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/v1/party/invites/:id ─────────────────────────────────────────

describe('DELETE /api/v1/party/invites/:id', () => {
  test('admin can delete an invite', async () => {
    const add = await request(app)
      .post('/api/v1/party/invites')
      .set('Cookie', adminCookie)
      .send({ emails: ['del@example.com'] });

    const id  = add.body[0].id;
    const del = await request(app)
      .delete(`/api/v1/party/invites/${id}`)
      .set('Cookie', adminCookie);

    expect(del.status).toBe(204);
  });

  test('returns 404 for non-existent invite', async () => {
    const res = await request(app)
      .delete('/api/v1/party/invites/99999')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });

  test('non-admin gets 403', async () => {
    const res = await request(app)
      .delete('/api/v1/party/invites/1')
      .set('Cookie', userCookie);

    expect(res.status).toBe(403);
  });
});

// ── GET /api/v1/party/access ──────────────────────────────────────────────────

describe('GET /api/v1/party/access', () => {
  test('invited user gets hasAccess: true', async () => {
    await inviteEmail('user@test.com'); // user@test.com is the regular user's email

    const res = await request(app)
      .get('/api/v1/party/access')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.hasAccess).toBe(true);
  });

  test('non-invited user gets hasAccess: false', async () => {
    const res = await request(app)
      .get('/api/v1/party/access')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.hasAccess).toBe(false);
  });

  test('admin email invited by default gets access if invited', async () => {
    await inviteEmail('admin@test.com');

    const res = await request(app)
      .get('/api/v1/party/access')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.hasAccess).toBe(true);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app).get('/api/v1/party/access');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/v1/party/rsvp ───────────────────────────────────────────────────

describe('POST /api/v1/party/rsvp', () => {
  beforeEach(async () => {
    await inviteEmail('user@test.com'); // invite the regular user
  });

  test('invited user can RSVP attending', async () => {
    const res = await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', userCookie)
      .send({ attending: true, dietary_needs: 'vegan', plus_one: false });

    expect(res.status).toBe(200);
    expect(res.body.attending).toBe(true);
    expect(res.body.dietary_needs).toBe('vegan');
  });

  test('invited user can RSVP not attending', async () => {
    const res = await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', userCookie)
      .send({ attending: false });

    expect(res.status).toBe(200);
    expect(res.body.attending).toBe(false);
  });

  test('invited user can include plus one', async () => {
    const res = await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', userCookie)
      .send({ attending: true, plus_one: true, plus_one_name: 'Jane', plus_one_dietary: 'gluten-free' });

    expect(res.status).toBe(200);
    expect(res.body.plus_one).toBe(true);
    expect(res.body.plus_one_name).toBe('Jane');
  });

  test('RSVP can be updated', async () => {
    await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', userCookie)
      .send({ attending: true });

    const res = await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', userCookie)
      .send({ attending: false });

    expect(res.status).toBe(200);
    expect(res.body.attending).toBe(false);
  });

  test('missing attending field returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', userCookie)
      .send({ dietary_needs: 'vegan' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/attending/i);
  });

  test('non-invited user gets 403', async () => {
    // Create another user not on the list
    const { lucia } = require('../../server/auth/lucia');
    const { Scrypt } = require('oslo/password');
    const scrypt = new Scrypt();
    const hash   = await scrypt.hash('testpass');
    const { rows } = await db.query(
      `INSERT INTO users (id, email, username, password_hash, role)
       VALUES ('other-user-id', 'other@test.com', 'otheruser', $1, 'user')
       ON CONFLICT DO NOTHING RETURNING id`,
      [hash]
    );
    if (rows[0]) {
      const session = await lucia.createSession('other-user-id', { ip_address: '127.0.0.1', user_agent: 'test' });
      const cookie  = lucia.createSessionCookie(session.id);
      const otherCookie = `${cookie.name}=${cookie.value}`;

      const res = await request(app)
        .post('/api/v1/party/rsvp')
        .set('Cookie', otherCookie)
        .send({ attending: true });

      expect(res.status).toBe(403);
    }
  });
});

// ── GET /api/v1/party/rsvp ────────────────────────────────────────────────────

describe('GET /api/v1/party/rsvp', () => {
  beforeEach(async () => {
    await inviteEmail('user@test.com');
  });

  test('returns null when no RSVP submitted', async () => {
    const res = await request(app)
      .get('/api/v1/party/rsvp')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  test('returns own RSVP after submitting', async () => {
    await request(app)
      .post('/api/v1/party/rsvp')
      .set('Cookie', userCookie)
      .send({ attending: true, dietary_needs: 'vegan' });

    const res = await request(app)
      .get('/api/v1/party/rsvp')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.attending).toBe(true);
    expect(res.body.dietary_needs).toBe('vegan');
  });
});

// ── GET /api/v1/party/rsvps (admin) ──────────────────────────────────────────

describe('GET /api/v1/party/rsvps', () => {
  test('admin can get all RSVPs', async () => {
    const res = await request(app)
      .get('/api/v1/party/rsvps')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('non-admin gets 403', async () => {
    await inviteEmail('user@test.com');
    const res = await request(app)
      .get('/api/v1/party/rsvps')
      .set('Cookie', userCookie);

    expect(res.status).toBe(403);
  });
});

// ── POST /api/v1/party/guestbook ─────────────────────────────────────────────

describe('POST /api/v1/party/guestbook', () => {
  beforeEach(async () => {
    await inviteEmail('user@test.com');
  });

  test('invited user can post a guestbook message', async () => {
    const res = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', userCookie)
      .send({ message: 'Happy birthday Halli!' });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Happy birthday Halli!');
    expect(res.body.user_id).toBe(userId);
  });

  test('message over 1000 chars returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', userCookie)
      .send({ message: 'A'.repeat(1001) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1000/);
  });

  test('empty message returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', userCookie)
      .send({ message: '   ' });

    expect(res.status).toBe(400);
  });

  test('non-invited user gets 403', async () => {
    const res = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', adminCookie) // admin not on invite list
      .send({ message: 'Hello!' });

    expect(res.status).toBe(403);
  });
});

// ── GET /api/v1/party/guestbook ───────────────────────────────────────────────

describe('GET /api/v1/party/guestbook', () => {
  beforeEach(async () => {
    await inviteEmail('user@test.com');
  });

  test('returns empty array when no messages', async () => {
    const res = await request(app)
      .get('/api/v1/party/guestbook')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  test('returns posted messages', async () => {
    await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', userCookie)
      .send({ message: 'First message!' });

    const res = await request(app)
      .get('/api/v1/party/guestbook')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].message).toBe('First message!');
    expect(res.body[0].username).toBeTruthy();
  });

  test('non-invited user gets 403', async () => {
    const res = await request(app)
      .get('/api/v1/party/guestbook')
      .set('Cookie', adminCookie); // admin not on invite list

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/v1/party/guestbook/:id ───────────────────────────────────────

describe('DELETE /api/v1/party/guestbook/:id', () => {
  beforeEach(async () => {
    await inviteEmail('user@test.com');
  });

  test('user can delete own message', async () => {
    const post = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', userCookie)
      .send({ message: 'Delete me' });

    const id  = post.body.id;
    const del = await request(app)
      .delete(`/api/v1/party/guestbook/${id}`)
      .set('Cookie', userCookie);

    expect(del.status).toBe(204);
  });

  test("user cannot delete another user's message — 403", async () => {
    // Post as regular user
    const post = await request(app)
      .post('/api/v1/party/guestbook')
      .set('Cookie', userCookie)
      .send({ message: 'Mine' });

    // Admin needs invite access to delete via party endpoint
    await inviteEmail('admin@test.com');

    // Admin can delete any message
    const del = await request(app)
      .delete(`/api/v1/party/guestbook/${post.body.id}`)
      .set('Cookie', adminCookie);

    expect(del.status).toBe(204);
  });

  test('returns 404 for non-existent message', async () => {
    const res = await request(app)
      .delete('/api/v1/party/guestbook/99999')
      .set('Cookie', userCookie);

    expect(res.status).toBe(404);
  });
});

// ── GET /api/v1/party/photos ──────────────────────────────────────────────────

describe('GET /api/v1/party/photos', () => {
  beforeEach(async () => {
    await inviteEmail('user@test.com');
  });

  test('returns empty array when no photos', async () => {
    const res = await request(app)
      .get('/api/v1/party/photos')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  test('non-invited user gets 403', async () => {
    const res = await request(app)
      .get('/api/v1/party/photos')
      .set('Cookie', adminCookie); // admin not on invite list

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app).get('/api/v1/party/photos');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/party/info ────────────────────────────────────────────────────

describe('GET /api/v1/party/info', () => {
  beforeEach(async () => {
    await inviteEmail('user@test.com');
  });

  test('returns default party info for invited user', async () => {
    const res = await request(app)
      .get('/api/v1/party/info')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.date).toBe('July 25, 2026');
    expect(res.body.schedule).toBeTruthy();
    expect(res.body.games).toBeTruthy();
  });

  test('non-invited user gets 403', async () => {
    const res = await request(app)
      .get('/api/v1/party/info')
      .set('Cookie', adminCookie); // admin not on invite list

    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/v1/party/info ──────────────────────────────────────────────────

describe('PATCH /api/v1/party/info', () => {
  test('admin can update party info', async () => {
    const res = await request(app)
      .patch('/api/v1/party/info')
      .set('Cookie', adminCookie)
      .send({ venue_name: 'The Grand Hall', venue_address: '123 Party St' });

    expect(res.status).toBe(200);
    expect(res.body.venue_name).toBe('The Grand Hall');
  });

  test('invalid field returns 400', async () => {
    const res = await request(app)
      .patch('/api/v1/party/info')
      .set('Cookie', adminCookie)
      .send({ not_allowed: 'value' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid field/i);
  });

  test('non-admin gets 403', async () => {
    await inviteEmail('user@test.com');
    const res = await request(app)
      .patch('/api/v1/party/info')
      .set('Cookie', userCookie)
      .send({ venue_name: 'Hacked' });

    expect(res.status).toBe(403);
  });
});
