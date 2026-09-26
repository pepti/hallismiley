// Product migration os_001: the seeded sales guides move from the retired flat
// 39/59/79 þ.kr./mán tiers to D-001 (build fee + service contract +
// verkeiningar) and point sellers at the demo instance, not at this site
// (D-020 step 5, 2026-09-22). The seed script and the migration must agree:
// the text the seed inserts on a fresh database is the text os_001 leaves on
// a database seeded before the change — once os_004 and os_003 (2026-09-26)
// are undone from the seed, since the seed now carries their text too
// (salesGuidesQueueSpread.test.js and salesGuidesD022.test.js cover those steps).
const crypto = require('crypto');
const db = require('../../server/config/database');
const { migrations } = require('../../server/config/migrationSet');
const { GUIDES } = require('../../server/scripts/seed-sales-guides');
const { createTestAdminUser } = require('../helpers');

const m = migrations.find(x => x.name === 'os_001_sales_guides_d001_pricing');
const m3 = migrations.find(x => x.name === 'os_003_sales_guides_d022_pricing');
const m4 = migrations.find(x => x.name === 'os_004_sales_guides_queue_spread');
const run = async () => { for (const sql of m.statements) await db.query(sql); };
const SLUGS = GUIDES.map(g => g.slug);

// The seed is the newest text. Undo os_004, then os_003, to get the D-001 text os_001 wrote,
// then os_001 to get the text as first seeded; each migration's edits newest
// first. Each new passage must occur exactly once for that to be well defined.
const count = (s, sub) => s.split(sub).length - 1;
function undo(row, edits) {
  for (const e of [...edits].reverse()) {
    if (e.slug !== row.slug) continue;
    if (count(row[e.field], e.to) !== 1) throw new Error(`${e.slug}.${e.field}: new passage not unique`);
    row[e.field] = row[e.field].replace(e.to, () => e.from);
  }
  return row;
}
const seedRow = (g) => ({ slug: g.slug, section: g.section, sort_order: g.sort_order, title: g.title, summary: g.summary, body: g.body.trim() });
const s3Guide = (g) => (m4 ? undo(seedRow(g), m4.edits) : seedRow(g));
const d001Guide = (g) => (m3 ? undo(s3Guide(g), m3.edits) : s3Guide(g));
const oldGuide = (g) => undo(d001Guide(g), m.edits);
// Filled inside the gated describe (beforeAll), not at module load: on a
// product where os_001 is not in the migration set, `m` is undefined and
// reconstructing the old text here would throw before the gate could skip.
const OLD = [];
const D001 = [];
const oldOf = (slug) => OLD.find(g => g.slug === slug);
const d001Of = (slug) => D001.find(g => g.slug === slug);
const text = (g) => [g.title, g.summary, g.body].join('\n');

async function insertGuide(g, updatedBy = null) {
  await db.query(
    `INSERT INTO sales_guides (slug, section, sort_order, title, summary, body, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [g.slug, g.section, g.sort_order, g.title, g.summary, g.body, updatedBy]);
}
const row = async (slug) => (await db.query('SELECT title, summary, body FROM sales_guides WHERE slug = $1', [slug])).rows[0];

// Retired-model phrases; none may survive in a guide at D-001. 39 alone stays
// legal: it is the Rekstur contract fee under D-001. (59 is legal again under
// D-022 — Verslun's fee — so these are checked on the D-001 text only.)
const FLAT_TIERS = [/\b59\b/, /\b79\b/, /39\s*\/\s*59\s*\/\s*79/, /Vefur\s*(?:—|\()?\s*39\b/,
  /fellur niður með árssamningi/, /Flöt áskrift/, /kostar áskrift/];

// Skipped as a whole on a product that hides, disables or forks the feature
// this suite belongs to, or when the feature is another product's
// (features/local.json — see tests/lib/featureGate.js). Shadows the global.
const { describeForSpec } = require('../lib/featureGate');
const describe = describeForSpec(__filename);

describe('os_001 — sales guides on the D-001 price model and the demo instance', () => {
  beforeAll(() => { D001.push(...GUIDES.map(d001Guide)); OLD.push(...GUIDES.map(oldGuide)); });
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

  test('the D-001 text (the seed before os_003) carries D-001 and the demo host, and no flat tier', () => {
    const all = D001.map(text).join('\n');
    for (const re of FLAT_TIERS) expect(all).not.toMatch(re);
    expect(all).toContain('390 / 580 / 690 þ.kr.');
    expect(all).toContain('19 / 29 / 39 þ.kr./mán');
    expect(all).toContain('5 / 10 / 20 verkeiningar');
    expect(all).toContain('demo.rekstrarkerfi.is');
    expect(all).toContain('endurstillt á hverri nóttu');
    expect(all).toContain('DRÖG — Halli staðfestir');
    expect(all).not.toMatch(/sýnir orangesmiley\.is/);
    // The seed itself still sends sellers to the demo host.
    expect(GUIDES.map(text).join('\n')).toContain('demo.rekstrarkerfi.is');
  });

  test('turns every untouched seeded guide into exactly the D-001 text (the seed before os_003)', async () => {
    for (const g of OLD) await insertGuide(g);
    await run();
    for (const slug of SLUGS) {
      const got = await row(slug);
      const want = d001Of(slug);
      expect({ slug, ...got }).toEqual({ slug, title: want.title, summary: want.summary, body: want.body });
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
