// "Í dag" attention cards (harvest 2 lane 5; icelandicstore #417) against real
// Postgres. The property: the number on a card IS the row count of the list its
// link opens — orders to fulfil (?view=open), sold out (the Birgðavakt's
// ?status=out, harvest 2 lane 6a's Inventory Watch), sign-ups
// awaiting approval (?status=pending), open change requests (?status=open) —
// and a section that cannot be read keeps its row with no count, never 0.
//
// A custom role with EXPLICIT grants is used: this product hides the shop views
// from a wildcard admin (identity.surface.hiddenAdminViews), but an explicit
// grant is always shown.
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const Role = require('../../server/models/Role');
const {
  createTestAdminUser, createTestPendingGuest, getTestSessionCookie, cleanTables,
} = require('../helpers');

const HOME = '/api/v1/admin/home';
const VIEWS = ['dashboard', 'orders', 'inventory', 'users', 'feedback'];
let cookie;
let seq = 0;

async function roleUser(name, views, id) {
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system) VALUES ($1, 'lane5 attention', $2::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`,
    [name, JSON.stringify(views)]
  );
  Role.invalidateCache();
  await db.query(
    `INSERT INTO users (id, email, username, role, approval_status, email_verified)
     VALUES ($1, $2, $3, $4, 'approved', TRUE) ON CONFLICT (id) DO NOTHING`,
    [id, `${id}@test.com`, id.replace(/[^a-z]/g, ''), name]
  );
  return getTestSessionCookie(id);
}

async function order(payment, fulfillment, createdAt = 'now()') {
  seq += 1;
  await db.query(
    `INSERT INTO orders (order_number, guest_email, guest_name, currency, subtotal, shipping, total, status,
        shipping_method, payment_status, fulfillment_status, paid_at, created_at)
     VALUES ($1, 'k@test.is', 'Kaupandi', 'ISK', 1000, 0, 1000, 'paid', 'local_pickup', $2, $3,
             CASE WHEN $2 = 'pending' THEN NULL ELSE now() END, ${createdAt})`,
    [`ATT-${seq}`, payment, fulfillment]
  );
}

async function product(slug, stock, extra = {}) {
  const { rows } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, category, is_bookable, active)
     VALUES ($1, $2, '', 1000, 700, $3, $4, $5, $6) RETURNING id`,
    [slug, `Vara ${slug}`, stock, extra.category || 'product', extra.bookable === true, extra.active !== false]
  );
  return rows[0].id;
}

beforeEach(async () => {
  await cleanTables();
  await db.query(`DELETE FROM products WHERE slug LIKE 'att-%'`);
  await createTestAdminUser();
  cookie = await roleUser('lane5-attention', VIEWS, 'lane5-attention-user');
});

afterAll(async () => { await db.pool.end(); });

const card = (body, kind) => body.todo.find(i => i.kind === kind);

