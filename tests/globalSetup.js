// Runs once before all test suites. (Per-worker databases ported from
// icelandicstore, ice #225 + #233; server seam, labels, sweep and interrupt
// cleanup added 2026-09-26 — test-db-hygiene-2026-09-26, docs/TESTING.md.)
// Provisions one database PER JEST WORKER (see tests/workerDb.js for the
// naming scheme and why parallel workers can't share a database).
//
// Migrates ONE template database, then clones it per worker. Previously this
// ran the full migration chain from scratch N times CONCURRENTLY — identical
// work repeated per worker, and the contention that dropAndCreate's retry loop
// exists to absorb. `CREATE DATABASE … TEMPLATE` is a file-level copy, so the
// worker DBs are byte-identical to the migrated template and the clean-slate
// guarantee is unchanged.
//
// Before provisioning, inside the lock, it SWEEPS this product's leftovers
// (tests/lib/testDbSweep.js): Jest databases whose run died (owner pid gone)
// or that are over 6 h old, e2e databases whose branch and worktree are both
// gone or that sat unused for 14 days, unlabelled derived names over 24 h. A
// database with a session is never touched.
const { Pool } = require('pg');
const { execFile, spawn } = require('child_process');
const path = require('path');
const {
  PRODUCT, workerDbUrl, resolveTestBaseUrl, templateDbName, adminDbUrl, setupLockKeys,
  fileEnvValue,
} = require('./workerDb');
const sweep = require('./lib/testDbSweep');
const { ensureTestServer, assertNotSharedPort } = require('./lib/testPg');

// Two-key advisory lock on the admin DB, one per BASE (workerDb.setupLockKeys:
// the "hall" namespace + a hash of the base name). Serialises the DROP/CREATE
// step across concurrent globalSetup runs of the same base (e.g. an editor's
// auto-test + a pre-push) so they can't crash with "duplicate key violates
// pg_database_datname_index". Until 2026-09-26 the key was one global
// constant, so every run of every repo and branch on the server queued behind
// each other; different bases never touch the same names, so they no longer
// share the lock.
//
// Note: this lock only covers DROP/CREATE, not migration or test execution.
// Two truly concurrent `npm test` runs against the SAME base still race —
// process B's drop can wipe process A's data mid-test. The user-visible
// failure mode becomes a clean "database does not exist" instead of a pile
// of cascading FK errors, which is a strict improvement. Since 2026-09-02 the
// default base is scoped per branch (tests/workerDb.js), so the remaining
// race is two runs of the same branch at once — or two runs pinned to one
// explicit TEST_DATABASE_URL.

const log = (msg) => process.stdout.write(`[jest] ${msg}\n`);

