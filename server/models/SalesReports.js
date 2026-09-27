// The analyses beside the sales report (harvest 2 lane 5, 2026-09-26): the
// insights block (icelandicstore #419) and the marketing overview (Halli's
// harvest-2 item 1). Read-only SQL over orders, page_views and discounts; the
// sales report itself stays in Order.salesReport.
//
// Same semantics as the sales report: an order counts when it is PAID
// (paid_at set), money is per currency and never summed across currencies, net
// = total − VAT (Order.vatTotalSql, the migration-121 snapshot).
//
// Left out on purpose (ice has them, the engine has none of the data): sales
// channels (Vefpantanir / tölvupóstur / umboðssala / posi), companies, and the
// shop's own kennitala exclusion.

const db = require('../config/database');
const Order = require('./Order');
const { summariseChannels } = require('../utils/trafficChannel');

const DORMANT_DAYS = 90;
const NEW_TOP = 5;
const DORMANT_TOP = 10;
const CAMPAIGN_LIMIT = 20;

// A customer is a registered user, or else a guest by e-mail address. An order
// with neither (a till-style guest with no address) belongs to no customer.
const CUSTOMER_KEY = `CASE WHEN o.user_id IS NOT NULL THEN 'u:' || o.user_id
                           WHEN NULLIF(TRIM(o.guest_email), '') IS NOT NULL THEN 'g:' || LOWER(TRIM(o.guest_email))
                      END`;
const CUSTOMER_NAME = `COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, u.email,
                                NULLIF(TRIM(o.guest_name), ''), o.guest_email)`;

const num = v => (v === null || v === undefined ? null : Number(v));

// Per-customer rows → [{ name, user_id, currency, orders, net, … }], keyed.
function customerRow(r, extra = {}) {
  return {
    name: r.name,
    user_id: r.user_id || null,
    currency: r.currency,
    orders: r.orders,
    net: Number(r.net),
    ...extra,
  };
}

class SalesReports {
  static DORMANT_DAYS = DORMANT_DAYS;

