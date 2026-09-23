// Product migration os_001: the seeded sales guides move from the retired flat
// 39/59/79 þ.kr./mán tiers to D-001 (build fee + service contract +
// verkeiningar) and point sellers at the demo instance, not at this site
// (D-020 step 5, 2026-09-22). The seed script and the migration must agree:
// the text the seed inserts on a fresh database is the text os_001 leaves on
// a database seeded before the change.
const crypto = require('crypto');
const db = require('../../server/config/database');
const { migrations } = require('../../server/config/migrationSet');
const { GUIDES } = require('../../server/scripts/seed-sales-guides');
const { createTestAdminUser } = require('../helpers');

const m = migrations.find(x => x.name === 'os_001_sales_guides_d001_pricing');
const run = async () => { for (const sql of m.statements) await db.query(sql); };
const SLUGS = GUIDES.map(g => g.slug);

// The seeded text as it was before os_001 = the seed text with every edit
// undone, newest first. Each new passage must occur exactly once for that to
// be well defined.
const count = (s, sub) => s.split(sub).length - 1;
function oldGuide(g) {
  const row = { slug: g.slug, section: g.section, sort_order: g.sort_order, title: g.title, summary: g.summary, body: g.body.trim() };
  for (const e of [...m.edits].reverse()) {
    if (e.slug !== g.slug) continue;
    if (count(row[e.field], e.to) !== 1) throw new Error(`${e.slug}.${e.field}: new passage not unique`);
    row[e.field] = row[e.field].replace(e.to, () => e.from);
  }
  return row;
}
const OLD = GUIDES.map(oldGuide);
const oldOf = (slug) => OLD.find(g => g.slug === slug);
const seedOf = (slug) => GUIDES.find(g => g.slug === slug);
const text = (g) => [g.title, g.summary, g.body].join('\n');

async function insertGuide(g, updatedBy = null) {
  await db.query(
    `INSERT INTO sales_guides (slug, section, sort_order, title, summary, body, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [g.slug, g.section, g.sort_order, g.title, g.summary, g.body, updatedBy]);
}
const row = async (slug) => (await db.query('SELECT title, summary, body FROM sales_guides WHERE slug = $1', [slug])).rows[0];

// Retired-model phrases; none may survive in a guide. 39 alone stays legal:
// it is the Rekstur contract fee under D-001.
const FLAT_TIERS = [/\b59\b/, /\b79\b/, /39\s*\/\s*59\s*\/\s*79/, /Vefur\s*(?:—|\()?\s*39\b/,
  /fellur niður með árssamningi/, /Flöt áskrift/, /kostar áskrift/];

// Skipped as a whole on a product that hides, disables or forks the feature
// this suite belongs to, or when the feature is another product's
// (features/local.json — see tests/lib/featureGate.js). Shadows the global.
const { describeForSpec } = require('../lib/featureGate');
const describe = describeForSpec(__filename);

describe('os_001 — sales guides on the D-001 price model and the demo instance', () => {
  beforeEach(async () => { await db.query('DELETE FROM sales_guides WHERE slug = ANY($1)', [SLUGS]); });
  afterAll(async () => { await db.query('DELETE FROM sales_guides WHERE slug = ANY($1)', [SLUGS]); });

  test('the reconstructed old text is exactly what the 2026-08-27 seed shipped', () => {
    // sha256 of [slug, title, summary, body] for the 14 guides as read from the
    // dev database on 2026-09-22, before os_001 — seeded 2026-08-27, 104 applied.
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(OLD.map(g => [g.slug, g.title, g.summary, g.body]))).digest('hex');
    expect(hash).toBe('d0ccc527cba354af948ada8b7def783611eb2071607f706dbaf48dce2be2b6f0');
    expect(oldOf('threpin-thrju').body).toContain('<h2>Vefur — 39 þ.kr./mán (DRÖG)</h2>');
    expect(oldOf('hvad-thu-lofar-aldrei').body).toContain('(39/59/79 þ.kr./mán)');
    expect(oldOf('kerfid-i-stuttu-mali').body).toContain('Þegar þú sýnir orangesmiley.is ertu því um leið að sýna vöruna.');
  });

  test('the seed script carries D-001 and the demo host, and no flat tier', () => {
    const all = GUIDES.map(text).join('\n');
    for (const re of FLAT_TIERS) expect(all).not.toMatch(re);
    expect(all).toContain('390 / 580 / 690 þ.kr.');
    expect(all).toContain('19 / 29 / 39 þ.kr./mán');
    expect(all).toContain('5 / 10 / 20 verkeiningar');
    expect(all).toContain('demo.rekstrarkerfi.is');
    expect(all).toContain('endurstillt á hverri nóttu');
    expect(all).toContain('DRÖG — Halli staðfestir');
    expect(all).not.toMatch(/sýnir orangesmiley\.is/);
  });

  test('turns every untouched seeded guide into exactly the seed text', async () => {
    for (const g of OLD) await insertGuide(g);
    await run();
    for (const slug of SLUGS) {
      const got = await row(slug);
      const want = seedOf(slug);
      expect({ slug, ...got }).toEqual({ slug, title: want.title, summary: want.summary, body: want.body.trim() });
    }
    const tiers = await row('threpin-thrju');
    for (const re of FLAT_TIERS) expect(text(tiers)).not.toMatch(re);
    expect(tiers.body).toContain('<h2>Vefur — 390 þ.kr. uppsetning + 19 þ.kr./mán með 5 verkeiningum (DRÖG)</h2>');
    expect(tiers.body).toContain('<h2>Rekstur — 690 þ.kr. uppsetning + 39 þ.kr./mán með 20 verkeiningum (DRÖG)</h2>');
    expect(tiers.summary).toContain('5 / 10 / 20 verkeiningum');
    expect((await row('kerfid-i-stuttu-mali')).body).toContain('sýnikerfið demo.rekstrarkerfi.is');
  });

  test('leaves a guide a person has saved alone', async () => {
    const adminId = await createTestAdminUser();
    const old = oldOf('threpin-thrju');
    await insertGuide(old, adminId);
    await run();
    expect(await row('threpin-thrju')).toEqual({ title: old.title, summary: old.summary, body: old.body });
  });

  test('is a no-op on a second run', async () => {
    for (const g of OLD) await insertGuide(g);
    await run();
    const once = await Promise.all(SLUGS.map(row));
    await run();
    expect(await Promise.all(SLUGS.map(row))).toEqual(once);
  });
});
