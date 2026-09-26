// Product migration os_004 (Halli, 2026-09-26), a follow-up to os_003: verk
// sizes stay 1 / 5 / 20 einingar but the D-022 monthly quotas are 2 / 3 / 5, so
// the queue note "a verk nobody is waiting for can wait for next month and take
// its units, at no extra cost" could not hold for a stórt verk. It now says the
// verk is paid with the units of the coming months, spread over several months
// if one cannot hold it, with a worked example (20 einingar on Rekstur: four
// months, or start now and pay the rest at the einingaverð). The seed carries
// the same text; os_004 turns the text os_003 left into it.
const db = require('../../server/config/database');
const { migrations } = require('../../server/config/migrationSet');
const { GUIDES } = require('../../server/scripts/seed-sales-guides');
const { createTestAdminUser } = require('../helpers');

const m4 = migrations.find(x => x.name === 'os_004_sales_guides_queue_spread');
const runAll = async (mig) => { for (const sql of mig.statements) await db.query(sql); };
const SLUGS = GUIDES.map(g => g.slug);

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
const seedOf = (slug) => seedRow(GUIDES.find(g => g.slug === slug));
// The text os_003 left = the seed with os_004 undone. Filled in beforeAll
// inside the gated describe (a product without os_004 skips the suite).
const S3 = [];
const s3Of = (slug) => S3.find(g => g.slug === slug);
const pick = ({ title, summary, body }) => ({ title, summary, body });

async function insertGuide(g, { updatedBy = null, published = false } = {}) {
  await db.query(
    `INSERT INTO sales_guides (slug, section, sort_order, title, summary, body, updated_by, published)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [g.slug, g.section, g.sort_order, g.title, g.summary, g.body, updatedBy, published]);
}
const row = async (slug) => (await db.query('SELECT title, summary, body FROM sales_guides WHERE slug = $1', [slug])).rows[0];

const OLD_PROMISE = 'má geyma til næsta mánaðar og taka af einingum hans';

const { describeForSpec } = require('../lib/featureGate');
const describe = describeForSpec(__filename);

describe('os_004 — the queue note spreads a verk over several months', () => {
  beforeAll(() => { S3.push(...GUIDES.map(g => undo(seedRow(g), m4.edits))); });
  beforeEach(async () => { await db.query('DELETE FROM sales_guides WHERE slug = ANY($1)', [SLUGS]); });
  afterAll(async () => { await db.query('DELETE FROM sales_guides WHERE slug = ANY($1)', [SLUGS]); });

  test('runs after os_003 and is pure data (no DDL, only guarded UPDATEs of sales_guides)', () => {
    const names = migrations.map(x => x.name);
    expect(names.indexOf('os_004_sales_guides_queue_spread')).toBeGreaterThan(names.indexOf('os_003_sales_guides_d022_pricing'));
    expect(m4.statements).toHaveLength(m4.edits.length);
    for (const sql of m4.statements) {
      expect(sql).toMatch(/^UPDATE sales_guides SET (?:title|summary|body) = replace\(/);
      expect(sql).toContain('updated_by IS NULL');
      expect(sql).not.toMatch(/\b(?:ALTER|DROP|CREATE|DELETE|INSERT|TRUNCATE)\b|published/i);
    }
  });

  test('the old passage occurs once in the os_003 text, the new one once in the seed', () => {
    for (const e of m4.edits) {
      expect(count(s3Of(e.slug)[e.field], e.from)).toBe(1);
      expect(count(seedOf(e.slug)[e.field], e.to)).toBe(1);
    }
  });

  test('the seed no longer promises next month, and carries the spread and the example', () => {
    const all = GUIDES.map(g => [g.title, g.summary, g.body].join('\n')).join('\n');
    expect(all).not.toContain(OLD_PROMISE);
    const body = seedOf('threpin-thrju').body;
    expect(body).toContain('má geyma og greiða með einingum næstu mánaða — stærra verk en einn mánuður rúmar má dreifa á fleiri mánuði, án aukakostnaðar.');
    expect(body).toContain('<li><strong>Dæmi:</strong> viðskiptavinur í Rekstri (5 einingar á mánuði) vill stórt verk (20 einingar).');
    expect(body).toContain('dreifist verkið á fjóra mánuði');
    expect(body).toContain('15 × 6.000 kr. = 90.000 kr. án VSK');
    expect(body).toContain('Viðskiptavinurinn velur, og samið er um valið áður en vinnan hefst.');
    // The verk sizes are unchanged.
    expect(body).toContain('<li><strong>Stórt verk = 20 einingar</strong>');
  });

  test('turns every untouched os_003 guide into exactly the seed text', async () => {
    for (const g of S3) await insertGuide(g);
    await runAll(m4);
    for (const slug of SLUGS) {
      expect({ slug, ...(await row(slug)) }).toEqual({ slug, ...pick(seedOf(slug)) });
    }
  });

  test('leaves a guide a person has saved alone, and never touches published', async () => {
    const adminId = await createTestAdminUser();
    const saved = { ...s3Of('threpin-thrju'), body: `${s3Of('threpin-thrju').body}\n<p>Breytt af Halla.</p>` };
    await insertGuide(saved, { updatedBy: adminId, published: true });
    await runAll(m4);
    expect(await row('threpin-thrju')).toEqual(pick(saved));
    expect((await row('threpin-thrju')).body).toContain(OLD_PROMISE);

    await db.query('DELETE FROM sales_guides WHERE slug = $1', ['threpin-thrju']);
    await insertGuide(s3Of('threpin-thrju'), { published: true });
    await runAll(m4);
    expect(await row('threpin-thrju')).toEqual(pick(seedOf('threpin-thrju')));
    const flags = (await db.query('SELECT published, updated_by FROM sales_guides WHERE slug = $1', ['threpin-thrju'])).rows;
    expect(flags).toEqual([{ published: true, updated_by: null }]);
  });

  test('is a no-op on a second run, and on rows already at the seed text', async () => {
    for (const g of S3) await insertGuide(g);
    await runAll(m4);
    const once = await Promise.all(SLUGS.map(row));
    await runAll(m4);
    expect(await Promise.all(SLUGS.map(row))).toEqual(once);

    await db.query('DELETE FROM sales_guides WHERE slug = ANY($1)', [SLUGS]);
    for (const g of GUIDES) await insertGuide(seedRow(g));
    await runAll(m4);
    for (const slug of SLUGS) expect(await row(slug)).toEqual(pick(seedOf(slug)));
  });
});
