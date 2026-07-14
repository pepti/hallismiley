// Admin Customers routes. Listing + import preview are read-only and gated by the
// grantable 'customers' view; creating/importing customers writes user rows, so
// those are hard admin-only (+ CSRF). All require auth.
const express = require('express');
const router  = express.Router();

const adminCustomer   = require('../controllers/adminCustomerController');
const { requireAuth } = require('../auth/middleware');
const { requireView } = require('../auth/requireView');
const { requireRole } = require('../auth/roles');
const { csrfProtect } = require('../middleware/csrf');

router.use(requireAuth);

router.get('/',                requireView('customers'), adminCustomer.listCustomers);
router.post('/import/preview', requireView('customers'), adminCustomer.previewImport);
router.post('/',               requireRole('admin'), csrfProtect, adminCustomer.createCustomer);
router.post('/import',         requireRole('admin'), csrfProtect, adminCustomer.applyImport);
router.post('/delete',         requireRole('admin'), csrfProtect, adminCustomer.deleteCustomers);

module.exports = router;
