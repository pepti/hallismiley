// Admin bookkeeping routes.
//
// Gating follows the template in adminCustomerRoutes.js, tightened for money:
// READS are gated by a grantable view id, so an accountant or bookkeeper can be
// given exactly the areas they need. WRITES that move money or issue a statutory
// document are hard `requireRole('admin')` + CSRF — those are not delegable
// through a custom role, because a role with 'invoices' would otherwise be able to
// issue and credit real documents.
//
// The trailing catch-all matters: a route added later outside every declared
// prefix would otherwise inherit only requireAuth. Any path not matched above is
// still required to hold the 'books' view.
const express = require('express');
const router = express.Router();

const books = require('../controllers/adminBookkeepingController');
const { requireAuth } = require('../auth/middleware');
const { requireView } = require('../auth/requireView');
const { requireRole } = require('../auth/roles');
const { csrfProtect } = require('../middleware/csrf');
const { docLimiter } = require('../middleware/booksLimiters');
const documentService = require('../services/bookkeeping/documentService');

router.use(requireAuth);

// ── Overview + settings (view: books) ────────────────────────────────────────
router.get('/dashboard', requireView('books'), books.getDashboard);
router.get('/settings', requireView('books'), books.getSettings);
router.patch('/settings', requireRole('admin'), csrfProtect, books.updateSettings);
router.post('/fx-rates', requireRole('admin'), csrfProtect, books.setFxRate);

// ── Invoices (view: invoices) ────────────────────────────────────────────────
// Literal paths before parameterised ones: '/invoices/from-order/:orderId' must be
// matched before anything could read 'from-order' as an :id.
router.post('/invoices/from-order/:orderId', requireRole('admin'), csrfProtect,
  books.createInvoiceFromOrder);

router.get('/invoices', requireView('invoices'), books.listInvoices);
router.get('/invoices/:id', requireView('invoices'), books.getInvoice);
// PDF generation is synchronous pdfkit work in-request, so it gets its own tighter
// limiter — nothing else in this app rate-limits document generation. The limiter
// runs BEFORE the view check so rejected attempts count against it too; otherwise
// only already-authorised traffic is ever throttled.
router.get('/invoices/:id/pdf', docLimiter, requireView('invoices'), books.getInvoicePdf);

router.post('/invoices/:id/payments', requireRole('admin'), csrfProtect, books.recordPayment);
// A refund is the CASH half of undoing a sale; the credit note is the other half.
// Separate endpoints because they are separate facts — a chargeback is a refund
// with no credit note, and a goodwill credit is a credit note with no refund.
router.post('/invoices/:id/refunds', requireRole('admin'), csrfProtect, books.recordRefund);
router.post('/invoices/:id/credit-notes', requireRole('admin'), csrfProtect, books.createCreditNote);

// Server-side CSV export, paged internally so a long history streams rather than
// being silently truncated at a page cap. Read-only, so no CSRF; docLimiter
// because building one is real work.
router.get('/invoices/export.csv', docLimiter, requireView('invoices'), books.exportInvoicesCsv);

// ── Expenses (view: expenses) ────────────────────────────────────────────────
// Literal paths first, and export.csv before any ':id' could swallow it.
router.get('/expenses/export.csv', docLimiter, requireView('expenses'), books.exportExpensesCsv);
router.get('/expenses/missing-documents', requireView('expenses'), books.getMissingDocuments);
router.get('/expenses/suppliers', requireView('expenses'), books.getSuppliers);
router.get('/expenses/accounts', requireView('expenses'), books.getAccounts);
// A dry-run VAT verdict so the form can explain a refused deduction while the user
// is still typing. Read-only in effect, but a POST because it takes a body.
router.post('/expenses/preview-vat', requireView('expenses'), csrfProtect, books.previewExpenseVat);

router.get('/expenses', requireView('expenses'), books.listExpenses);
router.get('/expenses/:id', requireView('expenses'), books.getExpense);
router.post('/expenses', requireRole('admin'), csrfProtect, books.createExpense);
router.patch('/expenses/:id/document', requireRole('admin'), csrfProtect, books.attachExpenseDocument);

// ── Documents (view: expenses) ───────────────────────────────────────────────
// multer runs BEFORE csrfProtect because the token arrives as a header, not a
// body field — csrf-csrf reads req.headers, so ordering is safe either way, but
// parsing multipart first gives a clean 400 on an oversized file instead of a
// confusing CSRF failure.
router.post('/documents', requireRole('admin'),
  documentService.createDocumentUpload().single('file'), csrfProtect, books.uploadDocument);
// Streamed through an authenticated route on purpose: these files live outside the
// statically-served tree, so this is the ONLY way to read them.
router.get('/documents/:id', requireView('expenses'), docLimiter, books.getDocument);

// ── Receivables (view: ar) ───────────────────────────────────────────────────
router.get('/ar/export.csv', docLimiter, requireView('ar'), books.exportAgingCsv);
router.get('/ar', requireView('ar'), books.getAging);
router.get('/ar/:customerKey', requireView('ar'), books.getStatement);

// ── VSK returns (view: vat) ──────────────────────────────────────────────────
router.get('/vat/export.csv', docLimiter, requireView('vat'), books.exportVatCsv);
router.get('/vat', requireView('vat'), books.listVatPeriods);
router.get('/vat/:period', requireView('vat'), books.getVatPeriod);
// Filing reports a figure to Skatturinn and locks the period. Hard admin-only —
// not delegable through a custom role, whatever else that role can see.
router.post('/vat/:period/file', requireRole('admin'), csrfProtect, books.fileVatReturn);
// Re-opening a filed period discards its snapshot. Admin-only, reason required,
// and audited with the figures the discarded return held.
router.post('/vat/:period/unlock', requireRole('admin'), csrfProtect, books.unlockVatPeriod);

// ── Reconciliation (view: bank) ──────────────────────────────────────────────
router.get('/bank/status', requireView('bank'), books.getReconciliationStatus);
router.get('/bank', requireView('bank'), books.listBankTransactions);
router.get('/bank/:id/suggestions', requireView('bank'), books.getBankSuggestions);
// Importing and resolving both write to the ledger, so both are admin-only.
router.post('/bank/import', requireRole('admin'), csrfProtect, books.importBankStatement);
router.post('/bank/:id/resolve', requireRole('admin'), csrfProtect, books.resolveBankTransaction);
router.post('/stripe/sync', requireRole('admin'), csrfProtect, books.syncStripe);

// ── Catch-all ────────────────────────────────────────────────────────────────
// Anything under /bookkeeping that matched no route above ends here rather than
// falling through to the /api/v1/admin catch-all router. Note what this does and
// does not do: it guards routes added BELOW this line, and it stops an unknown
// path from being probed by someone without the 'books' view. It cannot
// retroactively protect the routes above — those carry their own guards.
router.use(requireView('books'), (req, res) =>
  res.status(404).json({ error: 'Not found', code: 404 }));

module.exports = router;