test('every card counts exactly the rows its link opens', async () => {
  // Orders: two to fulfil (paid + unfulfilled, partly refunded + partial), and
  // three that are not (shipped, awaiting payment, voided).
  await order('paid', 'unfulfilled', "now() - INTERVAL '3 days'");
  await order('partially_refunded', 'partial');
  await order('paid', 'fulfilled');
  await order('pending', 'unfulfilled');
  await order('voided', 'unfulfilled');
  // Stock (Inventory Watch units): out (0), in stock, an inactive product at 0,
  // a bookable service at 0, a variant product whose only active variant is at
  // 0 (that variant is out; the inactive one is not a unit).
  await product('att-out', 0);
  await product('att-in', 5);
  await product('att-inactive', 0, { active: false });
  await product('att-service', 0, { bookable: true });
  const v = await product('att-variants', 0);
  await db.query(`UPDATE products SET variant_axes = '["size"]'::jsonb WHERE id = $1`, [v]);
  await db.query(
    `INSERT INTO product_variants (product_id, sku, attributes, stock, active)
     VALUES ($1, 'ATT-V-S', '{"size":"S"}'::jsonb, 0, TRUE), ($1, 'ATT-V-M', '{"size":"M"}'::jsonb, 9, FALSE)`, [v]
  );
  // Sign-ups: two awaiting approval.
  await createTestPendingGuest({ email: 'p1@test.is', username: 'pendone' });
  await createTestPendingGuest({ email: 'p2@test.is', username: 'pendtwo' });
  // Change requests: two open items, one resolved.
  const { rows: batch } = await db.query(
    `INSERT INTO change_request_batches (item_count) VALUES (3) RETURNING id`);
  for (const status of ['open', 'open', 'resolved']) {
    await db.query(`INSERT INTO change_requests (batch_id, page_url, note, status) VALUES ($1, '/admin', 'x', $2)`,
      [batch[0].id, status]);
  }

  const res = await request(app).get(HOME).set('Cookie', cookie);
  expect(res.status).toBe(200);
  expect(res.body.errors).toBeUndefined();
  const body = res.body;

  const ship = card(body, 'orders_to_ship');
  expect(ship).toMatchObject({ count: 2, route: '/admin/shop/orders?view=open' });
  const orders = await request(app).get('/api/v1/admin/shop/orders?view=open').set('Cookie', cookie);
  expect(orders.body.total).toBe(2);
  expect(orders.body.orders).toHaveLength(2);

  const out = card(body, 'out_of_stock');
  expect(out).toMatchObject({ count: 2, route: '/admin/inventory?status=out', view: 'inventory' });
  // The page behind the link filters the watch report's items by status.
  const watch = await request(app).get('/api/v1/admin/shop/reports/inventory').set('Cookie', cookie);
  expect(watch.status).toBe(200);
  const outRows = watch.body.report.items.filter(i => i.status === 'out');
  expect(outRows).toHaveLength(2);
  expect(outRows.map(i => i.name).sort()).toEqual(['Vara att-out', 'Vara att-variants']);

  const signups = card(body, 'signups_pending');
  expect(signups).toMatchObject({ count: 2, route: '/admin/users?status=pending', view: 'users' });
  const users = await request(app).get('/api/v1/admin/users?status=pending').set('Cookie', cookie);
  expect(users.body.total).toBe(2);
  expect(users.body.users.every(u => u.approval_status === 'pending')).toBe(true);

  const cr = card(body, 'change_requests_open');
  expect(cr).toMatchObject({ count: 2, route: '/admin/feedback?status=open' });
  const crs = await request(app).get('/api/v1/admin/change-requests?status=open').set('Cookie', cookie);
  expect(crs.body.batches.flatMap(b => b.items)).toHaveLength(2);
});

test('an unknown ?view= or ?status= is ignored, not an error', async () => {
  await order('paid', 'fulfilled');
  const a = await request(app).get('/api/v1/admin/shop/orders?view=bogus').set('Cookie', cookie);
  expect(a.status).toBe(200);
  expect(a.body.total).toBe(1);
  const b = await request(app).get('/api/v1/admin/users?status=bogus').set('Cookie', cookie);
  expect(b.status).toBe(200);
});

test('a role without a card’s view never gets that card', async () => {
  await product('att-out', 0);
  await createTestPendingGuest({ email: 'p3@test.is', username: 'pendthree' });
  const narrow = await roleUser('lane5-narrow', ['dashboard', 'feedback'], 'lane5-narrow-user');
  const res = await request(app).get(HOME).set('Cookie', narrow);
  expect(res.status).toBe(200);
  const kinds = res.body.todo.map(i => i.kind);
  expect(kinds).not.toContain('out_of_stock');
  expect(kinds).not.toContain('signups_pending');
});

test('a section that cannot be read keeps its row: count null, never 0', async () => {
  await order('paid', 'unfulfilled');
  // A real failure, not a mocked pg: the change-request table is briefly away.
  await db.query('ALTER TABLE change_requests RENAME TO change_requests_lane5_away');
  let res;
  try {
    res = await request(app).get(HOME).set('Cookie', cookie);
  } finally {
    await db.query('ALTER TABLE change_requests_lane5_away RENAME TO change_requests');
  }
  expect(res.status).toBe(200);
  expect(res.body.errors).toEqual(expect.arrayContaining(['todo.change_requests_open']));
  const cr = card(res.body, 'change_requests_open');
  expect(cr).toEqual(expect.objectContaining({ failed: true, count: null, route: '/admin/feedback?status=open' }));
  // The other sections were read on their own.
  expect(card(res.body, 'orders_to_ship')).toMatchObject({ count: 1 });
});
