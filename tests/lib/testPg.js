// The local TEST Postgres server seam (test-db-hygiene-2026-09-26).
//
// ⚠️ THROWAWAY TEST DATA ONLY. The cluster this module describes runs with
// fsync=off, full_page_writes=off and synchronous_commit=off: a crash or a
// power cut corrupts it beyond repair. That is the point — per-test cleanup
// and CREATE DATABASE … TEMPLATE copies stop costing checkpoint fsyncs — and
// it is also why NOTHING that matters may ever
// live on it. Never point TEST_PG_URL at a server that holds a real database
// (the books, a dev database, a customer's data).
//
// Why a separate server at all: the shared cluster on :5432 (the real books
// DB + the dev DBs) had collected 746 leftover test databases, and its
// checkpoints took ~8 minutes (about a million files to fsync on Windows), so
// every Jest globalSetup in every repo stalled behind them.
//
// Used by tests/globalSetup.js and e2e/global-setup.js (auto-start) and by
// scripts/test-pg.js (init | start | stop | status).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The settings the test cluster runs with — scripts/test-pg.js writes exactly
// these into postgresql.conf. Throwaway-data settings (see the header).
const CLUSTER_SETTINGS = Object.freeze({
  listen_addresses: "'localhost'",
  max_connections: '300',
  shared_buffers: '512MB',
  fsync: 'off',
  synchronous_commit: 'off',
  full_page_writes: 'off',
  wal_level: 'minimal',
  max_wal_senders: '0',
  checkpoint_timeout: '30min',
  max_wal_size: '8GB',
});

const DEFAULT_PORT = 5433;
const WINDOWS_DEFAULT_BIN = 'C:/Program Files/PostgreSQL/17/bin';

/** Default data directory: ~/pgtest17/data. */
function defaultDataDir() {
  return path.join(os.homedir(), 'pgtest17', 'data');
}

/** The directory holding pg_ctl / initdb: TEST_PG_BIN, else the Windows default, else PATH. */
function pgBinDir(env = process.env) {
  if (env.TEST_PG_BIN) return env.TEST_PG_BIN;
  if (process.platform === 'win32' && fs.existsSync(WINDOWS_DEFAULT_BIN)) return WINDOWS_DEFAULT_BIN;
  return '';
}

/** Full path of a Postgres binary (`pg_ctl`, `initdb`), or its bare name to find on PATH. */
function pgBin(name, env = process.env) {
  const dir = pgBinDir(env);
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  return dir ? path.join(dir, exe) : name;
}

/** The pg_ctl log file for a data directory: a sibling of it, never inside it. */
function logFileFor(dataDir) {
  return path.join(path.dirname(path.resolve(dataDir)), 'pg_ctl.log');
}

/** Admin URL (database `postgres`) on the same server as `url`. */
function adminUrlOf(url) {
  const u = new URL(url);
  u.pathname = '/postgres';
  return u.toString();
}

function isRefused(err) {
  if (!err) return false;
  if (err.code === 'ECONNREFUSED') return true;
  // localhost resolves to ::1 and 127.0.0.1; Node reports both as one AggregateError.
  return Array.isArray(err.errors) && err.errors.some((e) => e && e.code === 'ECONNREFUSED');
}

/**
 * Try one connection. Resolves 'up', 'refused', 'starting' (57P03) or throws
 * the connection error for anything else (bad password, unknown host …).
 */
async function probe(url) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: adminUrlOf(url), connectionTimeoutMillis: 3000, ssl: false });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return 'up';
  } catch (err) {
    if (isRefused(err)) return 'refused';
    if (err.code === '57P03') return 'starting';
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

const SHARED_PORT = 5432;

/** The effective value of `key` in a data directory's config files ('' when unset). */
function confValue(dataDir, key) {
  let value = '';
  for (const file of ['postgresql.conf', 'postgresql.auto.conf']) {
    let text;
    try { text = fs.readFileSync(path.join(dataDir, file), 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const m = line.replace(/#.*/, '').match(new RegExp(`^\\s*${key}\\s*=\\s*'?([^'\\s]*)'?`));
      if (m) value = m[1]; // the last assignment wins, as in Postgres
    }
  }
  return value;
}

/**
 * Refuse to start or stop a cluster that is not a throwaway test cluster: its
 * config must say fsync = off and a port other than 5432. A TEST_PG_DATA that
 * points at the shared cluster (the books) must never be driven from here.
 */
function assertThrowawayCluster(dataDir) {
  const fsync = confValue(dataDir, 'fsync').toLowerCase();
  const port = Number(confValue(dataDir, 'port') || SHARED_PORT);
  if (!['off', 'false', '0', 'no'].includes(fsync) || port === SHARED_PORT) {
    throw new Error(
      `Refusing to drive the cluster in ${dataDir}: a test cluster runs with fsync = off on a port ` +
      `other than ${SHARED_PORT} (found fsync=${fsync || 'on (default)'}, port=${port}). ` +
      'TEST_PG_DATA must name the throwaway test cluster, never a real one.'
    );
  }
}

/** Refuse a test server URL on the shared cluster's port. */
function assertNotSharedPort(url) {
  if (Number(new URL(url).port || SHARED_PORT) === SHARED_PORT) {
    throw new Error(
      `TEST_PG_URL points at port ${SHARED_PORT}, the shared cluster (real books + dev DBs). ` +
      'It must name the throwaway test server (default :5433) — docs/TESTING.md.'
    );
  }
}

/** Start the cluster detached (it must outlive this process). Returns the log path. */
function startDetached(dataDir, env = process.env) {
  assertThrowawayCluster(dataDir);
  const log = logFileFor(dataDir);
  const child = spawn(pgBin('pg_ctl', env), ['-D', dataDir, '-l', log, 'start'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {}); // a missing pg_ctl surfaces as the wait below timing out
  child.unref();
  return log;
}

/**
 * Make sure the test server at `url` answers. When it refuses connections and
 * `dataDir` (TEST_PG_DATA) is known, start it with pg_ctl — detached and
 * unref'd — and wait up to `timeoutMs`. Anything but a refusal (wrong
 * password, unknown host) is left for the caller's own connection to report.
 * `log` is a line writer (the callers use stdout).
 */
async function ensureTestServer(url, { dataDir, env = process.env, timeoutMs = 30000, log = () => {} } = {}) {
  let state;
  try {
    state = await probe(url);
  } catch {
    return 'unknown'; // not a refusal: let the real connection produce the real error
  }
  if (state === 'up') return 'up';
  if (state === 'refused') {
    if (!dataDir) return 'refused';
    const logFile = startDetached(dataDir, env);
    log(`test server ${new URL(url).host} refused connections — starting it: pg_ctl -D ${dataDir} (log ${logFile})`);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      if ((await probe(url)) === 'up') {
        log(`test server ${new URL(url).host} is up`);
        return 'started';
      }
    } catch {
      return 'unknown';
    }
  }
  throw new Error(
    `The test Postgres server at ${new URL(url).host} did not come up within ${Math.round(timeoutMs / 1000)} s` +
    (dataDir ? ` (pg_ctl -D ${dataDir}; see ${logFileFor(dataDir)})` : '') + '.'
  );
}

module.exports = {
  CLUSTER_SETTINGS,
  DEFAULT_PORT,
  defaultDataDir,
  pgBin,
  logFileFor,
  adminUrlOf,
  isRefused,
  confValue,
  assertThrowawayCluster,
  assertNotSharedPort,
  probe,
  ensureTestServer,
};
