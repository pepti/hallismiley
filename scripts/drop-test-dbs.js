#!/usr/bin/env node
// Drop the throwaway test databases the suites leave behind.
//
// tests/globalTeardown.js drops a run's own set, globalSetup's sweep drops
// what dead runs left (tests/lib/testDbSweep.js), and this script is the
// manual handle on the same machinery. It only ever considers DERIVED test
// names of this product (engine.json `product`: `<p>_…_w<N>_test`,
// `<p>_…_tmpl_test`, `<p>_e2e_…_test`), never a database with a session, never
// a name that does not end in `_test`.
//
// Today's scope (drops without asking, as it always has):
//   npm run test:db:clean                 every Jest-derived database of this product
//   npm run test:db:clean -- --e2e        … and the Playwright ones
//   npm run test:db:clean -- --dry-run    list them, drop nothing
//
// Wider modes — a DRY RUN that prints the plan unless --yes is given:
//   --sweep            the rules every `npm test` applies (dead owner / 6 h,
//                      e2e branch+worktree gone / 14 d unused, unlabelled 24 h)
//   --gone             databases whose branch is gone: local branches + `git
//                      worktree list`, matched by label first, then by slug
//                      (after a merge: git worktree remove, git branch -d, then
//                      `npm run test:db:clean -- --gone --yes`)
//   --legacy           also the pre-2026-09-26 `orangesmiley_*` names — shared
//                      by every downstream repo that has not synced yet, so
//                      look at the plan before adding --yes
//   --base <name> [--owner-pid <pid>] [--wait]
//                      one run's set (`<name>` = its base, e.g. os_master_test);
//                      what globalSetup's Ctrl-C handler spawns. --wait gives
//                      the dying run's sessions up to 30 s to go away.
//   --yes              actually drop (wider modes)
//
// Server + credentials come from the same resolution as `npm test`
// (TEST_DATABASE_URL, else TEST_PG_URL, else DATABASE_URL / .env, else
// localhost). To clean another server, point TEST_PG_URL at it for the one
// command: `TEST_PG_URL=postgres://postgres:…@localhost:5432 npm run
// test:db:clean -- --sweep`.
const { Pool } = require('pg');
const {
  PRODUCT, LEGACY_PREFIX, resolveTestBaseUrl, adminDbUrl, scopedTestDbName, e2eTestDbName, slugify,
} = require('../tests/workerDb');
const { checkTarget } = require('../server/scripts/targetGuard');
const sweep = require('../tests/lib/testDbSweep');
const path = require('path');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const valueOf = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const legacy = flag('--legacy');
const base = valueOf('--base');
const ownerPid = valueOf('--owner-pid');
const mode = base ? 'base' : flag('--gone') ? 'gone' : flag('--sweep') ? 'rules' : 'all';
const wider = mode !== 'all' || legacy;
const dryRun = flag('--dry-run') || (wider && !flag('--yes'));
const prefixes = legacy ? [PRODUCT, LEGACY_PREFIX] : [PRODUCT];
const out = (m) => console.log(`  ${m}`);

// Names this repo's branches and worktrees would derive, per prefix — the
// --gone fallback for databases without a label.
function knownNames() {
  const branches = sweep.localBranches();
  const trees = sweep.worktrees();
  const scopes = new Set([...branches].map(slugify));
  for (const t of trees) {
    if (t.branch) scopes.add(slugify(t.branch));
    scopes.add(slugify(path.basename(t.path))); // detached-HEAD fallback
  }
  const knownJestRoots = new Set();
  const knownE2eNames = new Set();
  for (const p of prefixes) {
    for (const s of scopes) {
      if (!s) continue;
      knownJestRoots.add(scopedTestDbName(`${p}_test`, s).replace(/_test$/, ''));
      // Legacy names were trimmed with the pre-2026-09-26 reserve (5, `_tmpl`).
      if (p === LEGACY_PREFIX) knownJestRoots.add(scopedTestDbName(`${p}_test`, s, 5).replace(/_test$/, ''));
      knownE2eNames.add(e2eTestDbName(s, p));
    }
  }
  return { branches, knownJestRoots, knownE2eNames, worktreePaths: trees.map((t) => t.path) };
}

async function waitForSessions(admin, pattern) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const { rows } = await admin.query(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname ~ $1', [pattern.source]
    );
    if (rows[0].n === 0) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
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
  const host = new URL(url).host;
  const admin = new Pool({ connectionString: adminDbUrl(url) });
  try {
    const client = await admin.connect();
    try {
      const ctx = { mode, prefixes, product: PRODUCT, includeE2e: flag('--e2e'), dryRun, log: out };
      if (mode === 'base') {
        ctx.base = base;
        ctx.ownerPid = ownerPid != null ? Number(ownerPid) : null;
        if (flag('--wait')) {
          const { runDbPattern } = require('../tests/workerDb');
          await waitForSessions(client, runDbPattern(base));
        }
      }
      if (mode === 'gone') {
        const k = knownNames();
        Object.assign(ctx, k, { branchExists: (b) => k.branches.has(b) });
      }
      console.log(
        `[test:db:clean] ${host} — mode ${mode}${legacy ? ' + legacy' : ''}, prefixes ${prefixes.join(', ')}` +
        `${dryRun ? ' (dry run)' : ''}`
      );
      if (legacy) {
        console.log(`  note: ${LEGACY_PREFIX}_* names are shared by every downstream that has not synced the product prefix yet.`);
      }
      const plan = await sweep.runSweep(client, ctx);
      for (const p of plan.filter((x) => !x.drop)) out(`keep  ${p.name} (${p.reason})`);
      const drops = plan.filter((x) => x.drop);
      const dropped = drops.filter((x) => x.dropped).length;
      const failed = drops.filter((x) => x.error).length;
      console.log(
        dryRun
          ? `[test:db:clean] dry run: ${drops.length} would be dropped, ${plan.length - drops.length} kept.` +
            (wider && !flag('--dry-run') ? ' Add --yes to drop them.' : '')
          : `[test:db:clean] dropped ${dropped}, kept ${plan.length - drops.length}${failed ? `, FAILED ${failed}` : ''}.`
      );
      if (failed) process.exitCode = 1;
    } finally {
      client.release();
    }
  } finally {
    await admin.end();
  }
}

main().catch((err) => {
  console.error(`[test:db:clean] failed: ${err.message}`);
  process.exit(1);
});
