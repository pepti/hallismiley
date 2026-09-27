'use strict';
// Applies the product's TEST-stack sample rows (server/demo/testStackData.js)
// — and nowhere but a TEST stack. Ported from icelandicstore #183
// (services/demoDataSeeder.js), harvest 2 lane 9, 2026-09-26.
//
// Promotion ships the whole image, so "keep it on TEST" cannot come from
// choosing what to deploy; it has to come from the rows refusing to install
// themselves anywhere else. The gate, all of it required:
//
//   • APP_ENV is exactly `test`. Deliberately NOT NODE_ENV: NODE_ENV is
//     `production` on TEST, on PROD and in CI's boot smoke alike, so a NODE_ENV
//     gate would seed nothing on TEST while proving nothing about PROD. Not
//     `development` either (config/appEnv.js calls both "open"): a laptop seeds
//     by hand, through the script, behind the target guard.
//   • This is not a demo instance — that one has its own seed (demo/seed.js).
//   • The database is not a production one: no `prod` / `production` / `live`
//     word in its host or name (the fleet names servers `<x>-prod-pg` /
//     `<x>-test-pg`). The belt under APP_ENV: a PROD app given APP_ENV=test
//     by mistake still points at its prod server and is refused.
//
// `npm run seed:test-stack` (server/scripts/seed-test-stack.js) forces past the
// gate for a LOCAL database only — server/scripts/targetGuard.js decides that.
//
// Never throws: sample rows must not be able to stop a TEST stack booting.
const defaultDb = require('../config/database');
const defaultLogger = require('../logger');
const { isDemoInstance } = require('../config/demoInstance');

// A word that marks a database holding real records, delimited by start/end
// or - _ . — so `icelandicstore-prod-pg.postgres.database.azure.com` and
// `shop_prod` match, `productcatalog` and `delivery` do not. Besides
// prod/production/live it carries targetGuard.js's reserved names — the
// private books (`*_books`, `*_books_restore`) and ops instance (`*_ops`,
// `<x>-ops-pg`) hold the company's real ledger (invariant-reviewer, lane 9).
const PRODUCTION_WORD = /(^|[-_.])(prod|production|live|books|ops)([-_.]|$)/i;

/**
 * Every host and database name a connection string can name — the URL's own
 * plus libpq's `?host=` / `?dbname=` / `?database=` overrides, which
 * node-postgres honours (targetGuard.js judges the same set). Empty lists when
 * unparseable.
 */
function targetOf(databaseUrl) {
  try {
    const u = new URL(String(databaseUrl || ''));
    let name = '';
    try { name = decodeURIComponent(u.pathname.replace(/^\//, '')); } catch { name = ''; }
    const hosts = [u.hostname.replace(/^\[|\]$/g, ''), ...u.searchParams.getAll('host')].filter(Boolean);
    const names = [name, ...u.searchParams.getAll('dbname'), ...u.searchParams.getAll('database')].filter(Boolean);
    return { host: hosts[0] || '', name: names[0] || '', hosts, names };
  } catch {
    return { host: '', name: '', hosts: [], names: [] };
  }
}

/**
 * May the TEST-stack rows be applied here? Pure: everything it reads is passed in.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function testStackGate({ env = process.env, demoInstance = isDemoInstance() } = {}) {
  if (env.APP_ENV !== 'test') return { ok: false, reason: `APP_ENV is ${env.APP_ENV ? `"${env.APP_ENV}"` : 'unset'}, not "test"` };
  if (demoInstance) return { ok: false, reason: 'this is a demo instance — its data comes from server/demo/seed.js' };
  const { host, name, hosts, names } = targetOf(env.DATABASE_URL);
  if (!host || !name) return { ok: false, reason: 'DATABASE_URL names no host and database' };
  for (const part of [...hosts.flatMap((h) => h.split('.')), ...names]) {
    if (PRODUCTION_WORD.test(part)) return { ok: false, reason: `the database "${name}" on "${host}" is a production one ("${part}")` };
  }
  return { ok: true };
}

/**
 * Apply every dataset, each in its own transaction.
 * @param {object} [opts]
 * @param {boolean} [opts.force]  skip the gate — only the seed:test-stack script,
 *                                after the target guard has passed a local database
 * @returns {Promise<{skipped: boolean, reason?: string, applied: string[], failed: string[]}>}
 */
async function applyTestStackData({
  db = defaultDb,
  logger = defaultLogger,
  datasets,
  env = process.env,
  demoInstance,
  force = false,
} = {}) {
  try {
    // Loaded here, inside the try: a product's data file that throws on load
    // must not stop the boot (a default parameter would run outside it).
    if (datasets === undefined) datasets = require('../demo/testStackData').datasets;
    if (!force) {
      const gate = testStackGate({ env, demoInstance: demoInstance === undefined ? isDemoInstance() : demoInstance });
      if (!gate.ok) {
        // The mechanism working as designed on every production boot — not a warning.
        logger.debug({ reason: gate.reason }, '[testStackData] not applied');
        return { skipped: true, reason: gate.reason, applied: [], failed: [] };
      }
    }
    const applied = [];
    const failed = [];
    for (const set of datasets || []) {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        for (const sql of set.statements || []) await client.query(sql);
        await client.query('COMMIT');
        applied.push(set.name);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        failed.push(set.name);
        logger.error({ err, dataset: set.name }, '[testStackData] dataset failed and was rolled back — continuing without it');
      } finally {
        client.release();
      }
    }
    if (applied.length || failed.length) logger.info({ applied, failed }, '[testStackData] TEST-stack sample rows applied');
    return { skipped: false, applied, failed };
  } catch (err) {
    logger.error({ err }, '[testStackData] could not apply the TEST-stack sample rows');
    return { skipped: false, applied: [], failed: ['*'] };
  }
}

module.exports = { applyTestStackData, testStackGate, targetOf, PRODUCTION_WORD };
