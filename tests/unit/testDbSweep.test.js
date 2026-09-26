'use strict';

// The test-database sweep's pure half (tests/lib/testDbSweep.js): the strict
// name regexes, label parsing, classification and — above all — which
// databases each mode drops. The real-Postgres half is
// tests/integration/testDbSweep.test.js.
const {
  jestNameRe, e2eNameRe, runRootOf, parseLabel, classify, planSweep,
  JEST_MAX_AGE_MS, E2E_MAX_IDLE_MS, UNLABELLED_MAX_AGE_MS,
} = require('../lib/testDbSweep');

const P = 'zz';
const NOW = Date.parse('2026-09-26T12:00:00Z');
const HOST = 'this-host';
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const MIN = 60 * 1000;

const label = (over = {}) => JSON.stringify({
  kind: 'jest', product: P, repo: '/repo/wt', branch: 'feat/x', pid: 100, host: HOST, createdAt: iso(5 * MIN), ...over,
});

function ctx(over = {}) {
  return {
    mode: 'rules',
    prefixes: [P],
    product: P,
    now: NOW,
    host: HOST,
    isPidAlive: (pid) => pid === 100,
    branchExists: (b) => b === 'feat/x',
    pathExists: (p) => p === '/repo/wt',
    ...over,
  };
}

const decide = (dbs, over) => Object.fromEntries(planSweep(dbs, ctx(over)).map((p) => [p.name, p.drop]));

describe('name regexes', () => {
  test('Jest names: template, workers, extras, with or without a scope', () => {
    const re = jestNameRe(P);
    for (const n of ['zz_tmpl_test', 'zz_w1_test', 'zz_feat_x_w2_test', 'zz_feat_x_tmpl_test', 'zz_a_w3_demo1_test']) {
      expect(re.test(n)).toBe(true);
    }
    for (const n of [
      'zz_test', 'zz_feat_x_test', 'zz_feat_x_w2', 'zz_feat_x_w2_test_', 'zz', 'zzz_w1_test', 'yy_w1_test',
      'zz_feat_x_w2_toolongsuffix1_test', 'zz__w1_test', 'ZZ_w1_test', 'zz_w1_test; DROP', 'zz_e2e_x_test',
    ]) {
      expect(re.test(n)).toBe(false);
    }
  });
  test('e2e names', () => {
    const re = e2eNameRe(P);
    expect(re.test('zz_e2e_test')).toBe(true);
    expect(re.test('zz_e2e_feat_x_test')).toBe(true);
    expect(re.test('zz_e2e')).toBe(false);
    expect(re.test('zz_e2e_x_test2')).toBe(false);
    expect(re.test('yy_e2e_x_test')).toBe(false);
  });
  test('regex metacharacters in a prefix are literal', () => {
    expect(jestNameRe('a.b').test('axb_w1_test')).toBe(false);
  });
  test('runRootOf strips the run infix', () => {
    expect(runRootOf('zz_feat_x_w2_test')).toBe('zz_feat_x');
    expect(runRootOf('zz_feat_x_tmpl_test')).toBe('zz_feat_x');
    expect(runRootOf('zz_feat_x_w2_demo_test')).toBe('zz_feat_x');
  });
});

describe('parseLabel / classify', () => {
  test('our JSON is a label; any other comment is foreign; none is empty', () => {
    expect(parseLabel(label()).label.kind).toBe('jest');
    expect(parseLabel('hand-made note')).toEqual({ foreign: true });
    expect(parseLabel('{"kind":"other"}')).toEqual({ foreign: true });
    expect(parseLabel(null)).toEqual({});
    expect(parseLabel('')).toEqual({});
  });
  test('classify: outside the prefixes or without _test is never a candidate', () => {
    expect(classify('zz_w1_test', [P])).toEqual({ kind: 'jest', prefix: P });
    expect(classify('zz_e2e_x_test', [P])).toEqual({ kind: 'e2e', prefix: P });
    expect(classify('zz_w1_test', ['yy'])).toBeNull();
    expect(classify('zz_w1', [P])).toBeNull();
    expect(classify('zz_books', [P])).toBeNull();
  });
  test('a name shaped like both follows its label, else counts as e2e (longer retention)', () => {
    expect(classify('zz_e2e_x_w1_test', [P])).toEqual({ kind: 'e2e', prefix: P });
    expect(classify('zz_e2e_x_w1_test', [P], { kind: 'jest' })).toEqual({ kind: 'jest', prefix: P });
  });
});

