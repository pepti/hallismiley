// The TEST-stack gate (services/testStackSeeder.js; ice #183, harvest 2 lane
// 9): invented sample rows install themselves on a TEST stack and nowhere else.
// Both directions are pinned — a silent failure here is invisible until made-up
// rows sit in production.
const { testStackGate, targetOf } = require('../../server/services/testStackSeeder');
const { datasets } = require('../../server/demo/testStackData');
const fs = require('fs');
const path = require('path');

const TEST_URL = 'postgresql://app:pw@icelandicstore-test-pg.postgres.database.azure.com:5432/icelandicstore?sslmode=require';
const gate = (env, demoInstance = false) => testStackGate({ env, demoInstance });

describe('testStackGate', () => {
  test('a TEST stack (APP_ENV=test, a test server) may apply', () => {
    expect(gate({ APP_ENV: 'test', DATABASE_URL: TEST_URL })).toEqual({ ok: true });
    expect(gate({ APP_ENV: 'test', DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/orangesmiley' })).toEqual({ ok: true });
  });

  test.each([
    [undefined, /unset/],
    ['production', /"production"/],
    ['development', /"development"/], // a laptop seeds through the script, behind the target guard
    ['staging', /"staging"/],
    ['demo', /"demo"/],
    ['TEST', /"TEST"/],
  ])('APP_ENV=%p is refused', (appEnv, re) => {
    const env = { DATABASE_URL: TEST_URL };
    if (appEnv !== undefined) env.APP_ENV = appEnv;
    const r = gate(env);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(re);
  });

  test('NODE_ENV plays no part (it is production on TEST and PROD alike)', () => {
    expect(gate({ APP_ENV: 'test', NODE_ENV: 'production', DATABASE_URL: TEST_URL }).ok).toBe(true);
    expect(gate({ NODE_ENV: 'test', DATABASE_URL: TEST_URL }).ok).toBe(false);
  });

  test('a demo instance is refused — it has its own seed', () => {
    expect(gate({ APP_ENV: 'test', DATABASE_URL: TEST_URL }, true).reason).toMatch(/demo instance/);
  });

  test.each([
    'postgresql://app:pw@icelandicstore-prod-pg.postgres.database.azure.com:5432/icelandicstore',
    'postgresql://app:pw@orangesmiley-prod-pg.postgres.database.azure.com/orangesmiley',
    'postgres://postgres:postgres@localhost:5432/shop_prod',
    'postgres://postgres:postgres@localhost:5432/production',
    'postgres://postgres:postgres@db.live.example.is:5432/shop',
    // the private books / ops instance (targetGuard.js's reserved names)
    'postgres://postgres:postgres@localhost:5432/orangesmiley_books',
    'postgres://postgres:postgres@localhost:5432/orangesmiley_books_restore',
    'postgresql://app:pw@orangesmiley-ops-pg.postgres.database.azure.com/orangesmiley',
    // libpq overrides node-postgres honours
    'postgres://u:p@shop-test-pg/shop?host=shop-prod-pg.postgres.database.azure.com',
    'postgres://u:p@shop-test-pg/shop?dbname=shop_production',
  ])('a production database is refused even with APP_ENV=test: %s', (url) => {
    const r = gate({ APP_ENV: 'test', DATABASE_URL: url });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/production one/);
  });

  test('words that merely contain prod/live are not production', () => {
    expect(gate({ APP_ENV: 'test', DATABASE_URL: 'postgres://u:p@localhost/productcatalog' }).ok).toBe(true);
    expect(gate({ APP_ENV: 'test', DATABASE_URL: 'postgres://u:p@delivery-test-pg/delivery' }).ok).toBe(true);
  });

  test('no parseable DATABASE_URL is refused', () => {
    expect(gate({ APP_ENV: 'test' }).ok).toBe(false);
    expect(gate({ APP_ENV: 'test', DATABASE_URL: 'not a url' }).ok).toBe(false);
    expect(targetOf('postgres://u:p@h:1/d%20b')).toMatchObject({ host: 'h', name: 'd b' });
  });
});

describe('the data file is loaded inside the never-throw', () => {
  test('a product data file that throws on load does not stop the boot', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../server/demo/testStackData', () => { throw new Error('bad product file'); });
      const { applyTestStackData } = require('../../server/services/testStackSeeder');
      const errors = [];
      const res = await applyTestStackData({
        env: { APP_ENV: 'test', DATABASE_URL: TEST_URL }, demoInstance: false,
        logger: { debug() {}, info() {}, error: (o, m) => errors.push(m) },
      });
      expect(res).toEqual({ skipped: false, applied: [], failed: ['*'] });
      expect(errors).toHaveLength(1);
    });
  });
});

describe('the engine ships no TEST-stack rows', () => {
  test('server/demo/testStackData.js is the empty product-owned stub', () => {
    expect(datasets).toEqual([]);
  });

  test('server.js applies them after migrate() at boot', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../server/server.js'), 'utf8');
    const migrateAt = src.indexOf('await migrate();');
    const seedAt = src.indexOf("require('./services/testStackSeeder').applyTestStackData()");
    expect(migrateAt).toBeGreaterThan(-1);
    expect(seedAt).toBeGreaterThan(migrateAt);
  });
});
