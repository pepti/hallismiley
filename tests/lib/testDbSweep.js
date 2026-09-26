// Test-database labels and the self-healing sweep (test-db-hygiene-2026-09-26).
//
// Shared by tests/globalSetup.js (a `rules` sweep inside the per-base advisory
// lock, before provisioning), tests/globalTeardown.js (labels, forced drops),
// e2e/global-setup.js (labels) and scripts/drop-test-dbs.js (every mode).
//
// Every test database is LABELLED when it is created:
//   COMMENT ON DATABASE … IS '{"kind":"jest"|"e2e","product","repo","branch",
//                              "pid","host","createdAt"[,"lastUsedAt"][,"keep"]}'
// so a later run can tell whose it is and whether its owner is still alive.
//
// Safety contract — every mode, no exceptions:
//   • only a name that is a DERIVED test name of one of the given product
//     prefixes (strict regexes below) is ever a candidate, and it ends in _test;
//   • a database with a session is never dropped (and the sweep's DROP has no
//     FORCE, so one that gains a session between the check and the drop makes
//     the DROP fail instead of killing the session);
//   • a template whose sibling workers are busy belongs to a live run and stays;
//   • a comment that is not our label, or a label for another product, keeps it.
//
// Plain stdout output, like the rest of the test tooling (no pino here).
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// A Jest database outlives its run only by accident: 6 h is far past any run.
const JEST_MAX_AGE_MS = 6 * HOUR;
// An e2e database is kept per branch on purpose and reused; 14 days unused = orphan.
const E2E_MAX_IDLE_MS = 14 * DAY;
// An unlabelled derived name predates labels (or its run died mid-create).
const UNLABELLED_MAX_AGE_MS = 24 * HOUR;

const RUN_INFIX_RE = /_(w\d+|tmpl)(_[a-z0-9]{1,12})?_test$/;

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `<p>_[<slug>_](w<N>|tmpl)[_<extra>]_test` — the Jest names of product prefix p. */
function jestNameRe(prefix) {
  return new RegExp(`^${escapeRe(prefix)}_(?:[a-z0-9]+(?:_[a-z0-9]+)*_)?(?:w\\d+|tmpl)(?:_[a-z0-9]{1,12})?_test$`);
}

/** `<p>_e2e[_<slug>]_test` — the Playwright names of product prefix p. */
function e2eNameRe(prefix) {
  return new RegExp(`^${escapeRe(prefix)}_e2e(?:_[a-z0-9]+)*_test$`);
}

/** The run root of a Jest name: `os_feat_x_w2_test` → `os_feat_x` (its base minus `_test`). */
function runRootOf(name) {
  return name.replace(RUN_INFIX_RE, '');
}

/**
 * Parse a database comment. Returns { label } for our JSON label, { foreign:
 * true } for any other non-empty comment, {} for none.
 */
function parseLabel(comment) {
  if (comment == null || comment === '') return {};
  try {
    const v = JSON.parse(comment);
    if (v && typeof v === 'object' && (v.kind === 'jest' || v.kind === 'e2e')) return { label: v };
  } catch { /* not ours */ }
  return { foreign: true };
}

/**
 * Which of our kinds a name is, for the first matching prefix:
 * { kind: 'jest'|'e2e', prefix } or null. A label decides when it names a kind
 * the name also fits; an unlabelled `<p>_e2e_…_w<N>_test` (shaped like both) is
 * treated as e2e — the longer retention is the safe side.
 */
function classify(name, prefixes, label) {
  if (typeof name !== 'string' || !name.endsWith('_test')) return null;
  for (const prefix of prefixes) {
    const isJest = jestNameRe(prefix).test(name);
    const isE2e = e2eNameRe(prefix).test(name);
    if (!isJest && !isE2e) continue;
    if (label && label.kind === 'jest' && isJest) return { kind: 'jest', prefix };
    if (label && label.kind === 'e2e' && isE2e) return { kind: 'e2e', prefix };
    if (isE2e) return { kind: 'e2e', prefix };
    return { kind: 'jest', prefix };
  }
  return null;
}

function ageFrom(iso, now) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? now - t : null;
}

