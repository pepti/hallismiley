'use strict';

// Test-database naming (tests/workerDb.js): per-product prefix, per-branch
// base, per-worker derivation. The contract that matters most is the `_test`
// suffix — every derived name must keep it, because globalSetup/globalTeardown
// and the sweep refuse to drop anything else — and the 63-byte Postgres
// identifier cap, which Postgres would otherwise enforce by truncating
// silently. Since 2026-09-26 the prefix is engine.json's `product` (P below),
// never a literal: every downstream carries this file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PRODUCT,
  DEFAULT_TEST_DATABASE_URL,
  INFIX_RESERVE,
  slugify,
  productPrefix,
  branchSlug,
  scopedTestDbName,
  e2eTestDbName,
  resolveTestBaseUrl,
  workerDbUrl,
  extraTestDbUrl,
  templateDbName,
  adminDbUrl,
  isDerivedTestDbName,
  runDbPattern,
  setupLockKeys,
} = require('../workerDb');

const P = PRODUCT;
const BASE = `${P}_test`;
const ROOT = path.join(__dirname, '..', '..');

describe('productPrefix', () => {
  test('is engine.json\'s product id, slugged', () => {
    const product = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine.json'), 'utf8')).product;
    expect(P).toBe(slugify(product));
    expect(P).not.toBe('');
  });
  test('falls back to package.json\'s name, then to "app"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workerdb-prefix-'));
    try {
      expect(productPrefix(dir)).toBe('app');
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'Ledger-Link' }));
      expect(productPrefix(dir)).toBe('ledger_link');
      fs.writeFileSync(path.join(dir, 'engine.json'), JSON.stringify({ product: 'LL' }));
      expect(productPrefix(dir)).toBe('ll');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test('the default URL names the product, never the old shared prefix', () => {
    expect(new URL(DEFAULT_TEST_DATABASE_URL).pathname).toBe(`/${BASE}`);
  });
});

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
    expect(scopedTestDbName(BASE, 'feat_harvest_h2')).toBe(`${P}_feat_harvest_h2_test`);
  });
  test('slugs a raw branch name', () => {
    expect(scopedTestDbName(BASE, 'r1/Brand-Core')).toBe(`${P}_r1_brand_core_test`);
  });
  test('returns the base unchanged for an empty scope', () => {
    expect(scopedTestDbName(BASE, '')).toBe(BASE);
    expect(scopedTestDbName(BASE, '---')).toBe(BASE);
  });
  test('refuses a base that does not end in _test', () => {
    expect(() => scopedTestDbName(P, 'x')).toThrow(/must end in _test/);
  });
  test('trims a long scope so the longest derived name (a worker extra) still fits 63 bytes', () => {
    const scoped = scopedTestDbName(BASE, 'x'.repeat(200));
    expect(scoped.endsWith('_test')).toBe(true);
    expect(templateDbName(scoped).length).toBeLessThanOrEqual(63);
    const worker = workerDbUrl(99, `postgresql://u:p@h/${scoped}`);
    expect(worker.name.length).toBeLessThanOrEqual(63);
    expect(extraTestDbUrl('x'.repeat(12), worker.url).name.length).toBeLessThanOrEqual(63);
    // Room = 63 - P - '_'(1) - reserve(17: '_w99_' + 12) - '_test'(5).
    const room = 63 - P.length - 1 - INFIX_RESERVE - 5;
    expect(INFIX_RESERVE).toBe(17);
    expect(scoped).toBe(`${P}_${'x'.repeat(room)}_test`);
  });
  test('never leaves a dangling underscore at the trim point', () => {
    const room = 63 - P.length - 1 - INFIX_RESERVE - 5;
    const scope = `${'a'.repeat(room - 1)}_bbbbbbbb`; // cut lands right after the `_`
    expect(scopedTestDbName(BASE, scope)).toBe(`${P}_${'a'.repeat(room - 1)}_test`);
  });
});

describe('e2eTestDbName', () => {
  test('is <product>_e2e_<slug>_test, unscoped without a slug', () => {
    expect(e2eTestDbName('feat/X-1')).toBe(`${P}_e2e_feat_x_1_test`);
    expect(e2eTestDbName('')).toBe(`${P}_e2e_test`);
    expect(e2eTestDbName('master', 'rk')).toBe('rk_e2e_master_test');
  });
  test('fits 63 bytes', () => {
    const name = e2eTestDbName('y'.repeat(200));
    expect(name.length).toBe(63);
    expect(name.endsWith('_test')).toBe(true);
  });
});

