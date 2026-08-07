// The ledger. Every financial posting in the system goes through postEntry() —
// there is deliberately no other way to write journal_lines from application code.
//
// Four invariants this module owns:
//
//   1. Double entry. An entry must balance, and postEntry refuses it otherwise.
//      The database asserts the same thing independently (trg_journal_lines_balanced),
//      because a CHECK constraint cannot see sibling rows and a future writer that
//      bypassed this module would otherwise be able to post a broken entry.
//
//   2. Gapless document numbers (Reglugerð 505/2013 gr. 16). Numbers come from a
//      counter row incremented inside the caller's transaction; the UPDATE holds
//      a row lock until COMMIT, so concurrent callers queue and a rollback returns
//      the number unused. A Postgres SEQUENCE is the wrong tool here: it does not
//      roll back, so a failed insert burns a number and holes the series.
//
//   3. Append-only (gr. 9). Posted entries are never updated or deleted. A
//      correction is a new reversing entry that cross-references the original.
//
//   4. Closed periods stay closed. Once a VSK return is filed its period is
//      locked and nothing may post into it.
//
// Callers pass their own pg client so numbering, the document insert and the
// posting all share one transaction. Read helpers accept a client too, so they
// can participate in the caller's snapshot rather than opening a second
// connection mid-transaction (doing that both breaks isolation and risks pool
// exhaustion under load).

const db = require('../../config/database');
const logger = require('../../logger');
const { assertIntegerIsk } = require('../../utils/vat');
const { periodForDate, periodBounds } = require('../../utils/vatPeriod');
const { toIsoDate, todayIso } = require('../../utils/booksDate');

class LedgerError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'LedgerError';
    this.status = status;
    if (code) this.code = code;
  }
}

const COUNTERS = ['invoice', 'receipt', 'credit_note', 'journal_entry'];

// ── Chart of accounts ──────────────────────────────────────────────────────────

// The COA is small (tens of rows) and effectively static at runtime, so it is
// cached per process. Editing an account in the admin UI calls invalidate().
let accountCache = null;

async function loadAccounts(client = db) {
  if (accountCache) return accountCache;
  const { rows } = await client.query(
    `SELECT id, code, name, name_en, type, vat_code, input_vat_blocked, is_active, sort
       FROM ledger_accounts ORDER BY sort, code`
  );
  accountCache = {
    byCode: new Map(rows.map(r => [r.code, r])),
    byId: new Map(rows.map(r => [r.id, r])),
    all: rows,
  };
  return accountCache;
}

function invalidateAccountCache() {
  accountCache = null;
}

// Resolve a COA code to its row, refusing unknown or deactivated accounts. The
// system this replaces never checked is_active, so a deactivated account could
// still be posted to.
async function accountByCode(code, client = db) {
  const { byCode } = await loadAccounts(client);
  const account = byCode.get(String(code));
  if (!account) {
    throw new LedgerError(`Unknown ledger account code: ${code}`, 500, 'UNKNOWN_ACCOUNT');
  }
  if (!account.is_active) {
    throw new LedgerError(`Ledger account ${code} is deactivated and cannot be posted to`, 400, 'INACTIVE_ACCOUNT');
  }
  return account;
}

// ── Gapless counters ──────────────────────────────────────────────────────────

// MUST be called inside a transaction. The UPDATE takes a row lock that is held
// until COMMIT, so a rollback returns the number and concurrent callers queue
// rather than collide. Keep the critical section after this call short: every
// round-trip made while holding it serialises all document creation.
async function nextCounter(client, name) {
  if (!COUNTERS.includes(name)) {
    throw new LedgerError(`Unknown document counter: ${name}`, 500);
  }
  const { rows } = await client.query(
    `UPDATE bookkeeping_counters
        SET next_value = next_value + 1, updated_at = NOW()
      WHERE name = $1
      RETURNING next_value - 1 AS value`,
    [name]
  );
  if (!rows.length) throw new LedgerError(`Document counter ${name} is missing`, 500);
  return Number(rows[0].value);
}

