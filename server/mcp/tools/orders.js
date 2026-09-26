// Sales tools — READ-ONLY (harvest 2 lane 5, 2026-09-26; icelandicstore has
// the pair as sales_report / list_orders in its server/mcp/tools/orders.js).
// Thin wrappers over the models that back the admin screens:
//
//   sales_report   → Order.salesReport — the /admin/sales numbers for a period,
//                    with its comparison window when asked
//   recent_orders  → Order.listAll — newest first, optionally only the orders
//                    to fulfil (the "Í dag" card's ?view=open)
//
// Four gates (registry.js): scope 'read' in the token AND the stack ceiling;
// the shop module; and the token OWNER's admin views on this instance —
// `sales` for the report, `orders` for the list (mcp/owner.js ownerViewAccess,
// the same answer the admin home gives the owner in a browser). A product that
// hides its shop from the admin nav therefore lists neither tool.
//
// What never leaves: customer e-mail addresses, postal addresses, phone
// numbers, the order note, Stripe ids. A customer is the name typed at a guest
// checkout, or just "registered" for an account's order — nothing more.
const Order = require('../../models/Order');
const { tag } = require('../envTag');
const { parseReportWindow } = require('../../utils/reportWindow');

const DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message) {
  const err = new Error(message);
  err.expose = true;
  throw err;
}

// Inclusive YYYY-MM-DD dates → the half-open window the model takes.
function windowFrom({ from, to, compare_from: cf, compare_to: ct }) {
  for (const [k, v] of Object.entries({ from, to, compare_from: cf, compare_to: ct })) {
    if (v !== undefined && !DATE_RE.test(v)) fail(`${k} must be a date, YYYY-MM-DD`);
  }
  const next = d => new Date(Date.parse(`${d}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const q = {
    to: to ? next(to) : next(today),
    from: from || new Date(Date.parse(`${to || today}T00:00:00Z`) - 29 * DAY).toISOString().slice(0, 10),
  };
  if (cf || ct) {
    if (!cf || !ct) fail('compare_from and compare_to go together');
    q.compare_from = cf;
    q.compare_to = next(ct);
  }
  const w = parseReportWindow(q);
  if (!w.ok) fail('The period is empty or backwards');
  return w;
}

const tools = [
  {
    name: 'sales_report',
    scope: 'read',
    module: 'shop',
    view: 'sales',
    description: 'Sales for a period, as the admin sales report shows it: paid orders counted by PAYMENT date, money PER CURRENCY (never add ISK and EUR). Per currency: orders, revenue (GROSS, VAT included), vat, revenue_net (net sales — the headline figure), average order gross and net. Also the series by day/week/month and the top products by units. Dates are YYYY-MM-DD and INCLUSIVE; omitted → the last 30 days up to today. Pass compare_from/compare_to (inclusive) to get the same figures for a comparison period as kpisPrev. Orders placed before the VAT snapshot (migration 121) carry an approximate VAT computed from current product rates.',
    inputSchema: {
      type: 'object',
      properties: {
        from:         { type: 'string', description: 'first day, YYYY-MM-DD (inclusive)' },
        to:           { type: 'string', description: 'last day, YYYY-MM-DD (inclusive)' },
        compare_from: { type: 'string', description: 'comparison period first day, YYYY-MM-DD' },
        compare_to:   { type: 'string', description: 'comparison period last day, YYYY-MM-DD' },
      },
      required: [],
    },
    async handler(args) {
      const w = windowFrom(args);
      const report = await Order.salesReport({ from: w.from, to: w.to, compare: w.compare, bucket: w.bucket });
      return tag({
        period: { from: w.from.toISOString().slice(0, 10), to_exclusive: w.to.toISOString().slice(0, 10) },
        bucket: report.bucket,
        kpis: report.kpis,
        ...(report.kpisPrev ? { comparison: report.compare, kpisPrev: report.kpisPrev } : {}),
        series: report.series,
        topProducts: report.topProducts,
      });
    },
  },
  {
    name: 'recent_orders',
    scope: 'read',
    module: 'shop',
    view: 'orders',
    description: 'The most recent orders, newest first: order number, when it was placed and paid, the customer name, currency, total (GROSS, VAT included) and vat_total, payment and fulfilment status. open_only=true lists only the orders waiting to be fulfilled (paid or partly refunded, unfulfilled or partly fulfilled) — the same list as the admin home\'s "orders to fulfil". No e-mail, address or phone is returned.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:     { type: 'integer', description: 'how many, 1–50 (default 10)' },
        open_only: { type: 'boolean', description: 'only the orders waiting to be fulfilled' },
      },
      required: [],
    },
    async handler({ limit, open_only: openOnly }) {
      const n = Math.min(50, Math.max(1, Math.floor(Number(limit) || 10)));
      const filter = openOnly ? { view: 'open' } : {};
      const [rows, total] = await Promise.all([
        Order.listAll({ ...filter, sort: 'date', dir: 'desc', limit: n }),
        Order.count(filter),
      ]);
      return tag({
        total,
        count: rows.length,
        orders: rows.map(o => ({
          order_number: o.order_number,
          created_at: o.created_at,
          paid_at: o.paid_at,
          customer: (o.guest_name && o.guest_name.trim()) || null,
          registered: Boolean(o.user_id),
          currency: o.currency,
          total: Number(o.total),
          vat_total: o.vat_total === null || o.vat_total === undefined ? null : Number(o.vat_total),
          items: o.item_count,
          payment_status: o.payment_status,
          fulfillment_status: o.fulfillment_status,
        })),
      });
    },
  },
];

module.exports = tools;
