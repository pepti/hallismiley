// Expenses — the input-VAT (innskattur) side of the books.
//
// This is where a non-expert owner is most likely to get it wrong, and the errors
// all cost money in the same direction: claiming input VAT you are not entitled
// to understates the VSK you owe, which is the kind of mistake Skatturinn assesses
// with a surcharge. So the rules are encoded rather than left to memory:
//
//   * Four statutory exclusions from input-VAT deduction (Skatturinn): risna
//     (entertainment), staff meals, passenger vehicles under 5,000 kg, and
//     holiday properties. The chart of accounts carries `input_vat_blocked` on the
//     accounts that represent them, so picking one refuses the deduction.
//   * A receipt with no supplier VSK number is not valid proof of input tax. A
//     card slip from a shop is not enough.
//   * Services bought from abroad are REVERSE CHARGED: you self-assess Icelandic
//     VAT on the purchase. It nets to zero when your activity is taxable, but it
//     must appear on the return, so it is modelled explicitly rather than skipped.
//     Threshold is 10,000 ISK per two-month period for electronic services — any
//     foreign SaaS stack clears it.
//
// Corrections work like everywhere else in this module: an expense posts its
// journal entry immediately and is then immutable except for the attached document
// and its description. To fix a wrong figure, reverse the entry and enter it again.

const logger = require('../../logger');
const ledger = require('./ledgerService');
const audit = require('./auditLog');
const FxRate = require('../../models/FxRate');
const { splitVatInclusive, addVat, assertIntegerIsk, STANDARD_VAT_RATE, REDUCED_VAT_RATE } = require('../../utils/vat');
const { convertToIsk } = require('../../utils/fx');
const { assertAccountingDate, toIsoDate } = require('../../utils/booksDate');

class ExpenseError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'ExpenseError';
    this.status = status;
    if (code) this.code = code;
  }
}

// How the VAT on a purchase is treated.
const VAT_CODES = ['input_24', 'input_11', 'exempt', 'none', 'reverse_charge_24'];

const INPUT_VAT_ACCOUNT = '1310';   // Innskattur — an ASSET (a claim on the state)
const AP_ACCOUNT = '2100';          // Viðskiptaskuldir
const OUTPUT_VAT_24 = '2200';       // used for the output side of a reverse charge

// Control accounts are never the destination of a purchase — they are the machinery
// the postings move through. Offering "Viðskiptakröfur" or "Bankainnstæða" in the
// account picker invites an entry that silently corrupts a control balance, and the
// reconciliation report would then never tie.
const CONTROL_ACCOUNTS = new Set([
  '1100', // Viðskiptakröfur (AR)
  '1310', // Innskattur
  '1400', // Kortagreiðslur í vinnslu
  '1900', // Bankainnstæða
  '1910', // Sjóður
  '1990', // Óvissureikningur
]);

// Can a purchase be posted here? Expense accounts always; asset accounts only when
// they are not control accounts, so a tool or machine can still be capitalised.
function isPurchasable(account) {
  if (!account || !account.is_active) return false;
  if (CONTROL_ACCOUNTS.has(account.code)) return false;
  return account.type === 'expense' || account.type === 'asset';
}

// Plain-language reasons a deduction is refused. These are shown to the user, so
// they explain the rule rather than just naming it.
const NON_DEDUCTIBLE_REASONS = {
  blocked_account: 'Innskattur er ekki frádráttarbær af þessum kostnaði (risna, fæði starfsmanna, '
    + 'fólksbifreið undir 5.000 kg eða frístundahúsnæði).',
  no_vat_number: 'Fylgiskjalið sýnir ekki VSK-númer seljanda, svo það er ekki fullnægjandi '
    + 'sönnun á innskatti.',
  exempt: 'Kaupin eru undanþegin VSK, svo enginn innskattur fellur til.',
};

/**
 * Decide the VAT treatment of a purchase, and say WHY when a deduction is refused.
 *
 * Returned separately from the posting so the UI can show the verdict — and its
 * reason — while the user is still filling the form, instead of after the fact.
 */