function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (p) => {
    const r = path.resolve(String(p));
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

function fmtAge(ms) {
  if (ms == null) return 'age unknown';
  if (ms >= DAY) return `${(ms / DAY).toFixed(1)} d`;
  if (ms >= HOUR) return `${(ms / HOUR).toFixed(1)} h`;
  return `${Math.round(ms / 60000)} min`;
}

/**
 * Decide, per database, whether it goes. Pure — the unit tests drive it.
 *
 * dbs: [{ name, sessions, comment, ageMs }]  (ageMs: data-file age, or null)
 * ctx: {
 *   mode: 'rules' | 'all' | 'gone' | 'base',
 *   prefixes: ['os'],            product prefixes whose names are in scope
 *   product: 'os',               a label for another product keeps its DB
 *   now, host,
 *   isPidAlive(pid), branchExists(branch), pathExists(p),
 *   includeE2e,                  mode 'all': also the e2e names
 *   knownJestRoots, knownE2eNames, worktreePaths   mode 'gone' (Sets / array)
 *   base, ownerPid               mode 'base'
 * }
 * Returns [{ name, kind, drop, reason }] for every name in scope.
 */
function planSweep(dbs, ctx) {
  const now = ctx.now == null ? Date.now() : ctx.now;
  const products = new Set([ctx.product, ...(ctx.prefixes || [])]);
  const entries = [];
  for (const db of dbs) {
    const parsed = parseLabel(db.comment);
    const cls = classify(db.name, ctx.prefixes, parsed.label);
    if (!cls) continue; // never a candidate
    entries.push({ db, parsed, cls, sessions: Number(db.sessions) || 0 });
  }
  // A live run holds sessions on its WORKERS, not on the template it cloned
  // them from — any busy sibling protects the whole run.
  const busyRoots = new Set(
    entries.filter((e) => e.cls.kind === 'jest' && e.sessions > 0).map((e) => runRootOf(e.db.name))
  );

  const plan = [];
  for (const { db, parsed, cls, sessions } of entries) {
    const out = (drop, reason) => plan.push({ name: db.name, kind: cls.kind, drop, reason });
    if (sessions > 0) { out(false, `${sessions} active session(s)`); continue; }
    if (cls.kind === 'jest' && busyRoots.has(runRootOf(db.name))) {
      out(false, 'a sibling database is in use — a run is live'); continue;
    }
    if (parsed.foreign) { out(false, 'carries a comment that is not a test label'); continue; }
    const label = parsed.label;
    if (label && label.product && !products.has(label.product)) {
      out(false, `labelled for product "${label.product}"`); continue;
    }

    if (ctx.mode === 'base') {
      const re = new RegExp(`^${escapeRe(String(ctx.base).replace(/_test$/, ''))}_(w\\d+|tmpl)(_[a-z0-9]{1,12})?_test$`);
      if (cls.kind !== 'jest' || !re.test(db.name)) continue;
      if (label && ctx.ownerPid != null && Number(label.pid) !== Number(ctx.ownerPid)) {
        out(false, `owned by pid ${label.pid}, not ${ctx.ownerPid}`); continue;
      }
      out(true, `belongs to run ${ctx.base}`); continue;
    }

    if (ctx.mode === 'all') {
      if (cls.kind === 'e2e' && !ctx.includeE2e) continue;
      // Between two suites a live run's workers can hold no session for a
      // moment; the label says whether its owner is still running.
      if (cls.kind === 'jest' && label && !label.keep && label.host === ctx.host &&
          label.pid != null && ctx.isPidAlive(Number(label.pid))) {
        out(false, `owner pid ${label.pid} is still running`); continue;
      }
      out(true, cls.kind === 'e2e' ? 'e2e database (--e2e)' : 'derived Jest database'); continue;
    }

    if (ctx.mode === 'gone') {
      if (label) {
        if (label.host && label.host !== ctx.host) { out(false, `labelled on host ${label.host}`); continue; }
        const branchGone = !label.branch || !ctx.branchExists(label.branch);
        const worktreeGone = !label.repo ||
          (!(ctx.worktreePaths || []).some((p) => samePath(p, label.repo)) && !ctx.pathExists(label.repo));
        if (branchGone && worktreeGone) out(true, `branch "${label.branch}" and worktree gone`);
        else out(false, branchGone ? 'worktree still exists' : `branch "${label.branch}" exists`);
        continue;
      }
      if (cls.kind === 'jest') {
        const root = runRootOf(db.name);
        if (root === cls.prefix) { out(false, 'unscoped base — owner unknown'); continue; }
        if (ctx.knownJestRoots.has(root)) out(false, 'matches a local branch or worktree');
        else out(true, 'no local branch or worktree matches its slug');
      } else {
        if (db.name === `${cls.prefix}_e2e_test`) { out(false, 'unscoped base — owner unknown'); continue; }
        if (ctx.knownE2eNames.has(db.name)) out(false, 'matches a local branch');
        else out(true, 'no local branch matches its slug');
      }
      continue;
    }

    // mode 'rules' — what every Jest run does before it provisions.
    if (!label) {
      const limit = cls.kind === 'jest' ? UNLABELLED_MAX_AGE_MS : E2E_MAX_IDLE_MS;
      if (db.ageMs == null) out(false, 'unlabelled, age unknown (needs superuser)');
      else if (db.ageMs > limit) out(true, `unlabelled and ${fmtAge(db.ageMs)} old`);
      else out(false, `unlabelled, ${fmtAge(db.ageMs)} old`);
      continue;
    }
    if (cls.kind === 'jest') {
      const age = ageFrom(label.createdAt, now);
      if (age != null && age > JEST_MAX_AGE_MS) { out(true, `${fmtAge(age)} old`); continue; }
      if (label.keep) { out(false, 'kept (KEEP_TEST_DB) and under 6 h old'); continue; }
      if (label.host === ctx.host && label.pid != null && !ctx.isPidAlive(Number(label.pid))) {
        out(true, `owner pid ${label.pid} is gone`); continue;
      }
      out(false, 'owner run is live');
      continue;
    }
    // e2e
    const idle = ageFrom(label.lastUsedAt || label.createdAt, now);
    if (idle != null && idle > E2E_MAX_IDLE_MS) { out(true, `unused for ${fmtAge(idle)}`); continue; }
    if (label.host === ctx.host && label.branch && label.repo &&
        !ctx.branchExists(label.branch) && !ctx.pathExists(label.repo)) {
      out(true, `branch "${label.branch}" and worktree gone`); continue;
    }
    out(false, `used ${fmtAge(idle)} ago`);
  }
  return plan;
}

// ── git + process facts (the impure half) ──────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function git(args, cwd = REPO_ROOT) {
  try {
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, windowsHide: true,
    }).trim();
  } catch {
    return '';
  }
}

