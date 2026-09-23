'use strict';

/**
 * What a DOWNSTREAM product needs from the identity seam, end to end: with its
 * own `identity` block in config/client.json — and nothing else changed — the
 * SSR'd page presents as that product. This is the case the hallismiley graft
 * hit (its HISTORY `engine-graft`): merged as-is, Halli's personal site would
 * have presented as the company site because the engine pinned Orange Smiley
 * literals in tests and files.
 *
 * The app is required fresh inside jest.isolateModules with CLIENT_CONFIG_FILE
 * pointing at a temp file, so the singleton config, every reader of it
 * (publicSurface, themes, i18n, ssrMeta) and the Express app resolve to the
 * downstream identity. Same worker database as every other suite; only
 * GET requests are made.
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const request = require('supertest');

const DOWNSTREAM = {
  brand: {
    name: 'Halli Smiley',
    legalName: 'Halli Smiley',
    alternateNames: ['hallismiley', 'Halli Smiley — wood and code'],
    titleSuffix: ' — Halli Smiley',
  },
  locale: { publicDefault: 'en' },
  theme: { default: 'glacier', root: 'classic', picker: ['glacier', 'classic', 'midnight', 'ember', 'lava', 'moss'] },
  hero: { clip: '/assets/videos/waterfall.mp4', poster: '/assets/videos/waterfall-poster.jpg' },
  surface: { hiddenRoutes: [], hiddenAdminViews: [] },
  organization: {
    email: 'halli@hallismiley.is',
    description: 'Icelandic craftsman who moves between wood and software.',
    addressLocality: 'Hafnarfjörður',
    sameAs: ['https://github.com/pepti'],
  },
};

const script = (html) => {
  const m = html.match(/<script id="identity" type="application\/json">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
};

describe('a downstream identity flows through the served page', () => {
  let dir;
  let app;
  const savedFile = process.env.CLIENT_CONFIG_FILE;
  const savedLocale = process.env.PUBLIC_DEFAULT_LOCALE;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-downstream-'));
    fs.writeFileSync(path.join(dir, 'client.json'), JSON.stringify({ identity: DOWNSTREAM }));
    process.env.CLIENT_CONFIG_FILE = path.join(dir, 'client.json');
    delete process.env.PUBLIC_DEFAULT_LOCALE;
    jest.isolateModules(() => {
      const { problems } = require('../../server/config/clientConfig');
      expect(problems).toEqual([]);
      app = require('../../server/app');
    });
  });

  afterAll(() => {
    if (savedFile === undefined) delete process.env.CLIENT_CONFIG_FILE;
    else process.env.CLIENT_CONFIG_FILE = savedFile;
    if (savedLocale !== undefined) process.env.PUBLIC_DEFAULT_LOCALE = savedLocale;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the landing redirect follows the downstream visitor default', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/en/');
  });

  test('titles carry the downstream suffix and brand', async () => {
    const th = await request(app).get('/en/thjonusta');
    expect(th.status).toBe(200);
    expect(th.text).toContain('<title id="ssr-title">Services — Halli Smiley</title>');
    expect(th.text).not.toContain('Orange Smiley');

    const home = await request(app).get('/en/');
    expect(home.text).toContain('<title id="ssr-title">Halli Smiley — AI-driven software company</title>');
    expect(home.text).toMatch(/<meta property="og:site_name" content="Halli Smiley" \/>/);
    expect(home.text).toMatch(/<meta name="author" content="Halli Smiley" \/>/);
  });

  test('the theme trio rides <html> and the whole identity rides the script tag', async () => {
    const res = await request(app).get('/en/');
    expect(res.text).toMatch(/<html lang="en" data-default-theme="glacier" data-theme-picker="glacier classic midnight ember lava moss" data-root-theme="classic">/);
    const id = script(res.text);
    expect(id.brand.name).toBe('Halli Smiley');
    expect(id.hero.clip).toBe('/assets/videos/waterfall.mp4');
    expect(id.surface.hiddenAdminViews).toEqual([]);
    expect(id.theme.picker).toEqual(DOWNSTREAM.theme.picker);
  });

  test('the Organization and WebSite JSON-LD are the downstream’s, on the same @id', async () => {
    const res = await request(app).get('/en/');
    const blocks = (res.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [])
      .map((b) => JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')));
    const org = blocks.find((b) => b['@type'] === 'Organization');
    const site = blocks.find((b) => b['@type'] === 'WebSite');
    expect(org).toMatchObject({
      '@id': 'https://www.hallismiley.is/#organization',
      name: 'Halli Smiley',
      alternateName: ['hallismiley', 'Halli Smiley — wood and code'],
      email: 'halli@hallismiley.is',
      sameAs: ['https://github.com/pepti'],
    });
    expect(org.description).toBe(DOWNSTREAM.organization.description);
    expect(site).toMatchObject({ name: 'Halli Smiley', publisher: { '@id': 'https://www.hallismiley.is/#organization' } });
    expect(blocks.filter((b) => b['@type'] === 'Organization')).toHaveLength(1); // the baked copy is gone
    // No engine brand anywhere in the structured data. (The crawler body may
    // still carry it: the seeded home copy is company CONTENT, which a product
    // replaces in its own migrations, not identity.)
    expect(JSON.stringify(blocks)).not.toContain('Orange Smiley');
  });

  test('with no hidden routes, the engine’s portfolio surfaces are indexable again', async () => {
    for (const p of ['/en/news', '/en/shop', '/en/halli']) {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<meta name="robots" content="index, follow"/);
    }
  });

  test('the theme validator accepts the downstream set', async () => {
    let THEMES;
    jest.isolateModules(() => { ({ THEMES } = require('../../server/config/themes')); });
    expect(THEMES).toEqual(DOWNSTREAM.theme.picker);
  });
});
