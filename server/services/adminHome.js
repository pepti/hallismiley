// "Í dag" — the admin home's one read (GET /api/v1/admin/home, D-020 step 4).
//
// The rule this module exists to keep (invariant 8): every block is COMPUTED
// only for a view the signed-in role holds, server-side. A key the role cannot
// see is ABSENT from the answer — never null, never 0, never "hidden by the
// client". The caller hands in `can(view)`, built from the same resolver the
// route guards use (auth/requireView.js resolveViews), so the home can never
// show a number whose own screen would answer 403.
//
// Shape (amounts integer ISK, times ISO UTC, no labels — the client owns the
// words): { generatedAt, todo: [...], figures: {...}, recent: [...],
// setup: null | {...}, errors?: [...] }. docs/ARCHITECTURE.md §2 and the
// spec in docs/HISTORY.md#admin-home-idag-2026-09-26 name every field.
//
// Every source is an independent sub-query in one Promise.all. A failing one
// drops ITS blocks, is logged, and is named in `errors` — the endpoint still
// answers 200 with everything else.
//
// `now` is injectable so the day boundaries ("today", "the same time a week
// ago") can be tested without a clock; production passes nothing. Reykjavík is
// UTC all year, but the boundaries are still computed in Atlantic/Reykjavik so
// the rule is written down where it applies.

const db = require('../config/database');
const logger = require('../logger');
const Bin = require('../models/Bin');
const Setting = require('../models/Setting');
const vatService = require('./bookkeeping/vatService');
const { toIsoDate } = require('../utils/booksDate');

const TZ = 'Atlantic/Reykjavik';
const RECENT_LIMIT = 8;
const EXCERPT = 90;
// A VSK deadline enters "Bíður þín" two weeks out, and turns urgent at three days.
const VAT_TODO_DAYS = 14;
const VAT_WARN_DAYS = 3;
// A Stripe Checkout session lives at most 24 hours; a pending order older than
// that was abandoned, not "awaiting payment" (there is no expiry webhook yet).
const AWAITING_PAYMENT_HOURS = 24;
// "Í sendingu" = fulfilled, not yet marked delivered. Many shops never mark
// delivery, so an unbounded count would only ever grow; two weeks is the
// window a parcel is plausibly still on its way.
const SHIPPED_WINDOW_DAYS = 14;

// Stable order of the to-do kinds within one tone (the spec's order).
const TODO_ORDER = [
  'invoices_overdue', 'vat_deadline', 'orders_to_ship', 'leads_new',
  'change_requests_open', 'bins_unshelved',
];
const TONE_RANK = { warn: 0, soon: 1 };

// Sales channels and the view each one needs. The classification is a rule to
// confirm with Bókari/Halli (docs/ARCHITECTURE.md §2): web = shop orders paid
// today; wholesale = invoices issued today that were NOT created from an order;
// pos = till receipts rung up today.
const CHANNELS = [
  { channel: 'web', view: 'orders' },
  { channel: 'wholesale', view: 'invoices' },
  { channel: 'pos', view: 'pos' },
];

// SQL fragments. $1 is always `now` (timestamptz).
const DAY_START = `(date_trunc('day', $1::timestamptz AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`;
const TODAY = `($1::timestamptz AT TIME ZONE '${TZ}')::date`;
const ISSUED_DAY = `(i.issued_at AT TIME ZONE '${TZ}')::date`;
const OUTSTANDING = 'i.total_gross - i.amount_credited - i.amount_paid + i.amount_refunded';

const num = v => (v === null || v === undefined ? 0 : Number(v));
const iso = v => (v ? new Date(v).toISOString() : null);
function excerpt(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > EXCERPT ? `${s.slice(0, EXCERPT - 1).trimEnd()}…` : s;
}

// ── Sources ───────────────────────────────────────────────────────────────────
// Each returns a plain object; the assembler below turns it into todo items,
// figures and feed rows. None of them decides visibility — the caller only
// runs a source whose view the role holds.

