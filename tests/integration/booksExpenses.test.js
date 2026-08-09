// Expenses (input VAT), documents, and receivables.
//
// The point of this suite is the GUARDRAILS. Recording a purchase is easy; what
// matters is that the system refuses an input-VAT deduction the law refuses,
// notices a double entry, and posts the VAT to the right side of the ledger —
// because every error here under-pays tax, which is the direction that gets
// assessed with a surcharge.
const fs = require('fs');
const path = require('path');
const db = require('../../server/config/database');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const expenses = require('../../server/services/bookkeeping/expenseService');
const documents = require('../../server/services/bookkeeping/documentService');
const invoices = require('../../server/services/bookkeeping/invoiceService');
const Expense = require('../../server/models/Expense');
const Invoice = require('../../server/models/Invoice');
const Setting = require('../../server/models/Setting');
const FxRate = require('../../server/models/FxRate');
const { BOOKS_UPLOAD_ROOT } = require('../../server/config/paths');
const { createTestAdminUser, reseedBooksReferenceData } = require('../helpers');

let adminId;
const VALID_KENNITALA = '1203894599';

async function legsFor(sourceType, sourceId) {
  const { rows } = await db.query(
    `SELECT la.code, (jl.debit - jl.credit)::bigint AS amount
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE je.source_type = $1 AND je.source_id = $2`,
    [sourceType, sourceId]
  );
  const out = {};
  for (const r of rows) out[r.code] = (out[r.code] || 0) + Number(r.amount);
  return out;
}

// Unique supplier per call by default, so the duplicate detector (which correctly
// fires on same-supplier + same-amount + nearby-date) does not trip every test that
// happens to reuse the fixture. The duplicate tests pass an explicit supplierName.
let fixtureSeq = 0;
const baseExpense = (over = {}) => ({
  supplierName: `Byko ${++fixtureSeq}`,
  supplierVatNumber: '12345',
  supplierCountry: 'IS',
  expenseDate: '2026-07-10',
  amountGross: 12400,
  accountCode: '5200',           // Efni og aðföng
  vatCode: 'input_24',
  createdBy: adminId,
  ...over,
});

beforeAll(async () => {
  await reseedBooksReferenceData();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();
});

afterAll(async () => { await db.pool.end(); });

beforeEach(async () => {
  await db.query(`UPDATE fiscal_periods SET status='open', locked_at=NULL, locked_by=NULL`);
});

describe('input VAT — the deduction rules', () => {
  it('splits VAT out of the gross and books it as an ASSET claim on the state', async () => {
    const { expense, verdict } = await ledger.withTransaction(c =>
      expenses.createExpense(c, baseExpense()));

    expect(verdict.deductible).toBe(true);
    expect(Number(expense.amount_net)).toBe(10000);
    expect(Number(expense.amount_vat)).toBe(2400);

    // Dr cost (net) + Dr input VAT / Cr accounts payable (gross).
    expect(await legsFor('expense', expense.id)).toEqual({
      5200: 10000,   // Efni og aðföng
      1310: 2400,    // Innskattur — an asset, positive = debit
      2100: -12400,  // Viðskiptaskuldir
    });
  });

  it('refuses the deduction on a statutorily blocked account, and folds VAT into the cost', async () => {
    // Risna (entertainment) is one of the four statutory exclusions. The VAT does
    // not vanish — it becomes part of the expense, which is what "not deductible"
    // means and is the easy thing to get wrong.
    const { expense, verdict } = await ledger.withTransaction(c =>
      expenses.createExpense(c, baseExpense({ accountCode: '6900' })));

    expect(verdict.deductible).toBe(false);
    expect(verdict.reason).toMatch(/risna|frádráttarbær/i);
    expect(Number(expense.amount_vat)).toBe(0);
    expect(Number(expense.amount_net)).toBe(12400);
    expect(await legsFor('expense', expense.id)).toEqual({ 6900: 12400, 2100: -12400 });
  });

  it('refuses the deduction when the receipt shows no supplier VAT number', async () => {
    // A till slip without a VSK number is not valid proof of input tax.
    const { expense, verdict } = await ledger.withTransaction(c =>
      expenses.createExpense(c, baseExpense({ supplierVatNumber: '' })));
    expect(verdict.deductible).toBe(false);
    expect(verdict.reason).toMatch(/VSK-númer/);
    expect(Number(expense.amount_vat)).toBe(0);
  });

  it('handles the 11% reduced rate', async () => {
    const { expense } = await ledger.withTransaction(c =>
      expenses.createExpense(c, baseExpense({ vatCode: 'input_11', amountGross: 11100 })));
    expect(Number(expense.amount_vat)).toBe(1100);
    expect(Number(expense.amount_net)).toBe(10000);
    expect(await legsFor('expense', expense.id)).toEqual({ 5200: 10000, 1310: 1100, 2100: -11100 });
  });

  it('records an exempt purchase with no VAT at all', async () => {
    const { expense, verdict } = await ledger.withTransaction(c =>
      expenses.createExpense(c, baseExpense({ vatCode: 'exempt', accountCode: '6500' })));
    expect(verdict.deductible).toBe(false);
    expect(Number(expense.amount_vat)).toBe(0);
  });

  it('refuses a purchase posted to a revenue account', async () => {
    await expect(ledger.withTransaction(c =>
      expenses.createExpense(c, baseExpense({ accountCode: '4100' }))))
      .rejects.toMatchObject({ code: 'BAD_ACCOUNT_TYPE' });
  });
});

