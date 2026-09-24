'use strict';

// Product images (services/productImages.js — harvested from icelandicstore
// #240/#241/#242, harvest-ice-d-2026-09-24): an upload is normalised (EXIF
// auto-orient, long edge ≤ 2000 px, metadata stripped, same format), a file
// sharp cannot decode is a localised 400 with nothing left on disk, a
// `<original>.thumb.webp` is made on the first request and served, the handler
// refuses to treat a derivative as a source, and deleting an image deletes its
// thumbnail.
const fs      = require('fs');
const path    = require('path');
const request = require('supertest');
const sharp   = require('sharp');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const { UPLOAD_ROOT } = require('../../server/config/paths');
const { getTestSessionCookie, cleanTables } = require('../helpers');

let adminCookie, product;
const dirOf = (p) => path.join(UPLOAD_ROOT, 'products', p.id);

beforeAll(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie();
  await db.query("DELETE FROM products WHERE slug = 'img-normalise-test'");
  product = await Product.create({ slug: 'img-normalise-test', name: 'Image Test', price_isk: 1000, price_eur: 700 });
});

afterAll(async () => {
  fs.rmSync(dirOf(product), { recursive: true, force: true });
  await db.query('DELETE FROM products WHERE id = $1', [product.id]);
});

async function bigJpeg() {
  // 3000 × 1200, EXIF orientation 6 (rotate 90° clockwise on display).
  return sharp({ create: { width: 3000, height: 1200, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
}

const upload = (buf, filename, contentType) => request(app)
  .post(`/api/v1/admin/shop/products/${product.id}/images`).set('Cookie', adminCookie)
  .attach('file', buf, { filename, contentType });

test('an upload is auto-oriented, capped at 2000 px on the long edge and stripped of metadata', async () => {
  const res = await upload(await bigJpeg(), 'camera.jpg', 'image/jpeg');
  expect(res.status).toBe(201);
  const file = path.join(dirOf(product), path.basename(res.body.image.url));
  const meta = await sharp(fs.readFileSync(file)).metadata();
  expect(meta.format).toBe('jpeg');
  // Rotated: the 3000-wide landscape becomes a portrait, capped at 2000.
  expect(meta.height).toBe(2000);
  expect(meta.width).toBe(800);
  expect(meta.orientation).toBeUndefined();
  expect(meta.exif).toBeUndefined();
});

test('bytes that pass the magic-byte check but do not decode are a 400, nothing kept', async () => {
  const before = fs.readdirSync(dirOf(product)).length;
  const fake = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('not really a png at all')]);
  const res = await upload(fake, 'broken.png', 'image/png');
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({ code: 400 });
  expect(fs.readdirSync(dirOf(product)).length).toBe(before);
});

test('the .thumb.webp is made on first request, served, and deleted with the image', async () => {
  const res = await upload(await bigJpeg(), 'thumb.jpg', 'image/jpeg');
  const url = res.body.image.url;
  const thumb = await request(app).get(`${url}.thumb.webp`).buffer(true).parse((r, cb) => {
    const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  expect(thumb.status).toBe(200);
  const meta = await sharp(thumb.body).metadata();
  expect(meta.format).toBe('webp');
  expect(Math.max(meta.width, meta.height)).toBe(192);
  const onDisk = path.join(dirOf(product), `${path.basename(url)}.thumb.webp`);
  expect(fs.existsSync(onDisk)).toBe(true);

  const del = await request(app).delete(`/api/v1/admin/shop/products/${product.id}/images/${res.body.image.id}`).set('Cookie', adminCookie);
  expect(del.status).toBe(204);
  await new Promise(r => setTimeout(r, 100)); // the unlinks are fire-and-forget
  expect(fs.existsSync(onDisk)).toBe(false);
});

test('a derivative is never a source, and a missing original falls through to 404', async () => {
  const res = await upload(await bigJpeg(), 'chain.jpg', 'image/jpeg');
  const url = res.body.image.url;
  await request(app).get(`${url}.thumb.webp`);
  expect((await request(app).get(`${url}.thumb.webp.thumb.webp`)).status).toBe(404);
  expect((await request(app).get(`/assets/products/${product.id}/nope.jpg.thumb.webp`)).status).toBe(404);
});
