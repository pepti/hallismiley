// The database half of the replay benchmark: load a case, push its history through
// the SAME services a person uses, derive the return, compare.
//
// "The same services" is the whole point. A replay that inserted journal rows with
// SQL would prove that SQL can insert rows. This one calls expenseService,
// posService and ledgerService exactly as the admin screens do, so the VAT
// verdict, the VAT-inclusive split, the reverse-charge gross-up, the FX lookup by
// document date, the duplicate detector and the period lock are all exercised on
// the way to the figure — and a regression in any of them lands in the diff.
//
// Documents are STUBBED. Every deductible expense needs a fylgiskjal or the
// preflight blocks, so a case says `"document": "stub"` and a placeholder PDF is
// registered through documentService (checksum, immutability, all of it). The
// replay measures VAT arithmetic and classification, not document custody; the
// real receipts stay outside the repo. The report says how many were stubbed.
//
// See replayCase.js for the case format and the comparison; books-replay.js for
// the CLI that wipes a `_replay` database and runs cases against it.

const fs = require('fs');
const path = require('path');
const Setting = require('../../models/Setting');
const FxRate = require('../../models/FxRate');
const ledger = require('./ledgerService');
const expenseService = require('./expenseService');
const posService = require('./posService');
const documentService = require('./documentService');
const vatService = require('./vatService');
const reports = require('./reportService');
const { booksDocumentDir } = require('../../config/paths');
const {
  ReplayError, validateCase, compare, comparePreflight,
} = require('./replayCase');

/** Read + parse + validate. Fails before anything touches a database. */
function loadCase(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new ReplayError(`Cannot read case file ${filePath}: ${err.message}`, 'NO_CASE');
  }
  let def;
  try {
    def = JSON.parse(raw);
  } catch (err) {
    throw new ReplayError(`${filePath} is not valid JSON: ${err.message}`, 'BAD_CASE');
  }
  const meta = validateCase(def);
  return { def, meta, file: filePath };
}

async function stubDocument(client, { label, createdBy, index }) {
  const dir = booksDocumentDir('replay');
  fs.mkdirSync(dir, { recursive: true });
  // Unique content per stub: identical bytes would share a checksum and be reported
  // as a duplicate upload of the same receipt, which is not what is being modelled.
  const abs = path.join(dir, `replay-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
  fs.writeFileSync(abs, `%PDF-1.4\n% Replay stub ${index} — stands in for: ${label}\n% Not evidence. The real document stays outside the repo.\n`);
  const { document } = await documentService.register(client, {
    path: abs,
    originalname: `replay-stub-${index}.pdf`,
    mimetype: 'application/pdf',
    size: fs.statSync(abs).size,
  }, { kind: 'supplier_invoice', note: 'replay stub — not evidence', createdBy });
  return document.id;
}

/**
 * Apply a case's history. Everything goes through `client`, so a caller running
 * inside ledger.withTransaction gets all-or-nothing — except the settings, which
 * the Setting model writes through the pool (they are configuration, not books).
 */
async function applyCase(client, def, { actorId }) {
  if (!actorId) throw new ReplayError('applyCase requires an actorId (every posting needs a person)', 'NO_ACTOR');
  const counts = { settings: 0, fx_rates: 0, manual_entries: 0, expenses: 0, pos_sales: 0, documents_stubbed: 0 };

  if (def.settings && Object.keys(def.settings).length) {
    await Setting.updateBookkeepingSettings(def.settings, { confirmedBy: 'replay' });
    counts.settings = Object.keys(def.settings).length;
  }

  for (const r of def.fx_rates || []) {
    await FxRate.set({
      rateDate: r.rate_date, currency: r.currency, rate: r.rate, source: 'manual', createdBy: actorId,
    }, client);
    counts.fx_rates += 1;
  }

  for (const e of def.manual_entries || []) {
    await ledger.postEntry(client, {
      entryDate: e.entry_date,
      memo: e.memo,
      sourceType: 'manual',
      createdBy: actorId,
      lines: (e.lines || []).map(l => ({
        accountCode: l.account_code, debit: l.debit || 0, credit: l.credit || 0, memo: l.memo || '',
      })),
    });
    counts.manual_entries += 1;
  }

  for (const [i, e] of (def.expenses || []).entries()) {
    let documentId = null;
    if (e.document === 'stub') {
      documentId = await stubDocument(client, {
        label: `${e.supplier_name} ${e.supplier_invoice_no || ''}`.trim(), createdBy: actorId, index: i + 1,
      });
      counts.documents_stubbed += 1;
    }
    await expenseService.createExpense(client, {
      supplierName: e.supplier_name,
      supplierKennitala: e.supplier_kennitala || null,
      supplierVatNumber: e.supplier_vat_number || '',
      supplierCountry: e.supplier_country || 'IS',
      supplierInvoiceNo: e.supplier_invoice_no || null,
      description: e.description || '',
      expenseDate: e.expense_date,
      amountGross: e.amount_gross,
      currency: e.currency || 'ISK',
      vatCode: e.vat_code || 'input_24',
      accountCode: e.account_code,
      documentId,
      // Real history contains genuine repeats (a monthly bill). The duplicate
      // detector is a warning for a person at a form; a replay is not that person.
      allowDuplicate: true,
      createdBy: actorId,
    });
    counts.expenses += 1;
  }

  for (const s of def.pos_sales || []) {
    await posService.sell(client, {
      lines: (s.lines || []).map(l => ({
        description: l.description,
        quantity: l.quantity || 1,
        unitPriceGross: l.unit_price_gross,
        vatRate: l.vat_rate,
      })),
      tender: s.tender || 'cash',
      soldAt: s.sold_at,
      customerName: s.customer_name || '',
      note: s.note || '',
      createdBy: actorId,
    });
    counts.pos_sales += 1;
  }

  return counts;
}

/** Derive and compare. Reads only; safe to call again on already-applied history. */
async function runCase(client, def, meta, { counts = null } = {}) {
  const derived = await vatService.deriveReturn(client, def.period);
  const preflight = await vatService.preflight(client, def.period);
  // All-time, not the period: opening entries before the period must balance too.
  const trialBalance = await reports.trialBalance({}, client);

  const comparison = meta.pending ? null : compare(derived, def.expected);
  const preflightComparison = def.expected_preflight
    ? comparePreflight(preflight.findings, def.expected_preflight)
    : null;

  const ok = meta.pending
    ? null
    : comparison.ok && (preflightComparison ? preflightComparison.ok : true) && trialBalance.balanced;

  return {
    def,
    meta,
    derived,
    preflight,
    trialBalance,
    comparison,
    preflightComparison,
    counts: counts || { settings: 0, fx_rates: 0, manual_entries: 0, expenses: 0, pos_sales: 0, documents_stubbed: 0 },
    ok,
  };
}

/** apply + run, for a case loaded by loadCase(). */
async function replayCase(client, loaded, { actorId }) {
  const counts = await applyCase(client, loaded.def, { actorId });
  return runCase(client, loaded.def, loaded.meta, { counts });
}

module.exports = { loadCase, applyCase, runCase, replayCase };