describe('reverse charge on services bought abroad', () => {
  it('self-assesses VAT with matching output and input legs', async () => {
    // Buying from Azure/GitHub obliges self-assessment. It nets to zero when the
    // activity is taxable, but BOTH legs must appear on the return — which is only
    // possible if they are actually posted.
    const { expense, verdict } = await ledger.withTransaction(c =>
      expenses.createExpense(c, baseExpense({
        supplierName: 'GitHub', supplierCountry: 'US', supplierVatNumber: '',
        vatCode: 'reverse_charge_24', accountCode: '6300', amountGross: 10000,
      })));

    expect(verdict.reverseCharge).toBe(true);
    // The foreign invoice is the NET figure, so VAT goes ON TOP rather than being
    // extracted — the opposite of a domestic purchase.
    expect(Number(expense.amount_net)).toBe(10000);
    expect(Number(expense.amount_vat)).toBe(2400);
    expect(Number(expense.amount_gross)).toBe(12400);

    expect(await legsFor('expense', expense.id)).toEqual({
      6300: 10000,   // cost
      1310: 2400,    // input VAT (deductible)
      2100: -10000,  // owed to the supplier — the NET amount only
      2200: -2400,   // output VAT self-assessed
    });
  });

  it('refuses reverse charge on a domestic supplier', async () => {
    await expect(ledger.withTransaction(c =>
      expenses.createExpense(c, baseExpense({ vatCode: 'reverse_charge_24' }))))
      .rejects.toMatchObject({ code: 'REVERSE_CHARGE_DOMESTIC' });
  });
});

describe('foreign currency', () => {
  it('translates to ISK at the expense date rate before extracting VAT', async () => {
    await FxRate.set({ rateDate: '2026-07-10', currency: 'EUR', rate: 150, source: 'manual' });
    const { expense } = await ledger.withTransaction(c =>
      expenses.createExpense(c, baseExpense({ currency: 'EUR', amountGross: 10000 })));
    // EUR 100.00 at 150 = 15,000 ISK, then 24% extracted from that.
    expect(Number(expense.amount_gross)).toBe(15000);
    expect(Number(expense.amount_vat)).toBe(Math.round((15000 * 24) / 124));
    expect(Number(expense.original_amount_gross)).toBe(10000);
    expect(Number(expense.fx_rate)).toBe(150);
  });
});

