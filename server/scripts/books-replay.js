#!/usr/bin/env node
// Replay a period of history through the books and diff the derived VSK return
// against the figures that were actually filed.
//
// WHY THIS EXISTS
//
// A ledger can pass every test it was written with and still be wrong about the
// one thing that matters: the return a real business filed for a real period. The
// parallel run answers that once ("is the figure right this time?"). This script
// turns the answer into a fixture, so it is asked again after every change to the
// books code — and at a customer's cutover, "does our ledger reproduce the
// incumbent's numbers?" is the same question with a different case file.
//
// WHAT IT DOES
//
//   1. Refuses unless the target database's name ends in `_replay`. A replay
//      DROPS AND RECREATES the public schema of its target; that guard is the one
//      property that lets anyone run this without fear, and there is no flag that
//      relaxes it.
//   2. Migrates the empty schema, creates a `replay` actor, and applies the case
//      through the real services (see server/services/bookkeeping/replay.js).
//   3. Derives the return, the preflight and the trial balance, and prints the
//      comparison box by box — D split into domestic and reverse charge, because a
//      reverse-charge error moves D and E together and leaves F looking right.
//
// Stub documents are written under a TEMP directory, never under the configured
// BOOKS_UPLOAD_ROOT: a replay must not leave placeholder PDFs among real fylgiskjöl.
//
// USAGE
//
//   createdb orangesmiley_replay                         # once
//   npm run books:replay -- --case=server/fixtures/books-replay/2026-P4-orangesmiley.json
//   npm run books:replay -- --all
//   npm run books:replay -- --case=D:/customer1/2025-P6.json --db=postgresql://…/customer1_replay
//   npm run books:replay -- --all --json
//
//   --case=PATH      a case file. Repeatable. Customer cases live OUTSIDE this repo.
//   --all            every case under server/fixtures/books-replay/.
//   --db=URL         the target database (name must end in _replay). Default:
//                    REPLAY_DATABASE_URL, else DATABASE_URL with `_replay` appended
//                    to the database name.
//   --json           machine-readable output (one JSON object per case).
//
// EXIT CODES
//
//   0   every case matched (or is "pending" — derived figures printed, nothing compared)
//   1   at least one case did not match
//   2   a case could not be applied, or the target could not be prepared

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ReplayError, assertReplayDatabase, replayUrlFrom, formatReport,
} = require('../services/bookkeeping/replayCase');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'books-replay');

function usage() {
  const header = fs.readFileSync(__filename, 'utf8').split('\n')
    .filter(l => l.startsWith('//')).map(l => l.replace(/^\/\/ ?/, '')).join('\n');
  return header;
}

function parseArgs(argv) {
  const args = { cases: [], all: false, db: null, json: false, help: false };
  for (const raw of argv.slice(2)) {
    if (raw === '--all') { args.all = true; continue; }
    if (raw === '--json') { args.json = true; continue; }
    if (raw === '--help' || raw === '-h') { args.help = true; continue; }
    const m = raw.match(/^--([a-z-]+)=(.*)$/);
    if (!m) throw new Error(`Unrecognised argument: ${raw}`);
    const [, key, value] = m;
    if (key === 'case') args.cases.push(value);
    else if (key === 'db') args.db = value;
    else throw new Error(`Unrecognised argument: --${key}`);
  }
  return args;
}

// Drop and recreate the public schema. The migration chain declares no extensions
// (gen_random_uuid() is built in), so an empty `public` plus migrate() is a full
// reset without needing rights on the admin database.
async function resetSchema(db) {
  await db.query('DROP SCHEMA public CASCADE');
  await db.query('CREATE SCHEMA public');
}

// Every posting needs a person (Reglugerð 505/2013 gr. 8; created_by is NOT NULL).
async function ensureActor(db) {
  const { rows } = await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ('replay', 'replay@localhost', 'replay', 'replay-cannot-log-in', 'admin', TRUE)
     ON CONFLICT (username) DO UPDATE SET role = 'admin'
     RETURNING id`
  );
  return rows[0].id;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { process.stdout.write(`${usage()}\n`); return 0; }

  // 1. Resolve and assert the target BEFORE requiring anything that opens a pool.
  const target = args.db
    || process.env.REPLAY_DATABASE_URL
    || replayUrlFrom(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/orangesmiley');
  const { url, dbName } = assertReplayDatabase(target);
  process.env.DATABASE_URL = url;
  if (!process.env.DB_SSL) process.env.DB_SSL = 'false';
  // Stubs go to a temp directory, never among real fylgiskjöl.
  process.env.BOOKS_UPLOAD_ROOT = path.join(os.tmpdir(), 'books-replay', dbName);

  // 2. Cases — parsed and validated before anything is wiped.
  let files = [...args.cases];
  if (args.all && fs.existsSync(FIXTURE_DIR)) {
    files.push(...fs.readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.json')).map(f => path.join(FIXTURE_DIR, f)));
  }
  files = [...new Set(files.map(f => path.resolve(f)))];
  if (!files.length) throw new Error('Nothing to run: pass --case=PATH (repeatable) or --all.\n\n' + usage());

  // The services log every posting at info level; that is right for a server and
  // noise between the rows of a report. Quiet unless the caller asked otherwise.
  if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'warn';

  const replay = require('../services/bookkeeping/replay');
  const loaded = files.map(replay.loadCase);

  const db = require('../config/database');
  const { migrate } = require('./migrate');
  const ledger = require('../services/bookkeeping/ledgerService');

  let worst = 0;
  try {
    for (const c of loaded) {
      try {
        await resetSchema(db);
      } catch (err) {
        if (err.code === '3D000') {
          throw new Error(`Database "${dbName}" does not exist. Create it once: createdb ${dbName}`, { cause: err });
        }
        throw err;
      }
      await migrate();
      ledger.invalidateAccountCache();
      const actorId = await ensureActor(db);

      let result;
      try {
        result = await ledger.withTransaction(client => replay.replayCase(client, c, { actorId }));
      } catch (err) {
        // A case that cannot be APPLIED is a different failure from a wrong number.
        worst = Math.max(worst, 2);
        const msg = `books:replay — ${c.def.case}: could not apply the case: ${err.message}`;
        process.stdout.write(args.json ? `${JSON.stringify({ case: c.def.case, error: err.message, code: err.code || null })}\n` : `${msg}\n`);
        continue;
      }

      if (args.json) {
        const { def, meta, derived, preflight, trialBalance, comparison, preflightComparison, counts, ok } = result;
        process.stdout.write(`${JSON.stringify({
          case: def.case, period: def.period, range: meta.bounds, pending: meta.pending, ok,
          derived: Object.fromEntries(Object.entries(derived).filter(([k]) => k !== 'detail')),
          comparison, preflight: preflight.findings.map(f => ({ level: f.level, code: f.code })),
          preflightComparison, trialBalance: { balanced: trialBalance.balanced, difference: trialBalance.difference },
          counts,
        })}\n`);
      } else {
        process.stdout.write(`${formatReport(result)}\n\n`);
      }
      if (result.ok === false) worst = Math.max(worst, 1);
    }
  } finally {
    await db.pool.end().catch(() => {});
  }
  return worst;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    const prefix = err instanceof ReplayError ? `books:replay (${err.code})` : 'books:replay';
    process.stderr.write(`${prefix}: ${err.message}\n`);
    process.exit(2);
  });