async function receivablesSource(now) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*)::int AS invoices,
       COALESCE(SUM(${OUTSTANDING}), 0)::bigint AS outstanding,
       COALESCE(SUM(${OUTSTANDING}) FILTER (WHERE i.due_at >= $1), 0)::bigint AS current,
       COALESCE(SUM(${OUTSTANDING}) FILTER (WHERE i.due_at < $1 AND i.due_at >= $1::timestamptz - INTERVAL '30 days'), 0)::bigint AS d1_30,
       COALESCE(SUM(${OUTSTANDING}) FILTER (WHERE i.due_at < $1::timestamptz - INTERVAL '30 days'), 0)::bigint AS d31_plus,
       COUNT(*) FILTER (WHERE i.due_at < $1)::int AS overdue_count,
       COALESCE(SUM(${OUTSTANDING}) FILTER (WHERE i.due_at < $1), 0)::bigint AS overdue_amount,
       MIN(i.due_at) FILTER (WHERE i.due_at < $1) AS oldest_due,
       (ARRAY_AGG(i.customer_name ORDER BY i.due_at ASC) FILTER (WHERE i.due_at < $1))[1] AS oldest_party,
       (SELECT EXISTS (SELECT 1 FROM invoices x
                        WHERE x.series = 'invoice' AND x.status IN ('issued','credited'))) AS any_invoice
     FROM invoices i
    WHERE i.status = 'issued' AND i.series = 'invoice' AND ${OUTSTANDING} > 0`,
    [now]
  );
  const r = rows[0];
  const oldestDays = r.oldest_due
    ? Math.max(0, Math.floor((now.getTime() - new Date(r.oldest_due).getTime()) / 86400000))
    : 0;
  return {
    anyInvoice: r.any_invoice === true,
    invoices: r.invoices,
    outstanding: num(r.outstanding),
    aging: { current: num(r.current), days1to30: num(r.d1_30), days31plus: num(r.d31_plus) },
    overdue: { amount: num(r.overdue_amount), count: r.overdue_count },
    oldestDays,
    oldestParty: r.oldest_party || null,
  };
}

// The next VSK filing: the earliest deadline, due today or later, whose period
// has no filed return. Only once the books have any posted entry — a new
// instance's seeded Skattadagatal is not yet a to-do.
async function vatSource(now) {
  const { rows } = await db.query(
    `SELECT td.period, td.due_on, (td.due_on - ${TODAY})::int AS days_left
       FROM tax_deadlines td
      WHERE td.kind = 'vsk' AND td.completed_at IS NULL AND td.period IS NOT NULL
        AND td.due_on >= ${TODAY}
        AND NOT EXISTS (SELECT 1 FROM vat_returns vr WHERE vr.period = td.period)
        AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.posted_at IS NOT NULL)
      ORDER BY td.due_on ASC, td.period ASC
      LIMIT 1`,
    [now]
  );
  if (!rows.length) return null;
  const r = rows[0];
  const derived = await vatService.deriveReturn(db, r.period);
  return {
    period: r.period,
    from: derived.range.from,
    to: derived.range.to,
    dueOn: toIsoDate(r.due_on),
    daysLeft: r.days_left,
    payable: num(derived.box_f_payable),
  };
}

async function ordersSource(now) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE o.payment_status IN ('paid','partially_refunded')
                          AND o.fulfillment_status IN ('unfulfilled','partial'))::int AS to_ship,
       MIN(o.created_at) FILTER (WHERE o.payment_status IN ('paid','partially_refunded')
                                   AND o.fulfillment_status IN ('unfulfilled','partial')) AS oldest_to_ship,
       COUNT(*) FILTER (WHERE o.payment_status IN ('paid','partially_refunded')
                          AND o.fulfillment_status = 'fulfilled'
                          AND o.fulfilled_at >= $1::timestamptz - INTERVAL '${SHIPPED_WINDOW_DAYS} days')::int AS shipped,
       COUNT(*) FILTER (WHERE o.payment_status = 'pending'
                          AND o.created_at >= $1::timestamptz - INTERVAL '${AWAITING_PAYMENT_HOURS} hours')::int AS awaiting,
       COUNT(*)::int AS any_order
     FROM orders o`,
    [now]
  );
  const r = rows[0];
  return {
    anyOrder: r.any_order > 0,
    toShip: r.to_ship,
    oldestAt: iso(r.oldest_to_ship),
    shipped: r.shipped,
    awaitingPayment: r.awaiting,
  };
}

