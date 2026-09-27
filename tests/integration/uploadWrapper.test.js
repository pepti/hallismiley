'use strict';
// The shared upload wrapper (middleware/upload.js uploadSingle + ensureDestination)
// and the product-image route's requireProduct. Ported from icelandicstore #150
// (resolve the product before writing; an mkdir failure is a 500, not a crash),
// #141/#142 (one wrapper, translated per-branch 400s) — harvest 2, 2026-09-26.
// The client-abort 499 branch is exercised in tests/unit/uploadSingle.test.js.
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const { UPLOAD_ROOT } = require('../../server/config/paths');
const { t } = require('../../server/i18n');
const { getTestSessionCookie, cleanTables } = require('../helpers');

let adminCookie, product;
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000'
  + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex'
);

beforeAll(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie();
  await db.query("DELETE FROM products WHERE slug = 'upload-wrapper-test'");
  product = await Product.create({ slug: 'upload-wrapper-test', name: 'Upload wrapper', price_isk: 1000, price_eur: 700 });
});

afterAll(async () => {
  fs.rmSync(path.join(UPLOAD_ROOT, 'products', product.id), { recursive: true, force: true });
  await db.query('DELETE FROM products WHERE id = $1', [product.id]);
  await db.pool.end();
});

const postImage = (id, buf, contentType = 'image/png', locale = 'en') => request(app)
  .post(`/api/v1/admin/shop/products/${id}/images`)
  .set('Cookie', adminCookie).set('X-Locale', locale)
  .attach('file', buf, { filename: 'x.png', contentType });

describe('POST /admin/shop/products/:id/images — requireProduct runs before multer writes', () => {
  test('an unknown id is a 404 and no directory is created', async () => {
    // Unique per run: a fixed name created by a pre-fix run would fail forever.
    const ghost = `ghost-${crypto.randomBytes(6).toString('hex')}`;
    const res = await postImage(ghost, PNG_1PX);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: t('en', 'errors.admin.productNotFound'), code: 404 });
    expect(fs.existsSync(path.join(UPLOAD_ROOT, 'products', ghost))).toBe(false);
  });

  test('a traversal-shaped id is a 404 and nothing is written outside the products dir', async () => {
    const res = await postImage('..%2F..%2Fupload-wrapper-evil', PNG_1PX);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 404 });
    expect(fs.existsSync(path.join(UPLOAD_ROOT, '..', 'upload-wrapper-evil'))).toBe(false);
    expect(fs.existsSync(path.join(UPLOAD_ROOT, 'upload-wrapper-evil'))).toBe(false);
  });

  test('a NUL-bearing id is a 404, not a Postgres 500', async () => {
    const res = await postImage('abc%00def', PNG_1PX);
    expect(res.status).toBe(404);
  });

  test('a wrong type is a translated 400, in either locale', async () => {
    for (const lc of ['en', 'is']) {
      const res = await postImage(product.id, Buffer.from('%PDF-1.4'), 'application/pdf', lc);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: t(lc, 'errors.upload.productImage.invalidType'), code: 400 });
    }
  });

  test('too large is a translated 400', async () => {
    const res = await postImage(product.id, Buffer.alloc(10 * 1024 * 1024 + 1024, 1), 'image/png', 'is');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: t('is', 'errors.upload.productImage.tooLarge'), code: 400 });
  });

  test('an mkdir failure on the uploads mount is a logged 500 envelope — the process survives', async () => {
    // A regular FILE where the product's directory should be: mkdirSync throws
    // (EEXIST/ENOTDIR) inside multer's destination(). Before ensureDestination
    // that throw escaped busboy's handler as an uncaught exception.
    const other = await Product.create({ slug: `upload-wrapper-mkdir-${Date.now()}`, name: 'mkdir', price_isk: 1000, price_eur: 700 });
    const blocker = path.join(UPLOAD_ROOT, 'products', other.id);
    fs.mkdirSync(path.dirname(blocker), { recursive: true });
    fs.writeFileSync(blocker, 'not a directory');
    try {
      const res = await postImage(other.id, PNG_1PX);
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ code: 500 });
      // Still serving.
      expect((await request(app).get('/health')).status).toBe(200);
    } finally {
      fs.rmSync(blocker, { force: true });
      await db.query('DELETE FROM products WHERE id = $1', [other.id]);
    }
  });
});

