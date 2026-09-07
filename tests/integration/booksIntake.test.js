// The intake queue (capture spine, migration 096) — the human gate, proven
// structurally rather than by convention.
//
// The tests this enhancement exists for:
//   - a pending row posts NOTHING;
//   - accept() creates exactly one expense with created_by = the accepting user,
//     and its ledger legs are IDENTICAL to the same input through createExpense()
//     — one path into the ledger, not two;
//   - the database refuses an "accepted" row that names no expense or no decider,
//     a decided row returned to the queue, and a repointed expense link;
//   - source_kind never bypasses the gate: a 'peppol' row still needs a person.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const Role = require('../../server/models/Role');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const intake = require('../../server/services/bookkeeping/intakeService');
const expenses = require('../../server/services/bookkeeping/expenseService');
const documents = require('../../server/services/bookkeeping/documentService');
const { BOOKS_UPLOAD_ROOT } = require('../../server/config/paths');
const {
  createTestAdminUser, getTestSessionCookie, reseedBooksReferenceData,
} = require('../helpers');

const BASE = '/api/v1/admin/bookkeeping';

let adminId; let adminCookie; let readerCookie;
let seq = 0;

// A stand-in supplier invoice on disk, unique bytes per call so checksums differ.
function writeDoc(label) {
  const dir = path.join(BOOKS_UPLOAD_ROOT, 'test-fixtures');
  fs.mkdirSync(dir, { recursive: true });
  const contents = `%PDF-1.4 intake ${label} ${Date.now()} ${++seq}`;
  const abs = path.join(dir, `intake-${Date.now()}-${seq}.pdf`);
  fs.writeFileSync(abs, contents);
  return { path: abs, originalname: `${label}.pdf`, mimetype: 'application/pdf', size: Buffer.byteLength(contents) };
}

const operatorBody = (over = {}) => ({
  supplierName: `Birgir ${++seq}`,
  supplierVatNumber: '12345',
  supplierCountry: 'IS',
  supplierInvoiceNo: `R-${seq}`,
  expenseDate: '2026-07-12',
  amountGross: 12400,
  currency: 'ISK',
  accountCode: '6300',
  vatCode: 'input_24',
  description: 'intake test',
  ...over,
});

async function legsFor(sourceId) {
  const { rows } = await db.query(
    `SELECT la.code, (jl.debit - jl.credit)::bigint AS amount
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE je.source_type = 'expense' AND je.source_id = $1
      ORDER BY la.code`,
    [sourceId]
  );
  return rows.map(r => `${r.code}:${r.amount}`);
}