async function leadsSource() {
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM leads WHERE status = 'new') AS n,
            (SELECT message FROM leads WHERE status = 'new' ORDER BY created_at DESC, id DESC LIMIT 1) AS latest`
  );
  return { count: rows[0].n, latest: rows[0].latest ? excerpt(rows[0].latest) : null };
}

async function changeRequestsSource() {
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM change_requests WHERE status = 'open') AS n,
            (SELECT note FROM change_requests WHERE status = 'open' ORDER BY created_at DESC LIMIT 1) AS latest`
  );
  return { count: rows[0].n, latest: rows[0].latest ? excerpt(rows[0].latest) : null };
}

async function binsSource() {
  const [count, sample] = await Promise.all([
    Bin.queueCount(),
    db.query(
      `SELECT name FROM (
         SELECT p.name FROM products p
          WHERE (p.bin IS NULL OR p.bin = '') AND p.active = TRUE
            AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id)
         UNION ALL
         SELECT p.name FROM product_variants v JOIN products p ON p.id = v.product_id
          WHERE (v.bin IS NULL OR v.bin = '') AND v.active = TRUE AND p.active = TRUE
       ) q ORDER BY name LIMIT 2`
    ),
  ]);
  return { count, sample: sample.rows.map(r => r.name) };
}

// One channel's sales: today so far, and the same weekday last week up to the
// same time of day. `any` = has this channel ever sold anything (a new
// instance shows no sales figure at all until the first sale).
const CHANNEL_SQL = {
  web: `SELECT
          COUNT(*) FILTER (WHERE o.paid_at >= ${DAY_START} AND o.paid_at <= $1)::int AS n,
          COALESCE(SUM(o.total) FILTER (WHERE o.paid_at >= ${DAY_START} AND o.paid_at <= $1), 0)::bigint AS amount,
          COALESCE(SUM(o.total) FILTER (WHERE o.paid_at >= ${DAY_START} - INTERVAL '7 days'
                                          AND o.paid_at <= $1::timestamptz - INTERVAL '7 days'), 0)::bigint AS compare,
          BOOL_OR(TRUE) AS any
        FROM orders o
       WHERE o.currency = 'ISK' AND o.paid_at IS NOT NULL
         AND o.payment_status IN ('paid','partially_refunded')`,
  // Issued today by the document's own date; "up to the same time" last week
  // by when the row was written (issued_at is a date, not a moment).
  wholesale: `SELECT
          COUNT(*) FILTER (WHERE ${ISSUED_DAY} = ${TODAY})::int AS n,
          COALESCE(SUM(i.total_gross) FILTER (WHERE ${ISSUED_DAY} = ${TODAY}), 0)::bigint AS amount,
          COALESCE(SUM(i.total_gross) FILTER (WHERE ${ISSUED_DAY} = ${TODAY} - 7
                                                AND i.created_at <= $1::timestamptz - INTERVAL '7 days'), 0)::bigint AS compare,
          BOOL_OR(TRUE) AS any
        FROM invoices i
       WHERE i.series = 'invoice' AND i.status IN ('issued','credited') AND i.order_id IS NULL`,
  // A receipt's issued_at is its sale DATE; the moment it was rung up is created_at.
  pos: `SELECT
          COUNT(*) FILTER (WHERE i.created_at >= ${DAY_START} AND i.created_at <= $1)::int AS n,
          COALESCE(SUM(i.total_gross) FILTER (WHERE i.created_at >= ${DAY_START} AND i.created_at <= $1), 0)::bigint AS amount,
          COALESCE(SUM(i.total_gross) FILTER (WHERE i.created_at >= ${DAY_START} - INTERVAL '7 days'
                                                AND i.created_at <= $1::timestamptz - INTERVAL '7 days'), 0)::bigint AS compare,
          BOOL_OR(TRUE) AS any
        FROM invoices i
       WHERE i.series = 'receipt' AND i.status IN ('issued','credited')`,
};

async function channelSource(channel, now) {
  const { rows } = await db.query(CHANNEL_SQL[channel], [now]);
  const r = rows[0];
  return { channel, any: r.any === true, amount: num(r.amount), count: r.n, compare: num(r.compare) };
}

// ── Feed sources (≤ 8 each, newest first) ─────────────────────────────────────

