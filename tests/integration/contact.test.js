const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');

afterAll(async () => {
  await db.pool.end();
});

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
    expect(res.body.message).toMatch(/received/i);
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
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/name/i)]));
  });

  test('missing email returns 400', async () => {
    const { email: _email, ...rest } = validPayload();
    const res = await request(app).post('/api/v1/contact').send(rest);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/email/i)]));
  });

  test('invalid email format returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), email: 'notanemail' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/email/i)]));
  });

  test('missing message returns 400', async () => {
    const { message: _message, ...rest } = validPayload();
    const res = await request(app).post('/api/v1/contact').send(rest);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/message/i)]));
  });

  test('message under 10 characters returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), message: 'Short' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/10 characters/i)]));
  });

  test('name over 100 chars returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), name: 'N'.repeat(101) });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/100/)]));
  });

  test('email over 200 chars returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), email: `${'a'.repeat(195)}@b.com` });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/200/)]));
  });

  test('message over 2000 chars returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send({ ...validPayload(), message: 'M'.repeat(2001) });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/2000/)]));
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
    expect(res.body.message).toMatch(/received/i);
  });
});
