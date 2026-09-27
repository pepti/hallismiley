'use strict';
/*
 * Apply the TEST-stack sample rows (server/demo/testStackData.js) to a LOCAL
 * database by hand — `npm run seed:test-stack`.
 *
 *   npm run seed:test-stack -- --allow-dev-db     # the local dev database
 *
 * A TEST stack applies them itself at every boot (services/testStackSeeder.js,
 * APP_ENV=test only). This script is for a laptop, where APP_ENV is not `test`,
 * so it passes `force` — and therefore runs server/scripts/targetGuard.js first:
 * a local host, a `_test` name or the dev database with --allow-dev-db, never a
 * books/ops/prod name, never Azure, never inside App Service. Ported from
 * icelandicstore #183 (`seed:demo`), with the target guard added (harvest 2
 * lane 9, 2026-09-26) — ice's script only warned.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });
const db = require('../config/database');
const logger = require('../logger');
const { assertSafeTarget } = require('./targetGuard');
const { applyTestStackData } = require('../services/testStackSeeder');

async function main(argv = process.argv.slice(2)) {
  const target = assertSafeTarget({
    databaseUrl: db.pool.options?.connectionString || process.env.DATABASE_URL,
    env: process.env,
    allowDevDb: argv.includes('--allow-dev-db'),
  }, { label: 'seed:test-stack', exit: () => {} });
  if (!target.ok) return 1;

  const res = await applyTestStackData({ force: true });
  logger.info({ database: target.database, ...res }, '[seed:test-stack] done');
  return res.failed.length ? 1 : 0;
}

module.exports = { main };

if (require.main === module) {
  main()
    .then(async (code) => { await db.pool.end().catch(() => {}); process.exit(code); })
    .catch(async (err) => {
      logger.error({ err }, '[seed:test-stack] failed');
      await db.pool.end().catch(() => {});
      process.exit(1);
    });
}
