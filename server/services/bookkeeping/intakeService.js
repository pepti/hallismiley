// The intake queue: documents that have arrived and are waiting for a person.
//
// A row in books_intake is a PROPOSAL. It touches no account and moves no money.
// Three structural facts — not a comment — keep it that way:
//
//   1. There is exactly one function that can create an expense,
//      expenseService.createExpense(), and it requires createdBy landing in a
//      NOT NULL REFERENCES users(id) column. accept() calls it with the person
//      who clicked. Nothing here posts a journal line.
//   2. The accept route is requireRole('admin') + csrfProtect like every other
//      money write. A background job cannot mint a CSRF token.
//   3. The database refuses an 'accepted' row that names no expense and no
//      decider (migration 096's CHECKs). A future bug that calls accept() from a
//      cron cannot produce a row that LOOKS human-approved.
//
// source_kind (the trust ladder) drives how the form pre-fills and how the
// provenance reads in the archive. It never drives whether a human is required —
// there is a test named after that.
//
// v1 has no parsers: receive() takes whatever its caller already extracted
// (`suggested`) and the upload controller passes {}. When the inbound Peppol
// parser lands it is a second caller and needs no change here.

const Expense = require('../../models/Expense');
const documentService = require('./documentService');
const expenseService = require('./expenseService');
const audit = require('./auditLog');
const {
  SOURCE_KINDS, STATUSES, dedupeHash, expenseInputFromOperator, denormalise,
} = require('./intakeShape');

class IntakeError extends Error {
  constructor(message, status = 400, code = 'INTAKE') {
    super(message);
    this.name = 'IntakeError';
    this.status = status;
    this.code = code;
  }
}

function shape(row) {
  if (!row) return null;
  return { ...row, amount_gross: row.amount_gross == null ? null : Number(row.amount_gross) };
}

/**
 * The ONLY way a row enters the queue. Registers the file through documentService
 * (checksum, immutability, seven-year retention all unchanged) and files a
 * proposal beside it. Posts nothing.
 */
