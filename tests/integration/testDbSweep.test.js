'use strict';

// The test-database sweep against real Postgres (tests/lib/testDbSweep.js):
// creates clearly-named throwaway databases under a prefix no product uses
// (`zzsw<pid>_…`), labels them, runs the sweep and checks which survive.
// Cleans up after itself, whatever happens. The pure rule table is unit-tested
// in tests/unit/testDbSweep.test.js.
const os = require('os');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
const { adminDbUrl } = require('../workerDb');
const sweep = require('../lib/testDbSweep');

// Every DROP DATABASE forces an immediate checkpoint, and in a full run that
// checkpoint also works off the other workers' cleanup backlog — so give this
// suite's database DDL room (docs/TESTING.md, TRUNCATE vs DELETE).
jest.setTimeout(240000);

const PREFIX = `zzsw${process.pid}`;
const HOUR = 60 * 60 * 1000;
const n = (s) => `${PREFIX}_${s}`;

let admin;
let deadPid;

async function exists(name) {
  const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  return rows.length === 1;
}

async function create(name, label) {
  await admin.query(`CREATE DATABASE "${name}"`);
  if (label) await sweep.labelDatabase(admin, name, label);
}

function jestLabel(over = {}) {
  return {
    kind: 'jest', product: PREFIX, repo: __dirname, branch: 'feat/sweep', pid: process.pid,
    host: os.hostname(), createdAt: new Date().toISOString(), ...over,
  };
}

async function dropAll() {
  const { rows } = await admin.query(
    'SELECT datname FROM pg_database WHERE starts_with(datname, $1)', [`${PREFIX}_`]
  );
  for (const { datname } of rows) await sweep.forceDropDatabase(admin, datname);
}

beforeAll(async () => {
  admin = new Client({ connectionString: adminDbUrl(process.env.DATABASE_URL) });
  await admin.connect();
  await dropAll();
  // A pid that certainly belonged to a process that has exited.
  deadPid = spawnSync(process.execPath, ['-e', '0']).pid;
});

afterAll(async () => {
  try {
    await dropAll();
  } finally {
    await admin.end();
  }
});

describe('labels', () => {
  test('a label round-trips, quotes and all (the COMMENT is built with format %I/%L)', async () => {
    const name = n('lbl_w1_test');
    const label = jestLabel({ repo: "C:/it's/a \"path\"; DROP DATABASE x; --" });
    await create(name, label);
    expect(await sweep.readLabel(admin, name)).toEqual(label);
    await sweep.forceDropDatabase(admin, name);
    expect(await exists(name)).toBe(false);
  });

  test('forceDropDatabase drops a database with a live session, and refuses a non-_test name', async () => {
    const name = n('force_w1_test');
    await create(name);
    const holder = new Client({ connectionString: adminDbUrl(process.env.DATABASE_URL).replace(/\/postgres$/, `/${name}`) });
    await holder.connect();
    holder.on('error', () => {}); // its session is about to be terminated
    await sweep.forceDropDatabase(admin, name);
    expect(await exists(name)).toBe(false);
    await holder.end().catch(() => {});
    await expect(sweep.forceDropDatabase(admin, `${PREFIX}_books`)).rejects.toThrow(/must end in _test/);
  });
});

describe('runSweep rules', () => {
  test('drops the dead, the old and the idle; keeps the live, the busy and the unrelated', async () => {
    const e2eLabel = (over) => jestLabel({ kind: 'e2e', lastUsedAt: new Date().toISOString(), ...over });
    await create(n('dead_w1_test'), jestLabel({ pid: deadPid }));
    await create(n('live_w1_test'), jestLabel());
    await create(n('old_w1_test'), jestLabel({ createdAt: new Date(Date.now() - 7 * HOUR).toISOString() }));
    await create(n('busy_w1_test'), jestLabel({ pid: deadPid }));
    await create(n('fresh_w1_test')); // unlabelled, seconds old
    await create(n('e2e_idle_test'), e2eLabel({ lastUsedAt: new Date(Date.now() - 15 * 24 * HOUR).toISOString() }));
    await create(n('e2e_fresh_test'), e2eLabel());
    await create(n('plain_test'), jestLabel({ pid: deadPid })); // not a derived name
    await create(n('notes_w1_test'));
    await admin.query(`COMMENT ON DATABASE "${n('notes_w1_test')}" IS 'kept by hand'`);

    // The age of an unlabelled database comes from its files (superuser here).
    const listed = await sweep.listTestDbs(admin, [PREFIX]);
    const fresh = listed.find((d) => d.name === n('fresh_w1_test'));
    expect(fresh.ageMs).not.toBeNull();
    expect(fresh.ageMs).toBeLessThan(HOUR);

    const holder = new Client({ connectionString: adminDbUrl(process.env.DATABASE_URL).replace(/\/postgres$/, `/${n('busy_w1_test')}`) });
    await holder.connect();
    let plan;
    try {
      const lines = [];
      plan = await sweep.runSweep(admin, {
        mode: 'rules', prefixes: [PREFIX], product: PREFIX, log: (m) => lines.push(m), branchExists: () => true,
      });
      expect(lines.join('\n')).toMatch(/dropped .*dead_w1_test/);
    } finally {
      await holder.end();
    }

    const byName = Object.fromEntries(plan.map((p) => [p.name, p.drop]));
    expect(byName).toEqual({
      [n('busy_w1_test')]: false,
      [n('dead_w1_test')]: true,
      [n('e2e_fresh_test')]: false,
      [n('e2e_idle_test')]: true,
      [n('fresh_w1_test')]: false,
      [n('live_w1_test')]: false,
      [n('notes_w1_test')]: false,
      [n('old_w1_test')]: true,
    });
    for (const [name, dropped] of Object.entries(byName)) expect(await exists(name)).toBe(!dropped);
    expect(await exists(n('plain_test'))).toBe(true);
  });

  test('dry run lists and drops nothing', async () => {
    await create(n('dry_w1_test'), jestLabel({ pid: deadPid }));
    const plan = await sweep.runSweep(admin, { mode: 'rules', prefixes: [PREFIX], product: PREFIX, dryRun: true });
    expect(plan.find((p) => p.name === n('dry_w1_test')).drop).toBe(true);
    expect(await exists(n('dry_w1_test'))).toBe(true);
  });
});

describe('runSweep base', () => {
  test('drops one interrupted run\'s set, owned by its pid, and nothing else', async () => {
    await create(n('run_tmpl_test'), jestLabel({ pid: deadPid }));
    await create(n('run_w1_test'), jestLabel({ pid: deadPid }));
    await create(n('run_w1_extra_test'));
    await create(n('run_w2_test'), jestLabel({ pid: deadPid + 1 }));
    await create(n('runx_w1_test'), jestLabel({ pid: deadPid }));
    await sweep.runSweep(admin, {
      mode: 'base', base: n('run_test'), ownerPid: deadPid, prefixes: [PREFIX], product: PREFIX,
    });
    expect(await exists(n('run_tmpl_test'))).toBe(false);
    expect(await exists(n('run_w1_test'))).toBe(false);
    expect(await exists(n('run_w1_extra_test'))).toBe(false);
    expect(await exists(n('run_w2_test'))).toBe(true);
    expect(await exists(n('runx_w1_test'))).toBe(true);
  });
});
