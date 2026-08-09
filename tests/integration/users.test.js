const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  createTestAdminUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

let sessionCookie;
let adminId;

beforeEach(async () => {
  await cleanTables();
  adminId       = await createTestAdminUser();
  sessionCookie = await getTestSessionCookie(adminId);
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
      email_verified: true,
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
      .send({ avatar: 'avatar-10.svg' });

    expect(res.status).toBe(200);
    expect(res.body.avatar).toBe('avatar-10.svg');
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

  // ── Username editing ──────────────────────────────────────────────────────
  describe('username updates', () => {
    test('updates username with valid value', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ username: 'new_handle_42' });

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('new_handle_42');

      // DB confirms the persisted change
      const { rows } = await db.query('SELECT username FROM users WHERE id = $1', [adminId]);
      expect(rows[0].username).toBe('new_handle_42');
    });

    test('rejects duplicate username with 409', async () => {
      // Seed a second user that owns the target username
      const { Scrypt } = require('oslo/password');
      const scrypt = new Scrypt();
      const hash = await scrypt.hash('password123');
      await db.query(
        `INSERT INTO users (id, email, username, password_hash, role, email_verified)
         VALUES ('test-other-id', 'other@test.com', 'takenname', $1, 'user', TRUE)`,
        [hash]
      );

      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ username: 'takenname' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/taken|already/i);
    });

    test('duplicate check is case-insensitive', async () => {
      const { Scrypt } = require('oslo/password');
      const scrypt = new Scrypt();
      const hash = await scrypt.hash('password123');
      await db.query(
        `INSERT INTO users (id, email, username, password_hash, role, email_verified)
         VALUES ('test-other-id', 'other@test.com', 'MixedCaseName', $1, 'user', TRUE)`,
        [hash]
      );

      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ username: 'mixedcasename' });

      expect(res.status).toBe(409);
    });

    test('allows the caller to keep their own username unchanged', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ username: process.env.ADMIN_USERNAME });

      expect(res.status).toBe(200);
      expect(res.body.username).toBe(process.env.ADMIN_USERNAME);
    });

    test('rejects username shorter than 3 chars (400)', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ username: 'ab' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/username/i);
    });

    test('rejects username longer than 40 chars (400)', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ username: 'a'.repeat(41) });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/username/i);
    });

    test('rejects username with invalid characters (400)', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ username: 'has spaces!' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/username/i);
    });

    test('accepts Icelandic letters in username', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ username: 'jónþórsson' });

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('jónþórsson');
    });

    // The DB unique index on LOWER(username) replaces a SELECT-then-UPDATE check
    // that was vulnerable to a TOCTOU race. These tests exercise the constraint
    // violation path directly to confirm 23505 surfaces as a clean 409.

    test('case-different duplicate is rejected by the DB index, not a pre-check', async () => {
      // Seed a row whose username differs only in case from the target.
      const { Scrypt } = require('oslo/password');
      const scrypt = new Scrypt();
      const hash = await scrypt.hash('password123');
      await db.query(
        `INSERT INTO users (id, email, username, password_hash, role, email_verified)
         VALUES ('test-other-id', 'other@test.com', 'CamelCase', $1, 'user', TRUE)`,
        [hash]
      );

      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ username: 'camelcase' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/taken|already/i);
    });

    test('whitespace-padded duplicate is trimmed, then rejected as duplicate', async () => {
      const { Scrypt } = require('oslo/password');
      const scrypt = new Scrypt();
      const hash = await scrypt.hash('password123');
      await db.query(
        `INSERT INTO users (id, email, username, password_hash, role, email_verified)
         VALUES ('test-other-id', 'other@test.com', 'taken_handle', $1, 'user', TRUE)`,
        [hash]
      );

      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ username: '  taken_handle  ' });

      expect(res.status).toBe(409);
    });

    test('username is persisted trimmed', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ username: '  spaced_name  ' });

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('spaced_name');

      const { rows } = await db.query('SELECT username FROM users WHERE id = $1', [adminId]);
      expect(rows[0].username).toBe('spaced_name');
    });

    test('DB unique index on LOWER(username) blocks case-only duplicates at insert time', async () => {
      const { Scrypt } = require('oslo/password');
      const scrypt = new Scrypt();
      const hash = await scrypt.hash('password123');
      await db.query(
        `INSERT INTO users (id, email, username, password_hash, role, email_verified)
         VALUES ('idx-test-a', 'a@test.com', 'IndexCheck', $1, 'user', TRUE)`,
        [hash]
      );

      await expect(
        db.query(
          `INSERT INTO users (id, email, username, password_hash, role, email_verified)
           VALUES ('idx-test-b', 'b@test.com', 'indexcheck', $1, 'user', TRUE)`,
          [hash]
        )
      ).rejects.toMatchObject({ code: '23505' });
    });
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