function gitToplevel(cwd = REPO_ROOT) { return git(['rev-parse', '--show-toplevel'], cwd) || cwd; }
function gitBranch(cwd = REPO_ROOT) {
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return b && b !== 'HEAD' ? b : '';
}
function localBranches(cwd = REPO_ROOT) {
  return new Set(git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], cwd).split(/\r?\n/).filter(Boolean));
}
/** [{ path, branch }] from `git worktree list --porcelain`. */
function worktrees(cwd = REPO_ROOT) {
  const out = [];
  let cur = null;
  for (const line of git(['worktree', 'list', '--porcelain'], cwd).split(/\r?\n/)) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: '' }; out.push(cur); }
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
  }
  return out;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, just not ours to signal
  }
}

/** The label a database gets at creation. `pid` is the Jest MAIN process's. */
function buildLabel(kind, extra = {}) {
  const now = new Date().toISOString();
  const { PRODUCT } = require('../workerDb');
  return {
    kind,
    product: PRODUCT,
    repo: gitToplevel(),
    branch: gitBranch(),
    pid: Number(process.env.TEST_DB_OWNER_PID) || process.pid,
    host: os.hostname(),
    createdAt: now,
    ...extra,
  };
}

// ── SQL helpers ─────────────────────────────────────────────────────────────

async function labelDatabase(client, name, label) {
  const { rows } = await client.query(
    "SELECT format('COMMENT ON DATABASE %I IS %L', $1::text, $2::text) AS sql",
    [name, JSON.stringify(label)]
  );
  await client.query(rows[0].sql);
}

async function readLabel(client, name) {
  const { rows } = await client.query(
    "SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1",
    [name]
  );
  return rows.length ? parseLabel(rows[0].comment).label || null : null;
}

