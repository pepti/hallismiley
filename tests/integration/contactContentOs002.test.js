// Product migration os_002 (2026-09-26, Halli): the contact page speaks for the
// whole company and names no software it replaces. 092 seeded the hero and
// "What we take on" rows with Shopify/Wix/WordPress and a
// migrate-onto-Rekstrarkerfið card; os_002 rewrites them where nobody edited
// the row. The view defaults and the migration must agree, so a fresh
// database (defaults) and a seeded one (rows) show the same page.
const fs = require('fs');
const path = require('path');
const db = require('../../server/config/database');
const { migrations } = require('../../server/config/migrationSet');
const { createTestAdminUser } = require('../helpers');

const m = migrations.find(x => x.name === 'os_002_contact_content_offering');
const run = async () => { for (const sql of m.statements) await db.query(sql); };
const KEYS = ['contact_hero', 'contact_availability'];
const NAMED = /Shopify|Wix|WordPress|WooCommerce|Squarespace|\bDK\b|Regla|Payday/;

// The 092 rows as seeded (the part os_002 touches).
const OLD = {
  contact_hero: {
    en: { eyebrow: 'Get in touch', title_line1: 'Tell us about your operation', title_accent: '— we take care of the systems.', subtitle: 'Moving off Shopify, Wix or WordPress, starting something new, or just weighing it up — we read every message and reply within one business day.' },
    is: { eyebrow: 'Hafa samband', title_line1: 'Segðu okkur frá rekstrinum', title_accent: '— við sjáum um kerfin.', subtitle: 'Á leið af Shopify, Wix eða WordPress, að byrja á einhverju nýju eða bara að skoða málin — við lesum öll skilaboð og svörum innan eins virks dags.' },
  },
  contact_availability: {
    en: { eyebrow: 'Right now', title: 'What we take on', cards: [{ status: 'open', label: 'Moving off Shopify, Wix or WordPress', body: 'x' }] },
    is: { eyebrow: 'Núna', title: 'Hvað við tökum að okkur', cards: [{ status: 'open', label: 'Flutningur af Shopify, Wix eða WordPress', body: 'x' }] },
  },
};

async function put(key, locale, value, updatedBy = null) {
  await db.query(
    `INSERT INTO site_content (key, locale, value, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (key, locale) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by`,
    [key, locale, JSON.stringify(value), updatedBy]);
}
const get = async (key, locale) =>
  (await db.query('SELECT value FROM site_content WHERE key = $1 AND locale = $2', [key, locale])).rows[0]?.value;

// Skipped as a whole on a product that hides, disables or forks the feature
// this suite belongs to, or when the feature is another product's
// (features/local.json — see tests/lib/featureGate.js). Shadows the global.
const { describeForSpec } = require('../lib/featureGate');
const describe = describeForSpec(__filename);

describe('os_002 — contact page copy for the whole company, no named software', () => {
  let saved;
  beforeAll(async () => {
    saved = (await db.query('SELECT key, locale, value, updated_by FROM site_content WHERE key = ANY($1)', [KEYS])).rows;
  });
  afterAll(async () => {
    await db.query('DELETE FROM site_content WHERE key = ANY($1)', [KEYS]);
    for (const r of saved) await put(r.key, r.locale, r.value, r.updated_by);
  });

  test('rewrites unedited 092 rows; the hero keeps its other fields', async () => {
    for (const key of KEYS) for (const lang of ['en', 'is']) await put(key, lang, OLD[key][lang]);
    await run();
    for (const lang of ['en', 'is']) {
      const hero = await get('contact_hero', lang);
      expect(hero).toEqual({ ...OLD.contact_hero[lang], subtitle: m.content.hero_subtitle[lang] });
      expect(await get('contact_availability', lang)).toEqual(m.content.availability[lang]);
      expect(JSON.stringify([hero, await get('contact_availability', lang)])).not.toMatch(NAMED);
    }
  });

  test('a row a person saved keeps every word, and a re-run is a no-op', async () => {
    const adminId = await createTestAdminUser();
    const mine = { ...OLD.contact_hero.is, subtitle: 'Eigin texti Halla.' };
    await put('contact_hero', 'is', mine, adminId);
    await put('contact_availability', 'is', OLD.contact_availability.is);
    await run();
    await run();
    expect(await get('contact_hero', 'is')).toEqual(mine);
    expect(await get('contact_availability', 'is')).toEqual(m.content.availability.is);
  });

  test('the ContactView defaults carry the same copy, and no section or option names a product', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../public/js/views/ContactView.js'), 'utf8');
    const flat = src.replace(/'\s*\+\s*\r?\n\s*'/g, ''); // join 'a ' + 'b' literals
    for (const lang of ['en', 'is']) {
      expect(flat).toContain(m.content.hero_subtitle[lang]);
      for (const c of m.content.availability[lang].cards) {
        expect(src).toContain(c.label);
        expect(src).toContain(c.body);
      }
    }
    const code = src.replace(/^\s*\/\/.*$/mg, '');
    expect(code).not.toMatch(NAMED);
    expect(code).not.toMatch(/built_with|builtWith/);
  });
});