async function journalCount() {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM journal_entries`);
  return rows[0].n;
}

beforeAll(async () => {
  await reseedBooksReferenceData();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);

  const { rows: role } = await db.query(
    `INSERT INTO roles (name, description, view_access, is_system)
     VALUES ('intake-reader-test', 'read-only expenses', $1::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access RETURNING name`,
    [JSON.stringify(['books', 'expenses'])]
  );
  Role.invalidateCache();
  const { rows: u } = await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ('intake-reader-id','intakereader@test.com','intakereader','x',$1,TRUE)
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
    [role[0].name]
  );
  readerCookie = await getTestSessionCookie(u[0].id);
});

describe('the gate', () => {
  it('a pending row posts nothing and creates no expense', async () => {
    const before = await journalCount();
    const { intake: row, document } = await ledger.withTransaction(c =>
      intake.receive(c, writeDoc('pending'), { createdBy: adminId, suggested: { supplier_name: 'Azure', amount_gross: 2000 } }));
    expect(row.status).toBe('pending');
    expect(row.supplier_name).toBe('Azure');
    expect(row.amount_gross).toBe(2000);
    expect(document.source_kind).toBe('manual');
    expect(await journalCount()).toBe(before);
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM expenses WHERE document_id = $1`, [document.id]);
    expect(rows[0].n).toBe(0);
  });

  it('accept() creates exactly one expense, by the accepting person, with the same legs as the manual path', async () => {
    const { intake: row } = await ledger.withTransaction(c =>
      intake.receive(c, writeDoc('accept'), { createdBy: adminId }));
    const body = operatorBody();

    const accepted = await ledger.withTransaction(c =>
      intake.accept(c, row.id, { expenseInput: body, createdBy: adminId }));
    expect(accepted.intake).toMatchObject({ status: 'accepted', expense_id: accepted.expense.id, decided_by: adminId });
    expect(accepted.intake.decided_at).toBeTruthy();
    expect(accepted.expense.created_by).toBe(adminId);
    expect(accepted.expense.document_id).toBe(row.document_id);

    // The same input through the manual path — a different supplier AND invoice
    // number so the duplicate detector stays quiet — must produce identical legs.
    const manual = await ledger.withTransaction(c =>
      expenses.createExpense(c, {
        ...body, supplierName: `${body.supplierName} manual`, supplierInvoiceNo: `${body.supplierInvoiceNo}-M`, createdBy: adminId,
      }));
    expect(await legsFor(accepted.expense.id)).toEqual(await legsFor(manual.expense.id));
    expect((await legsFor(accepted.expense.id)).length).toBeGreaterThan(1);
  });

  it('the suggestion is never what gets posted', async () => {
    const { intake: row } = await ledger.withTransaction(c =>
      intake.receive(c, writeDoc('suggested'), { createdBy: adminId, suggested: { supplier_name: 'Machine', amount_gross: 999999 } }));
    const accepted = await ledger.withTransaction(c =>
      intake.accept(c, row.id, { expenseInput: operatorBody({ amountGross: 2480 }), createdBy: adminId }));
    expect(accepted.expense.amount_gross).toBe(2480);
  });

  it('accepting twice is a 409, and the second attempt creates no second expense', async () => {
    const { intake: row } = await ledger.withTransaction(c =>
      intake.receive(c, writeDoc('twice'), { createdBy: adminId }));
    await ledger.withTransaction(c => intake.accept(c, row.id, { expenseInput: operatorBody(), createdBy: adminId }));
    const before = await journalCount();
    await expect(ledger.withTransaction(c => intake.accept(c, row.id, { expenseInput: operatorBody(), createdBy: adminId })))
      .rejects.toMatchObject({ code: 'ALREADY_DECIDED', status: 409 });
    expect(await journalCount()).toBe(before);
  });

  it('refuses without a person', async () => {
    const { intake: row } = await ledger.withTransaction(c =>
      intake.receive(c, writeDoc('noactor'), { createdBy: adminId }));
    await expect(ledger.withTransaction(c => intake.accept(c, row.id, { expenseInput: operatorBody() })))
      .rejects.toMatchObject({ status: 500 });
  });

  it('source_kind never bypasses the gate: a peppol row still needs a person to accept it', async () => {
    const before = await journalCount();
    const { intake: row, document } = await ledger.withTransaction(c =>
      intake.receive(c, writeDoc('peppol'), {
        createdBy: adminId, sourceKind: 'peppol', sourceRef: 'msg-abc',
        suggested: { supplier_name: 'Peppol Sender', amount_gross: 12400, expense_date: '2026-07-12', supplier_invoice_no: 'P-1' },
      }));
    expect(document.source_kind).toBe('peppol');
    expect(row.status).toBe('pending');
    expect(await journalCount()).toBe(before);
    const accepted = await ledger.withTransaction(c =>
      intake.accept(c, row.id, { expenseInput: operatorBody(), createdBy: adminId }));
    expect(accepted.expense.created_by).toBe(adminId);
  });
});

