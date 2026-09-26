#!/usr/bin/env node
// Drop the throwaway test databases Jest leaves behind.
//
// tests/globalTeardown.js drops a run's own set (per-branch template + worker
// clones), but a run that is killed first — a stopped shell does not stop its
// Jest child — leaves them on the server, one set per branch. This finds every
// name tests/workerDb.js could have derived (`*_w<N>_test`, `*_tmpl_test`),
// plus the pre-2026-09-02 shared `orangesmiley_test`, and drops it.
//
//   npm run test:db:clean              drop the Jest-derived databases
//   npm run test:db:clean -- --dry-run list them, drop nothing
//   npm run test:db:clean -- --e2e     also drop the Playwright per-branch DBs
//                                      (orangesmiley_e2e_*_test, e2e/lib/dbUrl.js)
//
// Server + credentials come from the same resolution as `npm test`
// (TEST_DATABASE_URL, else DATABASE_URL / .env, else localhost). Every name
// that gets dropped ends in `_test` by construction — the dev database is
// never a candidate. A database that is in use by a run happening RIGHT NOW
// is skipped, not terminated: this script cleans up orphans, it does not stop
// other people's tests.
const { Pool } = require('pg');
const {
  DEFAULT_TEST_DATABASE_URL,
  resolveTestBaseUrl,
  adminDbUrl,
  isDerivedTestDbName,
} = require('../tests/workerDb');
const { checkTarget } = require('../server/scripts/targetGuard');

const args   = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const e2e    = args.includes('--e2e');

// `orangesmiley` — the prefix every derived name starts with.
const PREFIX = new URL(DEFAULT_TEST_DATABASE_URL).pathname.replace(/^\//, '').replace(/_test$/, '');
const LEGACY_SHARED = `${PREFIX}_test`;
const E2E_RE = new RegExp(`^${PREFIX}_e2e(_.*)?_test$`);

function isCandidate(name) {
  if (!name.startsWith(`${PREFIX}_`) || !name.endsWith('_test')) return false;
  if (isDerivedTestDbName(name) && !E2E_RE.test(name)) return true;
  if (name === LEGACY_SHARED) return true;
  return e2e && E2E_RE.test(name);
}

async function main() {
  const { url } = resolveTestBaseUrl();
  // DROP DATABASE on a server it can reach: local host only (the shared
  // destructive-script guard, server/scripts/targetGuard.js, harvest 2).
  const target = checkTarget({ databaseUrl: url, env: process.env });
  if (!target.ok) {
    console.error(`[test:db:clean] refusing: ${target.reason}.`);
    process.exitCode = 1;
    return;
  }
  const admin = new Pool({ connectionString: adminDbUrl(url) });
  let dropped = 0, skipped = 0;
  try {
    const { rows } = await admin.query(
      `SELECT d.datname,
              (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname) AS sessions
         FROM pg_database d
        WHERE d.datname LIKE $1
        ORDER BY d.datname`,
      [`${PREFIX}%`]
    );
    const candidates = rows.filter(r => isCandidate(r.datname));
    if (candidates.length === 0) {
      console.log(`[test:db:clean] nothing to drop on ${new URL(url).host}.`);
      return;
    }
    // A run in progress holds sessions on its WORKER databases, not on the
    // template it cloned them from — so a template whose sibling workers are
    // busy belongs to a live run too, and stays.
    const busyBases = new Set(
      candidates
        .filter(r => Number(r.sessions) > 0)
        .map(r => r.datname.replace(/_(w\d+|tmpl)_test$/, ''))
    );
    for (const { datname, sessions } of candidates) {
      const base = datname.replace(/_(w\d+|tmpl)_test$/, '');
      if (Number(sessions) > 0 || (isDerivedTestDbName(datname) && busyBases.has(base))) {
        const why = Number(sessions) > 0
          ? `${sessions} active session(s) — a run is using it`
          : 'its worker databases are in use — a run is using it';
        console.log(`  skip  ${datname} (${why})`);
        skipped++;
        continue;
      }
      if (dryRun) {
        console.log(`  would drop ${datname}`);
        continue;
      }
      await admin.query(`DROP DATABASE IF EXISTS "${datname}"`);
      console.log(`  dropped ${datname}`);
      dropped++;
    }
    console.log(
      dryRun
        ? `[test:db:clean] dry run: ${candidates.length - skipped} database(s) would be dropped, ${skipped} skipped.`
        : `[test:db:clean] dropped ${dropped}, skipped ${skipped}.`
    );
  } finally {
    await admin.end();
  }
}

main().catch(err => {
  console.error(`[test:db:clean] failed: ${err.message}`);
  process.exit(1);
});