async function recentOrders() {
  const { rows } = await db.query(
    `SELECT o.id, o.order_number, o.total, o.paid_at,
            COALESCE(NULLIF(TRIM(o.guest_name), ''), NULLIF(TRIM(u.display_name), '')) AS party
       FROM orders o LEFT JOIN users u ON u.id = o.user_id
      WHERE o.paid_at IS NOT NULL AND o.payment_status <> 'pending'
      ORDER BY o.paid_at DESC
      LIMIT ${RECENT_LIMIT}`
  );
  return rows.map(r => ({
    type: 'order_placed', at: iso(r.paid_at), view: 'orders',
    route: `/admin/shop/orders/${r.id}`, ref: r.order_number, party: r.party || null, amount: num(r.total),
  }));
}

// Payments IN against invoices (receipts are till sales, never listed here —
// forty lines a day would drown the feed). Fully settled now = invoice_paid,
// else a part payment.
async function recentPayments() {
  const { rows } = await db.query(
    `SELECT p.amount, p.created_at, i.id AS invoice_id, i.invoice_number, i.customer_name,
            (${OUTSTANDING}) <= 0 AS settled
       FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.direction = 'in' AND i.series = 'invoice'
      ORDER BY p.created_at DESC
      LIMIT ${RECENT_LIMIT}`
  );
  return rows.map(r => ({
    type: r.settled ? 'invoice_paid' : 'invoice_part_paid', at: iso(r.created_at), view: 'invoices',
    route: `/admin/books/invoices/${r.invoice_id}`, ref: String(r.invoice_number),
    party: r.customer_name || null, amount: num(r.amount),
  }));
}

async function recentLeads() {
  const { rows } = await db.query(
    `SELECT id, name, company, message, created_at FROM leads
      ORDER BY created_at DESC, id DESC LIMIT ${RECENT_LIMIT}`
  );
  return rows.map(r => ({
    type: 'lead_received', at: iso(r.created_at), view: 'leads', route: '/admin/leads',
    party: r.name, company: r.company || null, summary: excerpt(r.message),
  }));
}

// Change requests have only open/resolved (ChangeRequest.js). "Received" is an
// item's creation; "resolved" is an item that is resolved now, at its last
// update. There is no "awaiting you" state to report.
async function recentChangeRequests() {
  const { rows } = await db.query(
    `(SELECT 'change_request_received' AS type, note, created_at AS at FROM change_requests
        ORDER BY created_at DESC LIMIT ${RECENT_LIMIT})
     UNION ALL
     (SELECT 'change_request_resolved' AS type, note, updated_at AS at FROM change_requests
       WHERE status = 'resolved' ORDER BY updated_at DESC LIMIT ${RECENT_LIMIT})`
  );
  return rows.map(r => ({
    type: r.type, at: iso(r.at), view: 'feedback', route: '/admin/feedback', summary: excerpt(r.note),
  }));
}

// ── Fyrstu skrefin ────────────────────────────────────────────────────────────
// Derived, never stored, so it cannot go stale. A step exists only when the
// screen it links to exists for this admin (`can`); the 2FA step is the
// viewer's own, the rest are the instance's.
async function setupSource(userId, can) {
  const checks = [];
  if (can('general')) {
    checks.push(['company', '/admin/general', async () => {
      const g = await Setting.getGeneralSettings();
      return Boolean(g.contact_email.trim() && g.address1.trim() && g.city.trim());
    }]);
  }
  if (can('products')) {
    checks.push(['product', '/admin/shop/products', async () => {
      const { rows } = await db.query('SELECT EXISTS (SELECT 1 FROM products) AS any');
      return rows[0].any === true;
    }]);
  }
  if (can('books')) {
    checks.push(['seller', '/admin/books/settings', async () => (await Setting.getBookkeepingSettings()).seller_complete]);
  }
  if (can('users')) {
    // Staff = anyone holding more than the customer floor: admin, moderator or
    // a custom role, as primary role or membership. Customers do not count.
    checks.push(['staff', '/admin/users', async () => {
      const { rows } = await db.query(
        `SELECT COUNT(DISTINCT u.id)::int AS n
           FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
          WHERE COALESCE(u.disabled, FALSE) = FALSE
            AND (u.role <> 'user' OR (ur.role_name IS NOT NULL AND ur.role_name <> 'user'))`
      );
      return rows[0].n >= 2;
    }]);
  }
  checks.push(['twoStep', '/profile', async () => {
    const { rows } = await db.query('SELECT totp_enabled FROM users WHERE id = $1', [String(userId)]);
    return rows[0]?.totp_enabled === true;
  }]);

  const done = await Promise.all(checks.map(([, , fn]) => fn()));
  const steps = checks.map(([key, route], i) => ({ key, done: done[i] === true, route }));
  const doneCount = steps.filter(s => s.done).length;
  if (doneCount === steps.length) return null;
  return { done: doneCount, total: steps.length, steps };
}

