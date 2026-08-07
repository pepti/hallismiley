// Reconciliation — proving the books against the outside world.
//
// Two independent jobs that share one purpose: every króna the books claim to hold
// must be a króna some third party agrees you hold.
//
//   BANK. A statement is imported, each line is matched to something already in the
//   books, and what cannot be matched is visible rather than absorbed. An unexplained
//   bank line is the single most reliable signal that a transaction is missing — and
//   the reason bookkeeping has a bank reconciliation at all.
//
//   STRIPE. Card money does NOT arrive in the bank when the customer pays. Stripe
//   holds it, deducts its fee, and pays out days later in a lump. Three separate
//   facts, and the system this replaces collapsed them into one by debiting the bank
//   at checkout — which overstates the bank, hides the fee entirely, and makes the
//   bank reconciliation impossible because the lump payout matches nothing.
//
//   So: the charge lands in 1400 (acquirer clearing, done at payment time by
//   invoiceService), the FEE is an expense, and the PAYOUT sweeps 1400 → 1900. After
//   a correct sync, 1400 holds exactly the money Stripe is still sitting on.

const crypto = require('crypto');
const logger = require('../../logger');
const ledger = require('./ledgerService');
const audit = require('./auditLog');
const { assertIntegerIsk } = require('../../utils/vat');
const { toIsoDate, assertAccountingDate, todayIso } = require('../../utils/booksDate');

class ReconciliationError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'ReconciliationError';
    this.status = status;
    if (code) this.code = code;
  }
}

const BANK_ACCOUNT = '1900';
const CLEARING_ACCOUNT = '1400';   // Kortagreiðslur í vinnslu
const FEE_ACCOUNT = '6500';        // Bankakostnaður og greiðslugjöld
const SUSPENSE_ACCOUNT = '1990';   // Óvissureikningur
const AR_ACCOUNT = '1100';

// ── Bank statement import ────────────────────────────────────────────────────

/**
 * Parse an Icelandic bank CSV.
 *
 * Delimiter is DETECTED, not assumed. Icelandic exports are routinely semicolon
 * separated with a decimal comma, because that is what a locale-aware Excel writes —
 * and splitting such a file on `[,;]` turns "143,05" into two cells. Amounts likewise
 * arrive as "1.234.567,00" (dot thousands, comma decimal), which parseFloat reads as
 * 1.234 unless the separators are stripped in the right order.
 */
