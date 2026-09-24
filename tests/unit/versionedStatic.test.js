'use strict';

// server/middleware/versionedStatic.js — /js/_<tag>/… and /css/_<tag>/… serve
// this release's files cached for a year, and nothing under any other tag.
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { versionedStatic, assetPrefix, isReleaseTag } = require('../../server/middleware/versionedStatic');
const { isStaticAsset } = require('../../server/utils/staticAsset');

const PUBLIC = path.join(__dirname, '../../public');
const TAG = 'abc123def456';

function appWith(buildTag) {
  const app = express();
  app.use(versionedStatic({ buildTag }));
  app.use((req, res) => res.status(418).send('fell through'));
  return app;
}

describe('versionedStatic', () => {
  const app = appWith(TAG);

  test('this release’s tag serves the file, immutable for a year', async () => {
    const res = await request(app).get(`/js/_${TAG}/main.js`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.text).toBe(fs.readFileSync(path.join(PUBLIC, 'js/main.js'), 'utf8'));
  });

  test('stylesheets, locale files and HEAD work the same way', async () => {
    expect((await request(app).get(`/css/_${TAG}/main.css`)).status).toBe(200);
    const json = await request(app).get(`/js/_${TAG}/i18n/is.json`);
    expect(json.status).toBe(200);
    expect(json.headers['cache-control']).toContain('immutable');
    expect((await request(app).head(`/js/_${TAG}/main.js`)).status).toBe(200);
  });

  test('another release’s tag is a 404 that is never cached — not our bytes', async () => {
    const res = await request(app).get('/js/_0ldrelease99/main.js');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ error: 'Not found', code: 404 });
  });

  test('a missing file under a live tag is a no-store 404, not the SPA shell', async () => {
    const res = await request(app).get(`/js/_${TAG}/no-such-module.js`);
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('climbing out of public/ is refused', async () => {
    // supertest (like a browser) normalises ../ and %2e%2e away before sending,
    // so send the raw path with node:http — that is what an attacker can do.
    const server = app.listen(0);
    try {
      const { status, body } = await new Promise((resolve, reject) => {
        http.get({ port: server.address().port, path: `/js/_${TAG}/../../server/app.js` }, (res) => {
          let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
      });
      expect([400, 403, 404]).toContain(status);
      expect(body).not.toContain('require(');
    } finally { server.close(); }
  });

  test('a stamped prefix names only its own directory', async () => {
    // %2F survives URL normalisation, so these reach the middleware as written.
    for (const p of [`/css/_${TAG}/..%2Fjs%2Fmain.js`, `/js/_${TAG}/..%2Findex.html`, `/js/_${TAG}/..%2F..%2Fserver%2Fapp.js`]) {
      const res = await request(app).get(p);
      expect(res.status).not.toBe(200);
      expect(res.headers['cache-control'] || '').not.toContain('immutable');
    }
  });

  test('an error answer never carries immutable (Range / conditional)', async () => {
    const range = await request(app).get(`/js/_${TAG}/main.js`).set('Range', 'bytes=999999999-');
    expect(range.status).toBe(416);
    expect(range.headers['cache-control'] || '').not.toContain('immutable');
    const cond = await request(app).get(`/js/_${TAG}/main.js`).set('If-Match', '"nope"');
    expect(cond.status).toBe(412);
    expect(cond.headers['cache-control'] || '').not.toContain('immutable');
  });

  test('unprefixed paths and writes pass straight through', async () => {
    expect((await request(app).get('/js/main.js')).status).toBe(418);
    expect((await request(app).post(`/js/_${TAG}/main.js`)).status).toBe(418);
  });

  test('without a real release (dev / unknown) nothing is served as immutable', async () => {
    for (const tag of ['dev', 'unknown']) {
      const res = await request(appWith(tag)).get(`/js/_${tag}/main.js`);
      expect(res.status).toBe(404);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  test('assetPrefix / isReleaseTag', () => {
    expect(assetPrefix(TAG)).toBe(`_${TAG}`);
    expect(assetPrefix('dev')).toBe('');
    expect(assetPrefix('unknown')).toBe('');
    expect(isReleaseTag('')).toBe(false);
  });

  test('stamped paths stay exempt from the global rate limiter', () => {
    expect(isStaticAsset({ path: `/js/_${TAG}/views/AdminView.js` })).toBe(true);
    expect(isStaticAsset({ path: `/css/_${TAG}/main.css` })).toBe(true);
  });
});