module.exports = async function globalSetup(globalConfig) {
  const { url: baseUrl, name: dbName, source, server } = resolveTestBaseUrl();
  // The .env is never loaded into the Jest main process, so a TEST_DATABASE_URL
  // written there does nothing (LESSONS 2026-09-26) — say so instead of
  // silently ignoring it.
  if (source !== 'TEST_DATABASE_URL' && fileEnvValue('TEST_DATABASE_URL')) {
    log('note: TEST_DATABASE_URL in .env is ignored (only the process env pins it); use TEST_PG_URL there to choose the server.');
  }
  // Pin the resolved base for the workers (and globalTeardown): they inherit
  // this process's env, so every one of them derives from the same string
  // instead of re-running the git lookup — and they cannot disagree with the
  // names provisioned here. TEST_DB_OWNER_PID puts THIS process's pid in the
  // labels the workers write (extra databases).
  process.env.TEST_DATABASE_URL = baseUrl;
  process.env.TEST_DB_OWNER_PID = String(process.pid);

  if (!dbName || !/_test$/.test(dbName)) {
    throw new Error(
      `Refusing to drop DB "${dbName}" — name must end in _test for safety.`
    );
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
  log(
    `test database base: ${dbName} on ${host} (from ${source}, server from ${server}) — ` +
    `template ${templateName}, workers ${workers.map(w => w.name).join(', ')}`
  );

  // TEST_PG_URL names the throwaway test server — never the shared :5432 one.
  // The local test cluster may be down: with TEST_PG_DATA known, start it.
  const dataDir = process.env.TEST_PG_DATA || fileEnvValue('TEST_PG_DATA');
  if (server === 'TEST_PG_URL') {
    assertNotSharedPort(baseUrl);
    if (dataDir) await ensureTestServer(baseUrl, { dataDir, log });
  }

  installInterruptCleanup(dbName);

  const migrateScript = path.join(__dirname, '..', 'server', 'scripts', 'migrate.js');
  const lockKeys = setupLockKeys(dbName);

  const admin = new Pool({ connectionString: adminDbUrl(baseUrl) });
  try {
    // Acquire a session-scoped advisory lock so the whole provisioning block
    // runs sequentially even when two `npm test` processes race.
    const lockClient = await admin.connect();
    try {
      await lockClient.query('SELECT pg_advisory_lock($1, $2)', lockKeys);
      try {
        // 0. Sweep this product's leftovers. Never fatal: a sweep problem must
        //    not stop the run it exists to protect.
        try {
          await sweep.runSweep(lockClient, {
            mode: 'rules', prefixes: [PRODUCT], product: PRODUCT, log: (m) => log(`sweep: ${m}`),
          });
        } catch (err) {
          log(`sweep skipped: ${err.message}`);
        }

        // 1. Build the template: clean database, full migration chain, once.
        await dropAndCreate(lockClient, templateName);
        await label(lockClient, templateName);

        // A child process per DB is deliberate: server/config/database.js binds
        // its pool to DATABASE_URL at require time, so migrating inside THIS
        // process would need require-cache surgery. migrate.js already supports
        // standalone invocation (`node server/scripts/migrate.js`).
        //
        // It ALSO matters that this is a child process rather than an in-process
        // migration: CREATE DATABASE … TEMPLATE below refuses to run while any
        // session is connected to the source, and the child has fully exited by
        // the time this await resolves. Do not "optimise" it into the parent.
        try {
          await runMigrate(migrateScript, templateUrl);
        } catch (err) {
          // A half-migrated template is useless and would otherwise sit on the
          // server until a sweep finds it: drop it before failing the run.
          await sweep.forceDropDatabase(lockClient, templateName).catch((dropErr) => {
            process.stderr.write(`[jest] could not drop the failed template ${templateName}: ${dropErr.message}\n`);
          });
          throw err;
        }

        // 2. Clone it per worker. A file-level copy, so each worker DB is
        //    byte-identical to the migrated template (labels are per database,
        //    so each clone gets its own).
        for (const w of workers) {
          await dropAndCreate(lockClient, w.name, templateName);
          await label(lockClient, w.name);
          // Throwaway per-worker database: a lost commit on crash is
          // meaningless here, and this takes the WAL fsync out of the ~2100
          // clean-and-reseed cycles a full run performs.
          await lockClient.query(
            `ALTER DATABASE "${w.name}" SET synchronous_commit = off`
          );
        }
      } finally {
        await lockClient.query('SELECT pg_advisory_unlock($1, $2)', lockKeys);
      }
    } finally {
      lockClient.release();
    }
  } finally {
    await admin.end();
  }
};

// Label a database this run created (tests/lib/testDbSweep.js). Best effort:
// an unlabelled database is still swept (by age), so a failure only warns.
async function label(client, name) {
  try {
    await sweep.labelDatabase(client, name, sweep.buildLabel('jest'));
  } catch (err) {
    log(`could not label ${name}: ${err.message}`);
  }
}

// Ctrl-C / kill / hang-up skip globalTeardown, which is how test databases
// used to pile up. On those signals, hand the drop to a detached child that
// outlives this process — scripts/drop-test-dbs.js --base, which only drops
// this base's databases labelled with THIS pid and only once their sessions
// are gone — then exit with the conventional status. A hard kill (SIGKILL,
// closing the terminal on Windows) runs nothing; the next run's sweep sees the
// dead pid and drops them then.
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

function installInterruptCleanup(dbName) {
  const script = path.join(__dirname, '..', 'scripts', 'drop-test-dbs.js');
  const handlers = {};
  for (const sig of Object.keys(SIGNAL_EXIT)) {
    handlers[sig] = () => {
      try {
        const child = spawn(
          process.execPath,
          [script, '--base', dbName, '--owner-pid', String(process.pid), '--wait', '--yes'],
          { detached: true, stdio: 'ignore', windowsHide: true, env: process.env }
        );
        child.on('error', () => {});
        child.unref();
        process.stderr.write(`\n[jest] ${sig}: dropping ${dbName}'s test databases in the background\n`);
      } catch { /* the next run's sweep is the fallback */ }
      process.exit(SIGNAL_EXIT[sig]);
    };
    process.once(sig, handlers[sig]);
  }
  // globalTeardown removes them: after a normal run there is nothing to clean.
  globalThis.__testDbInterruptHandlers = handlers;
}

// Exposed for tooling checks (the handler itself exits the process).
module.exports.installInterruptCleanup = installInterruptCleanup;

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