describe('planSweep — safety (every mode)', () => {
  const modes = ['rules', 'all', 'gone', 'base'];
  test.each(modes)('%s: a database with a session is never dropped', (mode) => {
    const d = decide([{ name: 'zz_old_w1_test', sessions: 2, comment: label({ pid: 9, createdAt: iso(99 * 24 * 60 * MIN) }) }],
      { mode, base: 'zz_old_test', includeE2e: true, knownJestRoots: new Set(), knownE2eNames: new Set() });
    expect(d.zz_old_w1_test).not.toBe(true);
  });
  test.each(modes)('%s: names outside the product prefix or not ending in _test never appear', (mode) => {
    const plan = planSweep([
      { name: 'orangesmiley_books', sessions: 0, comment: null, ageMs: 1e12 },
      { name: 'yy_old_w1_test', sessions: 0, comment: null, ageMs: 1e12 },
      { name: 'zz_old_w1', sessions: 0, comment: null, ageMs: 1e12 },
      { name: 'zz_dev', sessions: 0, comment: null, ageMs: 1e12 },
    ], ctx({ mode, base: 'zz_old_test', includeE2e: true, knownJestRoots: new Set(), knownE2eNames: new Set() }));
    expect(plan).toEqual([]);
  });
  test('a template whose sibling worker is busy stays (the run is live)', () => {
    const d = decide([
      { name: 'zz_b_tmpl_test', sessions: 0, comment: label({ pid: 9 }) },
      { name: 'zz_b_w1_test', sessions: 1, comment: label({ pid: 9 }) },
    ], { mode: 'all' });
    expect(d).toEqual({ zz_b_tmpl_test: false, zz_b_w1_test: false });
  });
  test('a foreign comment or another product\'s label keeps the database', () => {
    const d = decide([
      { name: 'zz_a_w1_test', sessions: 0, comment: 'somebody\'s notes', ageMs: 1e12 },
      { name: 'zz_c_w1_test', sessions: 0, comment: label({ product: 'rk', pid: 9 }) },
    ], { mode: 'all' });
    expect(d).toEqual({ zz_a_w1_test: false, zz_c_w1_test: false });
  });
});

describe('planSweep — rules (every npm test)', () => {
  test('Jest: dead owner on this host → drop; live owner → keep; over 6 h → drop', () => {
    const d = decide([
      { name: 'zz_dead_w1_test', sessions: 0, comment: label({ pid: 9 }) },
      { name: 'zz_live_w1_test', sessions: 0, comment: label({ pid: 100 }) },
      { name: 'zz_old_w1_test', sessions: 0, comment: label({ pid: 100, createdAt: iso(JEST_MAX_AGE_MS + MIN) }) },
      { name: 'zz_away_w1_test', sessions: 0, comment: label({ pid: 9, host: 'other' }) },
    ]);
    expect(d).toEqual({ zz_dead_w1_test: true, zz_live_w1_test: false, zz_old_w1_test: true, zz_away_w1_test: false });
  });
  test('Jest KEEP_TEST_DB: kept despite a dead owner, until 6 h', () => {
    const d = decide([
      { name: 'zz_k_w1_test', sessions: 0, comment: label({ pid: 9, keep: true }) },
      { name: 'zz_k2_w1_test', sessions: 0, comment: label({ pid: 9, keep: true, createdAt: iso(JEST_MAX_AGE_MS + MIN) }) },
    ]);
    expect(d).toEqual({ zz_k_w1_test: false, zz_k2_w1_test: true });
  });
  test('e2e: branch AND worktree gone → drop; either still there → keep; 14 d unused → drop', () => {
    const e2e = (over) => label({ kind: 'e2e', lastUsedAt: iso(MIN), ...over });
    const d = decide([
      { name: 'zz_e2e_gone_test', sessions: 0, comment: e2e({ branch: 'feat/gone', repo: '/repo/gone' }) },
      { name: 'zz_e2e_branch_test', sessions: 0, comment: e2e({ branch: 'feat/x', repo: '/repo/gone' }) },
      { name: 'zz_e2e_tree_test', sessions: 0, comment: e2e({ branch: 'feat/gone', repo: '/repo/wt' }) },
      { name: 'zz_e2e_idle_test', sessions: 0, comment: e2e({ lastUsedAt: iso(E2E_MAX_IDLE_MS + MIN) }) },
      { name: 'zz_e2e_away_test', sessions: 0, comment: e2e({ branch: 'feat/gone', repo: '/repo/gone', host: 'other' }) },
    ]);
    expect(d).toEqual({
      zz_e2e_gone_test: true, zz_e2e_branch_test: false, zz_e2e_tree_test: false,
      zz_e2e_idle_test: true, zz_e2e_away_test: false,
    });
  });
  test('unlabelled: Jest names over 24 h go, e2e over 14 d; unknown age stays', () => {
    const d = decide([
      { name: 'zz_u_w1_test', sessions: 0, comment: null, ageMs: UNLABELLED_MAX_AGE_MS + MIN },
      { name: 'zz_v_w1_test', sessions: 0, comment: null, ageMs: UNLABELLED_MAX_AGE_MS - MIN },
      { name: 'zz_w_w1_test', sessions: 0, comment: null, ageMs: null },
      { name: 'zz_e2e_u_test', sessions: 0, comment: null, ageMs: UNLABELLED_MAX_AGE_MS + MIN },
      { name: 'zz_e2e_v_test', sessions: 0, comment: null, ageMs: E2E_MAX_IDLE_MS + MIN },
    ]);
    expect(d).toEqual({
      zz_u_w1_test: true, zz_v_w1_test: false, zz_w_w1_test: false, zz_e2e_u_test: false, zz_e2e_v_test: true,
    });
  });
});