function parseBankCsv(text) {
  // A UTF-8 BOM is stripped by CODE POINT rather than with a regex containing the
  // character itself: Excel prefixes its CSV exports with one, and a literal BOM in
  // source is invisible to a reader (and irregular whitespace to the linter).
  const raw = String(text || '');
  const clean = (raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw).trim();
  if (!clean) throw new ReconciliationError('The file is empty', 400, 'EMPTY_FILE');

  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  const header = lines[0];
  // Whichever candidate appears more often in the header wins. A header has one
  // delimiter per column and rarely any decimal commas, so it is the reliable sample.
  const delimiter = [';', '\t', ',']
    .map(d => ({ d, n: header.split(d).length }))
    .sort((a, b) => b.n - a.n)[0];
  if (delimiter.n < 2) {
    throw new ReconciliationError(
      'Could not find columns in that file — expected a CSV exported from your bank',
      400, 'NO_COLUMNS'
    );
  }
  const sep = delimiter.d;

  const cells = row => row.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
  const cols = cells(header).map(c => c.toLowerCase());

  // Icelandic and English header names, since every bank words them differently.
  const findCol = (...names) => {
    for (const n of names) {
      const i = cols.findIndex(c => c.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const idx = {
    date: findCol('dagsetning', 'bókunardagur', 'date', 'bókun'),
    valueDate: findCol('gildisdagur', 'value'),
    description: findCol('skýring', 'texti', 'description', 'lýsing'),
    counterparty: findCol('viðskiptaaðili', 'greiðandi', 'counterparty', 'nafn'),
    reference: findCol('tilvísun', 'tilv', 'reference', 'kennitala'),
    amount: findCol('fjárhæð', 'hreyfing', 'amount', 'upphæð'),
    balance: findCol('staða', 'balance', 'eftirstöður'),
  };
  if (idx.date < 0 || idx.amount < 0) {
    throw new ReconciliationError(
      'That file has no recognisable date and amount columns. Export the statement as CSV from your bank without renaming the columns.',
      400, 'BAD_HEADERS'
    );
  }

  // "1.234.567,00" → 1234567. Strip group separators first, then normalise the
  // decimal comma, then round: bank statements are in whole krónur but sometimes
  // carry a ",00".
  const money = (raw) => {
    const s = String(raw || '').replace(/\s|kr\.?|ISK/gi, '');
    if (!s) return null;
    const normalised = s.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const n = Number(normalised);
    return Number.isFinite(n) ? Math.round(n) : null;
  };

  const rows = [];
  const problems = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = cells(lines[i]);
    const amount = money(c[idx.amount]);
    let bookedOn;
    try {
      bookedOn = normaliseBankDate(c[idx.date]);
    } catch {
      problems.push({ line: i + 1, reason: 'unreadableDate', raw: lines[i].slice(0, 120) });
      continue;
    }
    if (amount === null || amount === 0) {
      problems.push({ line: i + 1, reason: 'unreadableAmount', raw: lines[i].slice(0, 120) });
      continue;
    }
    rows.push({
      booked_on: bookedOn,
      value_on: idx.valueDate >= 0 ? safeDate(c[idx.valueDate]) : null,
      description: (c[idx.description] || '').slice(0, 500),
      counterparty: idx.counterparty >= 0 ? (c[idx.counterparty] || '').slice(0, 200) : null,
      reference: idx.reference >= 0 ? (c[idx.reference] || '').slice(0, 200) : null,
      amount,
      balance_after: idx.balance >= 0 ? money(c[idx.balance]) : null,
    });
  }
  return { rows, problems, delimiter: sep };
}

// Bank exports use dd.mm.yyyy as often as ISO, so both are accepted — but nothing
// ambiguous is guessed at (see booksDate for why).
function normaliseBankDate(raw) {
  const s = String(raw || '').trim();
  const dmy = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(s);
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return assertAccountingDate(iso, 'booked_on', { allowFuture: true });
  }
  return assertAccountingDate(s.slice(0, 10), 'booked_on', { allowFuture: true });
}

function safeDate(raw) {
  try { return normaliseBankDate(raw); } catch { return null; }
}

// One row's identity, for idempotent re-import. A statement is routinely downloaded
// twice with an overlapping window, and the same line must not become two.
function dedupeHash(accountCode, row) {
  return crypto.createHash('sha256').update([
    accountCode, row.booked_on, row.amount,
    (row.description || '').toLowerCase().replace(/\s+/g, ' '),
    row.reference || '', row.balance_after ?? '',
  ].join('|')).digest('hex');
}

/**
 * Import statement rows. Returns what was added and what was already present —
 * re-importing an overlapping window is expected, not an error.
 */
async function importBankRows(client, { accountCode = BANK_ACCOUNT, rows, createdBy, requestId = null }) {
  if (!createdBy) throw new ReconciliationError('importBankRows requires createdBy', 500);
  await ledger.accountByCode(accountCode, client); // refuse an unknown account up front

  const batch = crypto.randomUUID();
  let imported = 0;
  let duplicates = 0;

  for (const row of rows) {
    const hash = dedupeHash(accountCode, row);
    const { rowCount } = await client.query(
      `INSERT INTO bank_transactions
         (account_code, booked_on, value_on, description, counterparty, reference,
          amount, balance_after, import_batch, dedupe_hash, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (dedupe_hash) DO NOTHING`,
      [accountCode, row.booked_on, row.value_on, row.description, row.counterparty,
        row.reference, assertIntegerIsk(row.amount, 'amount'), row.balance_after,
        batch, hash, createdBy]
    );
    if (rowCount === 1) imported += 1; else duplicates += 1;
  }

  await audit.record(client, {
    actorId: createdBy,
    action: 'bank.imported',
    entityType: 'bank_import',
    entityId: batch,
    requestId,
    summary: { account: accountCode, imported, duplicates, rows: rows.length },
  });

  logger.info({ batch, accountCode, imported, duplicates }, 'bank statement imported');
  return { batch, imported, duplicates };
}

/**
 * Candidate matches for one bank line, best first.
 *
 * Suggestions only — nothing is applied automatically. An auto-matcher that is wrong
 * is worse than no matcher, because a wrongly matched line looks reconciled and stops
 * being investigated.
 */
async function suggestMatches(client, bankTxId) {
  const { rows: txRows } = await client.query(
    `SELECT * FROM bank_transactions WHERE id = $1`, [String(bankTxId)]
  );
  const tx = txRows[0];
  if (!tx) throw new ReconciliationError('Bank line not found', 404, 'NOT_FOUND');
  const amount = Number(tx.amount);

  const suggestions = [];

  if (amount > 0) {
    // Money in: an unpaid invoice. Exact amount and a reference containing the
    // invoice number are the two strong signals.
    const { rows } = await client.query(
      `SELECT i.id, i.invoice_number, i.customer_name, i.issued_at, i.due_at,
              (i.total_gross - i.amount_credited - i.amount_paid + i.amount_refunded)::bigint AS outstanding
         FROM invoices i
        WHERE i.status = 'issued'
          AND (i.total_gross - i.amount_credited - i.amount_paid + i.amount_refunded) > 0
        ORDER BY ABS((i.total_gross - i.amount_credited - i.amount_paid + i.amount_refunded) - $1) ASC,
                 i.issued_at DESC
        LIMIT 8`,
      [amount]
    );
    const haystack = `${tx.description || ''} ${tx.reference || ''} ${tx.counterparty || ''}`.toLowerCase();
    for (const inv of rows) {
      const outstanding = Number(inv.outstanding);
      let confidence = 'weak';
      if (outstanding === amount && haystack.includes(String(inv.invoice_number))) confidence = 'exact';
      else if (outstanding === amount) confidence = 'strong';
      else if (haystack.includes(String(inv.invoice_number))) confidence = 'strong';
      suggestions.push({
        kind: 'invoice',
        invoice_id: inv.id,
        invoice_number: Number(inv.invoice_number),
        customer_name: inv.customer_name,
        outstanding,
        confidence,
      });
    }
  } else {
    // Money out: an unpaid supplier bill. Same idea, matched on the gross.
    const { rows } = await client.query(
      `SELECT e.id, e.supplier_name, e.supplier_invoice_no, e.expense_date, e.amount_gross
         FROM expenses e
        WHERE e.expense_date >= $2::date - INTERVAL '90 days'
        ORDER BY ABS(e.amount_gross - $1) ASC, e.expense_date DESC
        LIMIT 8`,
      [Math.abs(amount), tx.booked_on]
    );
    const haystack = `${tx.description || ''} ${tx.counterparty || ''}`.toLowerCase();
    for (const e of rows) {
      const gross = Number(e.amount_gross);
      let confidence = 'weak';
      const nameHit = e.supplier_name
        && haystack.includes(String(e.supplier_name).toLowerCase().split(/\s+/)[0]);
      if (gross === Math.abs(amount) && nameHit) confidence = 'exact';
      else if (gross === Math.abs(amount)) confidence = 'strong';
      else if (nameHit) confidence = 'strong';
      suggestions.push({
        kind: 'expense',
        expense_id: e.id,
        supplier_name: e.supplier_name,
        supplier_invoice_no: e.supplier_invoice_no,
        amount_gross: gross,
        confidence,
      });
    }
  }

  const rank = { exact: 0, strong: 1, weak: 2 };
  suggestions.sort((a, b) => rank[a.confidence] - rank[b.confidence]);
  return { transaction: shapeBankTx(tx), suggestions };
}

/**
 * Resolve a bank line.
 *
 *   kind 'invoice'   record the receipt against that invoice (goes through
 *                    invoiceService, so the AR posting and audit are identical to a
 *                    manually entered payment)
 *   kind 'explained' post it to a chosen account with a written explanation
 *   kind 'suspense'  park it visibly in 1990, for a line nobody can identify yet
 *   kind 'ignore'    mark it as deliberately not a books transaction
 *
 * There is no "matched to an expense" posting: the expense already credited accounts
 * payable, so the bank line settles that — handled as 'explained' against 2100.
 */
async function resolveBankTransaction(client, bankTxId, opts = {}) {
  const { kind, actorId, requestId = null } = opts;
  if (!actorId) throw new ReconciliationError('resolveBankTransaction requires actorId', 500);

  const { rows } = await client.query(
    `SELECT * FROM bank_transactions WHERE id = $1 FOR UPDATE`, [String(bankTxId)]
  );
  const tx = rows[0];
  if (!tx) throw new ReconciliationError('Bank line not found', 404, 'NOT_FOUND');
  if (tx.match_state !== 'unmatched') {
    throw new ReconciliationError(
      `That bank line is already ${tx.match_state}`, 409, 'ALREADY_RESOLVED'
    );
  }
  const amount = Number(tx.amount);
  const bookedOn = toIsoDate(tx.booked_on);

  if (kind === 'ignore') {
    const reason = requireReason(opts.reason);
    await client.query(
      `UPDATE bank_transactions SET match_state = 'ignored', note = $2 WHERE id = $1`,
      [tx.id, reason]
    );
    await audit.record(client, {
      actorId, action: 'bank.matched', entityType: 'bank_transaction', entityId: tx.id,
      requestId, summary: { resolution: 'ignored', reason, amount },
    });
    return { transaction: shapeBankTx({ ...tx, match_state: 'ignored' }), journal_entry: null };
  }

  if (kind === 'invoice') {
    if (amount <= 0) {
      throw new ReconciliationError(
        'A money-OUT line cannot be a customer receipt', 400, 'WRONG_DIRECTION'
      );
    }
    // Deliberately routed through invoiceService: the AR posting, the settlement
    // counters and the audit entry then behave exactly as for a hand-entered payment.
    const invoiceService = require('./invoiceService');
    const result = await invoiceService.recordPayment(client, opts.invoiceId, {
      amount,
      method: 'bank_transfer',
      receivedAt: bookedOn,
      reference: (tx.reference || tx.description || '').slice(0, 200),
      // Deterministic from the bank line, so re-resolving the same line is a no-op
      // rather than a second payment.
      idempotencyKey: `bank:${tx.id}`,
      createdBy: actorId,
      requestId,
    });
    await client.query(
      `UPDATE bank_transactions
          SET match_state = 'matched', matched_payment_id = $2, matched_invoice_id = $3
        WHERE id = $1`,
      [tx.id, result.payment_id, opts.invoiceId]
    );
    await audit.record(client, {
      actorId, action: 'bank.matched', entityType: 'bank_transaction', entityId: tx.id,
      requestId, summary: { resolution: 'invoice', invoice_id: opts.invoiceId, amount },
    });
    return { transaction: shapeBankTx({ ...tx, match_state: 'matched' }), journal_entry: result.journal_entry };
  }

  // 'explained' and 'suspense' both post a two-line entry against the bank.
  const accountCode = kind === 'suspense'
    ? SUSPENSE_ACCOUNT
    : String(opts.accountCode || '').trim();
  if (!accountCode) {
    throw new ReconciliationError('An account is required to explain a bank line', 400, 'ACCOUNT_REQUIRED');
  }
  const reason = requireReason(opts.reason);
  const account = await ledger.accountByCode(accountCode, client);
  if ([BANK_ACCOUNT, ...(accountCode === BANK_ACCOUNT ? [] : [])].includes(account.code)) {
    throw new ReconciliationError('A bank line cannot be explained against the bank itself', 400, 'BAD_ACCOUNT');
  }

  const abs = Math.abs(amount);
  const entry = await ledger.postEntry(client, {
    entryDate: bookedOn,
    memo: `Banki: ${(tx.description || '').slice(0, 120)}`.trim(),
    sourceType: 'bank',
    sourceId: tx.id,
    createdBy: actorId,
    // Money in debits the bank; money out credits it.
    lines: amount > 0
      ? [
        { accountCode: BANK_ACCOUNT, debit: abs, memo: 'Innborgun' },
        { accountCode, credit: abs, memo: reason.slice(0, 200) },
      ]
      : [
        { accountCode, debit: abs, memo: reason.slice(0, 200) },
        { accountCode: BANK_ACCOUNT, credit: abs, memo: 'Útborgun' },
      ],
  });

  await client.query(
    `UPDATE bank_transactions
        SET match_state = $2, matched_entry_id = $3, note = $4
      WHERE id = $1`,
    [tx.id, kind === 'suspense' ? 'explained' : 'explained', entry.id, reason]
  );
  await audit.record(client, {
    actorId, action: 'bank.matched', entityType: 'bank_transaction', entityId: tx.id,
    requestId,
    summary: {
      resolution: kind, account: accountCode, amount, reason: reason.slice(0, 200),
      journal_entry_number: entry.entry_number,
    },
  });
  return { transaction: shapeBankTx({ ...tx, match_state: 'explained' }), journal_entry: entry };
}

function requireReason(reason) {
  const r = String(reason || '').trim();
  if (!r) {
    throw new ReconciliationError(
      'An explanation is required — an unexplained bank line is the main way a missing transaction is found, so it should not be silently absorbed',
      400, 'REASON_REQUIRED'
    );
  }
  return r.slice(0, 500);
}

function shapeBankTx(tx) {
  return {
    ...tx,
    amount: Number(tx.amount),
    balance_after: tx.balance_after === null ? null : Number(tx.balance_after),
    booked_on: toIsoDate(tx.booked_on),
    value_on: toIsoDate(tx.value_on),
  };
}

// ── Stripe settlement ───────────────────────────────────────────────────────

/**
 * Post Stripe balance transactions.
 *
 * Takes the list rather than fetching it, for two reasons: the sync is then testable
 * without network access, and a caller can hand over a page at a time. The Stripe
 * fetch itself lives in the controller/script.
 *
 * Three kinds matter:
 *   charge   the customer's payment. invoiceService already put the gross in 1400
 *            when the payment was recorded, so only the FEE is posted here:
 *            Dr 6500 fee / Cr 1400. Booking the gross again would double it.
 *   refund   Stripe's side of a refund. The credit note and the disbursement are
 *            recorded against the invoice, so only the fee adjustment is posted.
 *   payout   the lump that actually reaches the bank: Dr 1900 / Cr 1400.
 *
 * After a complete sync, 1400 holds exactly what Stripe is still holding — which is
 * the number that makes card money reconcilable at all.
 */
async function syncStripeTransactions(client, balanceTransactions, { actorId, requestId = null } = {}) {
  if (!actorId) throw new ReconciliationError('syncStripeTransactions requires actorId', 500);
  let posted = 0;
  let skipped = 0;
  const entries = [];

  for (const bt of balanceTransactions) {
    const id = String(bt.id);
    // Idempotent by Stripe's own id: a re-sync of an overlapping window is expected.
    const { rows: existing } = await client.query(
      `SELECT id, journal_entry_id FROM stripe_transactions WHERE id = $1`, [id]
    );
    if (existing.length) { skipped += 1; continue; }

    const currency = String(bt.currency || 'isk').toUpperCase();
    if (currency !== 'ISK') {
      // Foreign-currency settlement needs an FX rate and a decision about where the
      // difference goes. Recorded but not posted, so it is visible rather than wrong.
      await client.query(
        `INSERT INTO stripe_transactions
           (id, type, currency, amount_minor, fee_minor, net_minor, available_on,
            created_on, payout_id, charge_id, payment_intent_id, refund_id, raw, synced_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
        [id, bt.type, currency, bt.amount, bt.fee || 0, bt.net,
          bt.available_on ? new Date(bt.available_on * 1000).toISOString().slice(0, 10) : null,
          new Date(bt.created * 1000).toISOString(),
          bt.payout || null, bt.charge || null, bt.payment_intent || null, bt.refund || null,
          JSON.stringify(bt), actorId]
      );
      skipped += 1;
      logger.warn({ stripeId: id, currency }, 'stripe transaction in foreign currency recorded but not posted');
      continue;
    }

    const createdOn = new Date(bt.created * 1000).toISOString().slice(0, 10);
    const fee = Math.abs(Number(bt.fee || 0));
    let entry = null;

    if (bt.type === 'payout') {
      // The lump landing in the bank. bt.amount is negative for a payout.
      const gross = Math.abs(Number(bt.amount));
      entry = await ledger.postEntry(client, {
        entryDate: createdOn,
        memo: `Stripe útgreiðsla ${bt.payout || id}`,
        sourceType: 'stripe',
        sourceId: id,
        createdBy: actorId,
        lines: [
          { accountCode: BANK_ACCOUNT, debit: gross, memo: 'Stripe útgreiðsla' },
          { accountCode: CLEARING_ACCOUNT, credit: gross, memo: 'Kortagreiðslur gerðar upp' },
        ],
      });
    } else if (fee > 0) {
      // Charge or refund: only the fee is new information here.
      entry = await ledger.postEntry(client, {
        entryDate: createdOn,
        memo: `Stripe þóknun (${bt.type})`,
        sourceType: 'stripe',
        sourceId: id,
        createdBy: actorId,
        lines: [
          { accountCode: FEE_ACCOUNT, debit: fee, memo: 'Stripe þóknun' },
          { accountCode: CLEARING_ACCOUNT, credit: fee, memo: 'Þóknun dregin af' },
        ],
      });
    }

    await client.query(
      `INSERT INTO stripe_transactions
         (id, type, currency, amount_minor, fee_minor, net_minor, available_on,
          created_on, payout_id, charge_id, payment_intent_id, refund_id, raw,
          journal_entry_id, synced_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)`,
      [id, bt.type, currency, bt.amount, bt.fee || 0, bt.net,
        bt.available_on ? new Date(bt.available_on * 1000).toISOString().slice(0, 10) : null,
        new Date(bt.created * 1000).toISOString(),
        bt.payout || null, bt.charge || null, bt.payment_intent || null, bt.refund || null,
        JSON.stringify(bt), entry ? entry.id : null, actorId]
    );
    if (entry) { posted += 1; entries.push(entry.entry_number); } else skipped += 1;
  }

  await audit.record(client, {
    actorId, action: 'stripe.synced', entityType: 'stripe_sync', entityId: todayIso(),
    requestId, summary: { seen: balanceTransactions.length, posted, skipped },
  });

  logger.info({ seen: balanceTransactions.length, posted, skipped }, 'stripe transactions synced');
  return { seen: balanceTransactions.length, posted, skipped, entries };
}

// ── Status ──────────────────────────────────────────────────────────────────

/**
 * Is the bank reconciled?
 *
 * Compares the ledger's bank balance with the closing balance on the last imported
 * statement line. If they differ, something is in the books that is not at the bank
 * or the other way round — which is the entire point of doing this.
 */
async function reconciliationStatus(client, { accountCode = BANK_ACCOUNT } = {}) {
  const { rows: ledgerRows } = await client.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::bigint AS balance
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE la.code = $1 AND je.posted_at IS NOT NULL`,
    [accountCode]
  );
  const ledgerBalance = Number(ledgerRows[0].balance);

  const { rows: lastRows } = await client.query(
    `SELECT booked_on, balance_after FROM bank_transactions
      WHERE account_code = $1 AND balance_after IS NOT NULL
      ORDER BY booked_on DESC, created_at DESC LIMIT 1`,
    [accountCode]
  );
  const statementBalance = lastRows.length ? Number(lastRows[0].balance_after) : null;

  const { rows: openRows } = await client.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::bigint AS total
       FROM bank_transactions WHERE account_code = $1 AND match_state = 'unmatched'`,
    [accountCode]
  );

  const { rows: clearingRows } = await client.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::bigint AS balance
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE la.code = $1 AND je.posted_at IS NOT NULL`,
    [CLEARING_ACCOUNT]
  );

  return {
    account_code: accountCode,
    ledger_balance: ledgerBalance,
    statement_balance: statementBalance,
    statement_date: lastRows.length ? toIsoDate(lastRows[0].booked_on) : null,
    difference: statementBalance === null ? null : ledgerBalance - statementBalance,
    unmatched_count: openRows[0].n,
    unmatched_total: Number(openRows[0].total),
    // What Stripe is still holding. Should equal Stripe's own pending balance.
    clearing_balance: Number(clearingRows[0].balance),
  };
}

async function listBankTransactions({
  accountCode = BANK_ACCOUNT, state = null, limit = 50, offset = 0,
} = {}, client) {
  const params = [accountCode];
  let stateSql = '';
  if (state) { params.push(state); stateSql = `AND match_state = $${params.length}`; }
  params.push(limit, offset);
  const { rows } = await client.query(
    `SELECT * FROM bank_transactions
      WHERE account_code = $1 ${stateSql}
      ORDER BY booked_on DESC, created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: countRows } = await client.query(
    `SELECT COUNT(*)::int AS total FROM bank_transactions
      WHERE account_code = $1 ${stateSql}`,
    params.slice(0, -2)
  );
  return { transactions: rows.map(shapeBankTx), total: countRows[0].total };
}

module.exports = {
  ReconciliationError,
  BANK_ACCOUNT,
  CLEARING_ACCOUNT,
  FEE_ACCOUNT,
  SUSPENSE_ACCOUNT,
  AR_ACCOUNT,
  parseBankCsv,
  normaliseBankDate,
  dedupeHash,
  importBankRows,
  suggestMatches,
  resolveBankTransaction,
  syncStripeTransactions,
  reconciliationStatus,
  listBankTransactions,
};
