const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const { cleanTables, createTestAdminUser } = require('../helpers');

// Mock emailService so tests never hit SMTP
jest.mock('../../server/services/emailService', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));
const emailService = require('../../server/services/emailService');

beforeEach(async () => {
  await cleanTables();
  await createTestAdminUser();
});

afterAll(async () => {
  await db.pool.end();
});

// ── POST /auth/login ──────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  test('valid credentials return user info and set session cookie', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: {
        username: process.env.ADMIN_USERNAME,
        role:     'admin',
      },
    });
    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('auth_session='))).toBe(true);
  });

  test('wrong password returns 401 with generic message', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  test('wrong username returns 401 with generic message', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'notadmin', password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  test('missing password returns 400', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  test('missing username returns 400', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(400);
  });

  test('empty body returns 400', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
  });

  test('does not leak which credential was wrong', async () => {
    const [badUser, badPass] = await Promise.all([
      request(app).post('/auth/login').send({ username: 'nobody',                   password: process.env.ADMIN_PASSWORD }),
      request(app).post('/auth/login').send({ username: process.env.ADMIN_USERNAME, password: 'wrongpass' }),
    ]);
    expect(badUser.body.error).toBe(badPass.body.error);
  });

  test('disabled account returns 403 with clear message', async () => {
    await db.query(
      `UPDATE users SET disabled = TRUE, disabled_at = NOW() WHERE username = $1`,
      [process.env.ADMIN_USERNAME]
    );
    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/disabled/i);
  });

  // Tests covering the "email or username" + case-insensitive lookup added so
  // users who typed their email (the login label reads "Email or username")
  // can actually sign in.  See server/controllers/authController.js login query.
  test('login succeeds when the identifier is the account email', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin@test.com', password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(process.env.ADMIN_USERNAME);
    expect(res.body.user.email).toBe('admin@test.com');
  });

  test('login succeeds when the email is typed with different casing', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'ADMIN@TEST.COM', password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(process.env.ADMIN_USERNAME);
  });

  test('login succeeds when the username is typed with different casing', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME.toUpperCase(), password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(process.env.ADMIN_USERNAME);
  });

  test('login by email with wrong password still returns 401', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin@test.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  test('login by email still enforces the lockout counter', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/auth/login')
        .send({ username: 'admin@test.com', password: 'bad' });
    }

    // A valid password now should still be rejected with "locked" because
    // the email lookup must resolve to the same underlying row as the
    // username lookup — otherwise the counter would never increment.
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin@test.com', password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/locked/i);
  });
});

// ── Account lockout ───────────────────────────────────────────────────────────

describe('Account lockout', () => {
  test('account is locked after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/auth/login')
        .send({ username: process.env.ADMIN_USERNAME, password: 'bad' });
    }

    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: 'bad' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/locked/i);
  });

  test('correct password after lockout still returns locked', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/auth/login')
        .send({ username: process.env.ADMIN_USERNAME, password: 'bad' });
    }

    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/locked/i);
  });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  test('logout returns 204 and clears the session cookie', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    const res = await agent.post('/auth/logout');
    expect(res.status).toBe(204);

    const cookies = res.headers['set-cookie'] ?? [];
    const sessionCookie = cookies.find(c => c.startsWith('auth_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/Max-Age=0|auth_session=;/i);
  });

  test('session is invalid after logout', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    await agent.post('/auth/logout');

    const res = await agent.get('/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  test('logout without a session returns 204 (idempotent)', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(204);
  });

  test('double logout returns 204 (idempotent)', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    await agent.post('/auth/logout');
    const second = await agent.post('/auth/logout');
    expect(second.status).toBe(204);
  });
});

// ── GET /auth/session ─────────────────────────────────────────────────────────

describe('GET /auth/session', () => {
  test('returns authenticated=true with full user profile when logged in', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    const res = await agent.get('/auth/session');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      authenticated: true,
      user: {
        username:       process.env.ADMIN_USERNAME,
        role:           'admin',
        email_verified: true,
      },
    });
    // Full profile fields present
    expect(res.body.user).toHaveProperty('avatar');
    expect(res.body.user).toHaveProperty('display_name');
    expect(res.body.user).toHaveProperty('phone');
  });

  test('returns authenticated=false without a session cookie', async () => {
    const res = await request(app).get('/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  test('returns authenticated=false with a bogus session cookie', async () => {
    const res = await request(app)
      .get('/auth/session')
      .set('Cookie', 'auth_session=notarealsessionid');

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });
});