describe('planSweep — all (npm run test:db:clean, today\'s scope)', () => {
  test('every idle Jest name; e2e only with --e2e; a live owner\'s run stays', () => {
    const dbs = [
      { name: 'zz_a_w1_test', sessions: 0, comment: null },
      { name: 'zz_b_w1_test', sessions: 0, comment: label({ pid: 100 }) },
      { name: 'zz_e2e_a_test', sessions: 0, comment: null },
    ];
    expect(decide(dbs, { mode: 'all' })).toEqual({ zz_a_w1_test: true, zz_b_w1_test: false });
    expect(decide(dbs, { mode: 'all', includeE2e: true }))
      .toEqual({ zz_a_w1_test: true, zz_b_w1_test: false, zz_e2e_a_test: true });
  });
});

describe('planSweep — gone (after a merge)', () => {
  test('labels first, then slugs against local branches and worktrees', () => {
    const d = decide([
      { name: 'zz_feat_x_w1_test', sessions: 0, comment: null },
      { name: 'zz_feat_old_w1_test', sessions: 0, comment: null },
      { name: 'zz_w1_test', sessions: 0, comment: null },
      { name: 'zz_e2e_feat_x_test', sessions: 0, comment: null },
      { name: 'zz_e2e_feat_old_test', sessions: 0, comment: null },
      { name: 'zz_lab_w1_test', sessions: 0, comment: label({ pid: 9, branch: 'feat/gone', repo: '/repo/gone' }) },
      { name: 'zz_lab2_w1_test', sessions: 0, comment: label({ pid: 9, branch: 'feat/x', repo: '/repo/gone' }) },
      { name: 'zz_lab3_w1_test', sessions: 0, comment: label({ pid: 9, branch: 'feat/gone', repo: '/repo/listed' }) },
    ], {
      mode: 'gone',
      knownJestRoots: new Set(['zz_feat_x']),
      knownE2eNames: new Set(['zz_e2e_feat_x_test']),
      worktreePaths: ['/repo/listed'],
    });
    expect(d).toEqual({
      zz_feat_x_w1_test: false, zz_feat_old_w1_test: true, zz_w1_test: false,
      zz_e2e_feat_x_test: false, zz_e2e_feat_old_test: true,
      zz_lab_w1_test: true, zz_lab2_w1_test: false, zz_lab3_w1_test: false,
    });
  });
});

describe('planSweep — base (the interrupted run)', () => {
  test('only that base\'s run names, only the owner pid\'s (or unlabelled)', () => {
    const d = decide([
      { name: 'zz_feat_x_tmpl_test', sessions: 0, comment: label({ pid: 55 }) },
      { name: 'zz_feat_x_w1_test', sessions: 0, comment: label({ pid: 55 }) },
      { name: 'zz_feat_x_w1_demo_test', sessions: 0, comment: null },
      { name: 'zz_feat_x_w2_test', sessions: 0, comment: label({ pid: 66 }) },
      { name: 'zz_feat_xy_w1_test', sessions: 0, comment: label({ pid: 55 }) },
      { name: 'zz_e2e_feat_x_test', sessions: 0, comment: null },
    ], { mode: 'base', base: 'zz_feat_x_test', ownerPid: 55 });
    expect(d).toEqual({
      zz_feat_x_tmpl_test: true, zz_feat_x_w1_test: true, zz_feat_x_w1_demo_test: true, zz_feat_x_w2_test: false,
    });
  });
});