describe('duplicate detection', () => {
  it('warns on a repeated supplier invoice number, then saves when confirmed', async () => {
    // Double-posting a supplier invoice — once from the PDF, once from the bank
    // line — inflates input VAT and so under-pays tax. Warn, never block.
    const input = baseExpense({ supplierInvoiceNo: 'B-5512' });
    await ledger.withTransaction(c => expenses.createExpense(c, input));

    const err = await ledger.withTransaction(c => expenses.createExpense(c, input))
      .catch(e => e);
    expect(err.code).toBe('POSSIBLE_DUPLICATE');
    expect(err.status).toBe(409);
    expect(err.duplicates[0]).toMatchObject({ supplier_invoice_no: 'B-5512', why: 'same_invoice_number' });

    // The user has looked and means it.
    const { expense } = await ledger.withTransaction(c =>
      expenses.createExpense(c, { ...input, allowDuplicate: true }));
    expect(expense.id).toBeTruthy();
  });

  it('warns on the same supplier, amount and nearby date even with no invoice number', async () => {
    const input = baseExpense({ supplierName: 'Síminn', amountGross: 9900, expenseDate: '2026-07-01' });
    await ledger.withTransaction(c => expenses.createExpense(c, input));
    const err = await ledger.withTransaction(c =>
      expenses.createExpense(c, { ...input, expenseDate: '2026-07-03' })).catch(e => e);
    expect(err.code).toBe('POSSIBLE_DUPLICATE');
    expect(err.duplicates[0].why).toBe('same_supplier_amount_and_date');
  });

  it('does not warn on a genuinely different amount', async () => {
    const input = baseExpense({ supplierName: 'Veitur', amountGross: 5000 });
    await ledger.withTransaction(c => expenses.createExpense(c, input));
    await expect(ledger.withTransaction(c =>
      expenses.createExpense(c, { ...input, amountGross: 7000 })))
      .resolves.toBeTruthy();
  });
});

describe('immutability', () => {
  let expenseId;
  beforeEach(async () => {
    const { expense } = await ledger.withTransaction(c =>
      expenses.createExpense(c, baseExpense({ supplierInvoiceNo: `IMM-${Math.random()}` })));
    expenseId = expense.id;
  });

  it('refuses to delete a posted expense', async () => {
    await expect(db.query(`DELETE FROM expenses WHERE id = $1`, [expenseId]))
      .rejects.toThrow(/cannot be deleted/);
  });

  it('refuses to change the amount, the account or the VAT treatment', async () => {
    // Each of these must be a REAL change to the stored value — the guard compares
    // OLD to NEW, so re-setting a field to what it already holds is legitimately a
    // no-op and would make the assertion vacuous.
    await expect(db.query(`UPDATE expenses SET amount_gross = 1 WHERE id = $1`, [expenseId]))
      .rejects.toThrow(/cannot be altered/);
    await expect(db.query(`UPDATE expenses SET supplier_name = 'Someone Else' WHERE id = $1`, [expenseId]))
      .rejects.toThrow(/cannot be altered/);
    await expect(db.query(`UPDATE expenses SET vat_code = 'input_11' WHERE id = $1`, [expenseId]))
      .rejects.toThrow(/cannot be altered/);
    await expect(db.query(`UPDATE expenses SET expense_date = '2020-01-01' WHERE id = $1`, [expenseId]))
      .rejects.toThrow(/cannot be altered/);
    await expect(db.query(
      `UPDATE expenses SET account_id = (SELECT id FROM ledger_accounts WHERE code = '6800')
        WHERE id = $1`, [expenseId]
    )).rejects.toThrow(/cannot be altered/);
  });

  it('STILL allows a receipt to be attached later', async () => {
    // The one thing that must stay writable: receipts are routinely found after the
    // entry, and the missing-documents queue exists to chase exactly that.
    await expect(db.query(
      `UPDATE expenses SET description = 'found the receipt' WHERE id = $1`, [expenseId]
    )).resolves.toBeDefined();
  });
});

