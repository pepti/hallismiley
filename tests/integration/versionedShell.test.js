'use strict';

// The whole app with a stamped release: the shell points every script and
// stylesheet at /js/_<tag>/ and /css/_<tag>/, those URLs serve the files cached
// for a year, and another release's tag is a 404 — the #332 "never mix
// releases" guarantee, now by URL instead of by revalidation. Ported from
// icelandicstore #425 (harvest-ice-e-2026-09-24); the version module is the
// engine's shape, so the mock spreads the real one and pins the tag.
const request = require('supertest');

const TAG = 'feedc0ffee12';

function stampedApp() {
  let app;
  jest.isolateModules(() => {
    jest.doMock('../../server/config/version', () => ({
      ...jest.requireActual('../../server/config/version'), buildTag: TAG,
    }));
    app = require('../../server/app');
  });
  return app;
}

describe('a stamped release', () => {
  const app = stampedApp();

  test('the shell loads its scripts and stylesheets from this release’s prefix', async () => {
    const res = await request(app).get('/is/contact');
    expect(res.status).toBe(200);
    const html = res.text;
    for (const url of [
      `/css/_${TAG}/fonts.css`, `/css/_${TAG}/main.css`,
      `/js/_${TAG}/consent.js`, `/js/_${TAG}/main.js`,
    ]) expect(html).toContain(`"${url}"`);
    // …except theme-boot.js: it recovers a stamped file that 404s, so it must
    // exist on whichever instance answers during a slot swap.
    expect(html).toContain('"/js/theme-boot.js"');
    expect(html).not.toMatch(/(src|href)="\/(js|css)\/(?!_|theme-boot\.js")/);
    // The shell itself is still revalidated — it is what carries the new tag.
    expect(res.headers['cache-control']).toMatch(/no-cache/);
  });

  test('this release’s files are immutable, and carry the build header', async () => {
    const res = await request(app).get(`/js/_${TAG}/router.js`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['x-app-build']).toBe(TAG);
  });

  test('an old release’s module is a 404 that no cache keeps', async () => {
    const res = await request(app).get('/js/_0ldrelease99/views/AdminView.js');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-app-build']).toBe(TAG);
  });

  test('the unstamped URLs keep working, revalidated', async () => {
    const res = await request(app).get('/js/main.js');
    expect(res.status).toBe(200);
    // no-cache in production; test/dev add no-store (utils/staticCacheControl.js).
    expect(res.headers['cache-control']).toMatch(/^no-cache/);
  });
});

describe('an unstamped checkout (Jest, local dev)', () => {
  test('the shell is left exactly as written', async () => {
    let app;
    // Pinned to 'dev' rather than unmocked: a checkout that ran generate-version
    // locally would otherwise read as stamped.
    jest.isolateModules(() => {
      jest.doMock('../../server/config/version', () => ({
        ...jest.requireActual('../../server/config/version'), buildTag: 'dev',
      }));
      app = require('../../server/app');
    });
    const res = await request(app).get('/is/contact');
    expect(res.text).toContain('"/js/main.js"');
    expect(res.text).not.toMatch(/\/(js|css)\/_/);
  });
});