// ── Fiscal periods ────────────────────────────────────────────────────────────

// Create the period row for a date if it does not exist yet, so a year boundary
// is never a hard stop. Idempotent.
async function ensureFiscalPeriod(client, date) {
  const period = periodForDate(date);
  const bounds = periodBounds(period);
  await client.query(
    `INSERT INTO fiscal_periods (period, starts_on, ends_on)
     VALUES ($1, $2, $3) ON CONFLICT (period) DO NOTHING`,
    [period, bounds.starts_on, bounds.ends_on]
  );
  return period;
}

async function periodStatus(date, client = db) {
  const period = periodForDate(date);
  const { rows } = await client.query(
    `SELECT period, status, locked_at FROM fiscal_periods WHERE period = $1`,
    [period]
  );
  return rows[0] || { period, status: 'open', locked_at: null };
}

// Checked here so the caller gets a clean 409 with an explanation, rather than a
// raw Postgres exception from the trigger. The trigger remains the real guarantee.
async function assertPeriodOpen(client, date) {
  const status = await periodStatus(date, client);
  if (status.status === 'locked') {
    throw new LedgerError(
      `The accounting period ${status.period} is closed because its VSK return has been filed. ` +
      'Post the correction into the current open period instead.',
      409,
      'PERIOD_LOCKED'
    );
  }
  return status.period;
}

// ── Posting ───────────────────────────────────────────────────────────────────

/**
 * Post a balanced journal entry. This is the only supported way to write to the
 * ledger.
 *
 * @param {object} client   pg client already inside a transaction
 * @param {object} entry
 *   entryDate    {string|Date} the accounting date (drives which period it lands in)
 *   memo         {string}      human description, required — an entry nobody can
 *                              interpret later is not a record
 *   sourceType   {string}      which kind of document this rests on
 *   sourceId     {string}      that document's id
 *   documentId   {string}      optional fylgiskjal (supporting document) id
 *   createdBy    {string}      the acting user's id — required by gr. 8
 *   lines        {Array}       [{ accountCode, debit, credit, memo?, vatRate? }]
 *   reversesEntryId {string}   set when this entry reverses another
 *   isCorrection {boolean}     flags a prior-period correction for the reports
 * @returns {{ id, entry_number, entry_date, period }}
 */
