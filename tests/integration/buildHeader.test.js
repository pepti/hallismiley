'use strict';

/**
 * Release identity on the wire (icelandicstore #332/#358, harvest-ice-f-2026-09-24):
 *   • every response carries X-App-Build — API, probes, static files, refusals;
 *   • the value is sha256(<git sha>)[:12], exactly what deploy.yml and
 *     promote.yml compute to prove WHICH image answers /ready.
 * In tests no build stamp exists, so the value is 'dev' (server/config/version.js).
 */
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const crypto  = require('crypto');
const request = require('supertest');
const app     = require('../../server/app');
const version = require('../../server/config/version');

describe('X-App-Build', () => {
  test('the stamp under test is the checkout value', () => {
    expect(version.buildInfo.gitSha).toBe('dev');
    expect(version.buildTag).toBe('dev');
  });

  test('a stamped build publishes a digest, never the commit', () => {
    // The tag only needs to change per release; the commit itself stays behind
    // /api/v1/system/version (admin-only).
    const sha = '37f441eb786f8ba0036bf0bc883674ebef8bdadf';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-tag-'));
    const file = path.join(dir, 'version.json');
    fs.writeFileSync(file, JSON.stringify({ version: '0.1.0', gitSha: sha, builtAt: '2026-09-16T00:00:00Z', channel: 'release' }));
    const info = version.readBuildInfo(file);
    fs.rmSync(dir, { recursive: true, force: true });

    expect(info.gitSha).toBe(sha);
    const tag = version.publicBuildTag(info.gitSha);
    expect(tag).not.toBe(sha);
    expect(tag).toMatch(/^[0-9a-f]{12}$/);
    // The two "no release" values pass through as themselves.
    expect(version.publicBuildTag('dev')).toBe('dev');
    expect(version.publicBuildTag('unknown')).toBe('unknown');
  });

  // deploy.yml and promote.yml prove WHICH image is answering by computing this
  // same tag from the sha they shipped (`sha256sum | cut -c1-12`) and comparing
  // it with the header on /ready — a bare 200 came from the OLD container for
  // ~80 s after a restart (ice, 2026-09-18). Change the derivation here without
  // changing it there and every deploy times out "not serving" while the site
  // is perfectly healthy; this pins the two together.
  test('the tag is exactly what the deploy workflows compute from the sha', () => {
    const sha = '37f441eb786f8ba0036bf0bc883674ebef8bdadf';
    // printf '%s' "$SHA" | sha256sum | cut -c1-12
    expect(version.publicBuildTag(sha)).toBe(crypto.createHash('sha256').update(sha).digest('hex').slice(0, 12));

    const workflows = path.join(__dirname, '..', '..', '.github', 'workflows');
    for (const file of ['deploy.yml', 'promote.yml']) {
      const text = fs.readFileSync(path.join(workflows, file), 'utf8');
      expect(text).toContain('| sha256sum | cut -c1-12');
      expect(text).toContain("grep -i '^x-app-build:'");
    }
  });

  test.each([
    ['an API route', '/api/v1/content/home'],
    ['the liveness probe', '/health'],
    // The probe both workflows read the tag from.
    ['the readiness probe', '/ready'],
    ['a static module', '/js/main.js'],
    ['a stylesheet', '/css/main.css'],
    ['an unknown API path (404)', '/api/v1/definitely-not-a-route'],
  ])('%s carries X-App-Build', async (_label, url) => {
    const res = await request(app).get(url);
    expect(res.headers['x-app-build']).toBe(version.buildTag);
  });

  // A save answering from a new release is how a page in the middle of a job
  // learns it is out of date. This one refuses (no session) — the header rides
  // on the refusal all the same.
  test('a refused write carries X-App-Build', async () => {
    const res = await request(app).post('/api/v1/admin/shop/products').send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers['x-app-build']).toBe(version.buildTag);
  });

  // Chunk E (icelandicstore #332, harvest-ice-e-2026-09-24): the page's baseline.
  test('the SSR shell names its release in <meta name="app-build">', async () => {
    const res = await request(app).get('/is/thjonusta').set('Accept', 'text/html');
    expect(res.status).toBe(200);
    expect(res.headers['x-app-build']).toBe(version.buildTag);
    expect(res.text).toMatch(new RegExp(`<meta[^>]*name="app-build"[^>]*content="${version.buildTag}"`));
    // Exactly one — the template placeholder is replaced, not duplicated.
    expect(res.text.match(/name="app-build"/g)).toHaveLength(1);
  });

  test('the shell is revalidated, never served stale from cache', async () => {
    const res = await request(app).get('/en/um-okkur').set('Accept', 'text/html');
    expect(res.headers['cache-control']).toBe('public, no-cache');
  });

  test('a 304 revalidation still carries X-App-Build', async () => {
    const first = await request(app).get('/js/main.js');
    expect(first.headers.etag).toBeTruthy();
    const again = await request(app).get('/js/main.js').set('If-None-Match', first.headers.etag);
    expect(again.status).toBe(304);
    expect(again.headers['x-app-build']).toBe(version.buildTag);
  });
});
