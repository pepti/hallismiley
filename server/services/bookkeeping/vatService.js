// VSK returns (RSK 10.01) — derived from the ledger, reviewed before filing, and
// frozen once filed.
//
// The single most important property here: the return is computed FROM THE LEDGER,
// never from the invoice and expense tables directly. Two reasons, and the second
// is the one that matters at year end:
//
//   1. The ledger is the thing that must tie. If the return were summed from
//      invoices while the trial balance were summed from journal entries, the two
//      could disagree and nothing would notice. Deriving both from the same place
//      makes "the return does not match the books" impossible by construction.
//   2. RSK 10.25 — the annual reconciliation — compares the year's filed returns
//      against the annual accounts. Anything not posted to the ledger is invisible
//      to that comparison, so a figure that bypassed the ledger surfaces as an
//      unexplained difference twelve months later, with no trail.
//
// The boxes, and where each comes from:
//   A  net turnover at 24%   revenue accounts whose vat_code is output_24
//   B  net turnover at 11%   output_11
//   C  zero-rated turnover   output_0  (exports; needs proof of export on file)
//   D  output VAT            liability accounts 2200 + 2210
//   E  input VAT             asset account 1310
//   F  payable               D − E   (negative = a refund is due to you)
//
// Filing does three things atomically: snapshots the figures write-once, posts the
// settlement entry that clears the VAT accounts into 2290, and LOCKS the period so
// a figure already reported to Skatturinn cannot move afterwards.

const logger = require('../../logger');
const ledger = require('./ledgerService');
const audit = require('./auditLog');
const { periodBounds, periodForDate, isValidPeriod } = require('../../utils/vatPeriod');
const { todayIso, toIsoDate } = require('../../utils/booksDate');

class VatReturnError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'VatReturnError';
    this.status = status;
    if (code) this.code = code;
  }
}

const OUTPUT_VAT_ACCOUNTS = ['2200', '2210'];
const INPUT_VAT_ACCOUNT = '1310';
const VAT_SETTLEMENT_ACCOUNT = '2290'; // Virðisaukaskattur til greiðslu
const SUSPENSE_ACCOUNT = '1990';       // Óvissureikningur

// Entries that are VSK-settlement MACHINERY rather than business activity: the
// settlement itself, and the reversal of one after an unlock. Both have to be
// excluded from the figures — counting a reversal would inflate the boxes, and
// counting either when computing the next settlement double-books the period.
const EXCLUDE_SETTLEMENT_SQL = `(
  je.source_type <> 'vat_settlement'
  AND (je.reverses_entry_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM journal_entries orig
     WHERE orig.id = je.reverses_entry_id AND orig.source_type = 'vat_settlement'))
)`;

/**
 * Compute the return for a period straight out of the ledger.
 *
 * Only POSTED entries count — a draft is by definition not yet part of the books,
 * and including one would report a figure that the trial balance does not carry.
 * The settlement entry from a previous filing is excluded so re-deriving a filed
 * period reproduces the original figures rather than a cleared-out zero.
 */
