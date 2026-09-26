// TEST-stack sample rows on a real database (services/testStackSeeder.js;
// ported from icelandicstore #183, harvest 2 lane 9): nothing is written off a
// TEST stack, the rows land on one, a second boot changes nothing, and a bad
// dataset rolls back alone without stopping the boot. The script refuses a
// target the guard does not pass. Datasets are injected — the engine's own list
// is empty (server/demo/testStackData.js).
const db = require('../../server/config/database');
const { applyTestStackData } = require('../../server/services/testStackSeeder');
const { main: seedScript } = require('../../server/scripts/seed-test-stack');

const KEY = 'demo.test_stack_probe';
const OTHER = 'demo.test_stack_probe_2';
// A test stack's connection string — the gate judges the NAME, never connects
// with it (the seeder writes through the pool it is given).
const TEST_ENV = { APP_ENV: 'test', DATABASE_URL: 'postgres://u:p@shop-test-pg.postgres.database.azure.com/shop' };

const probe = {
  name: 'probe',
  statements: [
    `INSERT INTO app_settings (key, value) VALUES ('${KEY}', '"sample"'::jsonb) ON CONFLICT (key) DO NOTHING`,
  ],
};
const broken = {
  name: 'broken',
  statements: [
    `INSERT INTO app_settings (key, value) VALUES ('${OTHER}', '"half"'::jsonb) ON CONFLICT (key) DO NOTHING`,
    'SELECT * FROM no_such_table_l9',
  ],
};
const silent = { debug() {}, info() {}, warn() {}, error() {} };

async function count(key) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM app_settings WHERE key = $1', [key]);
  return rows[0].n;
}

beforeEach(async () => {
  await db.query('DELETE FROM app_settings WHERE key IN ($1, $2)', [KEY, OTHER]);
});
afterAll(async () => {
  await db.query('DELETE FROM app_settings WHERE key IN ($1, $2)', [KEY, OTHER]);
});

test('off a TEST stack nothing is written', async () => {
  for (const env of [{ ...TEST_ENV, APP_ENV: 'production' }, { DATABASE_URL: TEST_ENV.DATABASE_URL }]) {
    const res = await applyTestStackData({ env, datasets: [probe], logger: silent, demoInstance: false });
    expect(res).toMatchObject({ skipped: true, applied: [] });
  }
  const prod = await applyTestStackData({
    env: { APP_ENV: 'test', DATABASE_URL: 'postgres://u:p@shop-prod-pg.postgres.database.azure.com/shop' },
    datasets: [probe], logger: silent, demoInstance: false,
  });
  expect(prod.skipped).toBe(true);
  expect(await count(KEY)).toBe(0);
});

test('on a TEST stack the rows land, and a second boot changes nothing', async () => {
  const first = await applyTestStackData({ env: TEST_ENV, datasets: [probe], logger: silent, demoInstance: false });
  expect(first).toEqual({ skipped: false, applied: ['probe'], failed: [] });
  const second = await applyTestStackData({ env: TEST_ENV, datasets: [probe], logger: silent, demoInstance: false });
  expect(second.applied).toEqual(['probe']);
  expect(await count(KEY)).toBe(1);
});

test('a failing dataset rolls back alone; the others apply; nothing throws', async () => {
  const errors = [];
  const res = await applyTestStackData({
    env: TEST_ENV, datasets: [broken, probe], demoInstance: false,
    logger: { ...silent, error: (o, m) => errors.push(m) },
  });
  expect(res).toEqual({ skipped: false, applied: ['probe'], failed: ['broken'] });
  expect(await count(OTHER)).toBe(0); // its first statement was rolled back with it
  expect(await count(KEY)).toBe(1);
  expect(errors.join()).toMatch(/rolled back/);
});

test('a demo instance is left to its own seed', async () => {
  const res = await applyTestStackData({ env: TEST_ENV, datasets: [probe], logger: silent, demoInstance: true });
  expect(res.skipped).toBe(true);
  expect(await count(KEY)).toBe(0);
});

test('the engine boot applies nothing: its dataset list is empty', async () => {
  const res = await applyTestStackData({ env: TEST_ENV, logger: silent, demoInstance: false });
  expect(res).toEqual({ skipped: false, applied: [], failed: [] });
});

test('seed:test-stack refuses a target the guard does not pass, before writing', async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV };
  process.env.NODE_ENV = 'production';
  const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    expect(await seedScript([])).toBe(1);
  } finally {
    write.mockRestore();
    process.env.NODE_ENV = saved.NODE_ENV;
  }
});
