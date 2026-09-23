'use strict';

/**
 * The server i18n tables (server/i18n/en.json, is.json — email subjects,
 * headings, footer, the page meta) carry no brand literal since the identity
 * seam: t() injects `{siteName}` (identity.brand.name), `{legalName}`
 * (identity.brand.legalName) and `{siteHost}` (APP_URL's host without "www.")
 * on every call, and an explicit param of the same name wins.
 *
 * Pinned: with the ENGINE defaults and the production APP_URL the strings
 * render EXACTLY the text they carried as literals; a downstream brand flows
 * through; and no literal is left in the engine tables (the product overlay
 * product.<locale>.json is where product wording goes).
 *
 * "The engine defaults" means the schema's, not this instance's config: each
 * case points CLIENT_CONFIG_FILE at a temp file so the same pin holds in a
 * downstream whose committed client.json is its own (identity-seam-2).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const { role } = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine.json'), 'utf8'));
const testEngine = role === 'engine' ? test : test.skip;
const savedAppUrl = process.env.APP_URL;
const savedFile = process.env.CLIENT_CONFIG_FILE;
let dir;

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-identity-')); });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

afterEach(() => {
  if (savedAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = savedAppUrl;
  if (savedFile === undefined) delete process.env.CLIENT_CONFIG_FILE;
  else process.env.CLIENT_CONFIG_FILE = savedFile;
});

/** A fresh server/i18n over a client.json holding exactly `fileConfig`
 *  ({} = the engine's schema defaults). */
function fresh(fileConfig = {}) {
  const file = path.join(dir, `client-${process.hrtime.bigint()}.json`);
  fs.writeFileSync(file, JSON.stringify(fileConfig));
  process.env.CLIENT_CONFIG_FILE = file;
  let mod;
  jest.isolateModules(() => { mod = require('../../server/i18n'); });
  return mod;
}