async function deriveReturn(client, period) {
  if (!isValidPeriod(period)) {
    throw new VatReturnError(`Not a valid VSK period: ${period}`, 400, 'BAD_PERIOD');
  }
  const { starts_on: from, ends_on: to } = periodBounds(period);

  const { rows } = await client.query(
    `SELECT la.code, la.type, la.vat_code,
            COALESCE(SUM(jl.debit), 0)::bigint  AS debit,
            COALESCE(SUM(jl.credit), 0)::bigint AS credit
       FROM journal_entries je
       JOIN journal_lines jl   ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE je.posted_at IS NOT NULL
        AND je.entry_date >= $1::date AND je.entry_date <= $2::date
        AND ${EXCLUDE_SETTLEMENT_SQL}
      GROUP BY la.code, la.type, la.vat_code`,
    [from, to]
  );

  // Revenue is a credit balance, so turnover is credit − debit (a credit note
  // debits revenue back, which is exactly the reduction the return should show).
  const turnoverFor = code => rows
    .filter(r => r.type === 'revenue' && r.vat_code === code)
    .reduce((a, r) => a + (Number(r.credit) - Number(r.debit)), 0);

  // Output VAT is a liability: credit − debit. Input VAT is an asset: debit − credit.
  const outputVat = rows
    .filter(r => OUTPUT_VAT_ACCOUNTS.includes(r.code))
    .reduce((a, r) => a + (Number(r.credit) - Number(r.debit)), 0);
  const inputVat = rows
    .filter(r => r.code === INPUT_VAT_ACCOUNT)
    .reduce((a, r) => a + (Number(r.debit) - Number(r.credit)), 0);

  const boxA = turnoverFor('output_24');
  const boxB = turnoverFor('output_11');
  const boxC = turnoverFor('output_0');

  // Reverse-charge output VAT, separated out.
  //
  // Self-assessed VAT on services bought abroad IS output VAT, but it is not
  // domestic turnover — RSK 10.01 gives it its own line rather than merging it into
  // the ordinary output figure. Without this split, box D exceeds 24% of box A for
  // no visible reason, and an unexplainable number is what makes an accountant
  // distrust the whole return. Identified by source: only an expense posting ever
  // credits an output-VAT account.
  const { rows: rcRows } = await client.query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::bigint AS vat
       FROM journal_entries je
       JOIN journal_lines jl   ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE je.posted_at IS NOT NULL
        AND je.source_type = 'expense'
        AND je.entry_date >= $1::date AND je.entry_date <= $2::date
        AND la.code = ANY($3::text[])`,
    [from, to, OUTPUT_VAT_ACCOUNTS]
  );
  const reverseChargeVat = Number(rcRows[0].vat);

  // Per-account detail, so the screen can show WHERE each box came from and an
  // accountant can trace a figure without re-running the query by hand.
  const byAccount = rows
    .filter(r => r.type === 'revenue' || OUTPUT_VAT_ACCOUNTS.includes(r.code) || r.code === INPUT_VAT_ACCOUNT)
    .map(r => ({
      code: r.code,
      vat_code: r.vat_code,
      type: r.type,
      debit: Number(r.debit),
      credit: Number(r.credit),
      balance: r.type === 'asset'
        ? Number(r.debit) - Number(r.credit)
        : Number(r.credit) - Number(r.debit),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    period,
    range: { from, to },
    box_a_net_24: boxA,
    box_b_net_11: boxB,
    box_c_net_zero: boxC,
    box_d_output: outputVat,
    box_e_input: inputVat,
    box_f_payable: outputVat - inputVat,
    // Box D broken down, so the figure is explainable at a glance:
    //   domestic  = VAT charged to customers (should be ~24%/11% of A and B)
    //   reverse   = VAT self-assessed on services bought abroad, which has an
    //               equal and opposite entry in box E when the activity is taxable
    output_vat_domestic: outputVat - reverseChargeVat,
    output_vat_reverse_charge: reverseChargeVat,
    detail: { by_account: byAccount },
  };
}

/**
 * Everything worth looking at before filing.
 *
 * Filing is irreversible in practice — the figure goes to Skatturinn and the period
 * locks — so this is deliberately a review step rather than a validation gate.
 * Findings are graded:
 *   blocker  filing would report a figure that is knowably wrong
 *   warning  filing is legitimate but something needs attention first
 *   info     context worth seeing
 *
 * Only blockers stop the filing, and each one can be explained rather than merely
 * flagged, because a warning nobody understands gets clicked through.
 */
async function preflight(client, period) {
  if (!isValidPeriod(period)) {
    throw new VatReturnError(`Not a valid VSK period: ${period}`, 400, 'BAD_PERIOD');
  }
  const { starts_on: from, ends_on: to } = periodBounds(period);
  const findings = [];
  const add = (level, code, message, detail = {}) =>
    findings.push({ level, code, message, ...detail });

  // Already filed? Everything else is moot.
  const { rows: filed } = await client.query(
    `SELECT filed_at, box_f_payable FROM vat_returns WHERE period = $1`, [period]
  );
  if (filed.length) {
    add('blocker', 'ALREADY_FILED',
      `Period ${period} was already filed on ${toIsoDate(filed[0].filed_at)}. `
      + 'A filed return is a write-once snapshot — correct it through the next period, '
      + 'or unlock the period first if it has not actually been submitted yet.');
    return { period, findings, can_file: false };
  }

  // A draft entry is not in the books, so its figures are missing from the return —
  // and it will silently join a LATER period once posted.
  const { rows: drafts } = await client.query(
    `SELECT COUNT(*)::int AS n FROM journal_entries
      WHERE posted_at IS NULL AND entry_date >= $1::date AND entry_date <= $2::date`,
    [from, to]
  );
  if (drafts[0].n > 0) {
    add('blocker', 'UNPOSTED_DRAFTS',
      `${drafts[0].n} journal ${drafts[0].n === 1 ? 'entry is' : 'entries are'} still a draft in this period. `
      + 'Draft entries are not part of the books, so their figures are missing from this return — '
      + 'and once posted they would land in whichever period is open then.',
      { count: drafts[0].n });
  }

  // No fylgiskjal, no deduction. This is the one that costs real money in an audit:
  // the input VAT is claimed on the return but cannot be substantiated.
  const { rows: noDoc } = await client.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_vat), 0)::bigint AS vat
       FROM expenses
      WHERE document_id IS NULL AND vat_deductible = TRUE
        AND expense_date >= $1::date AND expense_date <= $2::date`,
    [from, to]
  );
  if (noDoc[0].n > 0) {
    add('blocker', 'UNSUBSTANTIATED_INPUT_VAT',
      `${noDoc[0].n} deductible ${noDoc[0].n === 1 ? 'purchase has' : 'purchases have'} no receipt attached, `
      + `claiming ${Number(noDoc[0].vat).toLocaleString('is-IS')} kr. of input VAT that cannot be proven. `
      + 'Attach the receipts, or mark the purchases non-deductible.',
      { count: noDoc[0].n, amount: Number(noDoc[0].vat) });
  }

  // Revenue that exists as a paid order but was never invoiced is turnover missing
  // from the return. The obligation to declare it does not wait for the paperwork.
  const { rows: uninvoiced } = await client.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(o.total), 0)::bigint AS total
       FROM orders o
       LEFT JOIN invoices i ON i.order_id = o.id
      WHERE i.id IS NULL
        AND o.payment_status = 'paid'
        AND o.paid_at >= $1::date AND o.paid_at < ($2::date + INTERVAL '1 day')`,
    [from, to]
  );
  if (uninvoiced[0].n > 0) {
    add('blocker', 'UNINVOICED_ORDERS',
      `${uninvoiced[0].n} paid ${uninvoiced[0].n === 1 ? 'order has' : 'orders have'} not been invoiced. `
      + 'That turnover is missing from this return, and the duty to declare a sale does not '
      + 'wait for the invoice to be written.',
      { count: uninvoiced[0].n, amount: Number(uninvoiced[0].total) });
  }

  // Anything parked in the suspense account is money whose treatment nobody decided,
  // which means its VAT treatment is undecided too.
  // Cumulative to the period END, not just within it: a suspense balance carried in
  // from an earlier period is still undecided money whose VAT treatment is unknown,
  // so it belongs in this review too.
  const { rows: suspense } = await client.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::bigint AS balance
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE la.code = $1 AND je.posted_at IS NOT NULL AND je.entry_date <= $2::date`,
    [SUSPENSE_ACCOUNT, to]
  );
  if (Number(suspense[0].balance) !== 0) {
    add('warning', 'SUSPENSE_NOT_EMPTY',
      `The suspense account holds ${Number(suspense[0].balance).toLocaleString('is-IS')} kr. `
      + 'Those entries have no decided treatment yet, so their VAT may belong on this return.',
      { amount: Number(suspense[0].balance) });
  }

  // Zero-rated turnover requires proof of export on file. The system cannot check
  // that a document exists in a filing cabinet, so it says so out loud.
  const derived = await deriveReturn(client, period);
  if (derived.box_c_net_zero > 0) {
    add('warning', 'ZERO_RATED_NEEDS_PROOF',
      `Box C reports ${derived.box_c_net_zero.toLocaleString('is-IS')} kr. of zero-rated turnover. `
      + 'Zero-rating has to be supported by evidence of export, or of the customer being a '
      + 'business outside Iceland. Make sure that evidence is on file before filing.',
      { amount: derived.box_c_net_zero });
  }

  // A refund position is legitimate (common when you sell abroad and buy at home)
  // but it is also what a sign error looks like, so it is surfaced rather than
  // passed over quietly.
  if (derived.box_f_payable < 0) {
    add('info', 'REFUND_POSITION',
      `This period claims a refund of ${Math.abs(derived.box_f_payable).toLocaleString('is-IS')} kr. `
      + 'That is normal when input VAT exceeds output VAT — check it is what you expect.',
      { amount: derived.box_f_payable });
  }

  // Nothing at all in the period. Filing a nil return is correct and required, but
  // an accidental nil return is worth a second look.
  if (derived.box_d_output === 0 && derived.box_e_input === 0) {
    add('warning', 'NIL_RETURN',
      'No VAT was recorded in this period at all. A nil return is still required, '
      + 'but check nothing is simply unentered.');
  }

  // The deadline, from the seeded Skattadagatal.
  const { rows: deadline } = await client.query(
    `SELECT due_on FROM tax_deadlines WHERE kind = 'vsk' AND period = $1 LIMIT 1`, [period]
  );
  if (deadline.length) {
    const dueOn = toIsoDate(deadline[0].due_on);
    const daysLeft = Math.round(
      (Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 86400000
    );
    add(daysLeft < 0 ? 'warning' : 'info',
      daysLeft < 0 ? 'PAST_DEADLINE' : 'DEADLINE',
      daysLeft < 0
        ? `The filing deadline was ${dueOn}, ${Math.abs(daysLeft)} days ago.`
        : `Filing deadline: ${dueOn} (${daysLeft} days).`,
      { due_on: dueOn, days_left: daysLeft });
  }

  return {
    period,
    findings,
    can_file: !findings.some(f => f.level === 'blocker'),
    derived,
  };
}