function assessVat({ vatCode, account, supplierCountry = 'IS', supplierVatNumber = '' }) {
  const code = String(vatCode || 'input_24');
  if (!VAT_CODES.includes(code)) {
    throw new ExpenseError(`Unknown VAT treatment: ${vatCode}`, 400, 'BAD_VAT_CODE');
  }

  const foreign = String(supplierCountry || 'IS').toUpperCase() !== 'IS';

  if (code === 'reverse_charge_24') {
    if (!foreign) {
      throw new ExpenseError(
        'Reverse charge only applies to services bought from a supplier abroad',
        400, 'REVERSE_CHARGE_DOMESTIC'
      );
    }
    // Self-assessed: an output leg AND a deductible input leg of the same size.
    return { code, deductible: true, reason: null, reverseCharge: true, rate: STANDARD_VAT_RATE };
  }

  if (code === 'exempt' || code === 'none') {
    return { code, deductible: false, reason: NON_DEDUCTIBLE_REASONS.exempt, reverseCharge: false, rate: 0 };
  }

  // An account flagged in the chart of accounts represents one of the statutory
  // exclusions, so no amount of paperwork makes it deductible.
  if (account && account.input_vat_blocked) {
    return { code, deductible: false, reason: NON_DEDUCTIBLE_REASONS.blocked_account, reverseCharge: false, rate: 0 };
  }

  // Only certain documents prove input tax, and a supplier VSK number is the
  // minimum. A till receipt without one does not qualify.
  if (!String(supplierVatNumber || '').trim()) {
    return { code, deductible: false, reason: NON_DEDUCTIBLE_REASONS.no_vat_number, reverseCharge: false, rate: 0 };
  }

  return {
    code,
    deductible: true,
    reason: null,
    reverseCharge: false,
    rate: code === 'input_11' ? REDUCED_VAT_RATE : STANDARD_VAT_RATE,
  };
}

/**
 * Look for an expense that may already have been entered.
 *
 * Double-entering a supplier invoice — once from the PDF, once from the bank line
 * — is the single most common error in owner-kept books, and it inflates input VAT,
 * i.e. it under-pays tax. Warns; never blocks, because genuine repeats exist
 * (a monthly subscription with the same amount every month).
 */
async function findPossibleDuplicates(client, { supplierName, supplierKennitala, supplierInvoiceNo, expenseDate, amountGross }) {
  const matches = [];

  // Strongest signal: the same supplier's own invoice number.
  if (supplierInvoiceNo && String(supplierInvoiceNo).trim()) {
    const { rows } = await client.query(
      `SELECT id, supplier_name, supplier_invoice_no, expense_date, amount_gross
         FROM expenses
        WHERE supplier_invoice_no = $1
          AND ($2::text IS NULL OR supplier_kennitala = $2 OR LOWER(supplier_name) = LOWER($3))
        LIMIT 5`,
      [String(supplierInvoiceNo).trim(), supplierKennitala || null, supplierName || '']
    );
    rows.forEach(r => matches.push({ ...r, why: 'same_invoice_number' }));
  }

  // Weaker signal: same supplier, same amount, within a few days.
  const { rows: near } = await client.query(
    `SELECT id, supplier_name, supplier_invoice_no, expense_date, amount_gross
       FROM expenses
      WHERE LOWER(supplier_name) = LOWER($1)
        AND amount_gross = $2
        AND expense_date BETWEEN $3::date - INTERVAL '5 days' AND $3::date + INTERVAL '5 days'
      LIMIT 5`,
    [supplierName || '', amountGross, expenseDate]
  );
  near.forEach((r) => {
    if (!matches.some(m => m.id === r.id)) matches.push({ ...r, why: 'same_supplier_amount_and_date' });
  });

  return matches.map(m => ({
    id: m.id,
    supplier_name: m.supplier_name,
    supplier_invoice_no: m.supplier_invoice_no,
    expense_date: toIsoDate(m.expense_date),
    amount_gross: Number(m.amount_gross),
    why: m.why,
  }));
}

/**
 * Record a purchase and post it to the ledger.
 *
 * @param {object} client  pg client inside a transaction
 * @param {object} input
 *   supplierName, supplierKennitala, supplierVatNumber, supplierCountry
 *   supplierInvoiceNo, expenseDate, description
 *   amountGross      {number} total paid, VAT-INCLUSIVE, in the original currency's minor units
 *   currency         {string} defaults to ISK
 *   vatCode          {string} one of VAT_CODES
 *   accountCode      {string} the expense account this purchase belongs to
 *   documentId       {string} optional fylgiskjal
 *   allowDuplicate   {boolean} the caller has seen the warning and means it
 *   createdBy, requestId
 */