describe('a malformed multipart body is the client\'s fault: 400, never a 500', () => {
  const url = () => `/api/v1/admin/shop/products/${product.id}/images`;

  test('a multipart content type with no boundary (busboy cannot start)', async () => {
    const res = await request(app).post(url()).set('Cookie', adminCookie).set('X-Locale', 'en')
      .set('Content-Type', 'multipart/form-data').send('garbage');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: t('en', 'errors.upload.failed'), code: 400 });
  });

  test('a body cut off before its closing boundary (Unexpected end of form)', async () => {
    const body = '--XBOUNDARY\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\n'
      + 'Content-Type: image/png\r\n\r\n' + PNG_1PX.toString('binary');
    const res = await request(app).post(url()).set('Cookie', adminCookie).set('X-Locale', 'is')
      .set('Content-Type', 'multipart/form-data; boundary=XBOUNDARY').send(Buffer.from(body, 'binary'));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: t('is', 'errors.upload.failed'), code: 400 });
  });

  test('a malformed part header', async () => {
    const body = '--XBOUNDARY\r\nthis is not a header\r\n\r\nx\r\n--XBOUNDARY--\r\n';
    const res = await request(app).post(url()).set('Cookie', adminCookie).set('X-Locale', 'en')
      .set('Content-Type', 'multipart/form-data; boundary=XBOUNDARY').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: t('en', 'errors.upload.failed'), code: 400 });
  });
});

describe('uploadImage — a product deleted between requireProduct and the row insert', () => {
  test('the FK violation (23503) is a 404 and the written file is removed', async () => {
    const adminShop = require('../../server/controllers/adminShopController');
    // A product that passed requireProduct and was deleted before addImage:
    // the row is gone, so the image insert trips the product FK.
    const gone = await Product.create({ slug: `upload-wrapper-gone-${Date.now()}`, name: 'gone', price_isk: 1000, price_eur: 700 });
    await db.query('DELETE FROM products WHERE id = $1', [gone.id]);
    const tmp = path.join(require('os').tmpdir(), `upload-wrapper-${crypto.randomBytes(4).toString('hex')}.png`);
    fs.writeFileSync(tmp, PNG_1PX);
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = jest.fn();
    await adminShop.uploadImage({
      product: gone, locale: 'en', body: {},
      file: { path: tmp, filename: path.basename(tmp), mimetype: 'image/png' },
    }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: t('en', 'errors.admin.productNotFound'), code: 404 });
    await new Promise((r) => setTimeout(r, 100)); // the unlink is fire-and-forget
    expect(fs.existsSync(tmp)).toBe(false);
  });
});

describe('POST /users/me/avatar — the customer-facing upload', () => {
  const postAvatar = (buf, contentType, locale) => request(app)
    .post('/api/v1/users/me/avatar').set('Cookie', adminCookie).set('X-Locale', locale)
    .attach('file', buf, { filename: 'a.png', contentType });

  test.each(['en', 'is'])('a wrong type is translated (%s)', async (lc) => {
    const res = await postAvatar(Buffer.from('GIF89a'), 'image/gif', lc);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: t(lc, 'errors.upload.avatar.invalidType'), code: 400 });
  });

  test('over 5 MB is translated, not multer\'s "File too large"', async () => {
    const res = await postAvatar(Buffer.alloc(5 * 1024 * 1024 + 1024, 1), 'image/png', 'is');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: t('is', 'errors.upload.avatar.tooLarge'), code: 400 });
  });
});

describe('POST /admin/background/media', () => {
  test('a wrong type is translated', async () => {
    const res = await request(app).post('/api/v1/admin/background/media')
      .set('Cookie', adminCookie).set('X-Locale', 'en')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: t('en', 'errors.upload.background.invalidType'), code: 400 });
  });
});

describe('POST /admin/shop/products/import/parse-file', () => {
  test('a too-large file keeps its 413, now translated', async () => {
    const res = await request(app).post('/api/v1/admin/shop/products/import/parse-file')
      .set('Cookie', adminCookie).set('X-Locale', 'en')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1024, 65), { filename: 'big.csv', contentType: 'text/csv' });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: t('en', 'errors.upload.productImport.tooLarge'), code: 413 });
  });
});