/**
 * File the return: snapshot it, post the settlement, lock the period.
 *
 * All three in one transaction. A snapshot without a lock leaves the reported
 * figures editable; a lock without a snapshot loses what was actually reported.
 *
 * The settlement entry clears the VAT accounts into 2290, which is what makes the
 * next period start from zero and turns "what do I owe Skatturinn" into a single
 * account balance rather than an arithmetic exercise.
 */
async function fileReturn(client, period, opts = {}) {
  const { filedBy, note = '', overrideBlockers = false, requestId = null } = opts;
  if (!filedBy) throw new VatReturnError('fileReturn requires filedBy', 500);

  const check = await preflight(client, period);
  if (!check.can_file && !overrideBlockers) {
    const blockers = check.findings.filter(f => f.level === 'blocker');
    const err = new VatReturnError(
      `Period ${period} is not ready to file: ${blockers.map(b => b.message).join(' ')}`,
      409, 'PREFLIGHT_BLOCKED'
    );
    err.findings = check.findings;
    throw err;
  }

  const derived = check.derived || await deriveReturn(client, period);
  const { ends_on: endsOn } = periodBounds(period);

  const { rows } = await client.query(
    `INSERT INTO vat_returns
       (period, box_a_net_24, box_b_net_11, box_c_net_zero,
        box_d_output, box_e_input, box_f_payable, detail, preflight, filed_by, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
     RETURNING *`,
    [
      period,
      derived.box_a_net_24, derived.box_b_net_11, derived.box_c_net_zero,
      derived.box_d_output, derived.box_e_input, derived.box_f_payable,
      JSON.stringify(derived.detail),
      // The preflight is stored WITH the return: a year later, "why was this filed
      // with three warnings outstanding" is a question the snapshot can answer.
      JSON.stringify({ findings: check.findings, overridden: Boolean(overrideBlockers) }),
      filedBy, String(note).slice(0, 1000),
    ]
  );
  const vatReturn = rows[0];

  // The settlement entry, dated the last day of the period so it belongs to the
  // period it settles. Skipped entirely when there is nothing to move — a nil
  // return needs no journal entry, and postEntry would refuse a two-zero-line one.
  let entry = null;
  const legs = await settlementLegs(client, period, derived);
  if (legs.length >= 2) {
    entry = await ledger.postEntry(client, {
      entryDate: endsOn,
      memo: `VSK uppgjör ${period}`,
      sourceType: 'vat_settlement',
      sourceId: vatReturn.id,
      createdBy: filedBy,
      lines: legs,
    });
  }

  // Lock LAST, so the settlement entry itself can still be posted into the period.
  await ledger.lockPeriod(client, period, { lockedBy: filedBy });

  await audit.record(client, {
    actorId: filedBy,
    action: 'vat.filed',
    entityType: 'vat_return',
    entityId: vatReturn.id,
    requestId,
    summary: {
      period,
      box_d_output: derived.box_d_output,
      box_e_input: derived.box_e_input,
      box_f_payable: derived.box_f_payable,
      blockers_overridden: Boolean(overrideBlockers),
      journal_entry_number: entry ? entry.entry_number : null,
    },
  });

  logger.info(
    { period, payable: derived.box_f_payable, overridden: Boolean(overrideBlockers) },
    'VSK return filed'
  );
  return { vat_return: vatReturn, derived, journal_entry: entry, findings: check.findings };
}