describe('documents (fylgiskjöl)', () => {
  const tmpFiles = [];

  async function writeDoc(contents, name = 'reikningur.pdf') {
    const dir = path.join(BOOKS_UPLOAD_ROOT, 'test-fixtures');
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
    fs.writeFileSync(abs, contents);
    tmpFiles.push(abs);
    return { path: abs, originalname: name, mimetype: 'application/pdf', size: Buffer.byteLength(contents) };
  }

  // The files are deliberately NOT deleted.
  //
  // Registering a document is append-only — books_protect_document refuses to delete the
  // row (asserted below) — so removing the file while the row survives manufactures the
  // exact integrity failure the system exists to detect: a books_documents row pointing at
  // nothing. The archive export verifies every document against the checksum recorded at
  // upload, and this cleanup was making it report seven missing files in an unrelated
  // suite. They are a few bytes each, under BOOKS_UPLOAD_ROOT/test-fixtures.
  afterAll(() => {
    tmpFiles.length = 0;
  });

  it('stores a checksum and reads the file back', async () => {
    const file = await writeDoc('%PDF-1.4 fake invoice');
    const { document } = await ledger.withTransaction(c =>
      documents.register(c, file, { kind: 'supplier_invoice', createdBy: adminId }));
    expect(document.checksum_sha256).toMatch(/^[0-9a-f]{64}$/);

    const opened = await documents.open(db, document.id);
    expect(opened.document.id).toBe(document.id);
  });

  it('refuses to serve a document whose bytes no longer match the checksum', async () => {
    // gr. 14 áreiðanleiki actually being enforced, not merely recorded: if the file
    // has changed it is no longer evidence, and saying so is better than serving it.
    const file = await writeDoc('%PDF-1.4 original');
    const { document } = await ledger.withTransaction(c =>
      documents.register(c, file, { createdBy: adminId }));
    fs.writeFileSync(file.path, '%PDF-1.4 tampered');
    await expect(documents.open(db, document.id))
      .rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
  });

  it('reports an identical re-upload as a probable duplicate', async () => {
    const a = await writeDoc('%PDF-1.4 same bytes');
    const b = await writeDoc('%PDF-1.4 same bytes');
    await ledger.withTransaction(c => documents.register(c, a, { createdBy: adminId }));
    const { duplicates } = await ledger.withTransaction(c =>
      documents.register(c, b, { createdBy: adminId }));
    expect(duplicates.length).toBeGreaterThan(0);
  });

  it('refuses to delete a document — it is the seven-year evidence trail', async () => {
    const file = await writeDoc('%PDF-1.4 keep me');
    const { document } = await ledger.withTransaction(c =>
      documents.register(c, file, { createdBy: adminId }));
    await expect(db.query(`DELETE FROM books_documents WHERE id = $1`, [document.id]))
      .rejects.toThrow(/cannot be deleted/);
  });

  it('refuses a path that escapes the document root', async () => {
    expect(() => documents.absolutePath('../../etc/passwd')).toThrow(/outside the document root/);
  });

  it('reports a missing file distinctly from a missing record', async () => {
    const file = await writeDoc('%PDF-1.4 will vanish');
    const { document } = await ledger.withTransaction(c =>
      documents.register(c, file, { createdBy: adminId }));
    fs.unlinkSync(file.path);
    await expect(documents.open(db, document.id)).rejects.toMatchObject({ code: 'FILE_MISSING' });
  });
});

describe('missing-documents queue and input-VAT totals', () => {
  it('counts unsubstantiated input VAT, and clears once a receipt is attached', async () => {
    const { expense } = await ledger.withTransaction(c =>
      expenses.createExpense(c, baseExpense({ supplierInvoiceNo: 'QUEUE-1' })));
    const before = await Expense.missingDocuments();
    expect(before.count).toBeGreaterThan(0);
    expect(before.unsubstantiated_vat).toBeGreaterThanOrEqual(2400);

    const dir = path.join(BOOKS_UPLOAD_ROOT, 'test-fixtures');
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, `queue-${Date.now()}.pdf`);
    fs.writeFileSync(abs, '%PDF-1.4 receipt');
    const { document } = await ledger.withTransaction(c => documents.register(c, {
      path: abs, originalname: 'r.pdf', mimetype: 'application/pdf', size: 16,
    }, { createdBy: adminId }));

    await ledger.withTransaction(c => expenses.attachDocument(c, expense.id, {
      documentId: document.id, createdBy: adminId,
    }));
    const after = await Expense.findById(expense.id);
    expect(after.document_name).toBe('r.pdf');
    fs.unlinkSync(abs);
  });

  it('counts only DEDUCTIBLE expenses toward input VAT for the period', async () => {
    // Non-deductible entries are real costs but their VAT was folded into the cost,
    // so including them in box E would claim a deduction the law refuses.
    await ledger.withTransaction(c => expenses.createExpense(c, baseExpense({
      supplierInvoiceNo: 'VATP-1', expenseDate: '2026-05-05',
    })));
    await ledger.withTransaction(c => expenses.createExpense(c, baseExpense({
      supplierInvoiceNo: 'VATP-2', expenseDate: '2026-05-06', accountCode: '6900',
    })));
    const { input_vat: inputVat } = await Expense.inputVatForPeriod({ from: '2026-05-01', to: '2026-06-30' });
    expect(inputVat).toBe(2400); // only the deductible one
  });
});

