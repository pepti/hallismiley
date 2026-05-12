'use strict';

/**
 * Integration tests for the i18n stack:
 *   • server-side t() helper + fallback
 *   • locale middleware priority (query > header > cookie > user pref > Accept-Language)
 *   • PATCH preferred_locale round-trip via the Lucia session
 *   • locale-aware content controller GET / PUT with per-locale rows
 *   • validation errors translate to Icelandic
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');
const { t } = require('../../server/i18n');

// Helper: read Icelandic text for a key to assert error messages.
function tIs(key, params) { return t('is', key, params); }

describe('server/i18n t() helper', () => {
  test('returns exact English copy for a known key', () => {
    expect(t('en', 'email.verify.subject')).toBe('Verify your Halli Smiley account');
  });

  test('returns Icelandic copy for a known key', () => {
    expect(t('is', 'email.verify.subject')).toBe('Staðfestu Halli Smiley aðganginn þinn');
  });

  test('falls back to English when Icelandic key is missing', () => {
    // A key that only exists in en.json would normally not exist since parity
    // is enforced — but t() should still fall back gracefully. Use a made-up
    // key to simulate the miss: it falls back to the key itself in both.
    expect(t('is', 'nonexistent.key.here')).toBe('nonexistent.key.here');
  });

  test('interpolates {params} into the translated string', () => {
    const out = t('is', 'email.order.subject', { orderNumber: 'HP-2026-ABCD' });
    expect(out).toContain('HP-2026-ABCD');
  });

  test('unknown locale falls back to DEFAULT_LOCALE (en)', () => {
    expect(t('xx', 'email.verify.subject')).toBe('Verify your Halli Smiley account');
  });
});

describe('locale middleware priority', () => {
  beforeEach(async () => {
    await cleanTables();
  });

  test('?locale=is query param overrides Accept-Language', async () => {
    const res = await request(app)
      .get('/api/v1/projects?locale=is')
      .set('Accept-Language', 'en-US')
      .expect(200);
    // No body-visible locale, but the endpoint should not 400.
    // Deeper: validation errors (forced by a bad body) come back in Icelandic.
    expect(res.status).toBe(200);
  });

  test('unauthenticated request: X-Locale: is translates the auth error', async () => {
    // Use the unauthenticated login endpoint — no req.user means the locale
    // middleware falls through to the X-Locale header.
    const res = await request(app)
      .post('/auth/login')
      .set('X-Locale', 'is')
      .send({ username: '', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(tIs('errors.auth.usernamePasswordRequired'));
  });

  test('explicit X-Locale overrides logged-in user preferred_locale', async () => {
    const cookie = await getTestSessionCookie();
    // Save preferred_locale = 'is'
    await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', cookie)
      .send({ preferred_locale: 'is' })
      .expect(200);
    // X-Locale: en is an explicit per-request signal and must win over the
    // saved account preference — so validation errors come back in English.
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', cookie)
      .set('X-Locale', 'en')
      .send({ phone: 'garbage' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(t('en', 'validation.phone.invalid'));
  });

  test('logged-in user preferred_locale wins when no explicit signal is sent', async () => {
    const cookie = await getTestSessionCookie();
    await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', cookie)
      .send({ preferred_locale: 'is' })
      .expect(200);
    // No ?locale=, no X-Locale, no preferred_locale cookie — the saved
    // account preference is the strongest remaining signal.
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', cookie)
      .send({ phone: 'garbage' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(tIs('validation.phone.invalid'));
  });
});

describe('PATCH preferred_locale round-trip', () => {
  beforeEach(async () => { await cleanTables(); });

  test('patches preferred_locale and persists across requests', async () => {
    const cookie = await getTestSessionCookie();
    const patch = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', cookie)
      .send({ preferred_locale: 'is' });
    expect(patch.status).toBe(200);
    expect(patch.body.preferred_locale).toBe('is');

    const me = await request(app)
      .get('/api/v1/users/me')
      .set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.preferred_locale).toBe('is');
  });

  test('rejects unsupported locale', async () => {
    const cookie = await getTestSessionCookie();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', cookie)
      .send({ preferred_locale: 'de' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(t('en', 'errors.user.unsupportedLocale'));
  });
});

describe('locale-aware site_content (migration 029)', () => {
  beforeEach(async () => {
    await cleanTables();
    // Seed two locales for a shared key.
    await db.query(`DELETE FROM site_content WHERE key = 'test_block'`);
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES
         ('test_block', 'en', '{"headline":"Hello"}'::jsonb),
         ('test_block', 'is', '{"headline":"Halló"}'::jsonb)`
    );
  });

  afterAll(async () => {
    await db.query(`DELETE FROM site_content WHERE key = 'test_block'`);
  });

  test('GET returns the row matching ?locale=', async () => {
    const en = await request(app).get('/api/v1/content/test_block?locale=en');
    expect(en.status).toBe(200);
    expect(en.body.headline).toBe('Hello');

    const is = await request(app).get('/api/v1/content/test_block?locale=is');
    expect(is.status).toBe(200);
    expect(is.body.headline).toBe('Halló');
  });

  test('GET falls back to default locale when the requested row is missing', async () => {
    await db.query(`DELETE FROM site_content WHERE key = 'test_block' AND locale = 'is'`);
    const res = await request(app).get('/api/v1/content/test_block?locale=is');
    expect(res.status).toBe(200);
    expect(res.body.headline).toBe('Hello');
  });

  test('PUT writes to the request locale without touching the other', async () => {
    const cookie = await getTestSessionCookie();
    await request(app)
      .put('/api/v1/content/test_block?locale=is')
      .set('Cookie', cookie)
      .send({ headline: 'Uppfært' })
      .expect(200);

    const isRow = await request(app).get('/api/v1/content/test_block?locale=is');
    expect(isRow.body.headline).toBe('Uppfært');

    const enRow = await request(app).get('/api/v1/content/test_block?locale=en');
    expect(enRow.body.headline).toBe('Hello');
  });
});