// ── Access ────────────────────────────────────────────────────────────────────

/**
 * Which views the home may compute for one viewer. Pure; the route feeds it
 * the resolved views (requireView.resolveViews), the switched-off modules'
 * views and the product's hidden admin views.
 *   instanceLacks(id): this INSTANCE has no such screen for this viewer — its
 *     module is off, or the product hides it from an all-views holder (the
 *     sidebar's rule; an explicit grant is always shown);
 *   can(id): held AND not lacking.
 */
function homeAccess({ views = [], disabled = [], hidden = [] } = {}) {
  const all = views.includes('*');
  const off = new Set(disabled);
  const hide = new Set(hidden);
  const instanceLacks = id => off.has(id) || (all && hide.has(id));
  const can = id => !instanceLacks(id) && (all || views.includes(id));
  return { can, instanceLacks };
}

// ── Assembly ──────────────────────────────────────────────────────────────────

/**
 * Build the home for one viewer.
 *
 * @param {object}   opts
 * @param {Function} opts.can            view id → boolean (held AND on this instance)
 * @param {Function} opts.instanceLacks  view id → boolean: the INSTANCE has no such
 *                                       screen for this viewer (module off, or hidden
 *                                       from an all-views holder) — as opposed to the
 *                                       role lacking it, which is what `partial` reports
 * @param {boolean}  opts.isAdmin        the viewer holds the admin role (setup is admins only)
 * @param {string}   opts.userId
 * @param {Date}     [opts.now]
 */
