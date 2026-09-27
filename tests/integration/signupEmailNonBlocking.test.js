// Signup must not wait on email delivery (ported from icelandicstore #199).
//
// The account is committed before the verification email is sent, so anything
// that delays the response strands the visitor on "Creating account…" for a
// signup that already succeeded — which is what happened on ice's PROD
// 2026-08-21 (201 logged server-side, the button never came back). These
// assert the response does not wait on the mailer AT ALL: the sender here
// never settles, the shape that actually hung.

// The engine's signup code is exercised whether or not this product runs the
// `signup` module (R2b) — switched on for this suite only, as auth.test.js does.
process.env.CLIENT_CONFIG_MODULES_SIGNUP_ENABLED = 'true';
afterAll(() => { delete process.env.CLIENT_CONFIG_MODULES_SIGNUP_ENABLED; });

const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const { cleanTables, createTestAdminUser } = require('../helpers');

let releaseVerification;
const neverSettles = () => new Promise((resolve) => { releaseVerification = resolve; });

jest.mock('../../server/services/emailService', () => ({
  sendVerificationEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));
const emailService = require('../../server/services/emailService');

beforeEach(async () => {
  await cleanTables();
  await createTestAdminUser();
  emailService.sendVerificationEmail.mockReset();
  releaseVerification = undefined;
});

afterEach(() => {
  // Let a pending send resolve so it cannot leak into the next test.
  if (releaseVerification) releaseVerification();
});

describe('signup does not block on the mailer', () => {
  test('responds 201 while the verification email never settles', async () => {
    emailService.sendVerificationEmail.mockImplementation(neverSettles);

    // Before the fix this awaited a promise that never resolves: the request
    // never returned and supertest failed on its own timeout.
    const res = await request(app).post('/auth/signup').timeout(5000).send({
      username: 'hangprobe',
      email:    'hangprobe@example.com',
      password: 'password123',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('hangprobe');
    // Signed in straight away, as before.
    expect((res.headers['set-cookie'] || []).some((c) => c.startsWith('auth_session='))).toBe(true);
    // The send was still ATTEMPTED — detached, not skipped.
    expect(emailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendVerificationEmail.mock.calls[0][0]).toBe('hangprobe@example.com');

    const { rows } = await db.query('SELECT username FROM users WHERE username = $1', ['hangprobe']);
    expect(rows).toHaveLength(1);
  });

  test('a rejected send is logged, never an unhandled rejection or a 500', async () => {
    emailService.sendVerificationEmail.mockRejectedValue(new Error('send timed out after 10000ms'));

    const unhandled = [];
    const onUnhandled = (err) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);
    try {
      const res = await request(app).post('/auth/signup').send({
        username: 'rejectprobe',
        email:    'rejectprobe@example.com',
        password: 'password123',
      });
      expect(res.status).toBe(201);
      // Give the detached rejection a tick to surface if it were unhandled.
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
