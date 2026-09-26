// "Í dag" — GET /api/v1/admin/home (routes/adminHomeRoutes.js,
// services/adminHome.js; D-020 step 4, 2026-09-26).
//
// The property this suite pins is invariant 8 made concrete: a block is
// COMPUTED only for a view the role holds, and a block the role cannot see is
// ABSENT from the JSON — not null, not zero. Plus: the dashboard gate, one
// failing source leaving a 200 with `errors`, the derived setup steps, and the
// sales channels with their `partial` flag and week-ago comparison.
//
// Real Postgres throughout (invariant 9). The failure case is a DATA condition
// (a tax deadline whose period is not a VSK period), never a mocked pg.
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const Role = require('../../server/models/Role');
const Bin = require('../../server/models/Bin');
const Setting = require('../../server/models/Setting');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const { buildHome } = require('../../server/services/adminHome');
const { identity } = require('../../server/config/identity');
const { disabledAdminViews } = require('../../server/config/modules');
const {
  createTestAdminUser, createTestModeratorUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

const URL = '/api/v1/admin/home';
// What an all-views holder sees on THIS instance: the product hides some admin
// views from '*' holders (identity.surface.hiddenAdminViews) and a switched-off
// module's views exist for nobody — the home follows the sidebar's rule.
const HIDDEN = new Set([...(identity.surface.hiddenAdminViews || []), ...disabledAdminViews()]);
const adminSees = id => !HIDDEN.has(id);

let adminId;
let adminCookie;
let seq = 900000;
const nextNo = () => { seq += 1; return seq; };

async function insertInvoice({
  series = 'invoice', customer = 'Hótel Heiði ehf.', total = 12400, issuedAt = 'now()',
  dueAt = "now() + INTERVAL '14 days'", createdAt = 'now()', orderId = null, paid = 0,
} = {}) {
  const net = Math.round(total / 1.24);
  const { rows } = await db.query(
    `INSERT INTO invoices (series, invoice_number, order_id, seller_name, seller_kennitala, seller_vat_number,
        customer_name, issued_at, due_at, subtotal_net, vat_total, total_gross, amount_paid, status, created_by, created_at)
     VALUES ($1, $2, $3, 'Seljandi ehf.', '1203894599', '148820', $4, ${issuedAt}, ${dueAt},
             $5, $6, $7, $8, 'issued', $9, ${createdAt})
     RETURNING id`,
    [series, nextNo(), orderId, customer, net, total - net, total, paid, adminId]
  );
  return rows[0].id;
}

async function insertOrder({
  total = 10000, paidAt = 'now()', payment = 'paid', fulfillment = 'unfulfilled', createdAt = 'now()',
  guestName = 'Anna Jónsdóttir',
} = {}) {
  const { rows } = await db.query(
    `INSERT INTO orders (order_number, guest_email, guest_name, currency, subtotal, shipping, total,
        status, shipping_method, payment_status, fulfillment_status, paid_at, created_at)
     VALUES ($1, 'anna@test.is', $2, 'ISK', $3, 0, $3, 'paid', 'flat_rate', $4, $5, ${paidAt}, ${createdAt})
     RETURNING id`,
    [`HOME-${nextNo()}`, guestName, total, payment, fulfillment]
  );
  return rows[0].id;
}

async function makeRoleUser(role, views, id) {
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system) VALUES ($1, 'adminHome test', $2::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`,
    [role, JSON.stringify(views)]
  );
  Role.invalidateCache();
  await db.query(
    `INSERT INTO users (id, email, username, role, approval_status, email_verified)
     VALUES ($1, $2, $3, $4, 'approved', TRUE) ON CONFLICT (id) DO NOTHING`,
    [id, `${id}@test.com`, id.replace(/[^a-z]/g, ''), role]
  );
  return getTestSessionCookie(id);
}

beforeEach(async () => {
  await cleanTables();
  adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  await db.query(`DELETE FROM tax_deadlines WHERE note = 'adminHome test'`);
});

afterAll(async () => {
  await db.query(`DELETE FROM tax_deadlines WHERE note = 'adminHome test'`);
});

describe('the gate', () => {
  test('signed out → 401', async () => {
    expect((await request(app).get(URL)).status).toBe(401);
  });

  test('a role without the dashboard view is refused with the error envelope', async () => {
    const cookie = await makeRoleUser('home-nodash', ['orders', 'bins'], 'home-nodash-user');
    const res = await request(app).get(URL).set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ code: 403, error: expect.any(String) }));
  });

  test('a moderator (an editor with no admin view) is refused too — the page never calls it', async () => {
    const mod = await createTestModeratorUser();
    const res = await request(app).get(URL).set('Cookie', await getTestSessionCookie(mod));
    expect(res.status).toBe(403);
  });
});

describe('an admin', () => {
  test('gets every block this instance has, with the shapes the client reads', async () => {
    // Overdue: two invoices past due; one current.
    await insertInvoice({ customer: 'Hótel Heiði ehf.', total: 50000, issuedAt: "now() - INTERVAL '60 days'", dueAt: "now() - INTERVAL '40 days'" });
    await insertInvoice({ customer: 'Kaffistofan Vík ehf.', total: 20000, issuedAt: "now() - INTERVAL '20 days'", dueAt: "now() - INTERVAL '5 days'" });
    await insertInvoice({ customer: 'Bakarí Siggu ehf.', total: 30000 });
    // A posted entry (the books are in use) and a deadline due TODAY — the
    // earliest unfiled one whatever the date (the seeded Skattadagatal rows are
    // all later, and a same-day tie orders by period: '2017-…' first).
    await ledger.withTransaction(c => ledger.postEntry(c, {
      entryDate: '2017-03-15', memo: 'adminHome test', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1100', debit: 1240 }, { accountCode: '4110', credit: 1000 }, { accountCode: '2200', credit: 240, vatRate: 24 }],
    }));
    await db.query(
      `INSERT INTO tax_deadlines (kind, period, due_on, label_is, label_en, note)
       VALUES ('vsk', '2017-P2', (now() AT TIME ZONE 'Atlantic/Reykjavik')::date, 'x', 'x', 'adminHome test')`);
    await db.query(
      `INSERT INTO leads (submission_id, name, email, message, status)
       VALUES (gen_random_uuid(), 'Hjördís Ósk', 'h@test.is', 'Heildsala fyrir nýtt kaffihús á Selfossi', 'new')`);
    const { rows: batch } = await db.query(
      `INSERT INTO change_request_batches (submitter_user_id, item_count) VALUES ($1, 1) RETURNING id`, [adminId]);
    await db.query(
      `INSERT INTO change_requests (batch_id, page_url, note) VALUES ($1, '/admin', 'Afsláttur á 3 mánaða kaffiáskrift')`,
      [batch[0].id]);
    await insertOrder({ total: 11980 });

    const res = await request(app).get(URL).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body;
    expect(body.errors).toBeUndefined();
    expect(Date.parse(body.generatedAt)).not.toBeNaN();

    const kinds = body.todo.map(i => i.kind);
    const expectKind = (kind, view) => (adminSees(view) ? expect(kinds).toContain(kind) : expect(kinds).not.toContain(kind));
    expectKind('invoices_overdue', 'ar');
    expectKind('vat_deadline', 'vat');
    expectKind('leads_new', 'leads');
    expectKind('change_requests_open', 'feedback');
    expectKind('orders_to_ship', 'orders');
    // Tone first: the overdue invoices (warn) lead.
    if (adminSees('ar')) {
      expect(body.todo[0].kind).toBe('invoices_overdue');
      const overdue = body.todo[0];
      expect(overdue).toEqual(expect.objectContaining({ view: 'ar', count: 2, amount: 70000, tone: 'warn' }));
      expect(overdue.detail.oldestParty).toBe('Hótel Heiði ehf.');
      expect(overdue.detail.oldestDays).toBeGreaterThanOrEqual(39);
      expect(body.figures.receivables).toEqual({
        outstanding: 100000, invoices: 3,
        aging: { current: 30000, days1to30: 20000, days31plus: 50000 },
        overdue: { amount: 70000, count: 2 },
      });
    }
    if (adminSees('vat')) {
      const vat = body.todo.find(i => i.kind === 'vat_deadline');
      // Due today: urgent (≤ 3 days), and the amount is the period's derived payable.
      expect(vat).toEqual(expect.objectContaining({ tone: 'warn', count: 0, amount: 240 }));
      expect(vat.detail).toEqual(expect.objectContaining({ period: '2017-P2', daysLeft: 0, from: '2017-03-01', to: '2017-04-30' }));
      expect(body.figures.vatNext).toEqual(expect.objectContaining({ period: '2017-P2', daysLeft: 0, payable: 240 }));
    }
    const lead = body.todo.find(i => i.kind === 'leads_new');
    if (lead) expect(lead.detail.latest).toBe('Heildsala fyrir nýtt kaffihús á Selfossi');
    const cr = body.todo.find(i => i.kind === 'change_requests_open');
    if (cr) expect(cr).toEqual(expect.objectContaining({ count: 1, route: '/admin/feedback' }));
    // Never a state the model does not have.
    expect(kinds).not.toContain('change_requests_awaiting');

    // Every figure key maps to a view the admin sees here.
    const figViews = { salesToday: ['orders', 'invoices', 'pos'], openOrders: ['orders'], receivables: ['ar'], vatNext: ['vat'] };
    for (const [key, views] of Object.entries(figViews)) {
      if (!views.some(adminSees)) expect(body.figures).not.toHaveProperty(key);
    }
    // The feed: newest first, at most 8, only types the admin's views allow.
    expect(body.recent.length).toBeGreaterThan(0);
    expect(body.recent.length).toBeLessThanOrEqual(8);
    const ats = body.recent.map(e => e.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    const feedView = { order_placed: 'orders', lead_received: 'leads', change_request_received: 'feedback', change_request_resolved: 'feedback', invoice_paid: 'invoices', invoice_part_paid: 'invoices' };
    for (const e of body.recent) expect(adminSees(feedView[e.type])).toBe(true);

    // Setup is an admin's, and derived: nothing is filled on a clean instance.
    expect(body).toHaveProperty('setup');
  });

  test('an all-clear instance: empty to-do list, no figures, no feed — still a 200', async () => {
    const res = await request(app).get(URL).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.todo).toEqual([]);
    // Nothing has ever been sold, invoiced or ordered: the figures wait for the first one.
    expect(res.body.figures.salesToday).toBeUndefined();
    expect(res.body.figures.openOrders).toBeUndefined();
    expect(res.body.figures.receivables).toBeUndefined();
    expect(res.body.recent).toEqual([]);
  });
});

describe('a restricted role (orders, bins, pos — the counter)', () => {
  test('gets ONLY its own blocks; everything else is absent from the JSON', async () => {
    const cookie = await makeRoleUser('home-counter', ['dashboard', 'orders', 'bins', 'pos'], 'home-counter-user');
    // Data from every source, so an absent key is absent by gate, not by emptiness.
    await insertInvoice({ customer: 'Leyndur Viðskiptavinur ehf.', total: 50000, issuedAt: "now() - INTERVAL '60 days'", dueAt: "now() - INTERVAL '40 days'" });
    await db.query(
      `INSERT INTO leads (submission_id, name, email, message, status)
       VALUES (gen_random_uuid(), 'Leynd Fyrirspurn', 'l@test.is', 'Leyndarmál', 'new')`);
    await insertOrder({ total: 11980 });
    await insertInvoice({ series: 'receipt', customer: 'Almenn sala', total: 2400, dueAt: 'now()' });
    await db.query(
      `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, active, bin)
       VALUES ('home-no-bin', 'Kólumbía Huila 1 kg', '', 5000, 30, 5, 'HOME-1', TRUE, NULL)
       ON CONFLICT (slug) DO UPDATE SET active = TRUE, bin = NULL`);

    const res = await request(app).get(URL).set('Cookie', cookie);
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.errors).toBeUndefined();

    expect(body.todo.map(i => i.kind).sort()).toEqual(['bins_unshelved', 'orders_to_ship']);
    const bins = body.todo.find(i => i.kind === 'bins_unshelved');
    expect(bins.count).toBe(await Bin.queueCount());
    expect(bins.detail.sample.length).toBeGreaterThan(0);

    expect(Object.keys(body.figures).sort()).toEqual(['openOrders', 'salesToday']);
    expect(body.figures.openOrders).toEqual({ count: 1, byState: { toShip: 1, shipped: 0, awaitingPayment: 0 } });
    const sales = body.figures.salesToday;
    // Web + till only; the instance invoices, the role cannot see invoices → partial.
    expect(sales.byChannel.map(c => c.channel)).toEqual(['web', 'pos']);
    expect(sales.partial).toBe(true);
    expect(sales.total).toBe(11980 + 2400);

    expect(body.recent.map(e => e.type)).toEqual(['order_placed']);
    // Setup is admins only: the key does not exist for this role.
    expect(body).not.toHaveProperty('setup');
    // Nothing from the books or the leads inbox left the server.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('Leyndur Viðskiptavinur');
    expect(raw).not.toContain('Leynd Fyrirspurn');
    expect(raw).not.toContain('receivables');
    expect(raw).not.toContain('vatNext');
  });
});

describe('a failing source', () => {
  test('drops its blocks, is named in errors, and the endpoint still answers 200', async () => {
    // The books are in use, and the next deadline carries a period that is not a
    // VSK period: deriving its return throws, so the VSK source fails on DATA.
    await ledger.withTransaction(c => ledger.postEntry(c, {
      entryDate: '2017-03-15', memo: 'adminHome test', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1100', debit: 1240 }, { accountCode: '4110', credit: 1000 }, { accountCode: '2200', credit: 240, vatRate: 24 }],
    }));
    await db.query(
      `INSERT INTO tax_deadlines (kind, period, due_on, label_is, label_en, note)
       VALUES ('vsk', '0000-P0', (now() AT TIME ZONE 'Atlantic/Reykjavik')::date, 'x', 'x', 'adminHome test')`);
    await insertInvoice({ customer: 'Hótel Heiði ehf.', total: 50000, issuedAt: "now() - INTERVAL '60 days'", dueAt: "now() - INTERVAL '40 days'" });

    // A role holding exactly the two books views, so the test does not depend on
    // what this product hides from an admin.
    const cookie = await makeRoleUser('home-books', ['dashboard', 'ar', 'vat'], 'home-books-user');
    const res = await request(app).get(URL).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual(['todo.vat_deadline', 'figures.vatNext']);
    expect(res.body.figures.vatNext).toBeUndefined();
    expect(res.body.todo.map(i => i.kind)).toEqual(['invoices_overdue']);
    expect(res.body.figures.receivables.outstanding).toBe(50000);
  });
});

describe('Fyrstu skrefin (setup)', () => {
  // The steps that exist for an admin here: each needs the screen it links to.
  const expected = [
    adminSees('general') && 'company',
    adminSees('products') && 'product',
    adminSees('books') && 'seller',
    adminSees('users') && 'staff',
    'twoStep',
  ].filter(Boolean);

  async function clearSettings() {
    for (const k of ['general.contact_email', 'general.address1', 'general.city',
      'books.seller_name', 'books.seller_kennitala', 'books.seller_vat_number']) {
      await Setting.set(k, '');
    }
  }

  test('steps are derived from the instance and the viewer, and setup is null once all are done', async () => {
    await clearSettings();
    let res = await request(app).get(URL).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.setup.steps.map(s => s.key)).toEqual(expected);
    expect(res.body.setup.total).toBe(expected.length);
    expect(res.body.setup.steps.every(s => typeof s.route === 'string' && s.route.startsWith('/'))).toBe(true);
    const doneNow = res.body.setup.steps.filter(s => s.done).map(s => s.key);
    expect(doneNow).not.toContain('company');
    expect(doneNow).not.toContain('staff');
    expect(doneNow).not.toContain('twoStep');
    expect(res.body.setup.done).toBe(doneNow.length);

    // Fill every step.
    await Setting.set('general.contact_email', 'info@test.is');
    await Setting.set('general.address1', 'Strandgata 1');
    await Setting.set('general.city', 'Hafnarfjörður');
    await Setting.updateBookkeepingSettings({
      seller_name: 'Seljandi ehf.', seller_kennitala: '1203894599', seller_vat_number: '148820',
    });
    await createTestModeratorUser(); // a second staff account
    await db.query(
      `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku)
       VALUES ('home-setup-product', 'Vara', '', 1000, 7, 1, 'HOME-SETUP') ON CONFLICT (slug) DO NOTHING`);

    res = await request(app).get(URL).set('Cookie', adminCookie);
    const pending = res.body.setup.steps.filter(s => !s.done).map(s => s.key);
    expect(pending).toEqual(['twoStep']); // the viewer's own step, until they enrol

    await db.query('UPDATE users SET totp_enabled = TRUE WHERE id = $1', [adminId]);
    res = await request(app).get(URL).set('Cookie', adminCookie);
    expect(res.body.setup).toBeNull();
  });

  test('a customer account does not count as staff', async () => {
    await db.query(
      `INSERT INTO users (id, email, username, role, approval_status, email_verified)
       VALUES ('home-customer', 'c@test.is', 'homecustomer', 'user', 'approved', TRUE)`);
    const res = await request(app).get(URL).set('Cookie', adminCookie);
    const staff = res.body.setup && res.body.setup.steps.find(s => s.key === 'staff');
    if (adminSees('users')) expect(staff.done).toBe(false);
  });
});

describe('salesToday (service level, fixed clock)', () => {
  // A fixed "now" far from any other suite's rows: 12:00 on a Wednesday.
  const NOW = new Date('2031-03-12T12:00:00Z');
  const at = (iso) => `'${iso}'::timestamptz`;
  const ALL3 = id => ['orders', 'invoices', 'pos'].includes(id);

  test('absent until the first sale; then web + wholesale + till, compared with the same time a week ago', async () => {
    let home = await buildHome({ can: ALL3, userId: adminId, now: NOW });
    expect(home.figures.salesToday).toBeUndefined();

    // Web: today before now (counts), later today (not yet), a week ago before
    // and after the same time, yesterday.
    await insertOrder({ total: 10000, paidAt: at('2031-03-12T11:00:00Z') });
    await insertOrder({ total: 777, paidAt: at('2031-03-12T13:00:00Z') });
    await insertOrder({ total: 4000, paidAt: at('2031-03-05T11:00:00Z'), fulfillment: 'fulfilled' });
    await insertOrder({ total: 999, paidAt: at('2031-03-05T13:00:00Z'), fulfillment: 'fulfilled' });
    await insertOrder({ total: 555, paidAt: at('2031-03-11T11:00:00Z'), fulfillment: 'fulfilled' });
    // Wholesale: issued today, not from an order (counts) — and one born from an order (never wholesale).
    await insertInvoice({ total: 5000, issuedAt: at('2031-03-12T00:00:00Z'), dueAt: at('2031-03-26T00:00:00Z'), createdAt: at('2031-03-12T09:00:00Z') });
    const orderId = await insertOrder({ total: 8888, paidAt: at('2031-03-01T10:00:00Z'), fulfillment: 'fulfilled' });
    await insertInvoice({ total: 8888, orderId, issuedAt: at('2031-03-12T00:00:00Z'), dueAt: at('2031-03-12T00:00:00Z'), createdAt: at('2031-03-12T09:30:00Z') });
    // Till: rung up today.
    await insertInvoice({ series: 'receipt', total: 2000, issuedAt: at('2031-03-12T00:00:00Z'), dueAt: at('2031-03-12T00:00:00Z'), createdAt: at('2031-03-12T11:30:00Z') });

    home = await buildHome({ can: ALL3, userId: adminId, now: NOW });
    const s = home.figures.salesToday;
    expect(s.byChannel).toEqual([
      { channel: 'web', amount: 10000, count: 1 },
      { channel: 'wholesale', amount: 5000, count: 1 },
      { channel: 'pos', amount: 2000, count: 1 },
    ]);
    expect(s.total).toBe(17000);
    expect(s.partial).toBe(false);
    expect(s.asOf).toBe(NOW.toISOString());
    expect(s.compare).toEqual({ basis: 'same_weekday_last_week_same_time', total: 4000 });

    // The role lacks invoices, the instance has them: wholesale omitted, never zeroed, partial.
    const noInvoices = id => ['orders', 'pos'].includes(id);
    home = await buildHome({ can: noInvoices, userId: adminId, now: NOW });
    expect(home.figures.salesToday.byChannel.map(c => c.channel)).toEqual(['web', 'pos']);
    expect(home.figures.salesToday.total).toBe(12000);
    expect(home.figures.salesToday.partial).toBe(true);

    // The INSTANCE lacks invoices (a switched-off module): omitted, and not partial.
    home = await buildHome({ can: noInvoices, instanceLacks: id => id === 'invoices', userId: adminId, now: NOW });
    expect(home.figures.salesToday.partial).toBe(false);

    // No channel view at all: no sales figure.
    home = await buildHome({ can: id => id === 'bins', userId: adminId, now: NOW });
    expect(home.figures).not.toHaveProperty('salesToday');
  });
});
