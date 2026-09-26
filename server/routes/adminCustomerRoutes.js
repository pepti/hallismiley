// Admin Customers routes. Listing + import preview are read-only and gated by the
// grantable 'customers' view; creating, importing, deleting and bulk-inviting
// customers are hard admin-only (+ CSRF). Since harvest 2 lane 3 (2026-09-26)
// the `customers` view ALSO grants editing ONE plain customer's contact details
// and sending them the invite (bottom of this file) — held to a plain customer
// in the model, never a staff account. All require auth.
const express = require('express');
const router  = express.Router();

const adminCustomer   = require('../controllers/adminCustomerController');
const { requireAuth } = require('../auth/middleware');
const { requireView } = require('../auth/requireView');
const { requireRole } = require('../auth/roles');
const { csrfProtect } = require('../middleware/csrf');
const { sanitizeBody } = require('../middleware/sanitize');
const { validateCustomerContact } = require('../middleware/validate');

router.use(requireAuth);

router.get('/',                requireView('customers'), adminCustomer.listCustomers);
router.post('/import/preview', requireView('customers'), adminCustomer.previewImport);
router.post('/',               requireRole('admin'), csrfProtect, adminCustomer.createCustomer);
router.post('/import',         requireRole('admin'), csrfProtect, adminCustomer.applyImport);
router.post('/delete',         requireRole('admin'), csrfProtect, adminCustomer.deleteCustomers);

// Bulk welcome invites — preview is read-only; render sanitises the pasted copy
// so the preview matches what would be stored + sent; template + send write.
router.get('/send-invites/preview', requireRole('admin'), adminCustomer.getInvitePreview);
router.post('/send-invites/render', requireRole('admin'), sanitizeBody, adminCustomer.renderInvitePreviewHtml);
router.patch('/invite-template',    requireRole('admin'), csrfProtect, sanitizeBody, adminCustomer.updateInviteTemplate);
router.post('/send-invites',        requireRole('admin'), csrfProtect, adminCustomer.sendBulkInvites);

// One customer: read, edit contact + address, send the welcome invite
// (harvest 2 lane 3, ported from icelandicstore #336). Gated on the SAME
// `customers` view as the list — Halli's scope, 2026-09-26 — with the target
// held to a plain customer in the model (Customer.findEditable: never a staff
// account or a party guest; those are 404). Declared AFTER every fixed path
// above so '/:id' never captures 'invite-template' or 'send-invites'.
router.get('/:id',          requireView('customers'), adminCustomer.getCustomer);
router.patch('/:id',        requireView('customers'), csrfProtect, sanitizeBody, validateCustomerContact, adminCustomer.updateCustomer);
router.post('/:id/invite',  requireView('customers'), csrfProtect, adminCustomer.sendCustomerInvite);

module.exports = router;