async function receive(client, file, {
  sourceKind = 'manual', sourceRef = null, sourceReceivedAt = null,
  suggested = {}, parseProblems = [], createdBy, requestId = null,
} = {}) {
  if (!createdBy) throw new IntakeError('receive requires createdBy', 500);
  if (!SOURCE_KINDS.includes(sourceKind)) throw new IntakeError(`Unknown source kind: ${sourceKind}`, 400, 'BAD_SOURCE');

  const { document } = await documentService.register(client, file, {
    kind: 'supplier_invoice',
    note: sourceRef ? `intake: ${String(sourceRef).slice(0, 400)}` : 'intake',
    createdBy, requestId, sourceKind, sourceRef, sourceReceivedAt,
  });

  const hash = dedupeHash({ sourceKind, checksum: document.checksum_sha256, sourceRef });
  const d = denormalise(suggested);
  let rows;
  try {
    ({ rows } = await client.query(
      `INSERT INTO books_intake
         (source_kind, source_ref, document_id, suggested, parse_problems,
          supplier_name, supplier_kennitala, supplier_invoice_no, document_date, amount_gross, currency,
          dedupe_hash, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        sourceKind, sourceRef, document.id,
        JSON.stringify(suggested && typeof suggested === 'object' ? suggested : {}),
        JSON.stringify(Array.isArray(parseProblems) ? parseProblems : []),
        d.supplier_name, d.supplier_kennitala, d.supplier_invoice_no, d.document_date, d.amount_gross, d.currency,
        hash, createdBy,
      ]
    ));
  } catch (err) {
    if (err.code === '23505') {
      // Re-delivery of the same message must not queue the same bill twice.
      throw new IntakeError('This document is already waiting in the queue', 409, 'ALREADY_QUEUED', { cause: err });
    }
    throw err;
  }
  const intake = shape(rows[0]);

  await audit.record(client, {
    actorId: createdBy,
    action: 'intake.received',
    entityType: 'intake',
    entityId: intake.id,
    requestId,
    summary: { source_kind: sourceKind, document_id: document.id, parse_problems: (parseProblems || []).length },
  });
  return { intake, document };
}

async function list(client, { status = 'pending', limit = 50, offset = 0 } = {}) {
  if (!STATUSES.includes(status)) throw new IntakeError(`Unknown status: ${status}`, 400, 'BAD_STATUS');
  const { rows } = await client.query(
    `SELECT i.*, d.original_name, d.mime_type, d.byte_size, d.checksum_sha256,
            COUNT(*) OVER() AS total
       FROM books_intake i
       JOIN books_documents d ON d.id = i.document_id
      WHERE i.status = $1
      ORDER BY i.created_at DESC
      LIMIT $2 OFFSET $3`,
    [status, limit, offset]
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { items: rows.map(r => { const { total: _t, ...rest } = r; return shape(rest); }), total };
}

async function get(client, id) {
  const { rows } = await client.query(
    `SELECT i.*, d.original_name, d.mime_type, d.byte_size, d.checksum_sha256
       FROM books_intake i JOIN books_documents d ON d.id = i.document_id
      WHERE i.id = $1`,
    [String(id)]
  );
  return shape(rows[0]);
}

/**
 * A READ-ONLY proposal for one pending row: what this supplier was last posted
 * to, plus the duplicate check verbatim. Returns; writes nothing. Mirrors
 * getBankSuggestions.
 */
async function suggest(client, id) {
  const intake = await get(client, id);
  if (!intake) throw new IntakeError('Intake item not found', 404, 'NOT_FOUND');

  const suggestion = {
    supplier_name: intake.supplier_name,
    supplier_kennitala: intake.supplier_kennitala,
    supplier_invoice_no: intake.supplier_invoice_no,
    expense_date: intake.document_date,
    amount_gross: intake.amount_gross,
    currency: intake.currency,
    supplier_vat_number: null,
    supplier_country: null,
    account_code: null,
    vat_code: null,
    from_history: false,
  };

  if (intake.supplier_name) {
    const { rows } = await client.query(
      `SELECT e.supplier_vat_number, e.supplier_country, e.vat_code, la.code AS account_code
         FROM expenses e JOIN ledger_accounts la ON la.id = e.account_id
        WHERE lower(e.supplier_name) = lower($1)
        ORDER BY e.created_at DESC LIMIT 1`,
      [intake.supplier_name]
    );
    if (rows.length) {
      Object.assign(suggestion, {
        supplier_vat_number: rows[0].supplier_vat_number,
        supplier_country: rows[0].supplier_country,
        vat_code: rows[0].vat_code,
        account_code: rows[0].account_code,
        from_history: true,
      });
    }
  }

  const duplicates = intake.supplier_name
    ? await expenseService.findPossibleDuplicates(client, {
      supplierName: intake.supplier_name,
      supplierKennitala: intake.supplier_kennitala,
      supplierInvoiceNo: intake.supplier_invoice_no,
      expenseDate: intake.document_date,
      amountGross: intake.amount_gross,
    })
    : [];

  return { intake, suggestion, duplicates };
}

/**
 * The human gate. Takes the OPERATOR-SUBMITTED values (never the suggestion),
 * calls expenseService.createExpense() with the operator as createdBy and the
 * intake's document attached — same transaction, so the duplicate 409, the VAT
 * verdict, the period lock and the ledger posting behave exactly as from the
 * manual form — then stamps the row.
 */
async function accept(client, id, { expenseInput, createdBy, requestId = null } = {}) {
  if (!createdBy) throw new IntakeError('accept requires the accepting user', 500);
  const { rows } = await client.query(
    `SELECT * FROM books_intake WHERE id = $1 FOR UPDATE`, [String(id)]
  );
  const intake = shape(rows[0]);
  if (!intake) throw new IntakeError('Intake item not found', 404, 'NOT_FOUND');
  if (intake.status !== 'pending') {
    throw new IntakeError(`This item was already ${intake.status}`, 409, 'ALREADY_DECIDED');
  }

  const input = expenseInputFromOperator(expenseInput, intake, { createdBy, requestId });
  const result = await expenseService.createExpense(client, input);

  const { rows: updated } = await client.query(
    `UPDATE books_intake
        SET status = 'accepted', expense_id = $2, decided_by = $3, decided_at = NOW()
      WHERE id = $1 RETURNING *`,
    [intake.id, result.expense.id, createdBy]
  );
  await audit.record(client, {
    actorId: createdBy,
    action: 'intake.accepted',
    entityType: 'intake',
    entityId: intake.id,
    requestId,
    summary: { expense_id: result.expense.id, source_kind: intake.source_kind },
  });
  return { intake: shape(updated[0]), expense: await Expense.findById(result.expense.id, client), verdict: result.verdict };
}

async function reject(client, id, { reason, createdBy, requestId = null } = {}) {
  if (!createdBy) throw new IntakeError('reject requires the deciding user', 500);
  const why = String(reason || '').trim();
  if (!why) throw new IntakeError('A reason is required to reject a queued document', 400, 'REASON_REQUIRED');
  const { rows } = await client.query(
    `SELECT * FROM books_intake WHERE id = $1 FOR UPDATE`, [String(id)]
  );
  const intake = shape(rows[0]);
  if (!intake) throw new IntakeError('Intake item not found', 404, 'NOT_FOUND');
  if (intake.status !== 'pending') {
    throw new IntakeError(`This item was already ${intake.status}`, 409, 'ALREADY_DECIDED');
  }
  const { rows: updated } = await client.query(
    `UPDATE books_intake
        SET status = 'rejected', reject_reason = $2, decided_by = $3, decided_at = NOW()
      WHERE id = $1 RETURNING *`,
    [intake.id, why.slice(0, 500), createdBy]
  );
  await audit.record(client, {
    actorId: createdBy,
    action: 'intake.rejected',
    entityType: 'intake',
    entityId: intake.id,
    requestId,
    summary: { reason: why.slice(0, 200), source_kind: intake.source_kind },
  });
  return { intake: shape(updated[0]) };
}

async function countPending(client) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM books_intake WHERE status = 'pending'`);
  return rows[0].n;
}

module.exports = {
  IntakeError, SOURCE_KINDS, STATUSES,
  receive, list, get, suggest, accept, reject, countPending,
};