let forceSupported = null;
async function supportsForce(client) {
  if (forceSupported == null) {
    const { rows } = await client.query('SHOW server_version_num');
    forceSupported = Number(rows[0].server_version_num) >= 130000;
  }
  return forceSupported;
}

/**
 * DROP a test database even while sessions hold it (teardown, a failed
 * migration). WITH (FORCE) on PG ≥ 13; before that, terminate + retry.
 * Refuses any name not ending in _test.
 */
async function forceDropDatabase(client, name) {
  if (!/_test$/.test(name)) {
    throw new Error(`Refusing to drop DB "${name}" — name must end in _test for safety.`);
  }
  if (await supportsForce(client)) {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    return;
  }
  for (let attempt = 1; ; attempt++) {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [name]
    );
    try {
      await client.query(`DROP DATABASE IF EXISTS "${name}"`);
      return;
    } catch (err) {
      if (attempt < 5 && /being accessed by other users/i.test(err.message)) {
        await new Promise((r) => setTimeout(r, 100 * attempt));
        continue;
      }
      throw err;
    }
  }
}

function likePrefix(prefix) {
  return `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}\\_%`;
}

/**
 * Every database whose name starts with `<prefix>_` for one of the prefixes:
 * [{ name, sessions, comment, ageMs }]. ageMs comes from the PG_VERSION file's
 * modification time (pg_stat_file — superuser or pg_read_server_files); null
 * when that is not permitted.
 */
async function listTestDbs(client, prefixes) {
  const { rows } = await client.query(
    `SELECT d.datname AS name, d.oid,
            shobj_description(d.oid, 'pg_database') AS comment,
            (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname) AS sessions
       FROM pg_database d
      WHERE d.datname LIKE ANY($1::text[]) AND NOT d.datistemplate
      ORDER BY d.datname`,
    [prefixes.map(likePrefix)]
  );
  let ages = new Map();
  if (rows.length) {
    try {
      const r = await client.query(
        `SELECT d.datname AS name,
                extract(epoch FROM now() - (pg_stat_file('base/' || d.oid || '/PG_VERSION', true)).modification) * 1000 AS age_ms
           FROM pg_database d WHERE d.datname = ANY($1::text[])`,
        [rows.map((r0) => r0.name)]
      );
      ages = new Map(r.rows.map((x) => [x.name, x.age_ms == null ? null : Number(x.age_ms)]));
    } catch { /* not permitted: the unlabelled rule skips */ }
  }
  return rows.map((r) => ({
    name: r.name, sessions: Number(r.sessions), comment: r.comment, ageMs: ages.has(r.name) ? ages.get(r.name) : null,
  }));
}

/**
 * List, plan and (unless dryRun) drop. Drops never use FORCE and never throw:
 * a failure is reported in the returned plan (`error`). Returns the plan.
 */
async function runSweep(client, { dryRun = false, log = () => {}, ...ctxIn }) {
  const ctx = {
    now: Date.now(),
    host: os.hostname(),
    isPidAlive,
    pathExists: (p) => { try { return fs.existsSync(p); } catch { return true; } },
    ...ctxIn,
  };
  if (!ctx.branchExists) {
    const branches = localBranches();
    ctx.branchExists = (b) => branches.has(b);
  }
  const dbs = await listTestDbs(client, ctx.prefixes);
  const plan = planSweep(dbs, ctx);
  for (const p of plan) {
    if (!p.drop) continue;
    if (dryRun) { log(`would drop ${p.name} (${p.reason})`); continue; }
    try {
      await client.query(`DROP DATABASE IF EXISTS "${p.name}"`);
      p.dropped = true;
      log(`dropped ${p.name} (${p.reason})`);
    } catch (err) {
      p.error = err.message;
      log(`could not drop ${p.name}: ${err.message}`);
    }
  }
  return plan;
}

module.exports = {
  JEST_MAX_AGE_MS,
  E2E_MAX_IDLE_MS,
  UNLABELLED_MAX_AGE_MS,
  jestNameRe,
  e2eNameRe,
  runRootOf,
  parseLabel,
  classify,
  planSweep,
  isPidAlive,
  gitToplevel,
  gitBranch,
  localBranches,
  worktrees,
  buildLabel,
  labelDatabase,
  readLabel,
  forceDropDatabase,
  listTestDbs,
  runSweep,
};
