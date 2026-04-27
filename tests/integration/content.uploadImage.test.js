'use strict';

// Integration tests for POST /api/v1/content/:key/image — specifically the
// `?field=` query and the locale fan-out behaviour added in PR #15.
//
// The endpoint is shared by multiple consumers (home_skills, product detail
// hero, halli_bio image slots), so back-compat with the no-field default is
// part of the contract under test.

const request = require('supertest');
const path    = require('path');
const fs      = require('fs');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const { getTestSessionCookie } = require('../helpers');

// Minimal 1×1 transparent PNG for upload tests
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const TEST_KEY = 'test_upload_image_key';
const writtenFiles = [];

let adminCookie;

beforeEach(async () => {
  await db.query('DELETE FROM site_content WHERE key = $1', [TEST_KEY]);
  // Seed both locale rows so UPSERT exercises the conflict path
  await db.query(
    `INSERT INTO site_content (key, locale, value)
     VALUES ($1, 'en', '{"title":"EN"}'::jsonb),
            ($1, 'is', '{"title":"IS"}'::jsonb)`,
    [TEST_KEY]
  );
  adminCookie = await getTestSessionCookie();
});

afterEach(() => {
  // Remove any files written to public/assets/content/ during the test
  while (writtenFiles.length) {
    const f = writtenFiles.pop();
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
});

afterAll(async () => {
  await db.query('DELETE FROM site_content WHERE key = $1', [TEST_KEY]);
  await db.pool.end();
});

function trackedFilePathFromUrl(url) {
  // url shape: /assets/content/<filename>
  const filename = url.replace('/assets/content/', '');
  const abs = path.join(__dirname, '..', '..', 'public', 'assets', 'content', filename);
  writtenFiles.push(abs);
  return abs;
}

async function readRow(locale) {
  const { rows } = await db.query(
    'SELECT value FROM site_content WHERE key = $1 AND locale = $2',
    [TEST_KEY, locale]
  );
  return rows[0] ? rows[0].value : null;
}

describe('POST /api/v1/content/:key/image — ?field= and locale fan-out', () => {
  test('back-compat: no ?field= writes to image_url on every locale', async () => {
    const res = await request(app)
      .post(`/api/v1/content/${TEST_KEY}/image`)
      .set('Cookie', adminCookie)
      .attach('file', PNG_BUFFER, { filename: 'a.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.image_url).toMatch(/^\/assets\/content\/.+\.png$/);
    expect(res.body.field).toBe('image_url');
    trackedFilePathFromUrl(res.body.image_url);

    const en = await readRow('en');
    const is = await readRow('is');
    expect(en.title).toBe('EN');
    expect(is.title).toBe('IS');
    expect(en.image_url).toBe(res.body.image_url);
    expect(is.image_url).toBe(res.body.image_url);
  });

  test('?field=craft_image_url merges into the named JSON key, not image_url', async () => {
    const res = await request(app)
      .post(`/api/v1/content/${TEST_KEY}/image?field=craft_image_url`)
      .set('Cookie', adminCookie)
      .attach('file', PNG_BUFFER, { filename: 'b.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.field).toBe('craft_image_url');
    trackedFilePathFromUrl(res.body.image_url);

    const en = await readRow('en');
    const is = await readRow('is');
    expect(en.craft_image_url).toBe(res.body.image_url);
    expect(is.craft_image_url).toBe(res.body.image_url);
    // image_url stays untouched on both locales
    expect(en.image_url).toBeUndefined();
    expect(is.image_url).toBeUndefined();
    // existing keys preserved
    expect(en.title).toBe('EN');
    expect(is.title).toBe('IS');
  });

  test('multiple field uploads coexist in the same row', async () => {
    const r1 = await request(app)
      .post(`/api/v1/content/${TEST_KEY}/image?field=craft_image_url`)
      .set('Cookie', adminCookie)
      .attach('file', PNG_BUFFER, { filename: 'c1.png', contentType: 'image/png' });
    trackedFilePathFromUrl(r1.body.image_url);

    const r2 = await request(app)
      .post(`/api/v1/content/${TEST_KEY}/image?field=life_image_url`)
      .set('Cookie', adminCookie)
      .attach('file', PNG_BUFFER, { filename: 'c2.png', contentType: 'image/png' });
    trackedFilePathFromUrl(r2.body.image_url);

    const en = await readRow('en');
    expect(en.craft_image_url).toBe(r1.body.image_url);
    expect(en.life_image_url).toBe(r2.body.image_url);
    expect(en.craft_image_url).not.toBe(en.life_image_url);
  });

  test('invalid ?field= falls back to image_url (regex whitelist)', async () => {
    const cases = [
      'has-dash',          // dashes excluded
      'has spaces',        // spaces excluded
      "drop'); --",        // SQL-injection-ish
      '1leading_digit',    // must start with letter or underscore
      'a'.repeat(80),      // over 64 chars
      '',                  // empty string
    ];

    for (const bad of cases) {
      const res = await request(app)
        .post(`/api/v1/content/${TEST_KEY}/image?field=${encodeURIComponent(bad)}`)
        .set('Cookie', adminCookie)
        .attach('file', PNG_BUFFER, { filename: 'x.png', contentType: 'image/png' });

      expect(res.status).toBe(200);
      expect(res.body.field).toBe('image_url');
      trackedFilePathFromUrl(res.body.image_url);
    }

    const en = await readRow('en');
    // No bad keys should have been written
    expect(Object.keys(en).filter(k => k !== 'title' && k !== 'image_url')).toEqual([]);
  });

  test('explicit ?locale= scopes the write to that locale only', async () => {
    const res = await request(app)
      .post(`/api/v1/content/${TEST_KEY}/image?field=life_image_url&locale=en`)
      .set('Cookie', adminCookie)
      .attach('file', PNG_BUFFER, { filename: 'd.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    trackedFilePathFromUrl(res.body.image_url);

    const en = await readRow('en');
    const is = await readRow('is');
    expect(en.life_image_url).toBe(res.body.image_url);
    expect(is.life_image_url).toBeUndefined();
  });

  test('rejects non-image MIME with 400', async () => {
    const res = await request(app)
      .post(`/api/v1/content/${TEST_KEY}/image?field=craft_image_url`)
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('fake pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    const en = await readRow('en');
    expect(en.craft_image_url).toBeUndefined();
  });
});
