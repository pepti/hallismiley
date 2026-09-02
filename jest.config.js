// `test:ci` passes --max-old-space-size=8192 on the MAIN process, which merges
// the per-suite coverage maps. History: the suite used to run in ONE process
// (--runInBand, forced by --detectOpenHandles) and the accumulated coverage
// map is what OOMs when a suite this size is measured serially — the OOM
// lands after "Ran all test suites" while the report is written, so the
// summary reads green and the job exits 134. Since the per-worker-DB rework
// (ported from icelandicstore, ice #225/#233) the suites run in parallel
// workers, each with its own database (tests/workerDb.js), which both cuts
// the wall-clock and moves per-suite state into short-lived worker heaps; the
// 8 GB headroom on the merge process is kept as belt and braces. If a red run
// ever shows no failing test, check for exit 134 before assuming a defect.
const path = require('path');

// Regex-escape the absolute root dir so it can anchor testPathIgnorePatterns.
// On Windows a raw `<rootDir>` interpolation injects backslashes that corrupt
// the regex (`C:\Users\…` → `\U` is read as an escape), silently disabling the
// pattern — which is how worktree phantom tests kept being globbed.
const ESCAPED_ROOT = path.resolve(__dirname).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEP = '[\\\\/]'; // match both separators

module.exports = {
  testEnvironment:  'node',
  globalSetup:      './tests/globalSetup.js',
  globalTeardown:   './tests/globalTeardown.js',
  setupFiles:       ['./tests/env.js'],
  // NOTE: do NOT add a setupFilesAfterEnv afterAll that pool.end()s the app
  // pool — the app has fire-and-forget writes (analytics, event log) that can
  // land after the last test, and ending the pool under them fails the suite
  // with "Cannot use a pool after calling end on the pool" (16 suites in ice's
  // first parallel validation run). Connection release is handled by the 1s
  // DB_POOL_IDLE_MS in tests/env.js instead.
  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/integration/**/*.test.js',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    // Ignore worktrees nested under the CURRENT root only (`.claude/worktrees/*`
    // and `.wt/*`). Anchoring on the escaped absolute root means that when Jest
    // runs from inside a worktree the patterns match nothing inside the
    // worktree itself — they only filter parallel worktrees that are children
    // of the current root. A bare '/.wt/' pattern would instead match every
    // absolute path under .wt/*, ignoring a worktree's own tests when run from
    // inside it. Without these, running Jest from the main checkout globs
    // stale test copies from sibling feature branches (phantom failures);
    // CI is unaffected (fresh checkout has no worktrees), which masked it.
    ESCAPED_ROOT + SEP + '\\.claude' + SEP,
    ESCAPED_ROOT + SEP + '\\.wt' + SEP,
  ],
  // 45s, not 30: on a contended 2-vCPU CI runner with 4 workers a healthy
  // suite's slowest tests approach the old ceiling and a green run turns red
  // with no failing test (ice #233).
  testTimeout:      45000,
  forceExit:        true,
  // Parallel workers, each against its OWN database (tests/env.js derives
  // <base>_w<JEST_WORKER_ID>_test; tests/globalSetup.js provisions one DB per
  // worker) — suites are unsafe against a SHARED database (fixed fixture ids,
  // TRUNCATE … CASCADE, the app_settings singleton), so isolation comes from
  // the per-worker DB, not from serial order. Within a worker, suites still
  // run one at a time.
  //
  // 4 is a deliberate fixed number, not '50%'. A private-repo ubuntu-latest
  // runner is 2 vCPU / 7 GB (ci.yml prints `nproc` on every run — read it
  // before touching this number, and A/B any change in ONE job; across-run
  // comparison is noise on a shared runner). The Postgres connection budget is
  // the real hard ceiling — each suite file creates its own app pool (max 10),
  // so N workers can briefly hold several suites' pools open at once. 4 stays
  // comfortably inside Postgres's default max_connections=100; a big dev
  // machine at '50%' (8+ workers) would not.
  // Serial fallback for debugging: `npm test -- --runInBand`.
  maxWorkers:       4,
  verbose:          true,
  // Transform ESM-only packages so Jest can require() them in the CJS test
  // environment. Two families live here:
  //  • lucia / oslo — auth stack, ESM-only since we adopted it.
  //  • htmlparser2 and its dom* / entities deps — pulled in by sanitize-html.
  //    sanitize-html 2.17.5+ moved to htmlparser2 12, which ships ESM only.
  //    Without these entries every suite that loads the sanitize middleware
  //    (i.e. anything requiring server/app.js) dies with
  //    "Cannot use import statement outside a module".
  transformIgnorePatterns: [
    'node_modules/(?!(lucia|@lucia-auth|oslo|@oslojs|htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities)/)',
  ],
  // Coverage configuration
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/scripts/**',
    '!server/migrations/**',
  ],
  // Coverage floor: pre-i18n the suite sat comfortably above 70%. The P0-P3
  // i18n / SEO overhaul added ~1,500 lines of new server code (validation
  // refactor, server-side t() helper, ssrMeta middleware, locale-aware
  // controllers) which temporarily pulled the global number to ~64%. Keep
  // ratcheting the floor upward as we land follow-up tests — eventual target
  // is back to 70.
  //
  // GLOBAL FLOOR ONLY — no per-file thresholds. The per-file entries that used
  // to sit here (authController 88, google/facebookAuthController 80) are a
  // false-red source under --forceExit: the coverage flush can be cut off with
  // DB-pool / fs-watch handles still open, moving per-file numbers by a few
  // points run-to-run, so CI goes red with every test passing (ice #224). The
  // auth surfaces keep their dedicated integration suites, and a genuine
  // coverage collapse still trips the global floor. Don't re-add per-file
  // gates without fixing the flush variance first.
  coverageThreshold: {
    global: {
      lines: 62,
    },
  },
};