  /**
   * @param {object}  o
   * @param {Date}    o.from, o.to  the window [from, to)
   * @param {boolean} o.named       include the customers' names (the viewer
   *                                may see customers or orders); else counts only
   * @param {Date}    [o.now]
   */
  static async insights({ from, to, named = false, now = new Date() }) {
    const vat = Order.vatTotalSql('o');
    const dormantBefore = new Date(now.getTime() - DORMANT_DAYS * 86400000);

    const [fulfil, fresh, dormant] = await Promise.all([
      // Payment to fulfilment, for orders FULFILLED in the window. An order
      // stamped fulfilled before it was paid (set by hand) says nothing about
      // the pace and is left out.
      db.query(
        `SELECT COUNT(*)::int AS n,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM o.fulfilled_at - o.paid_at)) AS median_s,
                AVG(EXTRACT(EPOCH FROM o.fulfilled_at - o.paid_at)) AS avg_s
           FROM orders o
          WHERE o.fulfilled_at >= $1 AND o.fulfilled_at < $2
            AND o.paid_at IS NOT NULL AND o.fulfilled_at >= o.paid_at`,
        [from, to]
      ),
      // New: the customer's FIRST paid order ever falls in the window.
      db.query(
        `WITH keyed AS (
           SELECT ${CUSTOMER_KEY} AS ckey, o.*, ${vat} AS vat_x
             FROM orders o WHERE o.paid_at IS NOT NULL
         ), firsts AS (
           SELECT ckey, MIN(paid_at) AS first_paid FROM keyed WHERE ckey IS NOT NULL GROUP BY ckey
         ), fresh AS (
           SELECT ckey FROM firsts WHERE first_paid >= $1 AND first_paid < $2
         )
         SELECT (SELECT COUNT(*)::int FROM fresh) AS total,
                k.ckey, k.currency, MIN(k.user_id) AS user_id,
                COUNT(*)::int AS orders, SUM(k.total - k.vat_x)::bigint AS net,
                MIN(k.paid_at) AS first_paid
           FROM keyed k JOIN fresh f ON f.ckey = k.ckey
          WHERE k.paid_at >= $1 AND k.paid_at < $2
          GROUP BY k.ckey, k.currency
          ORDER BY net DESC, first_paid ASC
          LIMIT ${NEW_TOP}`,
        [from, to]
      ),
      // Dormant: ordered before, nothing in the last 90 days — the state NOW,
      // not tied to the window. Ranked by lifetime net sales.
      db.query(
        `WITH keyed AS (
           SELECT ${CUSTOMER_KEY} AS ckey, o.*, ${vat} AS vat_x
             FROM orders o WHERE o.paid_at IS NOT NULL
         ), lasts AS (
           SELECT ckey, MAX(paid_at) AS last_paid FROM keyed WHERE ckey IS NOT NULL GROUP BY ckey
         ), asleep AS (
           SELECT ckey, last_paid FROM lasts WHERE last_paid < $1
         )
         SELECT (SELECT COUNT(*)::int FROM asleep) AS total,
                k.ckey, k.currency, MIN(k.user_id) AS user_id,
                COUNT(*)::int AS orders, SUM(k.total - k.vat_x)::bigint AS net,
                MAX(a.last_paid) AS last_paid
           FROM keyed k JOIN asleep a ON a.ckey = k.ckey
          GROUP BY k.ckey, k.currency
          ORDER BY net DESC, last_paid DESC
          LIMIT ${DORMANT_TOP}`,
        [dormantBefore]
      ),
    ]);

    // Names are resolved in a second, small query only when the viewer may see
    // them, so the ranking queries never carry a name they must not return.
    const names = named ? await SalesReports._names([...fresh.rows, ...dormant.rows].map(r => r.ckey)) : null;
    const withName = r => (names ? { name: names.get(r.ckey) || null } : {});

    const f = fulfil.rows[0];
    // Every counted customer has at least one row (a new one's first order is
    // in the window; a dormant one has orders), so no rows means a count of 0.
    const totalOf = rows => (rows.length ? rows[0].total : 0);
    const newTotal = totalOf(fresh.rows);
    return {
      fulfilment: {
        count: f.n,
        medianSeconds: f.n ? Math.round(num(f.median_s)) : null,
        averageSeconds: f.n ? Math.round(num(f.avg_s)) : null,
      },
      newCustomers: {
        count: newTotal,
        top: named ? fresh.rows.map(r => customerRow({ ...r, ...withName(r) }, { first_paid: new Date(r.first_paid).toISOString() })) : undefined,
      },
      dormant: {
        days: DORMANT_DAYS,
        asOf: now.toISOString(),
        count: totalOf(dormant.rows),
        top: named ? dormant.rows.map(r => customerRow({ ...r, ...withName(r) }, { last_paid: new Date(r.last_paid).toISOString() })) : undefined,
      },
    };
  }

  // ckey → display name, from the newest order of that customer.
  static async _names(keys) {
    const uniq = [...new Set(keys.filter(Boolean))];
    const out = new Map();
    if (!uniq.length) return out;
    const { rows } = await db.query(
      `SELECT DISTINCT ON (ckey) ckey, name FROM (
         SELECT ${CUSTOMER_KEY} AS ckey, ${CUSTOMER_NAME} AS name, o.created_at
           FROM orders o LEFT JOIN users u ON u.id = o.user_id
          WHERE o.paid_at IS NOT NULL
       ) x
       WHERE ckey = ANY($1::text[])
       ORDER BY ckey, created_at DESC`,
      [uniq]
    );
    for (const r of rows) out.set(r.ckey, r.name);
    return out;
  }

