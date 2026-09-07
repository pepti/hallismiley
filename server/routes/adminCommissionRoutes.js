// Commission report — /api/v1/admin/commission (migration 098; ENHANCEMENTS
// #18, D-003). Read-only: the ledger is written only by the service-invoice
// path. A seller sees their own rows; admin sees every seller. No-store.
const express = require('express');
const router  = express.Router();

const Commission = require('../models/Commission');
const { requireAuth }  = require('../auth/middleware');
const { requireView }  = require('../auth/requireView');
const { accountScope } = require('../auth/accountScope');
const { toCsv, csvHeaders } = require('../utils/csv');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function range(query) {
  const from = ISO_DATE.test(String(query.from || '')) ? query.from : null;
  const to   = ISO_DATE.test(String(query.to || ''))   ? query.to   : null;
  return { from, to };
}

router.use(requireAuth, requireView('commission'), accountScope);

// GET /?from=YYYY-MM-DD&to=YYYY-MM-DD → per seller per month + the events
router.get('/', async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const r = range(req.query);
    const [rows, events] = await Promise.all([
      Commission.report(req.accountScope, r),
      Commission.events(req.accountScope, { ...r, limit: 500 }),
    ]);
    return res.json({ rows, events, scope: req.accountScope.all ? 'all' : 'own', from: r.from, to: r.to });
  } catch (err) { next(err); }
});

// GET /export.csv — the events in the range, one row each.
router.get('/export.csv', async (req, res, next) => {
  try {
    const r = range(req.query);
    const events = await Commission.events(req.accountScope, { ...r, limit: 1000 });
    csvHeaders(res, `solulaun-${new Date().toISOString().slice(0, 10)}.csv`);
    return res.send(toCsv(
      ['period', 'seller', 'account', 'kind', 'invoice_number', 'base_amount_isk', 'rate_bp', 'amount_isk', 'invoice_paid'],
      events.map(e => [
        String(e.period).slice(0, 7), e.seller_username, e.account_name, e.kind, e.invoice_number,
        e.base_amount_isk, e.rate_bp, e.amount_isk, e.invoice_paid ? 'yes' : 'no',
      ])
    ));
  } catch (err) { next(err); }
});

module.exports = router;