async function postEntry(client, entry) {
  const {
    entryDate,
    memo,
    sourceType,
    sourceId = null,
    documentId = null,
    createdBy,
    lines,
    reversesEntryId = null,
    isCorrection = false,
  } = entry || {};

  if (!createdBy) {
    // Not a nicety: Reglugerð 505/2013 gr. 8 requires an identifiable person
    // behind every entry, and the column is NOT NULL for the same reason.
    throw new LedgerError('postEntry requires createdBy (who is recording this entry)', 500);
  }
  if (!memo || !String(memo).trim()) {
    throw new LedgerError('postEntry requires a memo describing the entry', 500);
  }
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new LedgerError('A journal entry needs at least two lines', 500);
  }

  const date = normaliseDate(entryDate);
  await ensureFiscalPeriod(client, date);
  const period = await assertPeriodOpen(client, date);

  // Normalise and validate every leg before touching the database, so a bad
  // entry fails cleanly instead of half-written.
  const prepared = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const [i, line] of lines.entries()) {
    const debit = assertIntegerIsk(line.debit || 0, `lines[${i}].debit`);
    const credit = assertIntegerIsk(line.credit || 0, `lines[${i}].credit`);
    if (debit < 0 || credit < 0) {
      throw new LedgerError(`lines[${i}] has a negative amount; reverse the sides instead`, 500);
    }
    // Skip legs that are entirely zero — a COGS leg for a product with no cost
    // recorded, for instance. They carry no information and would violate the
    // one-side CHECK.
    if (debit === 0 && credit === 0) continue;
    if (debit !== 0 && credit !== 0) {
      throw new LedgerError(`lines[${i}] has both a debit and a credit; split it into two lines`, 500);
    }
    const account = await accountByCode(line.accountCode, client);
    prepared.push({
      accountId: account.id,
      debit,
      credit,
      memo: line.memo || '',
      vatRate: line.vatRate === undefined ? null : line.vatRate,
    });
    totalDebit += debit;
    totalCredit += credit;
  }

  if (prepared.length < 2) {
    throw new LedgerError('A journal entry needs at least two non-zero lines', 500);
  }
  if (totalDebit !== totalCredit) {
    throw new LedgerError(
      `Unbalanced journal entry: debits ${totalDebit} ISK <> credits ${totalCredit} ISK`,
      500,
      'UNBALANCED'
    );
  }

  // Built as a DRAFT first, then flipped to posted once its lines exist. Two
  // reasons, in order of importance:
  //   1. It lets the database refuse line INSERTs into a posted entry outright.
  //      If entries were born posted, that guard would have to allow appends and
  //      posted history could be rewritten by adding a balanced pair of lines.
  //   2. The gapless counter is consumed at the very end, so the row lock that
  //      serialises ALL document creation is held for one statement instead of
  //      across the whole line insert.
  const { rows } = await client.query(
    `INSERT INTO journal_entries
       (entry_date, memo, source_type, source_id, document_id,
        reverses_entry_id, is_correction, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, entry_date`,
    [date, String(memo).trim(), sourceType, sourceId, documentId,
      reversesEntryId, Boolean(isCorrection), createdBy]
  );
  const created = rows[0];

  // One multi-row INSERT rather than a loop.
  const values = [];
  const params = [];
  prepared.forEach((line, i) => {
    const b = i * 6;
    values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
    params.push(created.id, line.accountId, line.debit, line.credit, line.memo, i);
  });
  await client.query(
    `INSERT INTO journal_lines (entry_id, account_id, debit, credit, memo, sort_order)
     VALUES ${values.join(', ')}`,
    params
  );

  const entryNumber = await nextCounter(client, 'journal_entry');
  const { rows: postedRows } = await client.query(
    `UPDATE journal_entries SET posted_at = NOW(), entry_number = $2
      WHERE id = $1 RETURNING id, entry_number, entry_date`,
    [created.id, entryNumber]
  );
  const posted = postedRows[0];

  logger.info(
    { entryId: posted.id, entryNumber: Number(posted.entry_number), sourceType, period, lineCount: prepared.length },
    'ledger entry posted'
  );
  return { ...posted, entry_number: Number(posted.entry_number), period };
}

/**
 * Reverse a posted entry (Reglugerð 505/2013 gr. 9: corrections are separate
 * offsetting entries, never edits).
 *
 * The reversal is dated in an OPEN period — by default today — not on the
 * original's date, because the original's period may well be closed. That is the
 * correct accounting treatment anyway: a prior-period error is corrected in the
 * period you discover it, flagged as a correction so the reports can show it.
 */