/**
 * The settlement legs: move each VAT account's balance to zero and put the net into
 * 2290. Built from the ACTUAL account balances rather than from the derived boxes,
 * so the entry provably clears what is really there.
 */
async function settlementLegs(client, period, derived) {
  const { starts_on: from, ends_on: to } = periodBounds(period);
  const { rows } = await client.query(
    `SELECT la.code, la.type,
            COALESCE(SUM(jl.debit), 0)::bigint AS debit,
            COALESCE(SUM(jl.credit), 0)::bigint AS credit
       FROM journal_entries je
       JOIN journal_lines jl   ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE je.posted_at IS NOT NULL
        AND je.entry_date >= $1::date AND je.entry_date <= $2::date
        AND ${EXCLUDE_SETTLEMENT_SQL}
        AND la.code = ANY($3::text[])
      GROUP BY la.code, la.type`,
    [from, to, [...OUTPUT_VAT_ACCOUNTS, INPUT_VAT_ACCOUNT]]
  );

  const legs = [];
  let net = 0;
  for (const r of rows) {
    if (r.code === INPUT_VAT_ACCOUNT) {
      // An asset with a debit balance: credit it away.
      const balance = Number(r.debit) - Number(r.credit);
      if (balance === 0) continue;
      legs.push(balance > 0
        ? { accountCode: r.code, credit: balance, memo: `Innskattur ${period} fluttur` }
        : { accountCode: r.code, debit: -balance, memo: `Innskattur ${period} fluttur` });
      net -= balance;
    } else {
      // A liability with a credit balance: debit it away.
      const balance = Number(r.credit) - Number(r.debit);
      if (balance === 0) continue;
      legs.push(balance > 0
        ? { accountCode: r.code, debit: balance, memo: `Útskattur ${period} fluttur` }
        : { accountCode: r.code, credit: -balance, memo: `Útskattur ${period} fluttur` });
      net += balance;
    }
  }
  if (!legs.length) return [];

  // net > 0 means VAT is owed: 2290 is credited (a liability). net < 0 means a
  // refund is due, so 2290 carries a debit balance instead — a claim on the state.
  legs.push(net >= 0
    ? { accountCode: VAT_SETTLEMENT_ACCOUNT, credit: net, memo: `VSK til greiðslu ${period}` }
    : { accountCode: VAT_SETTLEMENT_ACCOUNT, debit: -net, memo: `VSK endurgreiðsla ${period}` });

  // Sanity: what the entry moves must equal what the return reports. If these ever
  // disagree, the return and the books have diverged and filing would report a
  // figure the ledger cannot support.
  if (net !== derived.box_f_payable) {
    throw new VatReturnError(
      `Settlement moves ${net} ISK but the return reports ${derived.box_f_payable} ISK — `
      + 'refusing to file a return the ledger does not support',
      500, 'SETTLEMENT_MISMATCH'
    );
  }
  return legs;
}

