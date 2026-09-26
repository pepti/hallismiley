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

// The `zzsw<pid>_` names are deliberately outside every product's prefix (the
// suite runs the real sweep and must not meet a real run's databases), so no
// teardown or sweep owns them: a run killed before afterAll would leak its
// set. This suite owns them instead — on the way in it drops every
// `zzsw<pid>_…_test` whose pid is dead and that no session holds (a live pid
// is another run of this suite, in another worktree, on the same server). The
// pid is only meaningful on this host, so a set labelled by another host is
// left alone (its own next run cleans it).
async function dropOrphans() {
  const { rows } = await admin.query(
    `SELECT d.datname,
            (SELECT count(*)::int FROM pg_stat_activity a WHERE a.datname = d.datname) AS sessions
       FROM pg_database d
      WHERE d.datname ~ '^zzsw[0-9]+_.*_test$'`
  );
  for (const { datname, sessions } of rows) {
    const pid = Number(/^zzsw(\d+)_/.exec(datname)[1]);
    if (pid === process.pid || sessions > 0 || sweep.isPidAlive(pid)) continue;
    const label = await sweep.readLabel(admin, datname);
    if (label && label.host && label.host !== os.hostname()) continue;
    await sweep.forceDropDatabase(admin, datname);
  }
}

beforeAll(async () => {
  admin = new Client({ connectionString: adminDbUrl(process.env.DATABASE_URL) });
  await admin.connect();
  await dropOrphans();
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

describe('this suite\'s own leftovers', () => {
  test('a killed run\'s zzsw set is dropped on the way in; a live pid\'s set is kept', async () => {
    const dead = `zzsw${deadPid}_orphan_w1_test`;
    const live = `zzsw${process.ppid}_live_w1_test`;
    const elsewhere = `zzsw${deadPid}_elsewhere_w1_test`;
    try {
      await admin.query(`CREATE DATABASE "${dead}"`);
      await admin.query(`CREATE DATABASE "${live}"`);
      await create(elsewhere, jestLabel({ pid: deadPid, host: 'another-host' }));
      await dropOrphans();
      expect(await exists(dead)).toBe(false);
      expect(await exists(live)).toBe(true);
      expect(await exists(elsewhere)).toBe(true); // a pid from another host proves nothing
    } finally {
      await sweep.forceDropDatabase(admin, dead);
      await sweep.forceDropDatabase(admin, live);
      await sweep.forceDropDatabase(admin, elsewhere);
    }
  });
});
