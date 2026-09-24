// Versioned migration runner.
// Applies pending migrations from server/config/migrationSet.js (the engine
// array in schema.js followed by this product's array) and records them in
// the schema_migrations table so each migration only ever runs once.
//
// Run standalone: node server/scripts/migrate.js
//   --plan   print what a run WOULD do (RUN / ALIAS via <name> / SUPERSEDED /
//            applied) and exit without executing — the pre-flight before a
//            downstream boots a merged engine for the first time.
// Called on deploy: imported and invoked by server/server.js before app.listen
//
// Aliases and superseded entries (stack invariant #4): a downstream's database
// may already hold an engine migration under another name (the same DDL was
// numbered differently before the repos shared history), or may carry a
// product-specific variant that the engine entry must never overwrite. The
// product file declares those; the runner then RECORDS the engine name as
// applied — with the reason in resolved_from — instead of executing it. Both
// happen under the same advisory lock and are printed, so a first boot on a
// grafted database is legible in the log.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });
const logger = require('../logger');
const { pool } = require('../config/database');
const { migrations, aliases, superseded } = require('../config/migrationSet');

// Arbitrary but fixed key for the session-level advisory lock. Any process
// running this runner against the same database contends on it.
const MIGRATION_LOCK_ID = 725_100_318;

// --plan is a report for the human at the terminal, whatever NODE_ENV or
// LOG_LEVEL say (pino is disabled under NODE_ENV=test). Everything a BOOT
// prints goes through pino instead: server.js runs this at every container
// start, so a failed migration must reach the same log stream (and App
// Insights) as any other boot failure (icelandicstore #254).
function planLine(text) { process.stdout.write(text + '\n'); }

async function migrate(options = {}) {
  const plan = Boolean(options.plan);
  const client = await pool.connect();
  let lockHeld = false;
  try {
    // ── Serialise concurrent runners ────────────────────────────────────────
    // Since PROD moved to a tier with deployment slots, two containers can boot
    // at once against the SAME database: the staging slot warming up while the
    // production slot still serves. Both call this runner. Without a lock they
    // race — the "already applied?" SELECT can pass in both before either
    // INSERT lands, so a migration runs twice (its second run failing on an
    // existing object and crash-looping the new container).
    //
    // pg_advisory_lock is session-scoped, so it is held across the per-migration
    // transactions below and released by the explicit unlock (or automatically
    // if the connection dies). The second booter simply waits here, then finds
    // everything applied and continues.
    // pg_advisory_lock BLOCKS, and the pool sets statement_timeout (see
    // config/database.js) — which applies to it. Left alone, the waiting
    // booter is cancelled with 57014 the moment the first booter takes
    // longer than that timeout to migrate, and exits(1) instead of waiting:
    // a crash-loop in exactly the slot-swap case this lock exists for.
    // Disable the timeout on THIS session only (it is our own dedicated
    // client), then restore it before the client goes back to the pool.
    await client.query('SET statement_timeout = 0');
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    lockHeld = true;

    // Ensure the tracking table exists before anything else
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    // resolved_from records WHY a name is marked applied without having run:
    // the product name it was aliased to, or "superseded: <reason>". NULL for
    // an entry the runner executed. Additive, so an older container reading
    // this table during a swap is unaffected (invariant 14).
    await client.query(
      'ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS resolved_from VARCHAR(255)'
    );

    const appliedRows = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(appliedRows.rows.map(r => r.name));

    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        if (plan) planLine(`[migrate:plan] applied     ${migration.name}`);
        continue; // already applied
      }

      const via = (aliases[migration.name] || []).find(n => applied.has(n));
      if (via) {
        if (plan) { planLine(`[migrate:plan] ALIAS       ${migration.name} via ${via}`); continue; }
        await client.query(
          'INSERT INTO schema_migrations (name, resolved_from) VALUES ($1, $2)',
          [migration.name, via]
        );
        applied.add(migration.name);
        logger.info({ migration: migration.name, via }, '[migrate] Recorded as applied via alias');
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(superseded, migration.name)) {
        const reason = String(superseded[migration.name]);
        if (plan) { planLine(`[migrate:plan] SUPERSEDED  ${migration.name} (${reason})`); continue; }
        await client.query(
          'INSERT INTO schema_migrations (name, resolved_from) VALUES ($1, $2)',
          [migration.name, `superseded: ${reason}`.slice(0, 255)]
        );
        applied.add(migration.name);
        logger.info({ migration: migration.name, reason }, '[migrate] Skipped (superseded)');
        continue;
      }

      if (plan) { planLine(`[migrate:plan] RUN         ${migration.name}`); continue; }

      // One transaction per migration, covering the bookkeeping row: a migration
      // that fails half-way must leave no trace, or the next boot replays its
      // already-applied statements and crash-loops the deploy. Postgres runs DDL
      // transactionally, and no migration here uses a statement that cannot run
      // inside a transaction block (CREATE INDEX CONCURRENTLY, VACUUM).
      const startedAt = Date.now();
      await client.query('BEGIN');
      try {
        for (const sql of migration.statements) {
          await client.query(sql);
        }
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [migration.name]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        err.message = `migration ${migration.name} failed and was rolled back: ${err.message}`;
        throw err;
      }
      applied.add(migration.name);
      // `ms` is the boot cost per migration (icelandicstore #296): a new image
      // migrates the live database before it serves, so a slow one shows here.
      logger.info({ migration: migration.name, ms: Date.now() - startedAt }, '[migrate] Applied');
    }

    if (plan) planLine('[migrate:plan] Nothing was executed.');
    else logger.info('[migrate] All migrations up to date.');
  } finally {
    // Release before returning the connection to the pool: a pooled connection
    // is reused, and a session-level advisory lock left held would travel with
    // it and deadlock the next boot.
    // Undo the SET above before the client goes back to the pool, where the
    // next borrower would inherit an unlimited statement_timeout.
    await client.query('RESET statement_timeout').catch(() => {});
    if (lockHeld) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
      } catch (err) {
        logger.warn({ err }, '[migrate] advisory unlock failed');
      }
    }
    client.release();
  }
}

module.exports = { migrate };

// When invoked directly: node server/scripts/migrate.js [--plan]
if (require.main === module) {
  migrate({ plan: process.argv.includes('--plan') })
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(err => {
      // stderr as well as pino: pino is disabled under NODE_ENV=test, and the
      // one line that says why a standalone run failed must never be lost.
      process.stderr.write(`Migration failed: ${err.message}\n`);
      logger.fatal({ err }, 'Migration failed');
      logger.flush(() => process.exit(1));
    });
}