async function reverseEntry(client, entryId, { createdBy, reason, entryDate = new Date() } = {}) {
  if (!createdBy) throw new LedgerError('reverseEntry requires createdBy', 500);
  if (!reason || !String(reason).trim()) {
    throw new LedgerError('A reversal must state a reason', 400, 'REASON_REQUIRED');
  }

  const { rows: entryRows } = await client.query(
    `SELECT id, entry_number, entry_date, memo, source_type, source_id, posted_at
       FROM journal_entries WHERE id = $1 FOR UPDATE`,
    [entryId]
  );
  const original = entryRows[0];
  if (!original) throw new LedgerError('Journal entry not found', 404, 'NOT_FOUND');
  if (!original.posted_at) {
    throw new LedgerError('That entry is still a draft — delete it instead of reversing it', 400, 'NOT_POSTED');
  }

  // uniq_journal_reversal enforces this too; checking first gives a clean error.
  const { rows: existing } = await client.query(
    `SELECT entry_number FROM journal_entries WHERE reverses_entry_id = $1`,
    [entryId]
  );
  if (existing.length) {
    throw new LedgerError(
      `Entry ${original.entry_number} has already been reversed by entry ${existing[0].entry_number}`,
      409,
      'ALREADY_REVERSED'
    );
  }

  const { rows: lines } = await client.query(
    `SELECT la.code AS account_code, jl.debit, jl.credit, jl.memo
       FROM journal_lines jl
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE jl.entry_id = $1
      ORDER BY jl.sort_order`,
    [entryId]
  );
  if (!lines.length) throw new LedgerError('That entry has no lines to reverse', 500);

  const reversalDate = normaliseDate(entryDate);
  const original_period = periodForDate(original.entry_date);
  const reversal_period = periodForDate(reversalDate);

  const posted = await postEntry(client, {
    entryDate: reversalDate,
    memo: `Bakfærsla á færslu ${original.entry_number}: ${String(reason).trim()}`,
    sourceType: 'reversal',
    sourceId: original.id,
    createdBy,
    reversesEntryId: original.id,
    isCorrection: reversal_period !== original_period,
    // Debit becomes credit and vice versa.
    lines: lines.map(l => ({
      accountCode: l.account_code,
      debit: Number(l.credit),
      credit: Number(l.debit),
      memo: l.memo,
    })),
  });

  return { reversal: posted, original_period, reversed_entry_number: Number(original.entry_number) };
}

// ── Draft entries ─────────────────────────────────────────────────────────────

