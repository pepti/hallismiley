// The ledger reports, and the archive that has to outlive the application.
//
// The property that matters throughout: the four reports are four views of ONE set of
// posted journal lines, so they cannot disagree. Specifically —
//
//   trial balance   debits equal credits, always, because a trigger enforces it
//   P&L             revenue − expenses, from the same lines
//   balance sheet   assets = liabilities + equity, where equity INCLUDES the derived
//                   retained earnings; this is the assertion that would fail if the
//                   "no year-end close" decision were quietly broken
//   account ledger  opening + movements = closing, tying to the trial balance
//
// Assertions are DELTAS wherever the figure depends on history. The journal is
// append-only by design, so there is no DELETE to reset between tests and an absolute
// assertion drifts the moment another test is added above it.
const db = require('../../server/config/database');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const reports = require('../../server/services/bookkeeping/reportService');
const invoices = require('../../server/services/bookkeeping/invoiceService');
const expenses = require('../../server/services/bookkeeping/expenseService');
const archive = require('../../server/scripts/books-archive-export');
const Setting = require('../../server/models/Setting');
const { createTestAdminUser, reseedBooksReferenceData } = require('../helpers');

let adminId;
let productId;
const VALID_KENNITALA = '1203894599';

// Its own year, well clear of the seed and of every other books suite, so the
// range-filtered assertions in here can be absolute within that window.
const YEAR = 2019;
const D = day => `${YEAR}-06-${String(day).padStart(2, '0')}`;
const RANGE = { from: `${YEAR}-01-01`, to: `${YEAR}-12-31` };

// Range-scoped on purpose. An all-time balance cannot be compared against a
// range-scoped report once another suite posts to the same account in another year —
// and every books suite shares one append-only journal.
async function accountBalance(code, { from = null, to = null } = {}) {
  const params = [code];
  const where = ['la.code = $1', 'je.posted_at IS NOT NULL'];
  if (from) { params.push(from); where.push(`je.entry_date >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`je.entry_date <= $${params.length}::date`); }
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::bigint AS bal
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE ${where.join(' AND ')}`,
    params
  );
  return Number(rows[0].bal);
}

async function paidOrder(amount, at) {
  const { rows } = await db.query(
    `INSERT INTO orders (order_number, currency, subtotal, shipping, total, status,
       payment_status, shipping_method, shipping_address, guest_email, guest_name, paid_at)
     VALUES ($1,'ISK',$2,0,$2,'paid','paid','local_pickup',$3::jsonb,
             'rep@example.is','Report Test',$4::timestamptz)
     RETURNING id`,
    [`HP-REP-${Math.random().toString(36).slice(2, 9)}`, amount,
      JSON.stringify({ name: 'Report Test', line1: 'Gata 1', postal: '101', city: 'Reykjavík', country_code: 'IS' }),
      at]
  );
  await db.query(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot,
       product_price_snapshot, quantity, currency)
     VALUES ($1,$2,'Vefsíða',$3,1,'ISK')`,
    [rows[0].id, productId, amount]
  );
  const { invoice } = await ledger.withTransaction(c =>
    invoices.createFromOrder(c, rows[0].id, { createdBy: adminId }));
  return invoice;
}

beforeAll(async () => {
  await reseedBooksReferenceData();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();
  const { rows } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, is_bookable, vat_rate)
     VALUES ('rep-vefur','Vefsíða','',248000,1600,999,'REP-WEB',TRUE,24)
     ON CONFLICT (slug) DO UPDATE SET vat_rate = 24 RETURNING id`
  );
  productId = rows[0].id;
  await Setting.updateBookkeepingSettings({
    seller_name: 'Smiley Software ehf.',
    seller_kennitala: VALID_KENNITALA,
    seller_vat_number: '148820',
    payment_terms_days: 14,
  });
  for (const d of [D(3), D(10), D(17)]) {
    await ledger.withTransaction(c => ledger.ensureFiscalPeriod(c, d));
  }

  // One invoice, one payment, one expense — enough for every report to have something
  // on both sides, and small enough that the arithmetic can be checked by hand.
  const inv = await paidOrder(248_000, D(3));
  await ledger.withTransaction(c => invoices.recordPayment(c, inv.id, {
    amount: 248_000,
    method: 'bank_transfer',
    receivedAt: D(10),
    idempotencyKey: `rep-pay-${Math.random().toString(36).slice(2, 9)}`,
    createdBy: adminId,
  }));
  await ledger.withTransaction(c => expenses.createExpense(c, {
    supplierName: 'Tölvutækni ehf.',
    supplierVatNumber: '112233',
    expenseDate: D(17),
    description: 'Hýsing',
    amountGross: 62_000,
    accountCode: '6300',
    createdBy: adminId,
    allowDuplicate: true,
  }));
});

