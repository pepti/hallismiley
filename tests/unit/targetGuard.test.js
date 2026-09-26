// The guard every destructive script calls first (server/scripts/targetGuard.js).
// Cases ported from icelandicstore #370 (tests/unit/e2eTargetGuard.test.js) and
// extended for the engine's shape: a name pattern per caller, --allow-dev-db,
// the reserved books/ops/prod names and APP_ENV=staging.
const { checkTarget, assertSafeTarget } = require('../../server/scripts/targetGuard');
const { e2eDatabaseName } = require('../../e2e/lib/dbUrl');

const LOCAL = 'postgresql://postgres:postgres@localhost:5432/';
const ENV = { NODE_ENV: 'test' };

describe('checkTarget — allows a local test database', () => {
  test.each([
    ['a per-worker jest database', `${LOCAL}orangesmiley_harvest2_w1_test`],
    ['the e2e CI database', `${LOCAL}orangesmiley_e2e_ci_test`],
    ['127.0.0.1', 'postgresql://postgres:postgres@127.0.0.1:5432/orangesmiley_test'],
    ['IPv6 loopback', 'postgresql://postgres:postgres@[::1]:5432/orangesmiley_test'],
    ['a test name that happens to contain "books"', `${LOCAL}orangesmiley_books_fix_test`],
  ])('%s', (_label, databaseUrl) => {
    expect(checkTarget({ databaseUrl, env: ENV })).toMatchObject({ ok: true });
  });

  test('reports the host and database', () => {
    expect(checkTarget({ databaseUrl: `${LOCAL}orangesmiley_test`, env: {} }))
      .toEqual({ ok: true, host: 'localhost', database: 'orangesmiley_test' });
  });

  // e2e/global-setup.js runs the guard on whatever e2eDatabaseUrl() derives for
  // this checkout; this is the tripwire for the two drifting apart.
  test('whatever name e2eDatabaseName() derives for this checkout', () => {
    expect(checkTarget({ databaseUrl: `${LOCAL}${e2eDatabaseName()}`, env: ENV }).ok).toBe(true);
  });

  test('APP_ENV=test is not refused (a local dev .env may set it)', () => {
    expect(checkTarget({ databaseUrl: `${LOCAL}orangesmiley_test`, env: { APP_ENV: 'test' } }).ok).toBe(true);
  });
});

describe('checkTarget — refuses a database that is not local', () => {
  test.each([
    ['Azure host, real name',
      'postgresql://u:p@orangesmiley-prod-pg.postgres.database.azure.com:5432/orangesmiley?sslmode=require', /Azure database server/],
    ['Azure host even with a test-looking name',
      'postgresql://u:p@x.postgres.database.azure.com:5432/orangesmiley_test', /Azure database server/],
    ['a host that merely starts with localhost',
      'postgresql://u:p@localhost.evil.example:5432/orangesmiley_test', /is not local/],
    ['a remote IP', 'postgresql://u:p@10.0.0.5:5432/orangesmiley_test', /is not local/],
    ['a ?host= override behind a local URL host',
      `${LOCAL}orangesmiley_test?host=x.postgres.database.azure.com`, /Azure database server/],
    ['a unix-socket URL with no host', 'postgresql:///orangesmiley_test', /is not local/],
  ])('%s', (_label, databaseUrl, reason) => {
    const res = checkTarget({ databaseUrl, env: ENV, allowDevDb: true });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(reason);
  });
});