// Drafts are the escape hatch that makes an append-only ledger usable: an entry
// can be built up and reviewed while posted_at IS NULL, and only becomes
// permanent when posted. Nothing outside the books UI should create drafts.
async function createDraft(client, { entryDate, memo, sourceType = 'manual', createdBy, lines = [] }) {
  if (!createdBy) throw new LedgerError('createDraft requires createdBy', 500);
  const date = normaliseDate(entryDate);
  const { rows } = await client.query(
    `INSERT INTO journal_entries (entry_date, memo, source_type, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id, entry_date, memo`,
    [date, String(memo || '').trim(), sourceType, createdBy]
  );
  const draft = rows[0];
  for (const [i, line] of lines.entries()) {
    const account = await accountByCode(line.accountCode, client);
    await client.query(
      `INSERT INTO journal_lines (entry_id, account_id, debit, credit, memo, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [draft.id, account.id, line.debit || 0, line.credit || 0, line.memo || '', i]
    );
  }
  return draft;
}

// Post an existing draft. The balance check lives in the database trigger that
// fires on the posted_at transition, so an unbalanced draft cannot slip through.
async function postDraft(client, draftId, { createdBy } = {}) {
  const { rows } = await client.query(
    `SELECT id, entry_date, posted_at FROM journal_entries WHERE id = $1 FOR UPDATE`,
    [draftId]
  );
  const draft = rows[0];
  if (!draft) throw new LedgerError('Draft entry not found', 404, 'NOT_FOUND');
  if (draft.posted_at) throw new LedgerError('That entry is already posted', 409, 'ALREADY_POSTED');
  await assertPeriodOpen(client, draft.entry_date);
  const entryNumber = await nextCounter(client, 'journal_entry');
  const { rows: posted } = await client.query(
    `UPDATE journal_entries SET posted_at = NOW(), entry_number = $2
      WHERE id = $1 RETURNING id, entry_number, entry_date`,
    [draftId, entryNumber]
  );
  logger.info({ entryId: draftId, entryNumber, actorId: createdBy }, 'draft journal entry posted');
  return posted[0];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Accounting dates are DATE columns: a calendar day, not an instant.
//
// Delegates to the shared helper rather than doing its own `toISOString()` —
// which reads the UTC day and, on a server at a positive offset, moves a late
// evening transaction into the next day and sometimes into the next VSK period.
// One conversion, used everywhere, is the only way the app and the DB triggers
// agree on which period a document belongs to.
/**
 * Close a fiscal period.
 *
 * Takes `FOR UPDATE` on the period row before flipping it. The posting trigger reads
 * fiscal_periods without a lock, so without this a transaction that started posting
 * while the period looked open could commit after the lock landed — putting an entry
 * inside a period whose figures had already been reported. Locking the row here
 * makes the two serialise on it.
 *
 * Asserts a row actually changed: `UPDATE ... WHERE status = 'open'` silently does
 * nothing on an already-locked period, and a lock that quietly did not happen is
 * worse than an error.
 */
async function lockPeriod(client, period, { lockedBy } = {}) {
  if (!lockedBy) throw new LedgerError('lockPeriod requires lockedBy', 500);
  const { rows: locked } = await client.query(
    `SELECT period, status FROM fiscal_periods WHERE period = $1 FOR UPDATE`, [period]
  );
  if (!locked.length) {
    throw new LedgerError(`No such accounting period: ${period}`, 404, 'NO_SUCH_PERIOD');
  }
  if (locked[0].status === 'locked') {
    throw new LedgerError(`Period ${period} is already locked`, 409, 'ALREADY_LOCKED');
  }
  const { rowCount } = await client.query(
    `UPDATE fiscal_periods
        SET status = 'locked', locked_at = NOW(), locked_by = $2
      WHERE period = $1 AND status = 'open'`,
    [period, lockedBy]
  );
  if (rowCount !== 1) {
    throw new LedgerError(`Failed to lock period ${period}`, 409, 'LOCK_FAILED');
  }
  logger.info({ period, lockedBy }, 'accounting period locked');
  return { period, status: 'locked' };
}

/**
 * Re-open a locked period.
 *
 * Exists because "filed by mistake, before actually submitting" is a real situation
 * and the alternative is someone editing fiscal_periods by hand. The reason is
 * required and the caller is expected to audit it — vatService.unlockPeriod does.
 */
async function unlockPeriod(client, period, { unlockedBy, reason } = {}) {
  if (!unlockedBy) throw new LedgerError('unlockPeriod requires unlockedBy', 500);
  if (!reason || !String(reason).trim()) {
    throw new LedgerError('unlockPeriod requires a reason', 400, 'REASON_REQUIRED');
  }
  const { rows } = await client.query(
    `SELECT period, status FROM fiscal_periods WHERE period = $1 FOR UPDATE`, [period]
  );
  if (!rows.length) {
    throw new LedgerError(`No such accounting period: ${period}`, 404, 'NO_SUCH_PERIOD');
  }
  if (rows[0].status !== 'locked') {
    throw new LedgerError(`Period ${period} is not locked`, 409, 'NOT_LOCKED');
  }
  await client.query(
    `UPDATE fiscal_periods SET status = 'open', locked_at = NULL, locked_by = NULL
      WHERE period = $1`,
    [period]
  );
  logger.warn({ period, unlockedBy, reason: String(reason).slice(0, 200) }, 'accounting period unlocked');
  return { period, status: 'open' };
}

function normaliseDate(value) {
  if (value === undefined || value === null) return todayIso();
  try {
    return toIsoDate(value);
  } catch (_err) {
    throw new LedgerError(`Invalid accounting date: ${value}`, 400, 'INVALID_DATE');
  }
}

// Run `fn` inside a transaction, handing it a dedicated client.
async function withTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  LedgerError,
  COUNTERS,
  loadAccounts,
  invalidateAccountCache,
  accountByCode,
  nextCounter,
  ensureFiscalPeriod,
  periodStatus,
  assertPeriodOpen,
  lockPeriod,
  unlockPeriod,
  postEntry,
  reverseEntry,
  createDraft,
  postDraft,
  normaliseDate,
  withTransaction,
};
