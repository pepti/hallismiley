// Migration runner transactionality — server/scripts/migrate.js.
//
// The runner applies each migration's statements and then records it in
// schema_migrations. Without a transaction around the pair, a migration that
// fails half-way leaves its earlier statements applied but unrecorded, so the
// next boot replays them and crash-loops the deploy (boot-time migrations run
// before app.listen). These tests pin the rollback behaviour.
//
// schema.js is mocked so the real 88-migration list isn't involved; the array
// is mutated in place because migrate.js destructures it at require time.
const mockMigrations = [];
jest.mock('../../server/config/schema', () => ({ migrations: mockMigrations }));

const { migrate } = require('../../server/scripts/migrate');
const db = require('../../server/config/database');

const PROBE = 'migrate_tx_probe';

async function probeExists() {
  const { rows } = await db.query("SELECT to_regclass($1) AS reg", [`public.${PROBE}`]);
  return rows[0].reg !== null;
}

async function isRecorded(name) {
  const { rows } = await db.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
  return rows.length > 0;
}

async function cleanup() {
  await db.query(`DROP TABLE IF EXISTS ${PROBE}`);
  await db.query("DELETE FROM schema_migrations WHERE name LIKE 'zz_test_%'");
}

beforeEach(async () => {
  mockMigrations.length = 0;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe('migrate() — one transaction per migration', () => {
  it('rolls back every statement when a later one fails, and records nothing', async () => {
    mockMigrations.push({
      name: 'zz_test_partial_failure',
      statements: [
        `CREATE TABLE ${PROBE} (id INT PRIMARY KEY)`,
        'SELECT * FROM a_table_that_does_not_exist',
      ],
    });

    await expect(migrate()).rejects.toThrow(/zz_test_partial_failure/);

    // The first statement succeeded inside the transaction — it must be gone.
    expect(await probeExists()).toBe(false);
    expect(await isRecorded('zz_test_partial_failure')).toBe(false);
  });

  it('leaves the failure retryable — a fixed migration applies cleanly next run', async () => {
    mockMigrations.push({
      name: 'zz_test_retryable',
      statements: [
        `CREATE TABLE ${PROBE} (id INT PRIMARY KEY)`,
        'SELECT * FROM a_table_that_does_not_exist',
      ],
    });
    await expect(migrate()).rejects.toThrow();

    // Same migration name, now corrected — this is the crash-loop scenario:
    // without rollback the CREATE would fail with "already exists" forever.
    mockMigrations[0].statements = [`CREATE TABLE ${PROBE} (id INT PRIMARY KEY)`];

    await expect(migrate()).resolves.toBeUndefined();
    expect(await probeExists()).toBe(true);
    expect(await isRecorded('zz_test_retryable')).toBe(true);
  });

  it('commits a successful migration and skips it on re-run', async () => {
    mockMigrations.push({
      name: 'zz_test_success',
      statements: [`CREATE TABLE ${PROBE} (id INT PRIMARY KEY)`],
    });

    await migrate();
    expect(await isRecorded('zz_test_success')).toBe(true);

    // A second run must not replay the statement (CREATE TABLE would throw).
    await expect(migrate()).resolves.toBeUndefined();
  });

  it('does not apply migrations queued after the one that failed', async () => {
    mockMigrations.push(
      {
        name: 'zz_test_first_fails',
        statements: ['SELECT * FROM a_table_that_does_not_exist'],
      },
      {
        name: 'zz_test_never_reached',
        statements: [`CREATE TABLE ${PROBE} (id INT PRIMARY KEY)`],
      },
    );

    await expect(migrate()).rejects.toThrow(/zz_test_first_fails/);
    expect(await isRecorded('zz_test_never_reached')).toBe(false);
    expect(await probeExists()).toBe(false);
  });
});
