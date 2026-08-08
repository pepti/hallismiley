// Bókhald API client.
//
// Reads pass query params straight through; the server validates and returns a
// 400 with an explanation rather than silently coercing, so an error thrown here
// carries a message worth showing the user verbatim.
import { getCSRFToken } from './auth.js';

const BASE = '/api/v1/admin/bookkeeping';

async function csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

async function get(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    // Keep 0 and false; drop only genuinely absent values.
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  }
  const res = await fetch(BASE + path + (qs.toString() ? `?${qs}` : ''), { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Beiðni mistókst');
  return data;
}

async function send(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: await csrfHeaders(),
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Beiðni mistókst');
  return data;
}

export const fetchDashboard = (params) => get('/dashboard', params);
export const fetchInvoices = (params) => get('/invoices', params);
export const fetchInvoice = (id) => get(`/invoices/${encodeURIComponent(id)}`);
export const fetchBooksSettings = () => get('/settings');

export const updateBooksSettings = (patch) => send('PATCH', '/settings', patch);
export const setFxRate = (body) => send('POST', '/fx-rates', body);

export const issueInvoiceForOrder = (orderId) =>
  send('POST', `/invoices/from-order/${encodeURIComponent(orderId)}`, {});

// The idempotency key is generated per attempt by the CALLER, not here, so that a
// retry of a failed submit reuses the same key and cannot double-book the payment.
export const recordPayment = (invoiceId, body) =>
  send('POST', `/invoices/${encodeURIComponent(invoiceId)}/payments`, body);

// The cash half of undoing a sale. The credit note (below) is the other half —
// see the note in AdminInvoiceDetailView for when you want one, the other, or both.
export const recordRefund = (invoiceId, body) =>
  send('POST', `/invoices/${encodeURIComponent(invoiceId)}/refunds`, body);

export const issueCreditNote = (invoiceId, body) =>
  send('POST', `/invoices/${encodeURIComponent(invoiceId)}/credit-notes`, body);

export const invoicePdfUrl = (id) => `${BASE}/invoices/${encodeURIComponent(id)}/pdf`;

// ── Expenses ─────────────────────────────────────────────────────────────────

export const fetchExpenses = (params) => get('/expenses', params);
export const fetchExpense = (id) => get(`/expenses/${encodeURIComponent(id)}`);
export const fetchSuppliers = () => get('/expenses/suppliers');
export const fetchAccounts = () => get('/expenses/accounts');
export const fetchMissingDocuments = (params) => get('/expenses/missing-documents', params);

// Asks the server what the VAT treatment WOULD be, without saving. Lets the form
// explain a refused input-VAT deduction while the user is still filling it in.
export const previewExpenseVat = (body) => send('POST', '/expenses/preview-vat', body);

// Throws with `err.duplicates` attached on a 409, so the caller can show what it
// thinks the entry duplicates and offer to save anyway.
export async function createExpense(body) {
  const res = await fetch(`${BASE}/expenses`, {
    method: 'POST',
    credentials: 'include',
    headers: await csrfHeaders(),
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Beiðni mistókst');
    if (Array.isArray(data.duplicates)) err.duplicates = data.duplicates;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const attachExpenseDocument = (expenseId, documentId) =>
  send('PATCH', `/expenses/${encodeURIComponent(expenseId)}/document`, { document_id: documentId });

// ── Documents ────────────────────────────────────────────────────────────────

// multipart, so no Content-Type header — the browser sets the boundary itself.
export async function uploadDocument(file, { kind = 'receipt', note = '' } = {}) {
  const token = await getCSRFToken();
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  form.append('note', note);
  const res = await fetch(`${BASE}/documents`, {
    method: 'POST',
    credentials: 'include',
    headers: token ? { 'X-CSRF-Token': token } : {},
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upphleðsla mistókst');
  return data;
}

export const documentUrl = (id) => `${BASE}/documents/${encodeURIComponent(id)}`;

// ── Receivables ──────────────────────────────────────────────────────────────

export const fetchAging = (params) => get('/ar', params);
export const fetchStatement = (customerKey, params) =>
  get(`/ar/${encodeURIComponent(customerKey)}`, params);

// ── CSV exports (server-side, so they are never silently truncated) ──────────

export const invoicesCsvUrl = (params = {}) => withQuery(`${BASE}/invoices/export.csv`, params);
export const expensesCsvUrl = (params = {}) => withQuery(`${BASE}/expenses/export.csv`, params);
export const agingCsvUrl = () => `${BASE}/ar/export.csv`;

function withQuery(url, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  }
  return qs.toString() ? `${url}?${qs}` : url;
}

// crypto.randomUUID is available in every browser this app supports; the fallback
// keeps a non-secure-context dev server working.
export function newIdempotencyKey() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── VSK returns ──────────────────────────────────────────────────────────────

export const fetchVatPeriods = () => get('/vat');
export const fetchVatPeriod = (period) => get(`/vat/${encodeURIComponent(period)}`);

// Throws with `err.findings` attached on a 409, so the caller can show exactly what
// is blocking rather than a bare message.
export async function fileVatReturn(period, body) {
  const res = await fetch(`${BASE}/vat/${encodeURIComponent(period)}/file`, {
    method: 'POST',
    credentials: 'include',
    headers: await csrfHeaders(),
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Beiðni mistókst');
    if (Array.isArray(data.findings)) err.findings = data.findings;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const unlockVatPeriod = (period, body) =>
  send('POST', `/vat/${encodeURIComponent(period)}/unlock`, body);

export const vatCsvUrl = () => `${BASE}/vat/export.csv`;

// ── Reconciliation ───────────────────────────────────────────────────────────

export const fetchBankStatus = () => get('/bank/status');
export const fetchBankTransactions = (params) => get('/bank', params);
export const fetchBankSuggestions = (id) => get(`/bank/${encodeURIComponent(id)}/suggestions`);

// The statement travels as text, not as an upload: it is not a document to retain
// (the bank keeps it, and the entries it produces carry their own trail).
export const importBankStatement = (csv) => send('POST', '/bank/import', { csv });

export const resolveBankTransaction = (id, body) =>
  send('POST', `/bank/${encodeURIComponent(id)}/resolve`, body);

export const syncStripe = (since) => send('POST', '/stripe/sync', since ? { since } : {});

// ── Ledger and reports ───────────────────────────────────────────────────────

export const fetchJournal = (params) => get('/journal', params);
export const fetchTrialBalance = (params) => get('/reports/trial-balance', params);
export const fetchProfitAndLoss = (params) => get('/reports/profit-and-loss', params);
export const fetchBalanceSheet = (params) => get('/reports/balance-sheet', params);
export const fetchAccountLedger = (code, params) =>
  get(`/accounts/${encodeURIComponent(code)}/ledger`, params);
export const fetchAccountantPack = (params) => get('/reports/accountant-pack', params);

// Posting straight to the ledger. The memo is required by the server, not just by
// the form — a manual entry with no explanation is unreadable a year later.
export const postManualEntry = (body) => send('POST', '/journal', body);
export const reverseJournalEntry = (id, reason) =>
  send('POST', `/journal/${encodeURIComponent(id)}/reverse`, { reason });

export const trialBalanceCsvUrl = (params = {}) => withQuery(`${BASE}/reports/trial-balance.csv`, params);
export const journalCsvUrl = (params = {}) => withQuery(`${BASE}/reports/journal.csv`, params);

// ── Payroll ──────────────────────────────────────────────────────────────────

export const fetchPayrollYears = () => get('/payroll/years');
export const fetchPayrollYear = (year) => get(`/payroll/years/${encodeURIComponent(year)}`);
export const savePayrollYear = (year, body) =>
  send('PUT', `/payroll/years/${encodeURIComponent(year)}`, body);
// Confirming is the act that lets payroll run. The note is required by the server, not
// just by the form: the claim "I checked these" is only worth something if it says
// against what.
export const confirmPayrollYear = (year, sourceNote) =>
  send('POST', `/payroll/years/${encodeURIComponent(year)}/confirm`, { source_note: sourceNote });

export const fetchEmployees = (params) => get('/payroll/employees', params);
export const fetchEmployee = (id) => get(`/payroll/employees/${encodeURIComponent(id)}`);
export const createEmployee = (body) => send('POST', '/payroll/employees', body);
export const updateEmployee = (id, body) =>
  send('PATCH', `/payroll/employees/${encodeURIComponent(id)}`, body);

export const fetchPayrollRuns = (params) => get('/payroll/runs', params);
export const fetchPayrollRun = (id) => get(`/payroll/runs/${encodeURIComponent(id)}`);
export const createPayrollRun = (body) => send('POST', '/payroll/runs', body);

// Throws with `err.findings` attached on a 409, so the caller can show exactly which
// employee is blocking and by how much rather than a bare message.
export async function postPayrollRun(id, overrideReason) {
  const res = await fetch(`${BASE}/payroll/runs/${encodeURIComponent(id)}/post`, {
    method: 'POST',
    credentials: 'include',
    headers: await csrfHeaders(),
    body: JSON.stringify(overrideReason ? { override_reason: overrideReason } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Beiðni mistókst');
    if (Array.isArray(data.findings)) err.findings = data.findings;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const reversePayrollRun = (id, reason) =>
  send('POST', `/payroll/runs/${encodeURIComponent(id)}/reverse`, { reason });
export const payPayrollRun = (id, body) =>
  send('POST', `/payroll/runs/${encodeURIComponent(id)}/pay`, body);

export const payslipPdfUrl = (id) => `${BASE}/payroll/payslips/${encodeURIComponent(id)}/pdf`;
export const payrollCsvUrl = () => `${BASE}/payroll/export.csv`;

// ── Counter sales ────────────────────────────────────────────────────────────

export const fetchPosCatalogue = (q) => get('/pos/catalogue', q ? { q } : {});
export const fetchPosDay = (params) => get('/pos/day', params);
export const fetchPosReceipts = (params) => get('/pos/receipts', params);
export const ringUpSale = (body) => send('POST', '/pos/sales', body);
export const posCsvUrl = (params = {}) => withQuery(`${BASE}/pos/export.csv`, params);

// A receipt is a row in the same sales ledger as an invoice, so it prints through the
// same endpoint — the PDF renderer switches its own heading on the series.
export const receiptPdfUrl = (id) => invoicePdfUrl(id);