afterAll(async () => { await db.pool.end(); });

describe('trial balance', () => {
  it('balances, and says so', async () => {
    const tb = await reports.trialBalance();
    expect(tb.debit_total).toBe(tb.credit_total);
    expect(tb.balanced).toBe(true);
    expect(tb.difference).toBe(0);
  });

  it('reports each account on its natural side', async () => {
    const tb = await reports.trialBalance({ from: RANGE.from, to: RANGE.to });
    const byCode = Object.fromEntries(tb.accounts.map(a => [a.code, a]));

    // Revenue is a credit account, so a positive balance means revenue EARNED. If the
    // sign convention were flipped, this would come out negative and every P&L built
    // on it would be wrong while still looking like a number.
    expect(byCode['4110'].balance).toBe(200_000);
    expect(byCode['4110'].type).toBe('revenue');
    // Bank is an asset: debit-positive.
    expect(byCode['1900'].balance).toBe(248_000);
    // Receivables were debited by the invoice and credited by the payment, so the
    // account still APPEARS — with both sides shown and a zero balance. It is dropped
    // only when it has no movement at all, which is the right distinction: 'settled'
    // and 'never used' are different facts.
    expect(byCode['1100'].debit).toBe(248_000);
    expect(byCode['1100'].credit).toBe(248_000);
    expect(byCode['1100'].balance).toBe(0);
  });

  it('excludes unposted entries', async () => {
    // A draft entry (posted_at NULL) is not part of the books. Included, it would make
    // the trial balance appear unbalanced while nothing was actually wrong.
    const before = await reports.trialBalance();
    const { rows } = await db.query(
      `INSERT INTO journal_entries (entry_date, memo, source_type, created_by)
       VALUES ($1,'Draft, never posted','manual',$2) RETURNING id`,
      [D(3), adminId]
    );
    const { rows: acct } = await db.query(`SELECT id FROM ledger_accounts WHERE code = '1900'`);
    await db.query(
      `INSERT INTO journal_lines (entry_id, account_id, debit, credit, sort_order)
       VALUES ($1,$2,999999,0,0)`,
      [rows[0].id, acct[0].id]
    );
    const after = await reports.trialBalance();
    expect(after.debit_total).toBe(before.debit_total);
    expect(after.balanced).toBe(true);
    await db.query(`DELETE FROM journal_lines WHERE entry_id = $1`, [rows[0].id]);
    await db.query(`DELETE FROM journal_entries WHERE id = $1`, [rows[0].id]);
  });
});

describe('profit and loss', () => {
  it('reports revenue and expenses as positive figures, and profit as the difference', async () => {
    const pl = await reports.profitAndLoss(RANGE);
    expect(pl.revenue_total).toBe(200_000);   // 248.000 gross at 24% → 200.000 net
    expect(pl.expense_total).toBe(50_000);    // 62.000 gross at 24% → 50.000 net
    expect(pl.profit).toBe(150_000);
    expect(pl.revenue.every(l => l.amount > 0)).toBe(true);
    expect(pl.expenses.every(l => l.amount > 0)).toBe(true);
  });

  it('refuses to run without a range rather than inventing one', async () => {
    // A P&L over "everything" is almost never what was meant, and a silently-defaulted
    // window produces a figure the reader will believe.
    await expect(reports.profitAndLoss({})).rejects.toThrow(/needs a from and a to date/);
  });

  it('carries VAT into neither side', async () => {
    // The single most consequential property of the whole module: output VAT is not
    // revenue and input VAT is not an expense. If either leaked, every figure the
    // owner uses to decide anything would be inflated by 24%.
    const pl = await reports.profitAndLoss(RANGE);
    expect(pl.revenue_total + pl.expense_total).toBe(250_000);
    const codes = [...pl.revenue, ...pl.expenses].map(l => l.code);
    expect(codes).not.toContain('2200'); // output VAT
    expect(codes).not.toContain('1310'); // input VAT
  });
});