  /**
   * @param {object}  o
   * @param {Date}    o.from, o.to
   * @param {boolean} o.traffic  include the sessions-by-channel block (the
   *                             viewer holds the `analytics` view)
   * @param {Date}    [o.now]
   */
  static async marketing({ from, to, traffic = false, now = new Date() }) {
    const vat = Order.vatTotalSql('o');
    const discounted = `(o.discount_code IS NOT NULL OR o.discount_amount > 0 OR COALESCE(o.shipping_discount, 0) > 0)`;
    const [sessions, sales, campaigns] = await Promise.all([
      // A session = one visitor's day (visitor_token is a daily hash, so a
      // visitor cannot be followed across days); its channel is the referrer
      // of the FIRST page it opened that day. Bots are not visitors.
      traffic ? db.query(
        `SELECT referrer_host, COUNT(*)::int AS sessions FROM (
           SELECT DISTINCT ON (visitor_token, view_date) referrer_host
             FROM page_views
            WHERE device <> 'bot' AND created_at >= $1 AND created_at < $2
            ORDER BY visitor_token, view_date, created_at ASC, id ASC
         ) s GROUP BY referrer_host`,
        [from, to]
      ) : null,
      db.query(
        `SELECT o.currency,
                COUNT(*)::int AS orders,
                COUNT(*) FILTER (WHERE ${discounted})::int AS discounted_orders,
                COALESCE(SUM(o.total - ${vat}), 0)::bigint AS net,
                COALESCE(SUM(o.total - ${vat}) FILTER (WHERE ${discounted}), 0)::bigint AS discounted_net,
                COALESCE(SUM(o.discount_amount + COALESCE(o.shipping_discount, 0)) FILTER (WHERE ${discounted}), 0)::bigint AS discount_given
           FROM orders o
          WHERE o.paid_at IS NOT NULL AND o.paid_at >= $1 AND o.paid_at < $2
          GROUP BY o.currency ORDER BY o.currency`,
        [from, to]
      ),
      // Every campaign that is live now or sold in the window. A code is
      // matched case-insensitively, as the checkout matches it.
      db.query(
        `SELECT d.id, d.code, d.title, d.enabled, d.starts_at, d.ends_at, d.used_count, d.usage_limit,
                d.value_type, d.value, d.currency AS discount_currency,
                o.currency,
                COUNT(o.id)::int AS orders,
                COALESCE(SUM(o.total - ${vat}), 0)::bigint AS net,
                COALESCE(SUM(o.discount_amount + COALESCE(o.shipping_discount, 0)), 0)::bigint AS discount_given
           FROM discounts d
           LEFT JOIN orders o
             ON LOWER(o.discount_code) = LOWER(d.code)
            AND o.paid_at IS NOT NULL AND o.paid_at >= $1 AND o.paid_at < $2
          GROUP BY d.id, o.currency`,
        [from, to]
      ),
    ]);

    const byId = new Map();
    for (const r of campaigns.rows) {
      let c = byId.get(r.id);
      if (!c) {
        const started = new Date(r.starts_at) <= now;
        const ended = r.ends_at && new Date(r.ends_at) <= now;
        const usedUp = r.usage_limit !== null && r.used_count >= r.usage_limit;
        const status = !r.enabled ? 'off' : !started ? 'scheduled' : ended ? 'ended' : usedUp ? 'used_up' : 'active';
        c = {
          code: r.code, title: r.title, status,
          value_type: r.value_type, value: r.value, currency: r.discount_currency,
          starts_at: new Date(r.starts_at).toISOString(),
          ends_at: r.ends_at ? new Date(r.ends_at).toISOString() : null,
          used_count: r.used_count, usage_limit: r.usage_limit,
          orders: 0, sales: [],
        };
        byId.set(r.id, c);
      }
      if (r.currency && r.orders > 0) {
        c.orders += r.orders;
        c.sales.push({ currency: r.currency, net: Number(r.net), discount: Number(r.discount_given) });
      }
    }
    const list = [...byId.values()]
      .filter(c => c.orders > 0 || c.status === 'active')
      .sort((a, b) => b.orders - a.orders || (a.starts_at < b.starts_at ? 1 : -1))
      .slice(0, CAMPAIGN_LIMIT);
    list.forEach(c => c.sales.sort((a, b) => a.currency.localeCompare(b.currency)));

    const out = {
      discountSales: sales.rows.map(r => ({
        currency: r.currency,
        orders: r.orders,
        discountedOrders: r.discounted_orders,
        net: Number(r.net),
        discountedNet: Number(r.discounted_net),
        discountGiven: Number(r.discount_given),
      })),
      campaigns: list,
    };
    if (sessions) out.traffic = summariseChannels(sessions.rows);
    return out;
  }
}

module.exports = SalesReports;
