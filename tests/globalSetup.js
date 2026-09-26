// Runs once before all test suites. (Per-worker databases ported from
// icelandicstore, ice #225 + #233.)
// Provisions one database PER JEST WORKER (see tests/workerDb.js for the
// naming scheme and why parallel workers can't share a database).
//
// Migrates ONE template database, then clones it per worker. Previously this
// ran the full migration chain from scratch N times CONCURRENTLY — identical
// work repeated per worker, and the contention that dropAndCreate's retry loop
// exists to absorb. `CREATE DATABASE … TEMPLATE` is a file-level copy, so the
// worker DBs are byte-identical to the migrated template and the clean-slate
// guarantee is unchanged.
const { Pool } = require('pg');
const { execFile } = require('child_process');
const path = require('path');
const {
  workerDbUrl, resolveTestBaseUrl, templateDbName, adminDbUrl,
} = require('./workerDb');
const { checkTarget } = require('../server/scripts/targetGuard');

// Stable key for pg_advisory_lock on the admin DB. Serialises the DROP/CREATE
// step across concurrent globalSetup runs (e.g. an editor's auto-test +
// a pre-push) so they can't crash with "duplicate key violates
// pg_database_datname_index".
//
// Note: this lock only covers DROP/CREATE, not migration or test execution.
// Two truly concurrent `npm test` runs against the SAME base still race —
// process B's drop can wipe process A's data mid-test. The user-visible
// failure mode becomes a clean "database does not exist" instead of a pile
// of cascading FK errors, which is a strict improvement. Since 2026-09-02 the
// default base is scoped per branch (tests/workerDb.js), so the remaining
// race is two runs of the same branch at once — or two runs pinned to one
// explicit TEST_DATABASE_URL.
const SETUP_LOCK_KEY = 1751215212; // 0x68616c6c — "hall" as int32

module.exports = async function globalSetup(globalConfig) {
  const { url: baseUrl, name: dbName, source } = resolveTestBaseUrl();
  // Pin the resolved base for the workers (and globalTeardown): they inherit
  // this process's env, so every one of them derives from the same string
  // instead of re-running the git lookup — and they cannot disagree with the
  // names provisioned here.
  process.env.TEST_DATABASE_URL = baseUrl;

  if (!dbName || !/_test$/.test(dbName)) {
    throw new Error(
      `Refusing to drop DB "${dbName}" — name must end in _test for safety.`
    );
  }
  // The name rule above plus the shared destructive-script guard (harvest 2,
  // 2026-09-26, server/scripts/targetGuard.js): this run DROPs databases, so a
  // TEST_DATABASE_URL on a non-local host (an Azure server that happens to
  // hold a `…_test` database) or a shell inside a deployed container is refused.
  const target = checkTarget({ databaseUrl: baseUrl, env: process.env });
  if (!target.ok) {
    throw new Error(`Refusing to provision test databases: ${target.reason}.`);
  }

  // One DB per worker. Under --runInBand maxWorkers is 1 → just <base>_w1_test.
  const workerCount = Math.max(1, globalConfig.maxWorkers || 1);
  const workers = [];
  for (let i = 1; i <= workerCount; i++) {
    workers.push(workerDbUrl(i, baseUrl));
  }

  // The migrated template. Keeps the `_test` suffix so it satisfies the same
  // safety guard as every other database this file touches.
  const templateName = templateDbName(dbName);
  const templateUrl = (() => {
    const u = new URL(baseUrl);
    u.pathname = `/${templateName}`;
    return u.toString();
  })();

  // Say which base this run uses: the scoped default is derived, so a
  // collision (or a stray override) should be visible in the run's first line.
  const host = new URL(baseUrl).host;
  process.stdout.write(
    `[jest] test database base: ${dbName} on ${host} (from ${source}) — ` +
    `template ${templateName}, workers ${workers.map(w => w.name).join(', ')}\n`
  );

  const migrateScript = path.join(__dirname, '..', 'server', 'scripts', 'migrate.js');

  const admin = new Pool({ connectionString: adminDbUrl(baseUrl) });
  try {
    // Acquire a session-scoped advisory lock so the whole provisioning block
    // runs sequentially even when two `npm test` processes race.
    const lockClient = await admin.connect();
    try {
      await lockClient.query('SELECT pg_advisory_lock($1)', [SETUP_LOCK_KEY]);
      try {
        // 1. Build the template: clean database, full migration chain, once.
        await dropAndCreate(lockClient, templateName);

        // A child process per DB is deliberate: server/config/database.js binds
        // its pool to DATABASE_URL at require time, so migrating inside THIS
        // process would need require-cache surgery. migrate.js already supports
        // standalone invocation (`node server/scripts/migrate.js`).
        //
        // It ALSO matters that this is a child process rather than an in-process
        // migration: CREATE DATABASE … TEMPLATE below refuses to run while any
        // session is connected to the source, and the child has fully exited by
        // the time this await resolves. Do not "optimise" it into the parent.
        await runMigrate(migrateScript, templateUrl);

        // 2. Clone it per worker. A file-level copy, so each worker DB is
        //    byte-identical to the migrated template.
        for (const w of workers) {
          await dropAndCreate(lockClient, w.name, templateName);
          // Throwaway per-worker database: a lost commit on crash is
          // meaningless here, and this takes the WAL fsync out of the ~2100
          // TRUNCATE-and-reseed cycles a full run performs.
          await lockClient.query(
            `ALTER DATABASE "${w.name}" SET synchronous_commit = off`
          );
        }
      } finally {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [SETUP_LOCK_KEY]);
      }
    } finally {
      lockClient.release();
    }
  } finally {
    await admin.end();
  }
};

function runMigrate(script, databaseUrl) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script],
      {
        env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
        // From-scratch migration is normally well under a minute; this bound
        // just turns a hung child into a readable error instead of a hang.
        timeout: 5 * 60 * 1000,
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(
            `Migration failed for ${databaseUrl}: ${err.message}\n${stdout}\n${stderr}`
          ));
        } else {
          resolve();
        }
      }
    );
  });
}

// Inner DROP/CREATE with retry: pg_terminate_backend returns immediately
// but the backend takes a moment to actually exit. DROP DATABASE will
// fail with "is being accessed by other users" if it sees those zombies,
// so we retry a few times with a short backoff.
async function dropAndCreate(client, dbName, templateName) {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Terminate stragglers on the target AND, when cloning, on the source:
    // CREATE DATABASE … TEMPLATE fails while any session holds the template.
    await client.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = ANY($1::text[]) AND pid <> pg_backend_pid()`,
      [templateName ? [dbName, templateName] : [dbName]]
    );
    try {
      await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await client.query(
        templateName
          ? `CREATE DATABASE "${dbName}" TEMPLATE "${templateName}"`
          : `CREATE DATABASE "${dbName}"`
      );
      return;
    } catch (err) {
      const isAccessed = /being accessed by other users/i.test(err.message);
      const isDup      = /pg_database_datname_index/i.test(err.message);
      // Cloning adds one more transient: the template still has a session.
      const isTemplateBusy = /source database .* is being accessed/i.test(err.message);
      if (attempt < MAX_ATTEMPTS && (isAccessed || isDup || isTemplateBusy)) {
        await new Promise(r => setTimeout(r, 100 * attempt));
        continue;
      }
      throw err;
    }
  }
}
