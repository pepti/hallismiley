// The pure half of the intake queue — no database. Requireable from the unit tier.
//
// Two things live here because they are the ones worth pinning with a test that
// needs no Postgres: the delivery hash that keeps a re-sent message from queueing
// twice, and the rule that what gets POSTED comes from the operator's hand and
// never from the machine's proposal.

const crypto = require('crypto');

// The trust ladder, top to bottom. What it may drive: pre-fill, how loudly the
// duplicate check speaks, provenance in the archive. What it may never drive:
// whether a human is required.
const SOURCE_KINDS = ['peppol', 'embedded_xml', 'extracted', 'manual'];
const STATUSES = ['pending', 'accepted', 'rejected', 'superseded'];

// Stable across re-deliveries of the same message: same channel, same bytes, same
// sender-side reference → same hash. The partial unique index on books_intake
// turns a second pending row with this hash into a 409 rather than a second bill.
function dedupeHash({ sourceKind, checksum, sourceRef = null }) {
  if (!SOURCE_KINDS.includes(sourceKind)) throw new TypeError(`Unknown source kind: ${sourceKind}`);
  if (!checksum) throw new TypeError('dedupeHash needs the document checksum');
  return crypto.createHash('sha256')
    .update(`${sourceKind}\n${String(checksum)}\n${sourceRef == null ? '' : String(sourceRef)}`, 'utf8')
    .digest('hex');
}

/**
 * The input that goes to expenseService.createExpense() when an intake item is
 * accepted. Built from the OPERATOR's submitted body — the suggestion reached the
 * screen and comes back through the form, so a field the operator did not look at
 * cannot be posted — with three things forced: the document is the intake's own,
 * the person is the one accepting, and nothing is read from `intake.suggested`.
 */
function expenseInputFromOperator(operatorBody, intake, { createdBy, requestId = null }) {
  if (!createdBy) throw new TypeError('expenseInputFromOperator requires the accepting user');
  if (!intake || !intake.document_id) throw new TypeError('expenseInputFromOperator requires an intake row with a document');
  const body = { ...(operatorBody || {}) };
  delete body.documentId;
  delete body.createdBy;
  delete body.requestId;
  return { ...body, documentId: intake.document_id, createdBy, requestId };
}

// The four columns the queue screen sorts, searches and de-duplicates on, lifted
// out of the free-form proposal. Anything unparseable stays null.
function denormalise(suggested = {}) {
  const s = suggested && typeof suggested === 'object' ? suggested : {};
  const text = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max) || null);
  const date = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const amount = v => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return {
    supplier_name: text(s.supplier_name, 200),
    supplier_kennitala: text(s.supplier_kennitala, 20),
    supplier_invoice_no: text(s.supplier_invoice_no, 100),
    document_date: date(s.expense_date || s.document_date),
    amount_gross: amount(s.amount_gross),
    currency: text(s.currency, 3) || 'ISK',
  };
}

module.exports = { SOURCE_KINDS, STATUSES, dedupeHash, expenseInputFromOperator, denormalise };