describe('the database refuses what the gate forbids', () => {
  async function pendingRow() {
    const { intake: row } = await ledger.withTransaction(c =>
      intake.receive(c, writeDoc('db'), { createdBy: adminId }));
    return row;
  }

  it("an 'accepted' row without an expense, or a decision without an actor, is a CHECK violation", async () => {
    const row = await pendingRow();
    await expect(db.query(`UPDATE books_intake SET status = 'accepted', decided_by = $2, decided_at = NOW() WHERE id = $1`, [row.id, adminId]))
      .rejects.toMatchObject({ code: '23514' });
    await expect(db.query(`UPDATE books_intake SET status = 'rejected', reject_reason = 'x' WHERE id = $1`, [row.id]))
      .rejects.toMatchObject({ code: '23514' });
    await expect(db.query(`UPDATE books_intake SET status = 'rejected', decided_by = $2, decided_at = NOW() WHERE id = $1`, [row.id, adminId]))
      .rejects.toMatchObject({ code: '23514' }); // rejected needs a reason
  });

  it('a decided row cannot return to the queue, and its expense link cannot be repointed', async () => {
    const { intake: row } = await ledger.withTransaction(c =>
      intake.receive(c, writeDoc('frozen'), { createdBy: adminId }));
    const accepted = await ledger.withTransaction(c =>
      intake.accept(c, row.id, { expenseInput: operatorBody(), createdBy: adminId }));
    const other = await ledger.withTransaction(c =>
      expenses.createExpense(c, { ...operatorBody(), createdBy: adminId }));

    await expect(db.query(`UPDATE books_intake SET status = 'pending', expense_id = NULL, decided_by = NULL, decided_at = NULL WHERE id = $1`, [row.id]))
      .rejects.toMatchObject({ code: '23001' });
    await expect(db.query(`UPDATE books_intake SET expense_id = $2 WHERE id = $1`, [row.id, other.expense.id]))
      .rejects.toMatchObject({ code: '23001' });
    expect(accepted.intake.expense_id).not.toBe(other.expense.id);
  });

  it('provenance freezes with the document', async () => {
    const { document } = await ledger.withTransaction(c =>
      intake.receive(c, writeDoc('prov'), { createdBy: adminId }));
    await expect(db.query(`UPDATE books_documents SET source_kind = 'peppol' WHERE id = $1`, [document.id]))
      .rejects.toMatchObject({ code: '23001' });
  });

  it('re-delivery of the same document is refused while it is pending, and allowed once decided', async () => {
    const file = writeDoc('redeliver');
    const { intake: first } = await ledger.withTransaction(c =>
      intake.receive(c, file, { createdBy: adminId, sourceRef: 'msg-9' }));
    await expect(ledger.withTransaction(c => intake.receive(c, file, { createdBy: adminId, sourceRef: 'msg-9' })))
      .rejects.toMatchObject({ code: 'ALREADY_QUEUED', status: 409 });
    await ledger.withTransaction(c => intake.reject(c, first.id, { reason: 'duplicate delivery', createdBy: adminId }));
    const { intake: again } = await ledger.withTransaction(c =>
      intake.receive(c, file, { createdBy: adminId, sourceRef: 'msg-9' }));
    expect(again.status).toBe('pending');
  });

  it('reject needs a reason and is final', async () => {
    const row = await pendingRow();
    await expect(ledger.withTransaction(c => intake.reject(c, row.id, { reason: '  ', createdBy: adminId })))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const { intake: rejected } = await ledger.withTransaction(c =>
      intake.reject(c, row.id, { reason: 'not ours', createdBy: adminId }));
    expect(rejected).toMatchObject({ status: 'rejected', reject_reason: 'not ours', decided_by: adminId });
    await expect(ledger.withTransaction(c => intake.accept(c, row.id, { expenseInput: operatorBody(), createdBy: adminId })))
      .rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
  });
});

describe('what the ladder is allowed to drive', () => {
  it('suggest() proposes from history and runs the duplicate check, and writes nothing', async () => {
    const supplier = `Sögulegur birgir ${++seq}`;
    await ledger.withTransaction(c => expenses.createExpense(c, {
      ...operatorBody({ supplierName: supplier, supplierVatNumber: '54321', supplierInvoiceNo: 'H-1', amountGross: 12400 }), createdBy: adminId,
    }));
    const { intake: row } = await ledger.withTransaction(c =>
      intake.receive(c, writeDoc('history'), {
        createdBy: adminId, sourceKind: 'extracted',
        suggested: { supplier_name: supplier, supplier_invoice_no: 'H-1', amount_gross: 12400, expense_date: '2026-07-12' },
      }));
    const before = await journalCount();
    const s = await intake.suggest(db, row.id);
    expect(s.suggestion).toMatchObject({ from_history: true, supplier_vat_number: '54321', account_code: '6300', vat_code: 'input_24' });
    expect(s.duplicates.length).toBeGreaterThan(0); // same supplier + invoice number → the warning
    expect(await journalCount()).toBe(before);
    expect((await intake.get(db, row.id)).status).toBe('pending');
  });

  it('supplier_vat_number is persisted with the expense (096) — the evidence behind the deduction', async () => {
    const r = await ledger.withTransaction(c => expenses.createExpense(c, { ...operatorBody({ supplierVatNumber: '98765' }), createdBy: adminId }));
    const { rows } = await db.query(`SELECT supplier_vat_number FROM expenses WHERE id = $1`, [r.expense.id]);
    expect(rows[0].supplier_vat_number).toBe('98765');
    // Expand/contract: omitting it is still fine.
    const r2 = await ledger.withTransaction(c => expenses.createExpense(c, { ...operatorBody({ supplierVatNumber: '' }), vatCode: 'none', createdBy: adminId }));
    const { rows: r2rows } = await db.query(`SELECT supplier_vat_number FROM expenses WHERE id = $1`, [r2.expense.id]);
    expect(r2rows[0].supplier_vat_number).toBeNull();
  });
});

