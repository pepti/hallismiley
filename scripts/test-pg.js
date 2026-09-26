#!/usr/bin/env node
// ============================================================================
//  ⚠️  THROWAWAY TEST DATA ONLY — NEVER A REAL DATABASE  ⚠️
//
//  This script creates and runs a LOCAL TEST Postgres cluster with
//  fsync=off, full_page_writes=off and synchronous_commit=off. A crash, a
//  power cut or a killed postmaster can corrupt it beyond repair, and that
//  is accepted: it only ever holds databases the test suites create and drop.
//  Never restore, create or keep anything that matters on it (the books, a
//  dev database, customer data). Never point it at the shared :5432 cluster.
// ============================================================================
//
//   npm run test:pg:init     initdb + write the throwaway settings (refuses an
//                            existing non-empty data directory)
//   npm run test:pg:start    pg_ctl start (waits until it accepts connections)
//   npm run test:pg:status   pg_ctl status + a connection check + its settings
//   node scripts/test-pg.js stop
//
// Configuration (process env, else the repo's .env):
//   TEST_PG_URL   postgres://postgres:postgres@localhost:5433 — the server the
//                 Jest + e2e test databases are created on (port read from it)
//   TEST_PG_DATA  the data directory (default ~/pgtest17/data); when set,
//                 `npm test` also starts the cluster itself if it is down
//   TEST_PG_BIN   the directory holding initdb/pg_ctl (default
//                 C:/Program Files/PostgreSQL/17/bin on Windows, else PATH)
//
// See docs/TESTING.md → "The local test cluster".
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CLUSTER_SETTINGS, DEFAULT_PORT, defaultDataDir, pgBin, logFileFor, ensureTestServer, probe, adminUrlOf,
  assertThrowawayCluster,
} = require('../tests/lib/testPg');
const { fileEnvValue } = require('../tests/workerDb');

const SHARED_PORT = 5432;
const PASSWORD = 'postgres';
const USER = 'postgres';

function setting(key) {
  return process.env[key] || fileEnvValue(key) || '';
}

function config() {
  const url = setting('TEST_PG_URL') || `postgres://${USER}:${PASSWORD}@localhost:${DEFAULT_PORT}`;
  const port = Number(new URL(url).port || SHARED_PORT);
  const dataDir = path.resolve(setting('TEST_PG_DATA') || defaultDataDir());
  return { url, port, dataDir };
}

function refuseSharedPort(port) {
  if (port === SHARED_PORT) {
    console.error(`[test:pg] refusing: port ${SHARED_PORT} is the shared cluster (real books + dev DBs). ` +
      'The test cluster must listen elsewhere (TEST_PG_URL, default :5433).');
    process.exit(2);
  }
}

function run(bin, args) {
  const r = spawnSync(bin, args, { stdio: 'inherit', windowsHide: true });
  if (r.error) throw r.error;
  return r.status;
}

function init({ port, dataDir }) {
  refuseSharedPort(port);
  if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length > 0) {
    console.error(`[test:pg] ${dataDir} exists and is not empty — refusing to init over it.`);
    process.exit(2);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const pwfile = path.join(os.tmpdir(), `test-pg-pw-${process.pid}.txt`);
  fs.writeFileSync(pwfile, `${PASSWORD}\n`);
  const locale = process.env.TEST_PG_LOCALE ||
    (process.platform === 'win32' ? 'English_United Kingdom.1252' : 'C.UTF-8');
  try {
    const status = run(pgBin('initdb'), [
      '-D', dataDir, '-U', USER, `--pwfile=${pwfile}`, '--auth=scram-sha-256',
      '--encoding=UTF8', `--locale=${locale}`,
    ]);
    if (status !== 0) process.exit(status || 1);
  } finally {
    fs.rmSync(pwfile, { force: true });
  }
  const lines = [
    '',
    '# ── test-pg.js: THROWAWAY TEST CLUSTER — never a real database ──',
    '# fsync/full_page_writes off: a crash can corrupt this cluster, by design.',
    `port = ${port}`,
    ...Object.entries(CLUSTER_SETTINGS).map(([k, v]) => `${k} = ${v}`),
    '',
  ];
  fs.appendFileSync(path.join(dataDir, 'postgresql.conf'), lines.join('\n'));
  console.log(`[test:pg] initialised ${dataDir} (port ${port}, user ${USER}/${PASSWORD}).`);
  console.log('[test:pg] next: npm run test:pg:start, and put TEST_PG_URL (+ TEST_PG_DATA to auto-start) in .env.');
}

async function start({ url, port, dataDir }) {
  refuseSharedPort(port);
  const state = await ensureTestServer(url, { dataDir, log: (m) => console.log(`[test:pg] ${m}`) });
  console.log(`[test:pg] ${new URL(url).host}: ${state === 'unknown' ? 'answers, but the connection failed (check credentials)' : state}`);
}

function stop({ port, dataDir }) {
  refuseSharedPort(port);
  assertThrowawayCluster(dataDir); // never stop the shared cluster by a wrong TEST_PG_DATA
  process.exit(run(pgBin('pg_ctl'), ['-D', dataDir, 'stop', '-m', 'fast']) || 0);
}

async function status({ url, port, dataDir }) {
  console.log(`[test:pg] data ${dataDir}  log ${logFileFor(dataDir)}  url ${new URL(url).host}`);
  try {
    console.log(execFileSync(pgBin('pg_ctl'), ['-D', dataDir, 'status'], { encoding: 'utf8', windowsHide: true }).trim());
  } catch (err) {
    console.log((err.stdout || err.message || '').toString().trim());
  }
  let state;
  try { state = await probe(url); } catch (err) { state = `error: ${err.message}`; }
  console.log(`[test:pg] connection: ${state}`);
  if (state !== 'up') return;
  if (port === SHARED_PORT) console.log('[test:pg] ⚠️ this is the SHARED cluster, not a test cluster.');
  const { Client } = require('pg');
  const c = new Client({ connectionString: adminUrlOf(url), ssl: false });
  await c.connect();
  try {
    const keys = ['server_version', 'port', ...Object.keys(CLUSTER_SETTINGS)];
    const vals = [];
    for (const k of keys) vals.push(`${k}=${(await c.query(`SHOW ${k}`)).rows[0][k]}`);
    console.log(`[test:pg] ${vals.join('  ')}`);
    const { rows } = await c.query(
      "SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE '%\\_test'"
    );
    console.log(`[test:pg] ${rows[0].n} test database(s) on it (npm run test:db:clean -- --sweep to review).`);
  } finally {
    await c.end();
  }
}

async function main() {
  const cmd = process.argv[2];
  const cfg = config();
  switch (cmd) {
    case 'init': return init(cfg);
    case 'start': return start(cfg);
    case 'stop': return stop(cfg);
    case 'status': return status(cfg);
    default:
      console.error('usage: node scripts/test-pg.js init | start | stop | status');
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(`[test:pg] failed: ${err.message}`);
  process.exit(1);
});