describe('checkTarget — the name rule', () => {
  test.each([
    ['the dev database without the flag', `${LOCAL}orangesmiley`, false, /--allow-dev-db/],
    ['a ?dbname= override', `${LOCAL}orangesmiley_test?dbname=orangesmiley`, false, /does not match/],
    ['a ?database= override', `${LOCAL}orangesmiley_test?database=orangesmiley`, false, /does not match/],
    ['no database name', LOCAL, true, /names no database/],
    ['the books instance, even with the flag', `${LOCAL}orangesmiley_books`, true, /holds real records/],
    ['its restore drill', `${LOCAL}orangesmiley_books_restore`, true, /holds real records/],
    ['an ops database', `${LOCAL}orangesmiley_ops`, true, /holds real records/],
    ['a prod copy', `${LOCAL}orangesmiley_prod`, true, /holds real records/],
    ['a quoted name', `${LOCAL}${encodeURIComponent('orange"smiley')}`, true, /plain identifier/],
  ])('%s', (_label, databaseUrl, allowDevDb, reason) => {
    const res = checkTarget({ databaseUrl, env: ENV, allowDevDb });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(reason);
  });

  test('--allow-dev-db admits the local dev database', () => {
    expect(checkTarget({ databaseUrl: `${LOCAL}orangesmiley`, env: ENV, allowDevDb: true }))
      .toEqual({ ok: true, host: 'localhost', database: 'orangesmiley' });
  });

  test('a caller-specific pattern (books:replay needs _replay)', () => {
    const namePattern = /_replay$/;
    expect(checkTarget({ databaseUrl: `${LOCAL}orangesmiley_replay`, env: ENV, namePattern }).ok).toBe(true);
    expect(checkTarget({ databaseUrl: `${LOCAL}orangesmiley_test`, env: ENV, namePattern }).ok).toBe(false);
  });
});

describe('checkTarget — refuses a deployed environment even when the database looks right', () => {
  const databaseUrl = `${LOCAL}orangesmiley_test`;
  test.each([
    ['APP_ENV=production', { APP_ENV: 'production' }, /APP_ENV is "production"/],
    ['APP_ENV=staging', { APP_ENV: 'staging' }, /APP_ENV is "staging"/],
    ['APP_ENV in another case', { APP_ENV: ' Production ' }, /APP_ENV is "production"/],
    ['NODE_ENV=production', { NODE_ENV: 'production' }, /NODE_ENV is "production"/],
    ['an Azure App Service instance', { WEBSITE_SITE_NAME: 'orangesmiley-web' }, /Azure App Service/],
    ['an App Service instance id alone', { WEBSITE_INSTANCE_ID: 'abc123' }, /Azure App Service/],
  ])('%s', (_label, env, reason) => {
    const res = checkTarget({ databaseUrl, env, allowDevDb: true });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(reason);
  });
});

describe('checkTarget — refuses what it cannot read', () => {
  test.each([
    ['no DATABASE_URL', undefined, /not set/],
    ['an empty DATABASE_URL', '', /not set/],
    ['garbage', 'not a url', /not a parseable URL/],
    ['another protocol', 'mysql://localhost/orangesmiley_test', /not a postgres/],
  ])('%s', (_label, databaseUrl, reason) => {
    const res = checkTarget({ databaseUrl, env: ENV });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(reason);
  });

  test('no arguments at all', () => {
    expect(checkTarget().ok).toBe(false);
  });
});

describe('assertSafeTarget', () => {
  test('prints the reason and exits 1 on a refusal', () => {
    const exit = jest.fn();
    const out = [];
    const res = assertSafeTarget(
      { databaseUrl: 'postgresql://u:p@db.postgres.database.azure.com/orangesmiley', env: {} },
      { label: 'seed:books', exit, write: s => out.push(s) }
    );
    expect(res.ok).toBe(false);
    expect(exit).toHaveBeenCalledWith(1);
    expect(out.join('')).toMatch(/\[seed:books\] REFUSING TO RUN: .*Azure database server/);
  });

  test('returns quietly on an allowed target', () => {
    const exit = jest.fn();
    const res = assertSafeTarget({ databaseUrl: `${LOCAL}orangesmiley_test`, env: {} }, { exit, write: () => {} });
    expect(res.ok).toBe(true);
    expect(exit).not.toHaveBeenCalled();
  });
});