/**
 * Unlock a period that was locked in error.
 *
 * Deliberately available, deliberately noisy. The lock exists so a reported figure
 * cannot drift, but "I clicked file before actually submitting" is a real situation,
 * and the alternative to an audited unlock is someone editing the database by hand.
 * Requires a reason, and DELETES the return snapshot so the period cannot end up
 * with two conflicting versions of what was filed.
 */
async function unlockPeriod(client, period, opts = {}) {
  const { actorId, reason, requestId = null } = opts;
  if (!actorId) throw new VatReturnError('unlockPeriod requires actorId', 500);
  if (!reason || !String(reason).trim()) {
    throw new VatReturnError('Unlocking a filed period requires a reason', 400, 'REASON_REQUIRED');
  }

  const { rows: existing } = await client.query(
    `SELECT id, box_f_payable, filed_at FROM vat_returns WHERE period = $1`, [period]
  );

  // Unlock FIRST, so the settlement reversal below can be posted back inside the
  // period. Order matters: the period-open trigger would refuse a posting while the
  // period is still locked.
  await ledger.unlockPeriod(client, period, { unlockedBy: actorId, reason });

  // REVERSE THE SETTLEMENT.
  //
  // Filing posts an entry clearing the VAT accounts into 2290. Dropping the return
  // without undoing that leaves the balance sheet carrying a VSK liability for a
  // period that is no longer filed — and the next filing would post a SECOND
  // settlement on top, double-counting the period. Reversed rather than deleted,
  // because posted entries are append-only and reversal is the ledger's own
  // correction mechanism.
  //
  // Dated on the SETTLEMENT'S OWN DATE, not today. The premise of an unlock is that
  // the return was never actually submitted, so the period should be left exactly as
  // it was before filing — not carrying a settlement here and its offset in whatever
  // period happens to be open now.
  let reversal = null;
  if (existing.length) {
    const { rows: settlements } = await client.query(
      `SELECT id, entry_date FROM journal_entries
        WHERE source_type = 'vat_settlement' AND source_id = $1 AND posted_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = journal_entries.id)`,
      [existing[0].id]
    );
    for (const s of settlements) {
      reversal = await ledger.reverseEntry(client, s.id, {
        createdBy: actorId,
        reason: `VSK uppgjör ${period} afturkallað: ${String(reason).trim().slice(0, 120)}`,
        entryDate: s.entry_date,
      });
    }
  }

  // The snapshot is write-once by trigger, so it has to be removed rather than
  // amended — and that removal is itself recorded below, with the figures it held.
  if (existing.length) {
    await client.query(`ALTER TABLE vat_returns DISABLE TRIGGER trg_vat_returns_immutable`);
    try {
      await client.query(`DELETE FROM vat_returns WHERE period = $1`, [period]);
    } finally {
      await client.query(`ALTER TABLE vat_returns ENABLE TRIGGER trg_vat_returns_immutable`);
    }
  }

  await audit.record(client, {
    actorId,
    action: 'period.unlocked',
    entityType: 'fiscal_period',
    entityId: period,
    requestId,
    summary: {
      period,
      reason: String(reason).trim().slice(0, 300),
      discarded_return: existing.length
        ? { payable: Number(existing[0].box_f_payable), filed_at: existing[0].filed_at }
        : null,
      settlement_reversed_by: reversal ? reversal.entry_number : null,
    },
  });

  logger.warn({ period, actorId, settlementReversed: Boolean(reversal) }, 'VSK period unlocked');
  return { period, discarded: existing.length > 0, settlement_reversal: reversal };
}

