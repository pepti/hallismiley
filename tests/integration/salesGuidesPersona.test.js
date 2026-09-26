// Product migration os_005 (Halli, 2026-09-26): the demo persona "Kaffibrennslan
// Glóð" is a real company; the fictional one is Kaffibrennslan Hraunbaun. The
// seed carries the new name; os_005 turns a guide row that still has the old
// passage into the seed text — only in rows nobody saved, idempotently.
const db = require('../../server/config/database');
const { migrations } = require('../../server/config/migrationSet');
const { GUIDES } = require('../../server/scripts/seed-sales-guides');
const { createTestAdminUser } = require('../helpers');

const m5 = migrations.find(x => x.name === 'os_005_sales_guides_persona_hraunbaun');
const run = async () => { for (const sql of m5.statements) await db.query(sql); };
const SLUG = 'kerfid-i-stuttu-mali';
const seed = () => GUIDES.find(g => g.slug === SLUG);

async function insertGuide(body, { updatedBy = null } = {}) {
  const g = seed();
  await db.query(
    `INSERT INTO sales_guides (slug, section, sort_order, title, summary, body, updated_by, published)
     VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)`,
    [g.slug, g.section, g.sort_order, g.title, g.summary, body, updatedBy]);
}
const bodyOf = async () => (await db.query('SELECT body FROM sales_guides WHERE slug = $1', [SLUG])).rows[0].body;
// The text before os_005 = the seed with the edit undone.
const oldBody = () => {
  const [e] = m5.edits;
  const b = seed().body.trim();
  expect(b.split(e.to)).toHaveLength(2);
  return b.replace(e.to, () => e.from);
};

(m5 ? describe : describe.skip)('os_005 — the handbook names Kaffibrennslan Hraunbaun', () => {
  beforeEach(() => db.query('DELETE FROM sales_guides WHERE slug = $1', [SLUG]));
  afterAll(() => db.query('DELETE FROM sales_guides WHERE slug = $1', [SLUG]));

  test('is in the product array, after os_004', () => {
    const names = migrations.map(x => x.name);
    expect(names.indexOf('os_005_sales_guides_persona_hraunbaun')).toBeGreaterThan(names.indexOf('os_004_sales_guides_queue_spread'));
  });

  test('the seed carries no old name, and the old text + os_005 == the seed', async () => {
    expect(seed().body).not.toMatch(/Kaffibrennsl\w* Glóð/);
    await insertGuide(oldBody());
    await run();
    expect(await bodyOf()).toBe(seed().body.trim());
  });

  test('idempotent', async () => {
    await insertGuide(oldBody());
    await run();
    const once = await bodyOf();
    await run();
    expect(await bodyOf()).toBe(once);
  });

  test('a row someone saved is theirs — left alone', async () => {
    const adminId = await createTestAdminUser();
    await insertGuide(oldBody(), { updatedBy: adminId });
    await run();
    expect(await bodyOf()).toBe(oldBody());
  });
});