describe('server i18n — implicit {siteName} / {legalName} / {siteHost}', () => {
  test('with the engine defaults and the production origin the emails read exactly as before', () => {
    process.env.APP_URL = 'https://www.orangesmiley.is';
    const { t, implicitParams } = fresh();
    expect(implicitParams()).toEqual({ siteName: 'Orange Smiley', legalName: 'Orange Smiley ehf.', siteHost: 'orangesmiley.is' });
    expect(t('en', 'email.verify.subject')).toBe('Verify your Orange Smiley account');
    expect(t('is', 'email.verify.subject')).toBe('Staðfestu Orange Smiley aðganginn þinn');
    expect(t('en', 'email.reset.subject')).toBe('Reset your Orange Smiley password');
    expect(t('is', 'email.reset.subject')).toBe('Endurstilltu lykilorðið þitt á Orange Smiley');
    expect(t('en', 'email.invite.subject')).toBe('Your account at orangesmiley.is is ready');
    expect(t('is', 'email.invite.heading')).toBe('Velkomin á orangesmiley.is');
    expect(t('en', 'email.invite.body')).toContain('An account has been created for you at orangesmiley.is.');
    expect(t('en', 'email.order.subject', { orderNumber: 'HP-2026-ABCD' })).toBe('Your Orange Smiley order HP-2026-ABCD');
    expect(t('is', 'email.order.subject', { orderNumber: 'HP-2026-ABCD' })).toBe('Pöntun þín hjá Orange Smiley HP-2026-ABCD');
    expect(t('en', 'email.footer', { appUrl: 'https://www.orangesmiley.is' }))
      .toContain('<a href="https://www.orangesmiley.is" style="color:#c9a84c;text-decoration:none;">orangesmiley.is</a>');
    expect(t('en', 'email.footer', { appUrl: 'x' })).not.toContain('{siteHost}');
  });

  // hallismiley (engine-sync-2): engine-only — this repo overlays meta.home.title etc.
  testEngine('the page meta reads exactly as the literals ssrMeta.js carried until identity-seam-2', () => {
    const { t, has } = fresh();
    expect(t('en', 'meta.home.title')).toBe('{brand} — AI-driven software company');
    expect(t('is', 'meta.home.title')).toBe('{brand} — hugbúnaðarhús knúið gervigreind');
    expect(t('is', 'meta.thjonusta.title')).toBe('Þjónusta');
    expect(t('en', 'meta.umOkkur.description'))
      .toBe('Orange Smiley ehf. is an Icelandic software company: a solo founder assisted by AI agents, building and operating systems for Icelandic SMBs.');
    expect(t('is', 'meta.umOkkur.description'))
      .toBe('Orange Smiley ehf. er íslenskt hugbúnaðarfyrirtæki: einn stofnandi með aðstoð gervigreindarumboða sem smíðar og rekur kerfi fyrir íslensk fyrirtæki.');
    expect(t('is', 'meta.shop.title')).toBe('Verslun — Halli Smiley'); // the portfolio keeps the base's bare titles
    expect(has('en', 'meta.privacy.description')).toBe(false);          // a page without a description
    expect(has('is', 'meta.privacy.title')).toBe(true);
  });

  test('an explicit param of the same name wins over the implicit one', () => {
    process.env.APP_URL = 'https://www.orangesmiley.is';
    const { t } = fresh();
    expect(t('en', 'email.verify.subject', { siteName: 'Rekstrarkerfið' })).toBe('Verify your Rekstrarkerfið account');
    expect(t('en', 'email.invite.subject', { siteHost: 'rekstrarkerfi.is' })).toBe('Your account at rekstrarkerfi.is is ready');
    expect(t('en', 'meta.umOkkur.description', { legalName: 'Rekstrarkerfi ehf.' })).toMatch(/^Rekstrarkerfi ehf\. is an Icelandic/);
  });

  test('{siteHost} is the APP_URL host without a leading www.', () => {
    const { siteHost } = fresh();
    process.env.APP_URL = 'https://www.orangesmiley.is';
    expect(siteHost()).toBe('orangesmiley.is');
    process.env.APP_URL = 'https://ops.orangesmiley.is/';
    expect(siteHost()).toBe('ops.orangesmiley.is');
    process.env.APP_URL = 'http://localhost:3000';
    expect(siteHost()).toBe('localhost:3000');
    process.env.APP_URL = 'www.hallismiley.is/x';   // not a URL — best effort, never a throw
    expect(siteHost()).toBe('hallismiley.is');
    delete process.env.APP_URL;
    expect(siteHost()).toBe('orangesmiley.is');     // the engine's APP_URL fallback
  });

  test('a downstream brand flows through every email and meta string', () => {
    process.env.APP_URL = 'https://www.hallismiley.is';
    const { t, implicitParams } = fresh({ identity: { brand: { name: 'Halli Smiley', legalName: 'Halli Smiley' } } });
    expect(implicitParams()).toEqual({ siteName: 'Halli Smiley', legalName: 'Halli Smiley', siteHost: 'hallismiley.is' });
    expect(t('en', 'email.verify.subject')).toBe('Verify your Halli Smiley account');
    expect(t('is', 'email.verify.subject')).toBe('Staðfestu Halli Smiley aðganginn þinn');
    expect(t('is', 'email.invite.subject')).toBe('Aðgangurinn þinn á hallismiley.is er tilbúinn');
    expect(t('en', 'email.order.subject', { orderNumber: '1' })).toBe('Your Halli Smiley order 1');
    expect(t('en', 'meta.umOkkur.description')).toMatch(/^Halli Smiley is an Icelandic software company/);
    const keys = [
      'email.footer', 'email.verify.subject', 'email.reset.subject', 'email.invite.subject', 'email.invite.heading',
      'email.invite.body', 'email.order.subject',
      ...['home', 'thjonusta', 'umOkkur', 'projects', 'contact', 'privacy', 'terms'].flatMap((k) => [`meta.${k}.title`, `meta.${k}.description`]),
    ];
    for (const lc of ['en', 'is']) {
      for (const key of keys) {
        const out = t(lc, key, { appUrl: 'https://www.hallismiley.is', orderNumber: '1' });
        expect(out).not.toMatch(/Orange Smiley|orangesmiley\.is|\{siteName\}|\{legalName\}|\{siteHost\}/);
      }
    }
  });

  test('the engine tables carry the placeholders, never the brand', () => {
    for (const file of ['server/i18n/en.json', 'server/i18n/is.json']) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(text).not.toMatch(/Orange Smiley|orangesmiley\.is/);
      expect(text).toContain('{siteName}');
      expect(text).toContain('{legalName}');
      expect(text).toContain('{siteHost}');
    }
  });

  testEngine('the product overlays stay empty in the engine', () => {
    for (const file of ['server/i18n/product.en.json', 'server/i18n/product.is.json']) {
      expect(JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'))).toEqual({});
    }
  });
});
