// Runs once after all test suites complete (forceExit in jest.config.js
// handles open handles).
//
// Drops every database this run's BASE owns — the template, the per-worker
// clones and any worker's extra databases (workerDb.extraTestDbUrl) — found by
// pattern (`^<root>_(w<N>|tmpl)(_<extra>)?_test$`, workerDb.runDbPattern), not
// by counting 1..maxWorkers, so a leftover from an earlier run with more
// workers goes too. `DROP DATABASE … WITH (FORCE)` (PG ≥ 13; CI runs 16), so a
// straggling fire-and-forget session cannot keep one alive. They are rebuilt
// from scratch by globalSetup on every run anyway, so nothing is lost.
//
// A drop that fails makes the run fail, loudly: a leak that only prints to
// stderr is how 746 of them piled up on the shared server (2026-09-26).
//
// KEEP_TEST_DB=1 keeps them to inspect after a failure; this prints the exact
// command that drops them, and marks them `keep` so the next run's sweep gives
// them 6 h instead of dropping them as soon as it sees this pid is gone.
const { Pool } = require('pg');
const { baseTestUrl, adminDbUrl, runDbPattern } = require('./workerDb');
const sweep = require('./lib/testDbSweep');

module.exports = async function globalTeardown() {
  // After a normal run there is nothing for the interrupt handlers to do.
  const handlers = globalThis.__testDbInterruptHandlers || {};
  for (const [sig, fn] of Object.entries(handlers)) process.removeListener(sig, fn);
  delete globalThis.__testDbInterruptHandlers;

  // globalSetup pinned the resolved base into TEST_DATABASE_URL, so this
  // resolves to the same names it created.
  const baseUrl = baseTestUrl();
  const dbName = new URL(baseUrl).pathname.replace(/^\//, '');
  const pattern = runDbPattern(dbName);
  const root = dbName.replace(/_test$/, '');

  const admin = new Pool({ connectionString: adminDbUrl(baseUrl) });
  try {
    const { rows } = await admin.query(
      'SELECT datname FROM pg_database WHERE starts_with(datname, $1) ORDER BY datname',
      [`${root}_`]
    );
    const names = rows.map((r) => r.datname).filter((n) => pattern.test(n));
    const host = require('os').hostname();
    // Scoped names cannot collide since workerDb appends `_b` to a slug that
    // ends like a run infix, but a database another run labelled — another
    // host, or a different live pid here — is never this run's to touch.
    const foreignOwner = (label) => {
      if (!label) return null;
      if (label.host && label.host !== host) return `labelled on host ${label.host}`;
      const pid = Number(label.pid);
      const mine = pid === process.pid || pid === Number(process.env.TEST_DB_OWNER_PID);
      if (!mine && sweep.isPidAlive(pid)) return `owned by live pid ${label.pid}`;
      return null;
    };

    if (process.env.KEEP_TEST_DB) {
      const client = await admin.connect();
      try {
        for (const name of names) {
          const label = await sweep.readLabel(client, name);
          if (foreignOwner(label)) continue;
          await sweep.labelDatabase(client, name, { ...(label || sweep.buildLabel('jest')), keep: true })
            .catch(() => {});
        }
      } finally {
        client.release();
      }
      process.stdout.write(
        `[jest] KEEP_TEST_DB set — keeping ${names.join(', ') || '(none found)'}\n` +
        `[jest] drop them with:  npm run test:db:clean -- --base ${dbName} --yes\n` +
        names.map((n) => `[jest]   or in psql:     DROP DATABASE "${n}" WITH (FORCE);\n`).join('')
      );
      return;
    }

    const failures = [];
    const client = await admin.connect();
    try {
      for (const name of names) {
        try {
          const foreign = foreignOwner(await sweep.readLabel(client, name));
          if (foreign) {
            process.stdout.write(`[jest] keeping ${name}: ${foreign}\n`);
            continue;
          }
          await sweep.forceDropDatabase(client, name);
        } catch (err) {
          failures.push(`${name}: ${err.message}`);
        }
      }
    } finally {
      client.release();
    }
    if (failures.length) {
      const msg =
        `[jest] could not drop ${failures.length} test database(s) — they are LEFT ON THE SERVER:\n` +
        failures.map((f) => `  ${f}\n`).join('') +
        `  Retry: npm run test:db:clean -- --base ${dbName} --yes\n`;
      process.stderr.write(msg);
      throw new Error(`globalTeardown: ${failures.length} test database(s) could not be dropped (see above).`);
    }
  } finally {
    await admin.end();
  }
};
