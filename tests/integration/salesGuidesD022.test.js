// Product migration os_003 (D-022, Halli 2026-09-26): the seeded sales guides
// move from D-001's service contract (19/29/39 þ.kr./mán with 5/10/20
// verkeiningar, einingaverð undecided) to D-022's (29/59/89 with 2/3/5,
// einingaverð 6.000 kr., hosting and in-system AI beyond the included amount at
// cost + 15 %), and learn the fourth tier Samstarf: no listed price, agreed
// after a free assessment, and when a seller offers it. Build fees stay
// 390/580/690 þ.kr. The seed script and the migration must agree: the text the
// seed inserts on a fresh database is the text os_003 leaves on a database that
// os_001 already moved to D-001.
const db = require('../../server/config/database');
const { migrations } = require('../../server/config/migrationSet');
const { GUIDES } = require('../../server/scripts/seed-sales-guides');
const { createTestAdminUser } = require('../helpers');

const m1 = migrations.find(x => x.name === 'os_001_sales_guides_d001_pricing');
const m3 = migrations.find(x => x.name === 'os_003_sales_guides_d022_pricing');
const runAll = async (mig) => { for (const sql of mig.statements) await db.query(sql); };
const SLUGS = GUIDES.map(g => g.slug);

// The seed is D-022 text. Undo os_003 (newest edit first) = the D-001 text
// os_001 wrote; undo os_001 too = the text as first seeded (2026-08-27).
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
// Filled in beforeAll inside the gated describe (a product without os_003
// skips the suite before anything here would throw).
const D001 = [];
const ORIG = [];
const seedOf = (slug) => seedRow(GUIDES.find(g => g.slug === slug));
const text = (g) => [g.title, g.summary, g.body].join('\n');
const pick = ({ title, summary, body }) => ({ title, summary, body });