describe('balance sheet', () => {
  it('balances with retained earnings derived, not posted', async () => {
    const bs = await reports.balanceSheet({ to: RANGE.to });
    expect(bs.balanced).toBe(true);
    expect(bs.difference).toBe(0);
    // Nothing in the books posts to an equity account, so ALL of equity here is the
    // derived figure. That is the design: no year-end close.
    expect(bs.equity_total).toBe(bs.retained_earnings);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM journal_lines jl
         JOIN ledger_accounts la ON la.id = jl.account_id
        WHERE la.type = 'equity'`
    );
    expect(rows[0].n).toBe(0);
  });

  it('agrees with the profit and loss for the same window', async () => {
    // The two reports are computed separately; if they could disagree, one of them
    // would be quietly wrong and there would be no way to tell which.
    const openingBs = await reports.balanceSheet({ to: `${YEAR - 1}-12-31` });
    const closingBs = await reports.balanceSheet({ to: RANGE.to });
    const pl = await reports.profitAndLoss(RANGE);
    expect(closingBs.retained_earnings - openingBs.retained_earnings).toBe(pl.profit);
  });

  it('requires an as-at date', async () => {
    await expect(reports.balanceSheet({})).rejects.toThrow(/needs an as-at date/);
  });
});

describe('account ledger', () => {
  it('runs opening + movements = closing', async () => {
    const led = await reports.accountLedger({ accountCode: '1900', from: RANGE.from, to: RANGE.to });
    const movement = led.lines.reduce((a, l) => a + l.debit - l.credit, 0);
    expect(led.opening_balance + movement).toBe(led.closing_balance);
    expect(led.closing_balance).toBe(await accountBalance('1900', RANGE));
  });

  it('carries an opening balance forward rather than starting from zero', async () => {
    // The whole point of the opening figure: a mid-year range must still produce a
    // running balance that ties to the account, not one that starts at zero and
    // therefore ties to nothing.
    const late = await reports.accountLedger({
      accountCode: '1900', from: D(15), to: RANGE.to,
    });
    expect(late.opening_balance).toBe(248_000);
    expect(late.lines).toHaveLength(0);
    expect(late.closing_balance).toBe(248_000);
  });

  it('404s on an unknown account instead of returning an empty ledger', async () => {
    // An empty ledger for a mistyped code reads as "this account has no activity",
    // which is a wrong answer rather than an error.
    await expect(reports.accountLedger({ accountCode: '9999' }))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('journal', () => {
  it('groups lines under their entry, with a debit total per entry', async () => {
    const { entries } = await reports.journal({ from: RANGE.from, to: RANGE.to, limit: 50 });
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const e of entries) {
      expect(e.lines.length).toBeGreaterThanOrEqual(2);
      const debit = e.lines.reduce((a, l) => a + l.debit, 0);
      const credit = e.lines.reduce((a, l) => a + l.credit, 0);
      expect(debit).toBe(credit);
      expect(e.debit_total).toBe(debit);
    }
  });

  it('filters by account through the lines, keeping whole entries', async () => {
    // Filtering must not return half an entry: an entry with one leg shown does not
    // balance, and a journal that appears not to balance is worse than one that omits.
    const { entries } = await reports.journal({
      from: RANGE.from, to: RANGE.to, accountCode: '1900', limit: 50,
    });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.lines.some(l => l.account_code === '1900')).toBe(true);
      expect(e.lines.reduce((a, l) => a + l.debit, 0))
        .toBe(e.lines.reduce((a, l) => a + l.credit, 0));
    }
  });

  it('reports a total independent of the page size', async () => {
    const page = await reports.journal({ from: RANGE.from, to: RANGE.to, limit: 1 });
    expect(page.entries).toHaveLength(1);
    expect(page.total).toBeGreaterThanOrEqual(3);
  });

  it('filters by source type', async () => {
    const { entries } = await reports.journal({
      from: RANGE.from, to: RANGE.to, sourceType: 'expense', limit: 50,
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(e => e.source_type === 'expense')).toBe(true);
  });
});

describe('manual entries and reversal', () => {
  it('posts a balanced manual entry and shows it in the journal', async () => {
    const before = (await reports.trialBalance()).debit_total;
    const entry = await ledger.withTransaction(c => ledger.postEntry(c, {
      entryDate: D(17),
      memo: 'Afskrift á tölvubúnaði',
      sourceType: 'manual',
      createdBy: adminId,
      lines: [
        { accountCode: '7100', debit: 30_000, memo: 'Afskrift' },
        { accountCode: '1900', credit: 30_000 },
      ],
    }));
    const after = await reports.trialBalance();
    expect(after.debit_total).toBe(before + 30_000);
    expect(after.balanced).toBe(true);

    const { entries } = await reports.journal({
      from: RANGE.from, to: RANGE.to, sourceType: 'manual', limit: 50,
    });
    expect(entries.some(e => e.entry_number === entry.entry_number)).toBe(true);
  });

  it('reverses by posting a mirror entry, leaving the original in place', async () => {
    const original = await ledger.withTransaction(c => ledger.postEntry(c, {
      entryDate: D(17),
      memo: 'Færsla sem verður bakfærð',
      sourceType: 'manual',
      createdBy: adminId,
      lines: [
        { accountCode: '7100', debit: 11_000 },
        { accountCode: '1900', credit: 11_000 },
      ],
    }));
    const afterPost = await accountBalance('7100');

    const { reversal } = await ledger.withTransaction(c => ledger.reverseEntry(c, original.id, {
      createdBy: adminId, reason: 'Bókað á vitlausan lykil', entryDate: D(17),
    }));

    // The net effect is zero, but BOTH entries exist. A ledger that deleted the
    // original would have no record that the mistake was ever made.
    expect(await accountBalance('7100')).toBe(afterPost - 11_000);
    const { rows } = await db.query(
      `SELECT id, reverses_entry_id, is_correction FROM journal_entries WHERE id = ANY($1::text[])`,
      [[original.id, reversal.id]]
    );
    expect(rows).toHaveLength(2);
    const rev = rows.find(r => r.id === reversal.id);
    expect(rev.reverses_entry_id).toBe(original.id);
    // Same VSK period, so this is not a cross-period correction. is_correction marks
    // the case that matters for a filed return — a reversal landing in a period that
    // has already been reported — not every reversal.
    expect(rev.is_correction).toBe(false);
  });

  it('refuses an unbalanced entry at the database, not just in the form', async () => {
    // The client checks this too, for a readable message. This test is about the
    // guarantee: no code path, and no future caller, can post a lopsided entry.
    await expect(ledger.withTransaction(c => ledger.postEntry(c, {
      entryDate: D(17),
      memo: 'Stemmir ekki',
      sourceType: 'manual',
      createdBy: adminId,
      lines: [
        { accountCode: '7100', debit: 5_000 },
        { accountCode: '1900', credit: 4_000 },
      ],
    }))).rejects.toThrow();
  });
});

describe('archive export', () => {
  let outDir;

  beforeAll(async () => {
    outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'books-archive-'));
  });

  afterAll(async () => {
    await fs.rm(outDir, { recursive: true, force: true });
  });

  it('parses its arguments strictly', () => {
    expect(archive.parseArgs(['node', 's', '--out=./a', '--year=2026']))
      .toMatchObject({ out: './a', year: 2026, documents: true });
    expect(archive.parseArgs(['node', 's', '--out=./a', '--no-documents']).documents).toBe(false);
    // A year typed as 26 would silently produce an empty archive that looks complete.
    expect(() => archive.parseArgs(['node', 's', '--out=./a', '--year=26'])).toThrow(/four-digit/);
    expect(() => archive.parseArgs(['node', 's'])).toThrow(/--out=DIR is required/);
    expect(() => archive.parseArgs(['node', 's', '--out=./a', '--nope'])).toThrow(/Unrecognised/);
  });

  it('writes every file, and a manifest that verifies against them', async () => {
    const { manifest, files } = await archive.exportArchive({
      out: outDir, year: YEAR, documents: true, force: true,
    });
    const names = files.map(f => f.file);
    expect(names).toEqual(expect.arrayContaining([
      'journal.csv', 'journal-entries.csv', 'invoices.csv', 'invoice-lines.csv',
      'settlements.csv', 'expenses.csv', 'vat-returns.csv', 'accounts.csv',
      'audit-log.csv', 'trial-balance.csv',
    ]));
    expect(manifest.integrity.trial_balance_balanced).toBe(true);
    // The purpose is IN the file: a reader in 2033 should not need this repo to know
    // what they are holding or why it exists.
    expect(manifest.purpose).toMatch(/145\/1994/);

    const { checked, failures } = await archive.verify(outDir);
    expect(checked).toBe(manifest.files.length + manifest.documents.length);

    // Every CSV the archive wrote must verify. That is fully under this test's control.
    // Note the split: a failure reads "<path>: <reason>", so the path has to be separated
    // before it can be classified — filtering on endsWith('.csv') matches nothing and makes
    // the assertion pass without checking anything.
    const pathOf = f => f.split(':')[0];
    expect(failures.filter(f => pathOf(f).endsWith('.csv'))).toEqual([]);

    // Documents are NOT: this suite shares one database with every other books suite, and
    // one of them deliberately corrupts a document's bytes to prove gr. 14 is enforced.
    // Such a row SHOULD fail verification — reporting it is the archive working. What must
    // hold is that the archive and the verifier agree: a document the manifest recorded as
    // verified must still verify, and every failure must correspond to one it flagged.
    const flagged = new Set(manifest.documents.filter(d => !d.verified).map(d => d.archived_as));
    for (const failure of failures.filter(f => f.startsWith('documents/'))) {
      expect(flagged.has(pathOf(failure))).toBe(true);
    }
  });

  it('detects a tampered file rather than certifying it', async () => {
    // The reason the manifest carries checksums at all. If a corrupted or edited archive
    // still verified, the archive would be decorative.
    const target = path.join(outDir, 'journal.csv');
    const original = await fs.readFile(target, 'utf8');
    const csvFailures = async () =>
      (await archive.verify(outDir)).failures.filter(f => f.split(':')[0].endsWith('.csv'));

    expect(await csvFailures()).toEqual([]);
    await fs.writeFile(target, `${original}1,2019-06-03,manual,,Tilbúin lína,1900,Banki,1,0,,,,,,,\r\n`, 'utf8');
    expect(await csvFailures()).toEqual([expect.stringContaining('journal.csv')]);
    await fs.writeFile(target, original, 'utf8');
    expect(await csvFailures()).toEqual([]);
  });

  it('exports the chart of accounts as it stood, not just the codes', async () => {
    // A seven-year-old journal without the chart is a list of numbers against codes
    // whose names have been edited since.
    const csv = await fs.readFile(path.join(outDir, 'accounts.csv'), 'utf8');
    expect(csv).toContain('Viðskiptakröfur');
    expect(csv).toContain('1900');
    // BOM first, or Excel on Windows mangles every ð þ æ ö in the file.
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it('restricts to the requested year', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'books-archive-y-'));
    try {
      const { files } = await archive.exportArchive({
        out: other, year: YEAR - 5, documents: false, force: true,
      });
      const journal = files.find(f => f.file === 'journal.csv');
      expect(journal.rows).toBe(0);
      // Still a well-formed archive, with a header — an empty file with no header
      // would be indistinguishable from a failed export.
      const csv = await fs.readFile(path.join(other, 'journal.csv'), 'utf8');
      expect(csv).toContain('Færslunr.');
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite an existing archive without --force', async () => {
    // Overwriting silently is how a year's retention copy disappears.
    await expect(archive.exportArchive({ out: outDir, year: YEAR, documents: false, force: false }))
      .rejects.toThrow(/already holds an archive/);
  });
});