describe('workerDbUrl', () => {
  test('inserts the worker id BEFORE the _test suffix and keeps the connection details', () => {
    const { url, name } = workerDbUrl(2, `postgresql://user:pw@db.local:5433/${P}_feat_x_test`);
    expect(name).toBe(`${P}_feat_x_w2_test`);
    expect(url).toBe(`postgresql://user:pw@db.local:5433/${P}_feat_x_w2_test`);
  });
  test('refuses a base that does not end in _test', () => {
    expect(() => workerDbUrl(1, `postgresql://u:p@localhost/${P}`)).toThrow(/must end in _test/);
  });
});

describe('extraTestDbUrl', () => {
  const worker = `postgresql://u:p@h:5433/${P}_feat_x_w2_test`;
  test('derives …_w<N>_<suffix>_test from the worker database', () => {
    expect(extraTestDbUrl('demoreset', worker)).toEqual({
      url: `postgresql://u:p@h:5433/${P}_feat_x_w2_demoreset_test`,
      name: `${P}_feat_x_w2_demoreset_test`,
    });
  });
  test('refuses a bad suffix or a non-worker base', () => {
    expect(() => extraTestDbUrl('demo_reset', worker)).toThrow(/\[a-z0-9\]/);
    expect(() => extraTestDbUrl('', worker)).toThrow(/\[a-z0-9\]/);
    expect(() => extraTestDbUrl('a'.repeat(13), worker)).toThrow(/\[a-z0-9\]/);
    expect(() => extraTestDbUrl('x', `postgresql://u:p@h/${P}_feat_x_test`)).toThrow(/worker DB/);
  });
  test('the name is owned by the run: derived, and matched by the run pattern', () => {
    const { name } = extraTestDbUrl('demoreset', worker);
    expect(isDerivedTestDbName(name)).toBe(true);
    expect(runDbPattern(`${P}_feat_x_test`).test(name)).toBe(true);
  });
});

describe('templateDbName / adminDbUrl / isDerivedTestDbName', () => {
  test('template keeps the suffix', () => {
    expect(templateDbName(`${P}_feat_x_test`)).toBe(`${P}_feat_x_tmpl_test`);
    expect(() => templateDbName(P)).toThrow(/must end in _test/);
  });
  test('admin url targets the postgres database on the same server', () => {
    expect(adminDbUrl(`postgresql://u:p@h:5433/${P}_x_test`)).toBe('postgresql://u:p@h:5433/postgres');
  });
  test('recognises only names this module derives', () => {
    expect(isDerivedTestDbName(`${P}_feat_x_w3_test`)).toBe(true);
    expect(isDerivedTestDbName(`${P}_tmpl_test`)).toBe(true);
    expect(isDerivedTestDbName(`${P}_feat_x_w3_demo_test`)).toBe(true);
    expect(isDerivedTestDbName(`${P}_feat_x_test`)).toBe(false);
    expect(isDerivedTestDbName(`${P}_e2e_master_test`)).toBe(false);
    expect(isDerivedTestDbName(P)).toBe(false);
  });
});

describe('runDbPattern', () => {
  const re = runDbPattern(`${P}_feat_x_test`);
  test('matches the run\'s template, workers and extras', () => {
    for (const n of [`${P}_feat_x_tmpl_test`, `${P}_feat_x_w1_test`, `${P}_feat_x_w12_test`, `${P}_feat_x_w2_abc_test`]) {
      expect(re.test(n)).toBe(true);
    }
  });
  test('matches nothing of another base, the base itself, or a non-_test name', () => {
    for (const n of [
      `${P}_feat_x_test`, `${P}_feat_xy_w1_test`, `${P}_feat_x_w1`, `${P}_feat_x_w1_test_extra`,
      `${P}_e2e_feat_x_test`, `other_feat_x_w1_test`, `${P}_feat_x_w1_a_b_test`,
    ]) {
      expect(re.test(n)).toBe(false);
    }
  });
  test('escapes regex metacharacters in the base', () => {
    expect(runDbPattern('a.b_test').test('axb_w1_test')).toBe(false);
  });
});