async function createExpense(client, input = {}) {
  const {
    supplierName, supplierKennitala = null, supplierVatNumber = '', supplierCountry = 'IS',
    supplierInvoiceNo = null, description = '', amountGross, currency = 'ISK',
    vatCode = 'input_24', accountCode, documentId = null,
    allowDuplicate = false, createdBy, requestId = null,
  } = input;

  if (!createdBy) throw new ExpenseError('createExpense requires createdBy', 500);
  if (!supplierName || !String(supplierName).trim()) {
    throw new ExpenseError('A supplier name is required', 400, 'SUPPLIER_REQUIRED');
  }
  if (!accountCode) throw new ExpenseError('An expense account is required', 400, 'ACCOUNT_REQUIRED');

  const expenseDate = assertAccountingDate(input.expenseDate, 'expense_date');
  const account = await ledger.accountByCode(accountCode, client);
  if (!isPurchasable(account)) {
    throw new ExpenseError(
      CONTROL_ACCOUNTS.has(account.code)
        ? `Account ${accountCode} (${account.name}) is a control account and cannot receive a purchase`
        : `Account ${accountCode} is a ${account.type} account; a purchase must go to an expense or asset account`,
      400, 'BAD_ACCOUNT_TYPE'
    );
  }

  // Translate to ISK first, exactly as invoicing does, so VAT is extracted from
  // the ISK figure and the books stay single-currency.
  const originalGross = assertIntegerIsk(amountGross, 'amount_gross');
  if (originalGross <= 0) throw new ExpenseError('The amount must be greater than zero', 400, 'BAD_AMOUNT');
  const fx = currency === 'ISK'
    ? { rate: 1, rate_date: expenseDate }
    : await FxRate.forDate(currency, expenseDate, client);
  const grossIsk = convertToIsk(originalGross, currency, fx.rate);

  const verdict = assessVat({ vatCode, account, supplierCountry, supplierVatNumber });

  // Reverse charge is the one case where the supplier's invoice is the NET figure
  // and Icelandic VAT goes on top; every other case extracts VAT from the gross.
  const split = verdict.reverseCharge
    ? addVat(grossIsk, verdict.rate)
    : (verdict.deductible
      ? splitVatInclusive(grossIsk, verdict.rate)
      : { net: grossIsk, vat: 0, gross: grossIsk, rate: 0 });

  const duplicates = await findPossibleDuplicates(client, {
    supplierName, supplierKennitala, supplierInvoiceNo,
    expenseDate, amountGross: split.gross,
  });
  if (duplicates.length && !allowDuplicate) {
    const err = new ExpenseError(
      `This looks like it may already be entered (${duplicates.length} similar ${duplicates.length === 1 ? 'entry' : 'entries'}). `
      + 'Check, then confirm to save it anyway.',
      409, 'POSSIBLE_DUPLICATE'
    );
    err.duplicates = duplicates;
    throw err;
  }

  const { rows } = await client.query(
    `INSERT INTO expenses (
       supplier_name, supplier_kennitala, supplier_country, supplier_invoice_no,
       expense_date, description, amount_net, amount_vat, amount_gross,
       vat_code, vat_deductible, non_deductible_reason, account_id, document_id,
       original_currency, original_amount_gross, fx_rate, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      String(supplierName).trim().slice(0, 200), supplierKennitala, supplierCountry,
      supplierInvoiceNo ? String(supplierInvoiceNo).trim().slice(0, 100) : null,
      expenseDate, String(description || '').slice(0, 500),
      split.net, split.vat, split.gross,
      verdict.code, verdict.deductible, verdict.reason, account.id, documentId,
      currency, currency === 'ISK' ? null : originalGross, fx.rate, createdBy,
    ]
  );
  const expense = rows[0];

  const entry = await ledger.postEntry(client, {
    entryDate: expenseDate,
    memo: `${supplierName}${supplierInvoiceNo ? ` — reikn. ${supplierInvoiceNo}` : ''}`,
    sourceType: 'expense',
    sourceId: expense.id,
    documentId,
    createdBy,
    lines: expenseJournalLines({ accountCode, split, verdict }),
  });

  await audit.record(client, {
    actorId: createdBy,
    action: 'expense.created',
    entityType: 'expense',
    entityId: expense.id,
    requestId,
    summary: {
      supplier: String(supplierName).trim().slice(0, 80),
      amount_gross: split.gross,
      amount_vat: split.vat,
      vat_code: verdict.code,
      deductible: verdict.deductible,
      account: accountCode,
      has_document: Boolean(documentId),
      journal_entry_number: entry.entry_number,
    },
  });

  logger.info(
    { expenseId: expense.id, account: accountCode, vatCode: verdict.code, deductible: verdict.deductible, period: entry.period },
    'expense recorded'
  );
  return { expense, verdict, duplicates, journal_entry: entry };
}

/**
 * The journal legs for a purchase.
 *
 *   Deductible:      Dr expense (net) / Dr 1310 input VAT / Cr 2100 AP (gross)
 *   Not deductible:  Dr expense (gross)                  / Cr 2100 AP (gross)
 *                    — the VAT becomes part of the cost, which is exactly what
 *                      "not deductible" means and is easy to get wrong.
 *   Reverse charge:  Dr expense (net) / Dr 1310 (self-assessed) /
 *                    Cr 2100 (net) / Cr 2200 (self-assessed output)
 *                    — nets to zero on the VAT accounts when the activity is
 *                      taxable, but both legs appear on the return.
 */
function expenseJournalLines({ accountCode, split, verdict }) {
  if (verdict.reverseCharge) {
    return [
      { accountCode, debit: split.net, memo: 'Kaup á þjónustu frá útlöndum' },
      { accountCode: INPUT_VAT_ACCOUNT, debit: split.vat, vatRate: split.rate, memo: 'Innskattur (veltuskattur)' },
      { accountCode: AP_ACCOUNT, credit: split.net, memo: 'Viðskiptaskuld' },
      { accountCode: OUTPUT_VAT_24, credit: split.vat, vatRate: split.rate, memo: 'Útskattur (veltuskattur)' },
    ];
  }
  if (!verdict.deductible) {
    return [
      { accountCode, debit: split.gross, memo: 'Kostnaður (innskattur ekki frádráttarbær)' },
      { accountCode: AP_ACCOUNT, credit: split.gross, memo: 'Viðskiptaskuld' },
    ];
  }
  return [
    { accountCode, debit: split.net, memo: 'Kostnaður' },
    { accountCode: INPUT_VAT_ACCOUNT, debit: split.vat, vatRate: split.rate, memo: `Innskattur ${split.rate}%` },
    { accountCode: AP_ACCOUNT, credit: split.gross, memo: 'Viðskiptaskuld' },
  ];
}

/**
 * Attach (or replace) the supporting document on an existing expense.
 *
 * The one financial-adjacent field that stays editable, because receipts are
 * routinely found after the entry — which is the whole reason the
 * missing-documents queue exists.
 */
async function attachDocument(client, expenseId, { documentId, createdBy, requestId = null }) {
  if (!createdBy) throw new ExpenseError('attachDocument requires createdBy', 500);
  const { rows } = await client.query(
    `UPDATE expenses SET document_id = $2 WHERE id = $1 RETURNING id, document_id`,
    [String(expenseId), documentId || null]
  );
  if (!rows.length) throw new ExpenseError('Expense not found', 404, 'NOT_FOUND');
  await audit.record(client, {
    actorId: createdBy,
    action: 'expense.updated',
    entityType: 'expense',
    entityId: rows[0].id,
    requestId,
    summary: { attached_document: Boolean(documentId) },
  });
  return rows[0];
}

module.exports = {
  ExpenseError,
  VAT_CODES,
  NON_DEDUCTIBLE_REASONS,
  INPUT_VAT_ACCOUNT,
  AP_ACCOUNT,
  isPurchasable,
  CONTROL_ACCOUNTS,
  assessVat,
  findPossibleDuplicates,
  expenseJournalLines,
  createExpense,
  attachDocument,
};