async function insertGuide(g, { updatedBy = null, published = false } = {}) {
  await db.query(
    `INSERT INTO sales_guides (slug, section, sort_order, title, summary, body, updated_by, published)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [g.slug, g.section, g.sort_order, g.title, g.summary, g.body, updatedBy, published]);
}
const row = async (slug) => (await db.query('SELECT title, summary, body FROM sales_guides WHERE slug = $1', [slug])).rows[0];

// D-001 contract phrases; none may survive in a guide after D-022. The build
// fees (390 / 580 / 690) and the verk sizes (1 / 5 / 20) are unchanged and legal.
const D001_CONTRACT = [
  /19\s*\/\s*29\s*\/\s*39/, /5\s*\/\s*10\s*\/\s*20 verkeining/, /\b19 þ\.kr/,
  // "með 5 verkeiningum" is Rekstur's quota under D-022, so only 10/20 are retired.
  /með (?:10|20) verkeiningum/, /\+ 19 þ\.kr\.\/mán með 5\b/, /\+ 29 þ\.kr\.\/mán með 10\b/, /\+ 39 þ\.kr\.\/mán með 20\b/,
  /5, 10 eða 20 á mánuði/, /einingaverð\w* (?:er )?ekki ákveðin/i, /Upphæð einingaverðsins/,
  /5 einingar í Vef/, /20 einingar í Rekstri/,
];
// Retired flat-subscription phrases (os_001's list, minus the bare 59/79 —
// 59 is Verslun's fee under D-022).
const FLAT_TIERS = [/39\s*\/\s*59\s*\/\s*79/, /Vefur\s*(?:—|\()?\s*39\b/, /\b79\b/,
  /fellur niður með árssamningi/, /Flöt áskrift/, /kostar áskrift/];

// Skipped as a whole on a product that hides, disables or forks the feature
// this suite belongs to, or when the feature is another product's
// (features/local.json — see tests/lib/featureGate.js). Shadows the global.
const { describeForSpec } = require('../lib/featureGate');
const describe = describeForSpec(__filename);

describe('os_003 — sales guides on the D-022 price model, with Samstarf', () => {
  beforeAll(() => {
    D001.push(...GUIDES.map(g => undo(seedRow(g), m3.edits)));
    ORIG.push(...D001.map(g => undo({ ...g }, m1.edits)));
  });
  beforeEach(async () => { await db.query('DELETE FROM sales_guides WHERE slug = ANY($1)', [SLUGS]); });
  afterAll(async () => { await db.query('DELETE FROM sales_guides WHERE slug = ANY($1)', [SLUGS]); });

  test('runs after os_001 and is pure data (no DDL, only guarded UPDATEs of sales_guides)', () => {
    const names = migrations.map(x => x.name);
    expect(names.indexOf('os_003_sales_guides_d022_pricing')).toBeGreaterThan(names.indexOf('os_001_sales_guides_d001_pricing'));
    expect(m3.statements).toHaveLength(m3.edits.length);
    for (const sql of m3.statements) {
      expect(sql).toMatch(/^UPDATE sales_guides SET (?:title|summary|body) = replace\(/);
      expect(sql).toContain('updated_by IS NULL');
      expect(sql).not.toMatch(/\b(?:ALTER|DROP|CREATE|DELETE|INSERT|TRUNCATE)\b|published/i);
    }
  });

  test('every old passage occurs exactly once in the D-001 text, every new one once in the seed', () => {
    for (const e of m3.edits) {
      const before = D001.find(g => g.slug === e.slug);
      const after = seedOf(e.slug);
      expect({ e: `${e.slug}.${e.field}`, n: count(before[e.field], e.from) }).toEqual({ e: `${e.slug}.${e.field}`, n: 1 });
      expect({ e: `${e.slug}.${e.field}`, n: count(after[e.field], e.to) }).toEqual({ e: `${e.slug}.${e.field}`, n: 1 });
    }
    // os_003 starts from D-001 text: that text still quotes the old contract.
    expect(D001.map(text).join('\n')).toContain('19 / 29 / 39 þ.kr./mán');
  });

  test('the seed script carries D-022 and Samstarf, and no D-001 contract figure', () => {
    const all = GUIDES.map(text).join('\n');
    for (const re of [...D001_CONTRACT, ...FLAT_TIERS]) expect(all).not.toMatch(re);
    expect(all).toContain('390 / 580 / 690 þ.kr.');
    expect(all).toContain('29 / 59 / 89 þ.kr./mán');
    expect(all).toContain('2 / 3 / 5 verkeiningar');
    expect(all).toContain('6.000 kr.');
    expect(all).toContain('2.000 kr. á mánuði');
    expect(all).toContain('kostnaðarverði Azure að viðbættum 15 %');
    expect(all).toContain('DRÖG — Halli staðfestir');

    const tiers = seedOf('threpin-thrju');
    expect(tiers.title).toBe('Þrepin þrjú, Samstarf og hverjum þau henta');
    expect(tiers.body).toContain('<h2>Vefur — 390 þ.kr. uppsetning + 29 þ.kr./mán með 2 verkeiningum (DRÖG)</h2>');
    expect(tiers.body).toContain('<h2>Verslun — 580 þ.kr. uppsetning + 59 þ.kr./mán með 3 verkeiningum (DRÖG)</h2>');
    expect(tiers.body).toContain('<h2>Rekstur — 690 þ.kr. uppsetning + 89 þ.kr./mán með 5 verkeiningum (DRÖG)</h2>');
    expect(tiers.body).toContain('<strong>6.000 kr. á einingu án VSK</strong> (DRÖG — Halli staðfestir)');
    // Samstarf: its own section, no listed price, the free assessment and when to offer it.
    expect(tiers.body).toContain('<h2>Samstarf — fjórða leiðin, verð eftir ókeypis mat (DRÖG)</h2>');
    expect(tiers.body).toContain('Samstarf hefur <strong>ekkert listaverð</strong>');
    expect(tiers.body).toContain('<h2>Hvenær þú býður ókeypis mat í stað þreps</h2>');
    expect(tiers.body).toContain('Matið kostar ykkur ekkert.');
    expect(tiers.body).toContain('nefnir aldrei verð í Samstarfi');
    const samstarf = tiers.body.slice(tiers.body.indexOf('<h2>Samstarf'));
    expect(samstarf).not.toMatch(/\d+\s*þ\.kr\.|\d\.\d{3} kr\./); // no figure in the Samstarf copy
    expect(tiers.summary).toContain('Samstarf, hefur ekkert listaverð');

    const table = seedOf('hvad-er-i-hverju-threpi');
    expect(table.body).toContain('Vefur 390 þ.kr. uppsetning + 29 þ.kr./mán með 2 verkeiningum, Verslun 580 þ.kr. + 59 þ.kr./mán með 3, Rekstur 690 þ.kr. + 89 þ.kr./mán með 5');
    expect(table.body).toContain('<li><strong>Samstarf</strong> er utan þrepanna');
    expect(seedOf('tilbodsferlid').body).toContain('Í Samstarfi kemur ókeypis matið á undan tilboðinu.');
    expect(seedOf('hvad-thu-lofar-aldrei').body).toContain('Samstarf hefur ekkert verð fyrr en eftir ókeypis matið.');
    expect(seedOf('ordalisti').body).toContain('<li><strong>Ókeypis mat</strong>');
  });

  test('turns every untouched D-001 guide into exactly the seed text', async () => {
    for (const g of D001) await insertGuide(g);
    await runAll(m3);
    for (const slug of SLUGS) {
      expect({ slug, ...(await row(slug)) }).toEqual({ slug, ...pick(seedOf(slug)) });
    }
    const tiers = await row('threpin-thrju');
    for (const re of D001_CONTRACT) expect(text(tiers)).not.toMatch(re);
    expect(tiers.body).toContain('Samstarf — fjórða leiðin');
  });

  test('os_001 then os_003 turn the first-seeded guides into the seed text', async () => {
    for (const g of ORIG) await insertGuide(g);
    await runAll(m1);
    await runAll(m3);
    for (const slug of SLUGS) {
      expect({ slug, ...(await row(slug)) }).toEqual({ slug, ...pick(seedOf(slug)) });
    }
  });

  test('leaves a guide a person has saved alone, and never touches published', async () => {
    const adminId = await createTestAdminUser();
    const saved = D001.find(g => g.slug === 'threpin-thrju');
    await insertGuide(saved, { updatedBy: adminId });
    const untouched = D001.find(g => g.slug === 'hvad-er-i-hverju-threpi');
    await insertGuide(untouched, { published: true });
    await runAll(m3);
    expect(await row('threpin-thrju')).toEqual(pick(saved));
    expect(await row('hvad-er-i-hverju-threpi')).toEqual(pick(seedOf('hvad-er-i-hverju-threpi')));
    const flags = (await db.query(
      'SELECT slug, published, updated_by FROM sales_guides WHERE slug = ANY($1) ORDER BY slug',
      [['threpin-thrju', 'hvad-er-i-hverju-threpi']])).rows;
    expect(flags).toEqual([
      { slug: 'hvad-er-i-hverju-threpi', published: true, updated_by: null },
      { slug: 'threpin-thrju', published: false, updated_by: adminId },
    ]);
  });

  test('is a no-op on a second run, and on rows already at the seed text', async () => {
    for (const g of D001) await insertGuide(g);
    await runAll(m3);
    const once = await Promise.all(SLUGS.map(row));
    await runAll(m3);
    expect(await Promise.all(SLUGS.map(row))).toEqual(once);

    // A fresh install seeds D-022 text directly; os_003 then changes nothing.
    await db.query('DELETE FROM sales_guides WHERE slug = ANY($1)', [SLUGS]);
    for (const g of GUIDES) await insertGuide(seedRow(g));
    await runAll(m3);
    for (const slug of SLUGS) expect(await row(slug)).toEqual(pick(seedOf(slug)));
  });
});
