// Append-only audit trail for the books.
//
// Reglugerð 505/2013 gr. 8 requires that the path of data through the accounting
// system be traceable, with an identifiable person behind every entry. The ledger
// tables carry created_by for that, but "who changed this invoice's status" and
// "who filed this VSK return" need somewhere to live too.
//
// Two rules:
//   - Written with the SAME client as the change it describes, so it commits or
//     rolls back atomically with it. An audit row for a change that never
//     happened is worse than no audit row.
//   - Never contains a raw amount alongside a customer identity in a way that
//     would make the log itself a PII/financial export. Summaries stay minimal:
//     ids and field names, plus amounts where the amount IS the fact being
//     recorded (an invoice total, a payment). Emails and kennitölur are not
//     copied here — they are already on the document and this table is dumped by
//     the archive export.

const logger = require('../../logger');

// Actions are a closed vocabulary so the log can be filtered and so a typo does
// not create a silent second category that nobody ever queries.
const ACTIONS = [
  'invoice.issued', 'invoice.cancelled', 'invoice.credited',
  'payment.recorded', 'payment.refunded',
  'credit_note.issued',
  'expense.created', 'expense.updated',
  'journal.posted', 'journal.reversed', 'journal.draft_posted',
  'vat.filed', 'period.locked', 'period.unlocked',
  // Payroll. 'rates_saved' and 'rates_confirmed' are separate on purpose: entering the
  // year's figures and vouching for them against the published table are different acts
  // by (potentially) different people, and it is the second that lets payroll run.
  'payroll.rates_saved', 'payroll.rates_confirmed',
  'payroll.employee_created', 'payroll.employee_updated',
  'payroll.run_drafted', 'payroll.run_posted', 'payroll.run_reversed',
  'payroll.wages_paid',
  'payroll.run', 'payroll.settled',
  'pos.sale',
  'fx.rate_set',
  'coa.updated',
  'document.uploaded',
  'bank.imported', 'bank.matched',
  'stripe.synced',
  'archive.exported',
];

/**
 * Record a books mutation.
 *
 * @param {object} client  pg client inside the same transaction as the change
 * @param {object} opts
 *   actorId    {string}  acting user id (null only for system/cron actions)
 *   action     {string}  one of ACTIONS
 *   entityType {string}  'invoice' | 'payment' | 'journal_entry' | ...
 *   entityId   {string}  that entity's id
 *   summary    {object}  small JSON blob describing what changed
 *   requestId  {string}  request correlation id, when available
 */
async function record(client, { actorId = null, action, entityType, entityId = null, summary = {}, requestId = null }) {
  if (!ACTIONS.includes(action)) {
    // Throwing rather than logging-and-continuing: an unrecognised action means
    // the caller is adding a new kind of mutation and should register it here, so
    // the vocabulary stays a real index of what the system can do.
    throw new Error(`Unknown books audit action: ${action}`);
  }
  await client.query(
    `INSERT INTO books_audit_log (actor_id, action, entity_type, entity_id, summary, request_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [actorId, action, entityType, entityId, JSON.stringify(summary || {}), requestId]
  );
  // Deliberately not logging the summary payload: it can contain amounts, and the
  // audit table is the durable record. The log line is for correlation only.
  logger.info({ action, entityType, entityId, actorId, requestId }, 'books audit');
}

/**
 * Actor + correlation id off a request, for the services that take them.
 *
 * Spread into a service call: `{ ...actorOf(req), amount }`. The services want
 * `createdBy` (it lands in a NOT NULL column) while record() above wants
 * `actorId`, so both names are returned rather than making every call site
 * remember which one applies.
 */
function actorOf(req) {
  const id = req.user ? req.user.id : null;
  return { actorId: id, createdBy: id, requestId: req.requestId || null };
}

// History for one entity, newest first. Used by the "who touched this" panel on
// invoice and entry detail screens.
async function forEntity(client, entityType, entityId, limit = 50) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await client.query(
    `SELECT bal.id, bal.action, bal.summary, bal.created_at,
            bal.actor_id, u.username AS actor_username
       FROM books_audit_log bal
       LEFT JOIN users u ON u.id = bal.actor_id
      WHERE bal.entity_type = $1 AND bal.entity_id = $2
      ORDER BY bal.created_at DESC, bal.id DESC
      LIMIT $3`,
    [entityType, entityId, capped]
  );
  return rows;
}

module.exports = { ACTIONS, record, actorOf, forEntity };
