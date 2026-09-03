'use strict';

// Test-database naming (tests/workerDb.js): per-branch base + per-worker
// derivation. The contract that matters most is the `_test` suffix — every
// derived name must keep it, because globalSetup/globalTeardown refuse to
// drop anything else — and the 63-byte Postgres identifier cap, which
// Postgres would otherwise enforce by truncating silently.
const {
  DEFAULT_TEST_DATABASE_URL,
  slugify,
  branchSlug,
  scopedTestDbName,
  resolveTestBaseUrl,
  workerDbUrl,
  templateDbName,
  adminDbUrl,
  isDerivedTestDbName,
} = require('../workerDb');

const BASE = 'orangesmiley_test';

describe('slugify', () => {
  test('lower-cases and folds every non-alphanumeric run to one underscore', () => {
    expect(slugify('feat/Harvest-H2')).toBe('feat_harvest_h2');
    expect(slugify('claude/intelligent-edison-8d0da6')).toBe('claude_intelligent_edison_8d0da6');
    expect(slugify('  a--b__c  ')).toBe('a_b_c');
  });
  test('is empty for empty / nullish input', () => {
    expect(slugify('')).toBe('');
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
  });
});

describe('branchSlug', () => {
  test('slugs the branch git reports', () => {
    expect(branchSlug(() => 'feat/sales-handbook-reader\n')).toBe('feat_sales_handbook_reader');
  });
  test('is empty on a detached HEAD or when git is unavailable', () => {
    expect(branchSlug(() => 'HEAD\n')).toBe('');
    expect(branchSlug(() => '')).toBe('');
    expect(branchSlug(() => { throw new Error('not a git repository'); })).toBe('');
  });
});

describe('scopedTestDbName', () => {
  test('inserts the scope before the _test suffix', () => {
    expect(scopedTestDbName(BASE, 'feat_harvest_h2')).toBe('orangesmiley_feat_harvest_h2_test');
  });
  test('slugs a raw branch name', () => {
    expect(scopedTestDbName(BASE, 'r1/Brand-Core')).toBe('orangesmiley_r1_brand_core_test');
  });
  test('returns the base unchanged for an empty scope', () => {
    expect(scopedTestDbName(BASE, '')).toBe(BASE);
    expect(scopedTestDbName(BASE, '---')).toBe(BASE);
  });
  test('refuses a base that does not end in _test', () => {
    expect(() => scopedTestDbName('orangesmiley', 'x')).toThrow(/must end in _test/);
  });
  test('trims a long scope so the longest derived name still fits 63 bytes', () => {
    const scoped = scopedTestDbName(BASE, 'x'.repeat(200));
    expect(scoped.endsWith('_test')).toBe(true);
    expect(templateDbName(scoped).length).toBeLessThanOrEqual(63);
    expect(workerDbUrl(4, `postgresql://u:p@h/${scoped}`).name.length).toBeLessThanOrEqual(63);
    // Room = 63 - 'orangesmiley'(12) - '_'(1) - '_tmpl'(5) - '_test'(5) = 40.
    expect(scoped).toBe(`orangesmiley_${'x'.repeat(40)}_test`);
  });
  test('never leaves a dangling underscore at the trim point', () => {
    const scope = `${'a'.repeat(39)}_bbbbbbbb`; // cut lands right after the `_`
    expect(scopedTestDbName(BASE, scope)).toBe(`orangesmiley_${'a'.repeat(39)}_test`);
  });
});

describe('workerDbUrl', () => {
  test('inserts the worker id BEFORE the _test suffix and keeps the connection details', () => {
    const { url, name } = workerDbUrl(2, 'postgresql://user:pw@db.local:5433/orangesmiley_feat_x_test');
    expect(name).toBe('orangesmiley_feat_x_w2_test');
    expect(url).toBe('postgresql://user:pw@db.local:5433/orangesmiley_feat_x_w2_test');
  });
  test('refuses a base that does not end in _test', () => {
    expect(() => workerDbUrl(1, 'postgresql://u:p@localhost/orangesmiley')).toThrow(/must end in _test/);
  });
});

describe('templateDbName / adminDbUrl / isDerivedTestDbName', () => {
  test('template keeps the suffix', () => {
    expect(templateDbName('orangesmiley_feat_x_test')).toBe('orangesmiley_feat_x_tmpl_test');
    expect(() => templateDbName('orangesmiley')).toThrow(/must end in _test/);
  });
  test('admin url targets the postgres database on the same server', () => {
    expect(adminDbUrl('postgresql://u:p@h:5433/orangesmiley_x_test')).toBe('postgresql://u:p@h:5433/postgres');
  });
  test('recognises only names this module derives', () => {
    expect(isDerivedTestDbName('orangesmiley_feat_x_w3_test')).toBe(true);
    expect(isDerivedTestDbName('orangesmiley_tmpl_test')).toBe(true);
    expect(isDerivedTestDbName('orangesmiley_feat_x_test')).toBe(false);
    expect(isDerivedTestDbName('orangesmiley_e2e_master_test')).toBe(false);
    expect(isDerivedTestDbName('orangesmiley')).toBe(false);
  });
});

describe('resolveTestBaseUrl', () => {
  test('TEST_DATABASE_URL is an explicit override, used verbatim', () => {
    const env = { TEST_DATABASE_URL: 'postgresql://a:b@ci:5432/orangesmiley_pr1_test' };
    expect(resolveTestBaseUrl(env, 'ignored_branch')).toEqual({
      url: env.TEST_DATABASE_URL,
      name: 'orangesmiley_pr1_test',
      source: 'TEST_DATABASE_URL',
    });
  });
  test('the override must still name a _test database', () => {
    expect(() => resolveTestBaseUrl({ TEST_DATABASE_URL: 'postgresql://a:b@h/orangesmiley' }))
      .toThrow(/must end in _test/);
  });
  test('otherwise borrows connection details from DATABASE_URL and scopes the name', () => {
    const env = { DATABASE_URL: 'postgresql://halli:secret@db.local:5433/orangesmiley' };
    expect(resolveTestBaseUrl(env, 'feat/harvest-h2')).toEqual({
      url: 'postgresql://halli:secret@db.local:5433/orangesmiley_feat_harvest_h2_test',
      name: 'orangesmiley_feat_harvest_h2_test',
      source: 'branch',
    });
  });
  test('falls back to the localhost default when nothing is configured', () => {
    // An empty scope here stands in for "no branch, no worktree name" — the
    // .env fallback is not exercised because the worktree may carry one.
    const { url, name, source } = resolveTestBaseUrl({ DATABASE_URL: DEFAULT_TEST_DATABASE_URL }, '');
    expect(url).toBe(DEFAULT_TEST_DATABASE_URL);
    expect(name).toBe(BASE);
    expect(source).toBe('unscoped');
  });
  test('derives a real scope from git when none is injected', () => {
    const { name, source } = resolveTestBaseUrl({ DATABASE_URL: DEFAULT_TEST_DATABASE_URL });
    expect(name).toMatch(/^orangesmiley(_[a-z0-9_]+)?_test$/);
    expect(['branch', 'worktree', 'unscoped']).toContain(source);
    expect(templateDbName(name).length).toBeLessThanOrEqual(63);
  });
});