describe('over HTTP', () => {
  it('an admin queues a file, sees it, accepts it with their own figures; the upload cannot claim a higher rung', async () => {
    const up = await request(app).post(`${BASE}/intake`).set('Cookie', adminCookie)
      .field('source_kind', 'peppol') // ignored: v1 only produces 'manual' from an upload
      .attach('file', Buffer.from(`%PDF-1.4 http ${Date.now()}`), 'reikningur.pdf')
      .expect(201);
    expect(up.body.intake.status).toBe('pending');
    expect(up.body.intake.source_kind).toBe('manual');
    expect(up.body.document.source_kind).toBe('manual');

    const list = await request(app).get(`${BASE}/intake`).set('Cookie', readerCookie).expect(200);
    expect(list.body.items.some(i => i.id === up.body.intake.id)).toBe(true);

    const sugg = await request(app).get(`${BASE}/intake/${up.body.intake.id}/suggestions`).set('Cookie', readerCookie).expect(200);
    expect(sugg.body.suggestion).toBeTruthy();

    const body = operatorBody();
    const acc = await request(app).post(`${BASE}/intake/${up.body.intake.id}/accept`).set('Cookie', adminCookie)
      .send({
        supplier_name: body.supplierName, supplier_vat_number: body.supplierVatNumber, supplier_country: 'IS',
        supplier_invoice_no: body.supplierInvoiceNo, expense_date: body.expenseDate, amount_gross: body.amountGross,
        currency: 'ISK', vat_code: 'input_24', account_code: '6300', description: 'http accept',
        document_id: 'not-mine', // ignored: the intake's own document is forced
      })
      .expect(201);
    expect(acc.body.intake.status).toBe('accepted');
    expect(acc.body.expense.document_id).toBe(up.body.document.id);
    expect(acc.body.expense.created_by).toBe(adminId);

    const dash = await request(app).get(`${BASE}/dashboard`).set('Cookie', adminCookie).expect(200);
    expect(typeof dash.body.intake_pending).toBe('number');
  });

  it('a reader may look but not decide', async () => {
    const { intake: row } = await ledger.withTransaction(c =>
      intake.receive(c, writeDoc('rbac'), { createdBy: adminId }));
    await request(app).get(`${BASE}/intake/${row.id}`).set('Cookie', readerCookie).expect(200);
    await request(app).post(`${BASE}/intake/${row.id}/accept`).set('Cookie', readerCookie).send({}).expect(403);
    await request(app).post(`${BASE}/intake/${row.id}/reject`).set('Cookie', readerCookie).send({ reason: 'x' }).expect(403);
    await request(app).post(`${BASE}/intake`).set('Cookie', readerCookie)
      .attach('file', Buffer.from('%PDF-1.4 r'), 'r.pdf').expect(403);
  });

  it('a duplicate on accept is a 409 with the matches attached, and allow_duplicate goes through', async () => {
    const supplier = `Tvítekinn ${++seq}`;
    await ledger.withTransaction(c => expenses.createExpense(c, {
      ...operatorBody({ supplierName: supplier, supplierInvoiceNo: 'DUP-1' }), createdBy: adminId,
    }));
    const { intake: row } = await ledger.withTransaction(c => intake.receive(c, writeDoc('dup'), { createdBy: adminId }));
    const payload = {
      supplier_name: supplier, supplier_vat_number: '12345', supplier_country: 'IS', supplier_invoice_no: 'DUP-1',
      expense_date: '2026-07-12', amount_gross: 12400, currency: 'ISK', vat_code: 'input_24', account_code: '6300',
    };
    const dup = await request(app).post(`${BASE}/intake/${row.id}/accept`).set('Cookie', adminCookie).send(payload).expect(409);
    expect(dup.body.duplicates.length).toBeGreaterThan(0);
    expect((await intake.get(db, row.id)).status).toBe('pending'); // nothing half-done
    await request(app).post(`${BASE}/intake/${row.id}/accept`).set('Cookie', adminCookie)
      .send({ ...payload, allow_duplicate: true }).expect(201);
  });
});

describe('documents keep working as before', () => {
  it('register() without a source is manual, and the checksum still verifies on read', async () => {
    const file = writeDoc('legacy');
    const { document } = await ledger.withTransaction(c => documents.register(c, file, { createdBy: adminId }));
    expect(document.source_kind).toBe('manual');
    const opened = await documents.open(db, document.id);
    expect(opened.document.id).toBe(document.id);
  });
});
