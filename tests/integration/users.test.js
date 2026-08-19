const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  createTestAdminUser,
  createTestRegularUser,
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

// ── POST /api/v1/users/me/avatar ─────────────────────────────────────────────
// users.id is TEXT (gen_random_uuid()::text / test-style ids), so uploaded
// filenames are user-<textId>-<ts>-<rand>.<ext>. The shared UPLOADED_AVATAR_RE
// must match them, or superseded files are never unlinked and PATCH /users/me
// rejects the stored value when a client echoes it back.

describe('POST /api/v1/users/me/avatar', () => {
  const fs   = require('fs');
  const path = require('path');
  const { userAvatarDir } = require('../../server/config/paths');
  // Any bytes will do — multer validates the declared mimetype, not the content.
  const fakePng = Buffer.from('89504e470d0a1a0a', 'hex');

  function uploadAvatar() {
    return request(app)
      .post('/api/v1/users/me/avatar')
      .set('Cookie', sessionCookie)
      .attach('file', fakePng, { filename: 'me.png', contentType: 'image/png' });
  }

  afterEach(async () => {
    // Remove any files this suite wrote (admin + the second user below).
    const dir = userAvatarDir();
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(`user-${adminId}-`) || f.startsWith('user-test-')) {
          fs.unlinkSync(path.join(dir, f));
        }
      }
    }
  });

  test('stores the file, sets users.avatar, and the filename passes the shared allowlist', async () => {
    const res = await uploadAvatar();

    expect(res.status).toBe(200);
    const { UPLOADED_AVATAR_RE } = require('../../server/middleware/validate');
    expect(res.body.avatar).toMatch(UPLOADED_AVATAR_RE);
    expect(fs.existsSync(path.join(userAvatarDir(), res.body.avatar))).toBe(true);

    const { rows } = await db.query('SELECT avatar FROM users WHERE id = $1', [adminId]);
    expect(rows[0].avatar).toBe(res.body.avatar);
  });

  test('uploading a replacement deletes the superseded file from disk', async () => {
    const first = await uploadAvatar();
    expect(first.status).toBe(200);
    const firstPath = path.join(userAvatarDir(), first.body.avatar);
    expect(fs.existsSync(firstPath)).toBe(true);

    const second = await uploadAvatar();
    expect(second.status).toBe(200);
    expect(second.body.avatar).not.toBe(first.body.avatar);

    expect(fs.existsSync(path.join(userAvatarDir(), second.body.avatar))).toBe(true);
    expect(fs.existsSync(firstPath)).toBe(false);
  });

  test('switching to a baked SVG via PATCH deletes the superseded upload', async () => {
    const uploaded = await uploadAvatar();
    const uploadedPath = path.join(userAvatarDir(), uploaded.body.avatar);
    expect(fs.existsSync(uploadedPath)).toBe(true);

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ avatar: 'avatar-10.svg' });

    expect(res.status).toBe(200);
    expect(res.body.avatar).toBe('avatar-10.svg');
    expect(fs.existsSync(uploadedPath)).toBe(false);
  });

  test('PATCH /users/me echoing the stored uploaded-avatar value succeeds', async () => {
    const uploaded = await uploadAvatar();
    expect(uploaded.status).toBe(200);

    // Clients send the whole profile back on save — the stored value must
    // round-trip through the avatar validator.
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ avatar: uploaded.body.avatar });

    expect(res.status).toBe(200);
    expect(res.body.avatar).toBe(uploaded.body.avatar);
  });

  // The avatars dir is one flat shared directory and uploaded filenames are
  // served publicly, so an uploaded avatar must be claimable only by its owner.
  // Otherwise a user could point their profile at someone else's file and have
  // their next upload delete it (uploadAvatar unlinks the superseded value).
  describe('cross-user protection', () => {
    let victimFile;
    let otherCookie;

    beforeEach(async () => {
      const uploaded = await uploadAvatar();      // admin uploads; admin is the victim
      victimFile = uploaded.body.avatar;
      await createTestRegularUser();
      otherCookie = await getTestSessionCookie('test-user-id');
    });

    test("another user cannot set their avatar to the victim's uploaded file", async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Cookie', otherCookie)
        .send({ avatar: victimFile });

      expect(res.status).toBe(400);
      expect(fs.existsSync(path.join(userAvatarDir(), victimFile))).toBe(true);
    });

    test("a planted foreign avatar value is not deleted by the other user's upload", async () => {
      // Bypass the validator and write the victim's filename straight into the
      // attacker's row — proves the unlink guard is a second, independent layer.
      await db.query('UPDATE users SET avatar = $1 WHERE id = $2', [victimFile, 'test-user-id']);

      const res = await request(app)
        .post('/api/v1/users/me/avatar')
        .set('Cookie', otherCookie)
        .attach('file', fakePng, { filename: 'me.png', contentType: 'image/png' });

      expect(res.status).toBe(200);
      expect(fs.existsSync(path.join(userAvatarDir(), victimFile))).toBe(true);
    });
  });

  test('rejects a non-image mimetype with 400', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/avatar')
      .set('Cookie', sessionCookie)
      .attach('file', Buffer.from('<svg/>'), { filename: 'evil.svg', contentType: 'image/svg+xml' });

    expect(res.status).toBe(400);
  });
});
