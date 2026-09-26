// The demo reset for real (R2b, server/services/demoReset.js): on a database
// of its own — created here, dropped after — a child process builds the full
// schema, adds staff, prospects, a customer, sessions, uploads and sample data,
// resets, then simulates an interrupted reset and the boot recovery, and
// reports. See tests/fixtures/demoResetRun.js for the setup.
const { spawnSync } = require('child_process');
const path = require('path');
const { Client } = require('pg');

const base = new URL(process.env.DATABASE_URL);
const DB = `demo_reset_${process.pid}_test`;
const admin = () => { const u = new URL(base); u.pathname = '/postgres'; return new Client({ connectionString: u.toString() }); };

// Three full migration runs in a child process: seconds alone, minutes under a
// full four-worker Jest run on a busy machine.
jest.setTimeout(900_000);

let out;
beforeAll(async () => {
  const c = admin(); await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${DB}`);
  await c.end();
  const url = new URL(base); url.pathname = `/${DB}`;
  const run = spawnSync(process.execPath, [path.join(__dirname, '../fixtures/demoResetRun.js')], {
    env: { ...process.env, DATABASE_URL: url.toString(), DEMO_DATABASE_NAME: DB }, encoding: 'utf8', timeout: 840_000,
  });
  const line = (run.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}';
  out = JSON.parse(line);
  if (out.error || run.status !== 0) throw new Error(`demo reset run failed: ${out.error || run.stderr}`);
});

afterAll(async () => {
  const c = admin(); await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await c.end();
});

const ENGINE_STUB = { seeded: false, reason: 'the engine ships no demo data' };

test('the boot check passes on a real demo environment, and a fresh database is seeded once', () => {
  expect(out.bootChecked).toBe(true);
  expect(out.first).toEqual(ENGINE_STUB);
});

test('the restore does not depend on row order (an approver stored after the seller it approved)', () => {
  expect(out.heapOrder).toEqual(['sellerB', 'sellerA']);
  expect(out.afterReset.users.map((u) => u.id)).toEqual(['prospect1', 'sellerA', 'sellerB']);
  expect(out.afterReset.users.find((u) => u.id === 'sellerB').approved_by).toBe('sellerA');
  // sellerA was approved by the customer, who did not survive: cleared, not broken.
  expect(out.afterReset.users.find((u) => u.id === 'sellerA').approved_by).toBeNull();
});

test('kept roles survive; an expired prospect and the customer do not', () => {
  expect(out.summary.keptUsers).toBe(3);
  expect(out.afterReset.roles).toEqual([{ name: 'demo_guest', view_access: ['dashboard'] }]);
  expect(out.afterReset.memberships).toEqual([
    { user_id: 'prospect1', role_name: 'demo_guest' },
    { user_id: 'sellerA', role_name: 'admin' },
    { user_id: 'sellerB', role_name: 'admin' },
  ]);
});

test('only a live session of a login that does not expire is kept', () => {
  expect(out.afterReset.sessions).toEqual([{ id: 'sess-sellerB', user_id: 'sellerB' }]);
});

test('the sample data and the uploads are gone, the chain ran again, nothing was left aside', () => {
  expect(out.afterReset.probe).toBe(0);
  expect(out.afterReset.prev).toBe(0);
  expect(out.afterReset.migrations).toBeGreaterThan(100);
  expect(out.afterReset.lastReset.trigger).toBe('admin');
  expect(out.cooldownRefusal).toMatch(/less than 15 minutes/);
  expect(out.summary.seeded).toEqual(ENGINE_STUB);
  expect(out.uploads).toEqual({ a: [], b: [] });
  expect(out.summary.uploads).toEqual({ UPLOAD_ROOT: 1, BOOKS_UPLOAD_ROOT: 1 });
});

test('an upload root inside the app is never wiped', () => {
  expect(out.insideApp).toEqual({ UPLOAD_ROOT: 'refused', BOOKS_UPLOAD_ROOT: 'unset' });
});

test('an interrupted reset blocks new resets until the boot recovers its accounts', () => {
  expect(out.preflightInterrupted).toBe('interrupted');
  // While a reset holds the lock, boot recovery and the first-boot seed skip.
  expect(out.recoverWhileLocked).toBeNull();
  expect(out.seedWhileLocked).toBeNull();
  expect(out.snapshotKeptWhileLocked).toBe(1);
  expect(out.recovered.keptUsers).toBe(3);
  expect(out.seededAfterRecovery).toEqual(ENGINE_STUB);
  expect(out.afterRecovery.prev).toBe(0);
  expect(out.afterRecovery.probe).toBe(0);
  expect(out.afterRecovery.users.map((u) => u.id)).toEqual(['prospect1', 'sellerA', 'sellerB']);
});