// ── POST /auth/signup ─────────────────────────────────────────────────────────

describe('POST /auth/signup', () => {
  test('creates a new user and returns 201', async () => {
    const res = await request(app).post('/auth/signup').send({
      username: 'newuser',
      email:    'new@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('newuser');
    expect(res.body.user.role).toBe('user');
  });

  test('duplicate username returns 409', async () => {
    const res = await request(app).post('/auth/signup').send({
      username: process.env.ADMIN_USERNAME,
      email:    'other@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/username/i);
  });

  test('duplicate email returns 409', async () => {
    const res = await request(app).post('/auth/signup').send({
      username: 'brandnew',
      email:    'admin@test.com',
      password: 'password123',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/email/i);
  });

  test('invalid email format returns 400', async () => {
    const res = await request(app).post('/auth/signup').send({
      username: 'newuser2',
      email:    'not-an-email',
      password: 'password123',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('short username returns 400', async () => {
    const res = await request(app).post('/auth/signup').send({
      username: 'ab',
      email:    'x@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/username/i);
  });

  test('username with special chars returns 400', async () => {
    const res = await request(app).post('/auth/signup').send({
      username: 'user name!',
      email:    'x@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/username/i);
  });

  test('password too short returns 400', async () => {
    const res = await request(app).post('/auth/signup').send({
      username: 'newuser3',
      email:    'y@example.com',
      password: 'abc1234',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  test('password without a number returns 400', async () => {
    const res = await request(app).post('/auth/signup').send({
      username: 'newuser4',
      email:    'z@example.com',
      password: 'abcdefgh',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/number/i);
  });

  test('password without a letter returns 400', async () => {
    const res = await request(app).post('/auth/signup').send({
      username: 'newuser5',
      email:    'w@example.com',
      password: '12345678',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/letter/i);
  });

  test('invalid avatar returns 400', async () => {
    const res = await request(app).post('/auth/signup').send({
      username: 'newuser6',
      email:    'v@example.com',
      password: 'password123',
      avatar:   'my-custom-avatar.png',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/avatar/i);
  });

  test('valid avatar is accepted', async () => {
    const res = await request(app).post('/auth/signup').send({
      username: 'newuser7',
      email:    'u@example.com',
      password: 'password123',
      avatar:   'avatar-15.svg',
    });
    expect(res.status).toBe(201);
  });
});

// ── POST /auth/verify-email ───────────────────────────────────────────────────

describe('POST /auth/verify-email', () => {
  test('valid token marks email as verified', async () => {
    const token = 'a'.repeat(64);
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await db.query(
      `UPDATE users SET email_verified = FALSE, email_verify_token = $1, email_verify_expires = $2
       WHERE username = $3`,
      [token, expiry, process.env.ADMIN_USERNAME]
    );

    const res = await request(app).post('/auth/verify-email').send({ token });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified/i);
  });

  test('invalid token returns 400', async () => {
    const res = await request(app).post('/auth/verify-email').send({ token: 'badtoken' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  test('expired token returns 400', async () => {
    const token = 'b'.repeat(64);
    const expiry = new Date(Date.now() - 1000); // already expired
    await db.query(
      `UPDATE users SET email_verified = FALSE, email_verify_token = $1, email_verify_expires = $2
       WHERE username = $3`,
      [token, expiry, process.env.ADMIN_USERNAME]
    );
    const res = await request(app).post('/auth/verify-email').send({ token });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  test('missing token returns 400', async () => {
    const res = await request(app).post('/auth/verify-email').send({});
    expect(res.status).toBe(400);
  });
});

// ── POST /auth/forgot-password ────────────────────────────────────────────────

describe('POST /auth/forgot-password', () => {
  test('returns 200 for known email', async () => {
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'admin@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reset link/i);
  });

  test('returns 200 for unknown email (no enumeration)', async () => {
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'nobody@nowhere.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reset link/i);
  });

  test('missing email returns 400', async () => {
    const res = await request(app).post('/auth/forgot-password').send({});
    expect(res.status).toBe(400);
  });
});

// ── POST /auth/reset-password ─────────────────────────────────────────────────

describe('POST /auth/reset-password', () => {
  test('valid token resets password', async () => {
    const token  = 'c'.repeat(64);
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await db.query(
      `UPDATE users SET password_reset_token = $1, password_reset_expires = $2
       WHERE username = $3`,
      [token, expiry, process.env.ADMIN_USERNAME]
    );

    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'newpassword1' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password updated/i);
  });

  test('invalid token returns 400', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'badtoken', password: 'newpassword1' });
    expect(res.status).toBe(400);
  });

  test('expired token returns 400', async () => {
    const token  = 'd'.repeat(64);
    const expiry = new Date(Date.now() - 1000);
    await db.query(
      `UPDATE users SET password_reset_token = $1, password_reset_expires = $2
       WHERE username = $3`,
      [token, expiry, process.env.ADMIN_USERNAME]
    );
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'newpassword1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  test('weak new password returns 400', async () => {
    const token  = 'e'.repeat(64);
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await db.query(
      `UPDATE users SET password_reset_token = $1, password_reset_expires = $2
       WHERE username = $3`,
      [token, expiry, process.env.ADMIN_USERNAME]
    );
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'weakpass' });
    expect(res.status).toBe(400);
  });
});

// ── GET /auth/check-username/:username ────────────────────────────────────────

describe('GET /auth/check-username/:username', () => {
  test('taken username returns available=false', async () => {
    const res = await request(app).get(`/auth/check-username/${process.env.ADMIN_USERNAME}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
  });

  test('free username returns available=true', async () => {
    const res = await request(app).get('/auth/check-username/brandnewuser');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
  });
});

// ── GET /auth/check-email/:email ──────────────────────────────────────────────

describe('GET /auth/check-email/:email', () => {
  test('registered email returns available=false', async () => {
    const res = await request(app).get('/auth/check-email/admin@test.com');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
  });

  test('free email returns available=true', async () => {
    const res = await request(app).get('/auth/check-email/free@example.com');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
  });
});

// ── Signup creates session + sends optional verification email ────────────────

describe('POST /auth/signup — auto-login and optional verification', () => {
  beforeEach(() => {
    emailService.sendVerificationEmail.mockClear();
  });

  test('creates unverified user, logs them in, and sends verification email', async () => {
    const res = await request(app).post('/auth/signup').send({
      username: 'unverifuser',
      email:    'unverif@example.com',
      password: 'password123',
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      username:       'unverifuser',
      email:          'unverif@example.com',
      email_verified: false,
      role:           'user',
    });

    // Session cookie must be set — the user is logged in immediately.
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie.some(c => /auth_session=/.test(c))).toBe(true);

    const { rows } = await db.query(
      `SELECT email_verified, email_verify_token, email_verify_expires
         FROM users WHERE username = $1`,
      ['unverifuser']
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email_verified).toBe(false);
    expect(rows[0].email_verify_token).not.toBeNull();
    expect(rows[0].email_verify_expires).not.toBeNull();

    expect(emailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
      'unverif@example.com',
      expect.any(String),
      expect.any(String)
    );
  });

  test('signup still succeeds when verification email fails to send', async () => {
    emailService.sendVerificationEmail.mockRejectedValueOnce(new Error('SMTP down'));

    const res = await request(app).post('/auth/signup').send({
      username: 'emailfailuser',
      email:    'emailfail@example.com',
      password: 'password123',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('emailfailuser');
    expect(res.headers['set-cookie'].some(c => /auth_session=/.test(c))).toBe(true);
  });
});

// ── POST /auth/resend-verification ───────────────────────────────────────────

describe('POST /auth/resend-verification', () => {
  beforeEach(async () => {
    emailService.sendVerificationEmail.mockClear();
  });

  test('missing email returns 400', async () => {
    const res = await request(app).post('/auth/resend-verification').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('nonexistent email returns 200 (no enumeration)', async () => {
    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'nobody@nowhere.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/pending verification/i);
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  test('already-verified user returns 200 and does not send email', async () => {
    // Admin user is email_verified = TRUE in helpers
    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'admin@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/pending verification/i);
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  test('pending-verification user gets a new token and email', async () => {
    // Create an unverified user
    const token  = 'f'.repeat(64);
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await db.query(
      `INSERT INTO users (email, username, password_hash, role, email_verified,
                          email_verify_token, email_verify_expires)
       VALUES ('pending@example.com', 'pendinguser', 'fakehash', 'user', FALSE, $1, $2)`,
      [token, expiry]
    );

    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'pending@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/pending verification/i);
    expect(emailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
      'pending@example.com',
      expect.any(String),
      expect.any(String)  // locale — added by the i18n refactor
    );

    // Token in DB should be rotated
    const { rows } = await db.query(
      `SELECT email_verify_token FROM users WHERE username = 'pendinguser'`
    );
    expect(rows[0].email_verify_token).not.toBe(token);
  });
});
