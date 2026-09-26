// GET /api/v1/admin/shop/reports (+ /insights, /marketing) — the sales report
// with period presets, a comparison window and net sales (harvest 2 lane 5;
// icelandicstore #414/#419 onto the engine's paid_at, per-currency semantics).
// Real Postgres throughout (invariant 9).
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const Role = require('../../server/models/Role');
const { t } = require('../../server/i18n');
const {
  createTestAdminUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

const URL = '/api/v1/admin/shop/reports';
let adminCookie;
let seq = 0;
let productId;

async function seedOrder({
  total = 12400, vat = 2400, currency = 'ISK', paidAt = 'now()', qty = 1, name = 'Borð',
  email = 'kaupandi@example.is', userId = null, discountCode = null, discount = 0,
  fulfilledAt = null, createdAt = null,
} = {}) {
  seq += 1;
  const { rows } = await db.query(
    `INSERT INTO orders (order_number, user_id, guest_email, guest_name, currency, subtotal, shipping, total,
        status, shipping_method, payment_status, fulfillment_status, paid_at, fulfilled_at, vat_total,
        discount_code, discount_amount, created_at)
     VALUES ($1, $2, $3, 'Kaupandi', $4, $5, 0, $5, 'paid', 'local_pickup', 'paid',
             ${fulfilledAt ? "'fulfilled'" : "'unfulfilled'"}, ${paidAt}, ${fulfilledAt || 'NULL'}, $6, $7, $8,
             ${createdAt || paidAt || 'now()'})
     RETURNING id`,
    [`REP-${seq}`, userId, userId ? null : email, currency, total, vat, discountCode, discount]
  );
  await db.query(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_price_snapshot, quantity, currency, vat_rate)
     VALUES ($1, $2, $3, $4, $5, $6, 24)`,
    [rows[0].id, productId, name, Math.round(total / qty), qty, currency]
  );
  return rows[0].id;
}

beforeEach(async () => {
  await cleanTables();
  const adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  const { rows } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, vat_rate)
     VALUES ('report-table', 'Borð', '', 12400, 8900, 10, 24)
     ON CONFLICT (slug) DO UPDATE SET vat_rate = 24 RETURNING id`
  );
  productId = rows[0].id;
});

afterAll(async () => { await db.pool.end(); });

const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const cur = (report, c = 'ISK') => report.kpis.byCurrency.find(x => x.currency === c);

describe('the previous release’s call shape', () => {
  test('?days= answers the trailing window with the legacy keys', async () => {
    await seedOrder({ total: 12400, vat: 2400 });
    await seedOrder({ total: 8900, vat: 1723, currency: 'EUR' });
    await seedOrder({ total: 5000, vat: 968, paidAt: "now() - INTERVAL '40 days'" });
    const res = await request(app).get(`${URL}?days=30`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const r = res.body.report;
    expect(r.days).toBe(30);
    expect(r.orders).toBe(2);
    expect(r.revenueByCurrency).toEqual([
      { currency: 'EUR', orders: 1, revenue: 8900 },
      { currency: 'ISK', orders: 1, revenue: 12400 },
    ]);
    expect(r.byDay.reduce((s, d) => s + d.orders, 0)).toBe(2);
    expect(r.topProducts[0]).toEqual({ name: 'Borð', qty: 2 });
  });

  test('no parameters at all is the trailing 30 days, as before', async () => {
    const res = await request(app).get(URL).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.report.days).toBe(30);
  });
});