async function buildHome({ can, instanceLacks = () => false, isAdmin = false, userId, now = new Date() }) {
  const errors = [];
  // name → { blocks: [error keys], run: () => Promise }
  const jobs = {};
  const add = (name, blocks, run) => { jobs[name] = { blocks, run }; };

  if (can('ar')) add('receivables', ['todo.invoices_overdue', 'figures.receivables'], () => receivablesSource(now));
  if (can('vat')) add('vat', ['todo.vat_deadline', 'figures.vatNext'], () => vatSource(now));
  if (can('orders')) add('orders', ['todo.orders_to_ship', 'figures.openOrders'], () => ordersSource(now));
  if (can('leads')) add('leads', ['todo.leads_new'], () => leadsSource());
  if (can('feedback')) add('changeRequests', ['todo.change_requests_open'], () => changeRequestsSource());
  if (can('bins')) add('bins', ['todo.bins_unshelved'], () => binsSource());
  const heldChannels = CHANNELS.filter(c => can(c.view));
  for (const c of heldChannels) add(`sales.${c.channel}`, ['figures.salesToday'], () => channelSource(c.channel, now));
  if (can('orders')) add('recent.orders', ['recent.orders'], recentOrders);
  if (can('invoices')) add('recent.payments', ['recent.payments'], recentPayments);
  if (can('leads')) add('recent.leads', ['recent.leads'], recentLeads);
  if (can('feedback')) add('recent.changeRequests', ['recent.changeRequests'], recentChangeRequests);
  if (isAdmin) add('setup', ['setup'], () => setupSource(userId, can));

  const names = Object.keys(jobs);
  const settled = await Promise.allSettled(names.map(n => jobs[n].run()));
  const out = {};
  settled.forEach((s, i) => {
    const name = names[i];
    if (s.status === 'fulfilled') { out[name] = s.value; return; }
    logger.error({ err: s.reason, source: name }, 'adminHome: a source failed; its blocks are left out');
    for (const b of jobs[name].blocks) if (!errors.includes(b)) errors.push(b);
    out[name] = undefined;
  });
  const ok = name => Object.prototype.hasOwnProperty.call(out, name) && out[name] !== undefined;

  // ── todo ──
  const todo = [];
  if (ok('receivables') && out.receivables.overdue.count > 0) {
    const r = out.receivables;
    todo.push({
      kind: 'invoices_overdue', view: 'ar', route: '/admin/books/ar', tone: 'warn',
      count: r.overdue.count, amount: r.overdue.amount,
      detail: { oldestDays: r.oldestDays, oldestParty: r.oldestParty },
    });
  }
  if (ok('vat') && out.vat && out.vat.daysLeft <= VAT_TODO_DAYS) {
    const v = out.vat;
    todo.push({
      kind: 'vat_deadline', view: 'vat', route: '/admin/books/vat',
      tone: v.daysLeft <= VAT_WARN_DAYS ? 'warn' : 'soon',
      count: v.daysLeft, amount: v.payable,
      detail: { period: v.period, from: v.from, to: v.to, dueOn: v.dueOn, daysLeft: v.daysLeft },
    });
  }
  if (ok('orders') && out.orders.toShip > 0) {
    todo.push({
      kind: 'orders_to_ship', view: 'orders', route: '/admin/shop/orders', tone: null,
      count: out.orders.toShip, detail: { oldestAt: out.orders.oldestAt },
    });
  }
  if (ok('leads') && out.leads.count > 0) {
    todo.push({
      kind: 'leads_new', view: 'leads', route: '/admin/leads', tone: null,
      count: out.leads.count, detail: { latest: out.leads.latest },
    });
  }
  if (ok('changeRequests') && out.changeRequests.count > 0) {
    todo.push({
      kind: 'change_requests_open', view: 'feedback', route: '/admin/feedback', tone: null,
      count: out.changeRequests.count, detail: { latest: out.changeRequests.latest },
    });
  }
  if (ok('bins') && out.bins.count > 0) {
    todo.push({
      kind: 'bins_unshelved', view: 'bins', route: '/admin/bins', tone: null,
      count: out.bins.count, detail: { sample: out.bins.sample },
    });
  }
  todo.sort((a, b) => ((TONE_RANK[a.tone] ?? 2) - (TONE_RANK[b.tone] ?? 2))
    || (TODO_ORDER.indexOf(a.kind) - TODO_ORDER.indexOf(b.kind)));

  // ── figures ──
  const figures = {};
  const channelRows = heldChannels.map(c => out[`sales.${c.channel}`]);
  if (heldChannels.length && !errors.includes('figures.salesToday') && channelRows.some(r => r.any)) {
    const byChannel = channelRows.map(r => ({ channel: r.channel, amount: r.amount, count: r.count }));
    figures.salesToday = {
      total: byChannel.reduce((a, c) => a + c.amount, 0),
      asOf: now.toISOString(),
      // A channel the INSTANCE has but the ROLE lacks: omitted, never zeroed,
      // and the figure says it is partial.
      partial: CHANNELS.some(c => !can(c.view) && !instanceLacks(c.view)),
      byChannel,
      compare: {
        basis: 'same_weekday_last_week_same_time',
        total: channelRows.reduce((a, r) => a + r.compare, 0),
      },
    };
  }
  if (ok('orders') && out.orders.anyOrder) {
    const o = out.orders;
    figures.openOrders = {
      count: o.toShip + o.shipped + o.awaitingPayment,
      byState: { toShip: o.toShip, shipped: o.shipped, awaitingPayment: o.awaitingPayment },
    };
  }
  if (ok('receivables') && out.receivables.anyInvoice) {
    const r = out.receivables;
    figures.receivables = { outstanding: r.outstanding, invoices: r.invoices, aging: r.aging, overdue: r.overdue };
  }
  if (ok('vat') && out.vat) {
    const v = out.vat;
    figures.vatNext = { period: v.period, from: v.from, to: v.to, dueOn: v.dueOn, daysLeft: v.daysLeft, payable: v.payable };
  }

  // ── recent ──
  const recent = ['recent.orders', 'recent.payments', 'recent.leads', 'recent.changeRequests']
    .filter(ok).flatMap(n => out[n])
    .filter(e => e.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, RECENT_LIMIT);

  const body = {
    generatedAt: now.toISOString(),
    todo,
    figures,
    recent,
  };
  // Admins only; any other role never sees the key. null = every step done.
  if (isAdmin && ok('setup')) body.setup = out.setup;
  if (errors.length) body.errors = errors;
  return body;
}

module.exports = { buildHome, homeAccess, CHANNELS, VAT_TODO_DAYS, VAT_WARN_DAYS };
