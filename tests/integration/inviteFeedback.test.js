// "Invite sent" means sent (harvested from icelandicstore #258, 2026-09-24).
//
// The engine's customer create answered `invited` from "did the send not
// throw", and sendPasswordResetEmail returned undefined on BOTH its success and
// its muted path — so a muted or redirected send read as delivered, and the
// set-password link was withheld in exactly the case the admin needed it. These
// tests pin the properties of utils/inviteSend.js on the create path:
//   * `invited` means the message was accepted for the customer, never
//     "credentials exist"
//   * a failure hands back `resetUrl` (and the reason) so the job can be
//     finished by hand
//   * an EMAIL_ALLOWLIST redirect is reported, because the addressee got nothing
//   * invited_at is stamped only on a confirmed, un-redirected send
//   * the message goes to the new customer, carrying the token actually persisted
const request = require('supertest');

jest.mock('../../server/services/emailService', () => {
  const actual = jest.requireActual('../../server/services/emailService');
  return {
    ...actual,
    // isConfigured stays TRUE throughout: a configured transport must not by
    // itself be reported as a successful send.
    isConfigured:           jest.fn(() => true),
    isRedirecting:          jest.fn(() => false),
    sendWelcomeInviteEmail: jest.fn(),
  };
});

const emailService = require('../../server/services/emailService');
const app = require('../../server/app');
const db  = require('../../server/config/database');
const { createTestAdminUser, getTestSessionCookie, cleanTables } = require('../helpers');

let adminCookie;
const EMAIL = 'invitee@example.is';

const create = () => request(app)
  .post('/api/v1/admin/customers')
  .set('Cookie', adminCookie)
  .send({ email: EMAIL, display_name: 'Invitee' });

const invitedAt = async () =>
  (await db.query('SELECT invited_at FROM users WHERE email = $1', [EMAIL])).rows[0]?.invited_at ?? null;

beforeEach(async () => {
  await cleanTables();
  await createTestAdminUser();
  adminCookie = await getTestSessionCookie();
  emailService.sendWelcomeInviteEmail.mockReset();
  emailService.isRedirecting.mockReturnValue(false);
});

describe('POST /api/v1/admin/customers (create + welcome invite)', () => {
  test('an accepted send reports invited, stamps invited_at and withholds the link', async () => {
    emailService.sendWelcomeInviteEmail.mockResolvedValue('msg-123');
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.invited).toBe(true);
    expect(res.body.emailed).toBe(true);
    expect(res.body.resetUrl).toBeUndefined();
    expect(await invitedAt()).not.toBeNull();
  });

  test('the mail goes to the new customer, carrying the token that was persisted', async () => {
    emailService.sendWelcomeInviteEmail.mockResolvedValue('msg-123');
    await create();
    const [to, token] = emailService.sendWelcomeInviteEmail.mock.calls[0];
    expect(to).toBe(EMAIL);
    const { rows } = await db.query('SELECT password_reset_token FROM users WHERE email = $1', [EMAIL]);
    expect(rows[0].password_reset_token).toBe(token);
  });

  test('a THROWN send reports the failure and hands back the working link', async () => {
    emailService.sendWelcomeInviteEmail.mockRejectedValue(new Error('Resend 500'));
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.invited).toBe(false);
    expect(res.body.emailError).toBe('Resend 500');
    expect(res.body.resetUrl).toMatch(/\/reset-password\?token=[0-9a-f]{64}/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(await invitedAt()).toBeNull();
  });

  test('a rejection that is not an Error still reports as a failure', async () => {
    emailService.sendWelcomeInviteEmail.mockRejectedValue('plain string');
    const res = await create();
    expect(res.body.invited).toBe(false);
    expect(res.body.emailError).toBe('plain string');
    expect(res.body.resetUrl).toBeTruthy();
  });

  test('a muted transport is not reported as a send', async () => {
    emailService.sendWelcomeInviteEmail.mockResolvedValue(false);
    const res = await create();
    expect(res.body.invited).toBe(false);
    expect(res.body.emailed).toBe(false);
    expect(res.body.emailError).toBeUndefined();
    expect(res.body.resetUrl).toBeTruthy();
    expect(await invitedAt()).toBeNull();
  });

  test('an EMAIL_ALLOWLIST redirect is reported, not passed off as reaching the customer', async () => {
    emailService.sendWelcomeInviteEmail.mockResolvedValue('msg-123');
    emailService.isRedirecting.mockReturnValue(true);
    const res = await create();
    expect(res.body.invited).toBe(false);
    expect(res.body.redirected).toBe(true);
    expect(res.body.resetUrl).toBeTruthy();
    expect(await invitedAt()).toBeNull();
  });

  test('the customers list shows the receipt (invited_at)', async () => {
    emailService.sendWelcomeInviteEmail.mockResolvedValue('msg-123');
    await create();
    const list = await request(app).get('/api/v1/admin/customers').set('Cookie', adminCookie);
    const row = list.body.customers.find((c) => c.email === EMAIL);
    expect(row.invited_at).toBeTruthy();
  });
});
