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
// limiter — nothing else in this app rate-limits document generation.
router.get('/invoices/:id/pdf', requireView('invoices'), docLimiter, books.getInvoicePdf);

router.post('/invoices/:id/payments', requireRole('admin'), csrfProtect, books.recordPayment);
router.post('/invoices/:id/credit-notes', requireRole('admin'), csrfProtect, books.createCreditNote);

// ── Catch-all ────────────────────────────────────────────────────────────────
// Belt-and-braces: an endpoint added below this line, or one that slips past the
// prefixes above, still cannot be reached without the 'books' view.
router.use(requireView('books'));

module.exports = router;