describe('the windowed report', () => {
  test('net sales per currency, gross kept, never summed across currencies', async () => {
    await seedOrder({ total: 12400, vat: 2400 });
    await seedOrder({ total: 4990, vat: 494 });
    await seedOrder({ total: 8900, vat: 1723, currency: 'EUR' });
    // Not paid → not a sale.
    await seedOrder({ total: 99999, vat: 0, paidAt: 'NULL', createdAt: 'now()' });

    const res = await request(app).get(`${URL}?from=${day(3)}&to=${day(-1)}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const r = res.body.report;
    expect(r.kpis.orders).toBe(3);
    expect(cur(r)).toMatchObject({
      orders: 2, revenue: 17390, vat: 2894, revenue_net: 14496,
      avg_order_value: 8695, avg_order_value_net: 7248,
    });
    expect(cur(r, 'EUR')).toMatchObject({ orders: 1, revenue: 8900, revenue_net: 7177 });
    expect(r.series.filter(p => p.currency === 'ISK').reduce((s, p) => s + p.revenue_net, 0)).toBe(14496);
    expect(r).not.toHaveProperty('kpisPrev');
  });

  test('an order with no snapshot (the previous release, mid-swap) falls back to the approximation', async () => {
    const id = await seedOrder({ total: 12400, vat: 0 });
    await db.query('UPDATE orders SET vat_total = NULL WHERE id = $1', [id]);
    await db.query('UPDATE order_items SET vat_rate = NULL WHERE order_id = $1', [id]);
    const res = await request(app).get(`${URL}?from=${day(1)}&to=${day(-1)}`).set('Cookie', adminCookie);
    expect(cur(res.body.report)).toMatchObject({ revenue: 12400, vat: 2400, revenue_net: 10000 });
  });

  test('compare_from/compare_to add the comparison window as kpisPrev', async () => {
    await seedOrder({ total: 1240, vat: 240, paidAt: "now() - INTERVAL '1 day'" });
    await seedOrder({ total: 620, vat: 120, paidAt: "now() - INTERVAL '10 days'" });
    await seedOrder({ total: 620, vat: 120, paidAt: "now() - INTERVAL '12 days'" });
    const res = await request(app)
      .get(`${URL}?from=${day(5)}&to=${day(-1)}&compare_from=${day(15)}&compare_to=${day(5)}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(cur(res.body.report)).toMatchObject({ orders: 1, revenue_net: 1000 });
    expect(res.body.report.kpisPrev.orders).toBe(2);
    expect(cur({ kpis: res.body.report.kpisPrev })).toMatchObject({ orders: 2, revenue_net: 1000 });
  });

  test('buckets are cut on the shop clock: hour keys, and a week starts on Monday', async () => {
    const a = await seedOrder({ total: 124, vat: 24 });
    const b = await seedOrder({ total: 248, vat: 48 });
    await db.query(`UPDATE orders SET paid_at = '2026-09-22T09:15:00Z' WHERE id = $1`, [a]);
    await db.query(`UPDATE orders SET paid_at = '2026-09-22T14:40:00Z' WHERE id = $1`, [b]);
    const hourly = await request(app).get(`${URL}?from=2026-09-22&to=2026-09-23`).set('Cookie', adminCookie);
    expect(hourly.body.report.bucket).toBe('hour');
    expect(hourly.body.report.series.map(p => [p.day, p.revenue_net])).toEqual([
      ['2026-09-22T09', 100], ['2026-09-22T14', 200],
    ]);
    const weekly = await request(app).get(`${URL}?from=2026-07-01&to=2026-10-01&bucket=week`).set('Cookie', adminCookie);
    // Tuesday 22 Sept 2026 is in the week of Monday 21 Sept.
    expect(weekly.body.report.series.map(p => [p.day, p.orders])).toEqual([['2026-09-21', 2]]);
    const monthly = await request(app).get(`${URL}?from=2025-10-01&to=2026-10-01`).set('Cookie', adminCookie);
    expect(monthly.body.report.bucket).toBe('month');
    expect(monthly.body.report.series.map(p => p.day)).toEqual(['2026-09-01']);
  });

  test('400 in the envelope for an empty, backwards or unparsable window — either one', async () => {
    for (const qs of [
      'from=2026-09-10&to=2026-09-10',
      'from=2026-09-10&to=2026-09-01',
      'from=nope&to=2026-09-01',
      'from=2026-09-01&to=2026-09-10&compare_from=2026-08-10&compare_to=2026-08-01',
      'from=2026-09-01&to=2026-09-10&compare_from=2026-08-01',
    ]) {
      const res = await request(app).get(`${URL}?${qs}`).set('Cookie', adminCookie);
      expect(res.status).toBe(400);
      // Localised: the admin's own locale picks which of the two.
      expect(res.body).toEqual({ error: expect.any(String), code: 400 });
      expect(['en', 'is'].map(l => t(l, 'errors.admin.invalidDateRange'))).toContain(res.body.error);
    }
  });
});

describe('insights', () => {
  test('fulfilment time, new and dormant customers', async () => {
    // Fulfilled in the window: 2 h and 6 h after payment → median 4 h.
    await seedOrder({ paidAt: "now() - INTERVAL '2 days'", fulfilledAt: "now() - INTERVAL '2 days' + INTERVAL '2 hours'", email: 'a@example.is' });
    await seedOrder({ paidAt: "now() - INTERVAL '3 days'", fulfilledAt: "now() - INTERVAL '3 days' + INTERVAL '6 hours'", email: 'b@example.is' });
    // b ordered before the window too → not new. a is new.
    await seedOrder({ paidAt: "now() - INTERVAL '50 days'", email: 'B@example.is' });
    // c: last order 120 days ago → dormant.
    await seedOrder({ total: 24800, vat: 4800, paidAt: "now() - INTERVAL '120 days'", email: 'c@example.is' });

    const res = await request(app).get(`${URL}/insights?from=${day(7)}&to=${day(-1)}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const i = res.body.insights;
    expect(i.fulfilment).toEqual({ count: 2, medianSeconds: 4 * 3600, averageSeconds: 4 * 3600 });
    expect(i.newCustomers.count).toBe(1);
    expect(i.newCustomers.top).toHaveLength(1);
    expect(i.newCustomers.top[0]).toMatchObject({ name: 'Kaupandi', orders: 1, net: 10000, currency: 'ISK' });
    expect(i.dormant).toMatchObject({ days: 90, count: 1 });
    expect(i.dormant.top[0]).toMatchObject({ net: 20000, orders: 1 });
  });

  test('a sales-only role gets the counts but no customer names', async () => {
    await seedOrder({ email: 'a@example.is' });
    await db.query(
      `INSERT INTO roles (name, description, view_access, is_system) VALUES ('sales-only', 'lane5 test', '["sales"]'::jsonb, FALSE)
       ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`
    );
    Role.invalidateCache();
    await db.query(
      `INSERT INTO users (id, email, username, role, approval_status, email_verified)
       VALUES ('sales-only-user', 'so@test.com', 'salesonly', 'sales-only', 'approved', TRUE) ON CONFLICT (id) DO NOTHING`
    );
    const cookie = await getTestSessionCookie('sales-only-user');
    const res = await request(app).get(`${URL}/insights?from=${day(7)}&to=${day(-1)}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.insights.newCustomers.count).toBe(1);
    expect(res.body.insights.newCustomers).not.toHaveProperty('top');
    expect(res.body.insights.dormant).not.toHaveProperty('top');
    const m = await request(app).get(`${URL}/marketing?from=${day(7)}&to=${day(-1)}`).set('Cookie', cookie);
    expect(m.status).toBe(200);
    expect(m.body.marketing).not.toHaveProperty('traffic');
  });

  test('gated like the report: 401 signed out, 400 on a bad window', async () => {
    expect((await request(app).get(`${URL}/insights`)).status).toBe(401);
    expect((await request(app).get(`${URL}/marketing`)).status).toBe(401);
    const bad = await request(app).get(`${URL}/insights?from=2026-09-10&to=2026-09-01`).set('Cookie', adminCookie);
    expect(bad.status).toBe(400);
  });
});

describe('marketing', () => {
  test('sessions by channel, discounted sales, campaigns', async () => {
    const pv = (token, host, minutes) => db.query(
      `INSERT INTO page_views (path, referrer_host, device, visitor_token, created_at)
       VALUES ('/', $1, 'desktop', $2, now() - ($3 || ' minutes')::interval)`, [host, token, String(minutes)]
    );
    await pv('v1', 'www.google.is', 30);
    await pv('v1', 'internal', 20);          // same visitor-day: still one Search session
    await pv('v2', null, 10);                 // Direct
    await pv('v3', 'l.facebook.com', 10);     // Social
    await pv('v4', 'mail.google.com', 10);    // Email
    await pv('v5', 'blogg.example.is', 10);   // Referral
    await db.query(`INSERT INTO page_views (path, device, visitor_token) VALUES ('/', 'bot', 'b1')`);

    await db.query(
      `INSERT INTO discounts (code, title, value_type, value) VALUES ('HAUST', 'Haustútsala', 'percentage', 10)
       ON CONFLICT DO NOTHING`
    );
    await seedOrder({ total: 11160, vat: 2160, discountCode: 'haust', discount: 1240 });
    await seedOrder({ total: 12400, vat: 2400 });

    const res = await request(app).get(`${URL}/marketing?from=${day(1)}&to=${day(-1)}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const m = res.body.marketing;
    const sessions = Object.fromEntries(m.traffic.channels.map(c => [c.channel, c.sessions]));
    expect(sessions).toEqual({ direct: 1, search: 1, social: 1, email: 1, referral: 1 });
    expect(m.traffic.total).toBe(5);
    expect(m.traffic.topReferrers).toEqual([{ host: 'blogg.example.is', sessions: 1 }]);
    expect(m.discountSales).toEqual([{
      currency: 'ISK', orders: 2, discountedOrders: 1, net: 19000, discountedNet: 9000, discountGiven: 1240,
    }]);
    expect(m.campaigns).toHaveLength(1);
    expect(m.campaigns[0]).toMatchObject({
      code: 'HAUST', status: 'active', orders: 1, sales: [{ currency: 'ISK', net: 9000, discount: 1240 }],
    });
  });
});
