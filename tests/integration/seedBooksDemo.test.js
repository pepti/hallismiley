// `npm run seed:books -- --wipe` never deletes a real book-keeping row.
//
// Ported from icelandicstore #427 (seed:bookkeeping never deletes a real
// expense). Before harvest 2 the wipe ran `DELETE FROM` on every books table —
// invoices, payments, credit notes, expenses, journal entries, VAT returns, the
// audit log — and reset the invoice counter to 1001, guarded only by
// NODE_ENV=production. On the private books instance (docs/BOOKS-PARALLEL-RUN.md)
// that is the company's real ledger.
const os = require('os');
const path = require('path');

// The seed writes stand-in receipt PDFs under BOOKS_UPLOAD_ROOT/demo; keep them
// out of the checkout. paths.js reads this at require time.
process.env.BOOKS_UPLOAD_ROOT = path.join(os.tmpdir(), `seed-books-demo-test-${process.pid}`);

const db = require('../../server/config/database');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const expenses = require('../../server/services/bookkeeping/expenseService');
const seed = require('../../server/scripts/seed-books-demo');
const { cleanTables, createTestAdminUser } = require('../helpers');

let adminId;

async function seedDemo() {
  ledger.invalidateAccountCache();
  await seed.ensureSeller();
  await seed.ensureFxRates();
  const bySku = await seed.ensureProducts();
  await seed.seedSales(adminId, bySku);
  await seed.seedExpenses(adminId);
}

async function count(table) {
  const { rows } = await db.query(`SELECT COUNT(*)::int n FROM ${table}`);
  return rows[0].n;
}

async function counts() {
  const out = {};
  for (const t of ['invoices', 'payments', 'credit_notes', 'expenses', 'journal_entries', 'books_documents']) {
    out[t] = await count(t);
  }
  return out;
}

// Quiet the script's progress lines.
let stdoutSpy;
beforeAll(async () => {
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await cleanTables();
  adminId = await createTestAdminUser();
});

afterAll(async () => {
  stdoutSpy.mockRestore();
  await cleanTables();
  await db.query(`DELETE FROM products WHERE slug LIKE 'demo-%'`);
  await db.pool.end();
});

describe('seed:books --wipe', () => {
  test('on books that hold only the demo, removes every row it seeded and restarts the series', async () => {
    await seedDemo();
    const before = await counts();
    expect(before.invoices).toBe(seed.ORDERS.length);
    expect(before.expenses).toBe(seed.EXPENSES.length);

    await seed.wipe();

    expect(await counts()).toEqual({
      invoices: 0, payments: 0, credit_notes: 0, expenses: 0, journal_entries: 0, books_documents: 0,
    });
    expect(await count(`orders WHERE guest_email LIKE '%@demo.%'`)).toBe(0);
    expect(await count(`products WHERE slug LIKE 'demo-%'`)).toBe(0);
    const { rows } = await db.query(`SELECT next_value FROM bookkeeping_counters WHERE name = 'invoice'`);
    expect(Number(rows[0].next_value)).toBe(1001);
  });

  test('refuses — deleting nothing — once the books hold a row a person entered', async () => {
    await seedDemo();
    const { expense: real } = await ledger.withTransaction(c => expenses.createExpense(c, {
      supplierName: 'Veitur', supplierVatNumber: '12345', supplierCountry: 'IS',
      supplierInvoiceNo: 'VT-2026-09', expenseDate: new Date().toISOString().slice(0, 10),
      amountGross: 51234, accountCode: '6400', vatCode: 'input_24',
      description: 'Rafmagn — raunreikningur', createdBy: adminId,
    }));
    const before = await counts();

    await expect(seed.wipe()).rejects.toMatchObject({
      code: 'UNSEEDED_BOOKS',
      unseeded: expect.arrayContaining([
        { table: 'expenses', count: 1 },
        { table: 'journal_entries', count: 1 },
      ]),
    });

    expect(await counts()).toEqual(before);
    expect(await count(`expenses WHERE id = '${real.id}'`)).toBe(1);
    // The rollback put every immutability trigger back ('O' = enabled).
    const { rows } = await db.query(
      `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE 'trg_%' AND tgenabled <> 'O'
         AND tgrelid IN ('invoices'::regclass, 'expenses'::regclass, 'journal_entries'::regclass,
                         'journal_lines'::regclass, 'payments'::regclass)`
    );
    expect(rows).toEqual([]);
  });

  test('main() refuses a deployed environment before its first query', async () => {
    const saved = process.env.APP_ENV;
    process.env.APP_ENV = 'production';
    const querySpy = jest.spyOn(db, 'query');
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await seed.main(['node', 'seed-books-demo.js', '--wipe'])).toBe(1);
      expect(querySpy).not.toHaveBeenCalled();
      expect(stderr.mock.calls.join('')).toMatch(/REFUSING TO RUN: APP_ENV is "production"/);
    } finally {
      querySpy.mockRestore();
      stderr.mockRestore();
      if (saved === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = saved;
    }
  });
});