describe('setupLockKeys', () => {
  test('two int32 keys: the "hall" namespace + a stable per-base hash', () => {
    const [ns, key] = setupLockKeys(`${P}_master_test`);
    expect(ns).toBe(1751215212);
    expect(Number.isInteger(key)).toBe(true);
    expect(key).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(key).toBeLessThan(2 ** 31);
    expect(setupLockKeys(`${P}_master_test`)).toEqual([ns, key]);
  });
  test('different bases get different locks', () => {
    const keys = new Set(['os_master_test', 'rk_master_test', 'os_feat_a_test', 'os_feat_b_test']
      .map((b) => setupLockKeys(b)[1]));
    expect(keys.size).toBe(4);
  });
});

describe('resolveTestBaseUrl', () => {
  test('TEST_DATABASE_URL is an explicit override, used verbatim', () => {
    const env = { TEST_DATABASE_URL: `postgresql://a:b@ci:5432/${P}_pr1_test`, TEST_PG_URL: 'postgres://x:y@z:5433' };
    expect(resolveTestBaseUrl(env, 'ignored_branch', {})).toEqual({
      url: env.TEST_DATABASE_URL,
      name: `${P}_pr1_test`,
      source: 'TEST_DATABASE_URL',
      server: 'TEST_DATABASE_URL',
    });
  });
  test('the override must still name a _test database', () => {
    expect(() => resolveTestBaseUrl({ TEST_DATABASE_URL: `postgresql://a:b@h/${P}` }, undefined, {}))
      .toThrow(/must end in _test/);
  });
  test('TEST_PG_URL chooses the server (process env first, then .env), ahead of DATABASE_URL', () => {
    const dbEnv = { DATABASE_URL: `postgresql://halli:secret@db.local:5432/${P}` };
    expect(resolveTestBaseUrl({ ...dbEnv, TEST_PG_URL: 'postgres://postgres:postgres@localhost:5433' }, 'feat/a', {}))
      .toEqual({
        url: `postgres://postgres:postgres@localhost:5433/${P}_feat_a_test`,
        name: `${P}_feat_a_test`,
        source: 'branch',
        server: 'TEST_PG_URL',
      });
    const fromFile = resolveTestBaseUrl(dbEnv, 'feat/a', { TEST_PG_URL: 'postgres://t:t@127.0.0.1:5433' });
    expect(fromFile.url).toBe(`postgres://t:t@127.0.0.1:5433/${P}_feat_a_test`);
    expect(fromFile.server).toBe('TEST_PG_URL');
  });
  test('otherwise borrows connection details from DATABASE_URL and scopes the name', () => {
    const env = { DATABASE_URL: `postgresql://halli:secret@db.local:5433/${P}` };
    expect(resolveTestBaseUrl(env, 'feat/harvest-h2', {})).toEqual({
      url: `postgresql://halli:secret@db.local:5433/${P}_feat_harvest_h2_test`,
      name: `${P}_feat_harvest_h2_test`,
      source: 'branch',
      server: 'DATABASE_URL',
    });
    expect(resolveTestBaseUrl({}, 'x', { DATABASE_URL: 'postgresql://f:f@file:1/db' }).url)
      .toBe(`postgresql://f:f@file:1/${P}_x_test`);
  });
  test('falls back to the localhost default when nothing is configured', () => {
    const { url, name, source, server } = resolveTestBaseUrl({}, '', {});
    expect(url).toBe(DEFAULT_TEST_DATABASE_URL);
    expect(name).toBe(BASE);
    expect(source).toBe('unscoped');
    expect(server).toBe('default');
  });
  test('derives a real scope from git when none is injected', () => {
    const { name, source } = resolveTestBaseUrl({ DATABASE_URL: DEFAULT_TEST_DATABASE_URL }, undefined, {});
    expect(name).toMatch(new RegExp(`^${P}(_[a-z0-9_]+)?_test$`));
    expect(['branch', 'worktree', 'unscoped']).toContain(source);
    expect(templateDbName(name).length).toBeLessThanOrEqual(63);
  });
});
