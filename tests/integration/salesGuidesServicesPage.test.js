// Migration 104: the seeded sales guides stop telling sellers that prices and
// the tier table are on /thjonusta (removed from the company site 2026-09-13).
const db = require('../../server/config/database');
// 104 is a company-content migration, so it lives in the product array
// (product-migrations/os.js) — migrationSet is the list the runner applies.
const { migrations } = require('../../server/config/migrationSet');
const { createTestAdminUser } = require('../helpers');

const m104 = migrations.find(m => m.name === '104_sales_guides_services_page');
const run = async () => { for (const sql of m104.statements) await db.query(sql); };

const STALE_TIERS = '<p>Verðin eru DRÖG. Þau eru sömu drög og birtast á þjónustusíðu vefsins. Nefndu þau sem viðmið.</p>';
const STALE_TABLE_SUMMARY = 'Nákvæma eiginleikataflan, eins og hún birtist á þjónustusíðunni: hvað öll þrep innihalda.';
const STALE_TABLE_BODY = '<p>Þessi leið speglar eiginleikatöfluna á þjónustusíðu vefsins — hún er heimildin þín.</p>';

async function insertGuide(slug, { summary = null, body, updatedBy = null }) {
  await db.query(
    `INSERT INTO sales_guides (slug, section, title, summary, body, updated_by)
     VALUES ($1, 'sala', $2, $3, $4, $5)`,
    [slug, slug, summary, body, updatedBy]);
}
const guide = async (slug) => (await db.query('SELECT summary, body FROM sales_guides WHERE slug = $1', [slug])).rows[0];

// Skipped as a whole on a product that hides, disables or forks the feature
// this suite belongs to, or when the feature is another product's
// (features/local.json — see tests/lib/featureGate.js). Shadows the global.
const { describeForSpec } = require('../lib/featureGate');
const describe = describeForSpec(__filename);

describe('migration 104 — sales guides no longer point at /thjonusta', () => {
  beforeEach(async () => {
    await db.query(`DELETE FROM sales_guides WHERE slug IN ('threpin-thrju', 'hvad-er-i-hverju-threpi')`);
  });
  afterAll(async () => {
    await db.query(`DELETE FROM sales_guides WHERE slug IN ('threpin-thrju', 'hvad-er-i-hverju-threpi')`);
  });

  test('rewrites the stale sentences in untouched seeded guides', async () => {
    await insertGuide('threpin-thrju', { body: STALE_TIERS });
    await insertGuide('hvad-er-i-hverju-threpi', { summary: STALE_TABLE_SUMMARY, body: STALE_TABLE_BODY });
    await run();

    const tiers = await guide('threpin-thrju');
    expect(tiers.body).not.toContain('þjónustusíð');
    expect(tiers.body).toContain('ekki birt á orangesmiley.is');
    expect(tiers.body).toContain('Nefndu þau sem viðmið.');

    const table = await guide('hvad-er-i-hverju-threpi');
    expect(table.summary).toBe('Nákvæma eiginleikataflan: hvað öll þrep innihalda.');
    expect(table.body).toContain('Þessi leið geymir eiginleikatöfluna fyrir þrepin — hún er heimildin þín.');
    expect(table.body).not.toContain('þjónustusíð');
  });

  test('leaves a guide a person has saved alone', async () => {
    const adminId = await createTestAdminUser();
    await insertGuide('threpin-thrju', { body: STALE_TIERS, updatedBy: adminId });
    await run();
    expect((await guide('threpin-thrju')).body).toBe(STALE_TIERS);
  });

  test('is a no-op on a second run', async () => {
    await insertGuide('threpin-thrju', { body: STALE_TIERS });
    await run();
    const once = await guide('threpin-thrju');
    await run();
    expect(await guide('threpin-thrju')).toEqual(once);
  });

  test('the seed script no longer carries the stale sentences', () => {
    const seed = require('fs').readFileSync(require('path').join(__dirname, '../../server/scripts/seed-sales-guides.js'), 'utf8');
    expect(seed).not.toMatch(/þjónustusíð/);
  });
});