// Every period that has activity or a filing, newest first — the VSK screen's list.
async function listPeriods(client, { limit = 24 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 24, 1), 60);
  const { rows } = await client.query(
    `SELECT fp.period, fp.starts_on, fp.ends_on, fp.status, fp.locked_at,
            vr.id AS return_id, vr.box_f_payable, vr.filed_at,
            u.username AS filed_by_username,
            td.due_on,
            (SELECT COUNT(*)::int FROM journal_entries je
              WHERE je.posted_at IS NOT NULL
                AND je.entry_date >= fp.starts_on AND je.entry_date <= fp.ends_on) AS entry_count
       FROM fiscal_periods fp
       LEFT JOIN vat_returns vr ON vr.period = fp.period
       LEFT JOIN users u ON u.id = vr.filed_by
       LEFT JOIN tax_deadlines td ON td.period = fp.period AND td.kind = 'vsk'
      ORDER BY fp.starts_on DESC
      LIMIT $1`,
    [capped]
  );
  return rows.map(r => ({
    period: r.period,
    starts_on: toIsoDate(r.starts_on),
    ends_on: toIsoDate(r.ends_on),
    status: r.status,
    locked_at: r.locked_at,
    filed: Boolean(r.return_id),
    filed_at: r.filed_at,
    filed_by: r.filed_by_username,
    payable: r.box_f_payable === null ? null : Number(r.box_f_payable),
    due_on: r.due_on ? toIsoDate(r.due_on) : null,
    entry_count: r.entry_count,
  }));
}

// A filed return exactly as it was reported. Read from the snapshot, never
// recomputed — reproducing "as filed" is the whole point of storing it.
async function getFiledReturn(client, period) {
  const { rows } = await client.query(
    `SELECT vr.*, u.username AS filed_by_username
       FROM vat_returns vr LEFT JOIN users u ON u.id = vr.filed_by
      WHERE vr.period = $1`,
    [period]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    ...r,
    box_a_net_24: Number(r.box_a_net_24),
    box_b_net_11: Number(r.box_b_net_11),
    box_c_net_zero: Number(r.box_c_net_zero),
    box_d_output: Number(r.box_d_output),
    box_e_input: Number(r.box_e_input),
    box_f_payable: Number(r.box_f_payable),
  };
}

module.exports = {
  VatReturnError,
  OUTPUT_VAT_ACCOUNTS,
  INPUT_VAT_ACCOUNT,
  VAT_SETTLEMENT_ACCOUNT,
  deriveReturn,
  preflight,
  fileReturn,
  settlementLegs,
  unlockPeriod,
  listPeriods,
  getFiledReturn,
  currentPeriod: () => periodForDate(todayIso()),
};
