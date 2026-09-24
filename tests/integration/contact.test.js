const request = require('supertest');
const app     = require('../../server/app');
// Messages are asserted in the visitor-default locale (tests/lib/locale.js).
const { tx } = require('../lib/locale');


const validPayload = () => ({
  name:    'Jane Doe',
  email:   'jane@example.com',
  message: 'Hello, I would love to discuss a project with you.',
});

// ── POST /api/v1/contact ──────────────────────────────────────────────────────

describe('POST /api/v1/contact — valid submissions', () => {
  test('returns 200 with success message for valid input', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send(validPayload());

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(tx('errors.contact.messageReceivedFull'));
  });

  test('accepts message at exactly 10 characters', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), message: '1234567890' });

    expect(res.status).toBe(200);
  });

  test('accepts maximum-length valid fields', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({
        name:    'A'.repeat(100),
        email:   `${'a'.repeat(190)}@b.com`,
        message: 'M'.repeat(2000),
      });

    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/contact — validation errors', () => {
  test('missing name returns 400', async () => {
    const { name: _name, ...rest } = validPayload();
    const res = await request(app).post('/api/v1/contact').send(rest);

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain(tx('errors.contact.nameRequired'));
  });

  test('missing email returns 400', async () => {
    const { email: _email, ...rest } = validPayload();
    const res = await request(app).post('/api/v1/contact').send(rest);

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain(tx('errors.contact.emailRequired'));
  });

  test('invalid email format returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), email: 'notanemail' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain(tx('errors.contact.emailRequired'));
  });

  test('missing message returns 400', async () => {
    const { message: _message, ...rest } = validPayload();
    const res = await request(app).post('/api/v1/contact').send(rest);

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain(tx('errors.contact.messageMinLength'));
  });

  test('message under 10 characters returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), message: 'Short' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain(tx('errors.contact.messageMinLength'));
  });

  test('name over 100 chars returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), name: 'N'.repeat(101) });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain(tx('errors.contact.nameTooLong'));
  });

  test('email over 200 chars returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), email: `${'a'.repeat(195)}@b.com` });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain(tx('errors.contact.emailTooLong'));
  });

  test('message over 2000 chars returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), message: 'M'.repeat(2001) });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain(tx('errors.contact.messageTooLong'));
  });

  test('empty body returns 400 with multiple error messages', async () => {
    const res = await request(app).post('/api/v1/contact').send({});

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(1);
  });
});

describe('POST /api/v1/contact — honeypot', () => {
  test('filled website (honeypot) field silently discards the submission', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), website: 'http://spam.bot' });

    // Returns 200 so the bot thinks it succeeded
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(tx('errors.contact.messageReceived'));
  });
});

// ── Business lead fields (job 2E) ────────────────────────────────────────────
// The form doubles as lead capture: company, phone and current platform are
// optional qualifiers, and a submission is never rejected for omitting them.

describe('POST /api/v1/contact — lead fields', () => {
  test('accepts the full business payload', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({
        ...validPayload(),
        company: 'Ísprjón ehf.',
        phone: '+354 555 1234',
        current_platform: 'shopify',
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(tx('errors.contact.messageReceivedFull'));
  });

  test('omitting every optional field still succeeds', async () => {
    const res = await request(app).post('/api/v1/contact').send(validPayload());
    expect(res.status).toBe(200);
  });

  test('an unrecognised platform is accepted, not rejected', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), current_platform: 'some-bespoke-thing' });

    expect(res.status).toBe(200);
  });

  test('over-long company returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), company: 'C'.repeat(151) });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain(tx('errors.contact.companyTooLong'));
  });

  test('over-long phone returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), phone: '9'.repeat(41) });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain(tx('errors.contact.phoneTooLong'));
  });
});

describe('POST /api/v1/contact — notification', () => {
  test('a valid submission triggers the lead notification', async () => {
    const emailService = require('../../server/services/emailService');
    const spy = jest.spyOn(emailService, 'sendLeadNotification').mockResolvedValue(undefined);

    try {
      const res = await request(app)
        .post('/api/v1/contact')
        .send({ ...validPayload(), company: 'Ísprjón ehf.', current_platform: 'shopify' });
      expect(res.status).toBe(200);

      // The send is fire-and-forget — let the microtask queue drain.
      await new Promise(resolve => setImmediate(resolve));

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Jane Doe',
        email: 'jane@example.com',
        company: 'Ísprjón ehf.',
        platform: 'shopify',
      }));
    } finally {
      spy.mockRestore();
    }
  });

  // Process-wide send budget (harvested from icelandicstore #295, 2026-09-24):
  // over it, the visitor still gets a 200 and the lead is stored, but no mail
  // goes out and the row says why.
  test('over the send budget: 200, lead stored, nothing sent, row says why', async () => {
    const emailService = require('../../server/services/emailService');
    const { contactBudget } = require('../../server/services/contactBudget');
    const db = require('../../server/config/database');
    const spy  = jest.spyOn(emailService, 'sendLeadNotification').mockResolvedValue(true);
    const take = jest.spyOn(contactBudget, 'take').mockReturnValue(false);
    try {
      const res = await request(app).post('/api/v1/contact')
        .send({ ...validPayload(), email: 'budget@example.com' });
      expect(res.status).toBe(200);
      let row;
      for (let i = 0; i < 40 && !row?.notify_error; i++) {
        await new Promise(r => setTimeout(r, 25));
        row = (await db.query(`SELECT notify_error FROM leads WHERE email = 'budget@example.com'`)).rows[0];
      }
      expect(row.notify_error).toBe('over send budget');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      take.mockRestore();
    }
  });

  test('the honeypot path sends nothing', async () => {
    const emailService = require('../../server/services/emailService');
    const spy = jest.spyOn(emailService, 'sendLeadNotification').mockResolvedValue(undefined);

    try {
      await request(app)
        .post('/api/v1/contact')
        .send({ ...validPayload(), website: 'http://spam.bot' });
      await new Promise(resolve => setImmediate(resolve));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