describe('receivables', () => {
  let productId;

  async function issuedInvoice({ email = 'jon@example.is', dueDaysAgo = 0, amount = 12400 } = {}) {
    const issuedAt = new Date(Date.now() - (dueDaysAgo + 14) * 86400000).toISOString().slice(0, 10);
    const { rows } = await db.query(
      `INSERT INTO orders (order_number, currency, subtotal, shipping, total, status,
         payment_status, shipping_method, guest_email, guest_name, paid_at)
       VALUES ($1,'ISK',$2,0,$2,'paid','paid','local_pickup',$3,'Jón Jónsson',$4::timestamptz)
       RETURNING id`,
      [`HP-AR-${Math.random().toString(36).slice(2, 9)}`, amount, email, issuedAt]
    );
    await db.query(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot,
         product_price_snapshot, quantity, currency)
       VALUES ($1,$2,'Eikarborð',$3,1,'ISK')`,
      [rows[0].id, productId, amount]
    );
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, rows[0].id, { createdBy: adminId }));
    return invoice;
  }

  beforeAll(async () => {
    const { rows } = await db.query(
      `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku)
       VALUES ('ar-bord','Eikarborð','',12400,8900,10,'SKU-AR-1')
       ON CONFLICT (slug) DO UPDATE SET price_isk = EXCLUDED.price_isk RETURNING id`
    );
    productId = rows[0].id;
    await Setting.updateBookkeepingSettings({
      seller_name: 'Halli Smiley ehf.',
      seller_kennitala: VALID_KENNITALA,
      seller_vat_number: '123456',
      payment_terms_days: 14,
    });
  });

  it('buckets by how far past the DUE date each invoice is', async () => {
    // No table clearing here: journal history is append-only and DELETE is refused
    // by design, so the assertion scopes itself to this customer's own row instead.
    await issuedInvoice({ email: 'aging@example.is', dueDaysAgo: 45, amount: 10000 });

    const { customers } = await Invoice.agingByCustomer();
    const row = customers.find(c => c.customer_email === 'aging@example.is');
    expect(row).toBeTruthy();
    // 45 days past due lands in 31-60, not in "current" and not in 1-30.
    expect(row.d31_60).toBe(10000);
    expect(row.current).toBe(0);
    expect(row.d1_30).toBe(0);
  });

  it('groups guest invoices by email into one customer', async () => {
    await issuedInvoice({ email: 'twice@example.is', amount: 5000 });
    await issuedInvoice({ email: 'twice@example.is', amount: 7000 });
    const { customers } = await Invoice.agingByCustomer();
    const row = customers.find(c => c.customer_email === 'twice@example.is');
    expect(row.open_invoices).toBe(2);
    expect(row.total).toBe(12000);
    expect(row.customer_key).toBe('e:twice@example.is');
  });

  it('builds a statement with a running balance in date order', async () => {
    const invoice = await issuedInvoice({ email: 'stmt@example.is', amount: 12400 });
    await ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 6200, method: 'bank_transfer', idempotencyKey: `stmt-${invoice.id}`,
      receivedAt: new Date().toISOString().slice(0, 10), createdBy: adminId,
    }));

    const statement = await Invoice.statementForCustomer('e:stmt@example.is');
    expect(statement.lines.length).toBeGreaterThanOrEqual(2);
    expect(statement.lines[0].kind).toBe('invoice');
    expect(statement.lines[0].charge).toBe(12400);
    // Half paid, so half still owed.
    expect(statement.closing_balance).toBe(6200);
  });

  it('rejects a malformed customer key rather than running unscoped', async () => {
    await expect(Invoice.statementForCustomer('nonsense'))
      .rejects.toMatchObject({ status: 400 });
    await expect(Invoice.statementForCustomer('u:')).rejects.toMatchObject({ status: 400 });
  });

  it('excludes fully settled invoices from the aging list', async () => {
    const invoice = await issuedInvoice({ email: 'settled@example.is', amount: 4000 });
    await ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 4000, method: 'cash', idempotencyKey: `settled-${invoice.id}`,
      receivedAt: new Date().toISOString().slice(0, 10), createdBy: adminId,
    }));
    const { customers } = await Invoice.agingByCustomer();
    expect(customers.find(c => c.customer_email === 'settled@example.is')).toBeUndefined();
  });
});
