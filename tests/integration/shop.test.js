'use strict';

/**
 * Public shop API — GET /api/v1/shop/products.
 *
 * Focused on the shop-redesign step 2 ?category= filter. Seeds three rows
 * (one per top-level category) directly via the Product model so the test
 * doesn't need an admin session, and inactivates them at the end so other
 * suites that read products see the table state they expect.
 */

const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const Order   = require('../../server/models/Order');
const { sendBookingNotification } = require('../../server/services/emailService');

const TEST_SLUGS = [
  'shop-filter-test-physical',
  'shop-filter-test-tech',
  'shop-filter-test-carpentry',
];

async function clearTestProducts() {
  // Hard-delete the rows we seeded by slug so the suite is fully self-contained
  // and re-runs don't accumulate state.
  await db.query(
    `DELETE FROM products WHERE slug = ANY($1::text[])`,
    [TEST_SLUGS]
  );
}

describe('GET /api/v1/shop/products — ?category= filter (shop redesign step 2)', () => {
  beforeAll(async () => {
    await clearTestProducts();
    await Product.create({
      slug: TEST_SLUGS[0], name: 'Physical Test',
      price_isk: 1000, price_eur: 700,
      category: 'product', subcategory: 'apparel',
    });
    await Product.create({
      slug: TEST_SLUGS[1], name: 'Tech Test',
      price_isk: 50000, price_eur: 36000,
      category: 'tech_service', duration_minutes: 60, delivery_format: 'remote', is_bookable: true,
    });
    await Product.create({
      slug: TEST_SLUGS[2], name: 'Carpentry Test',
      price_isk: 80000, price_eur: 57000,
      category: 'carpentry_service', duration_minutes: 120, is_bookable: true,
    });
  });

  afterAll(async () => {
    await clearTestProducts();
  });

  test('no filter returns all three seeded products (and possibly others)', async () => {
    const res = await request(app).get('/api/v1/shop/products');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.products)).toBe(true);
    const slugs = res.body.products.map(p => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(TEST_SLUGS));
  });

  test('?category=product returns only physical-goods rows', async () => {
    const res = await request(app).get('/api/v1/shop/products?category=product');
    expect(res.status).toBe(200);
    const slugs = res.body.products.map(p => p.slug);
    expect(slugs).toContain(TEST_SLUGS[0]);
    expect(slugs).not.toContain(TEST_SLUGS[1]);
    expect(slugs).not.toContain(TEST_SLUGS[2]);
    // Every returned row must carry the requested category.
    for (const p of res.body.products) expect(p.category).toBe('product');
  });

  test('?category=tech_service returns only tech-service rows + their service fields', async () => {
    const res = await request(app).get('/api/v1/shop/products?category=tech_service');
    expect(res.status).toBe(200);
    const slugs = res.body.products.map(p => p.slug);
    expect(slugs).toContain(TEST_SLUGS[1]);
    expect(slugs).not.toContain(TEST_SLUGS[0]);
    const tech = res.body.products.find(p => p.slug === TEST_SLUGS[1]);
    expect(tech).toMatchObject({
      category: 'tech_service',
      duration_minutes: 60,
      delivery_format: 'remote',
      is_bookable: true,
    });
  });

  test('?category=carpentry_service returns only carpentry rows', async () => {
    const res = await request(app).get('/api/v1/shop/products?category=carpentry_service');
    expect(res.status).toBe(200);
    const slugs = res.body.products.map(p => p.slug);
    expect(slugs).toContain(TEST_SLUGS[2]);
    expect(slugs).not.toContain(TEST_SLUGS[0]);
    expect(slugs).not.toContain(TEST_SLUGS[1]);
  });

  test('?category=garbage returns 400 with a descriptive error (no raw DB error leak)', async () => {
    const res = await request(app).get('/api/v1/shop/products?category=garbage');
    expect(res.status).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({
      error: expect.stringMatching(/category must be one of/),
      code: 400,
    }));
  });
});

// ─── Shop redesign step 5 — booking flow plumbing ────────────────────────────
// is_bookable on order_items, returned via the JOIN in Order.listItems.
// The webhook handler (handleCheckoutCompleted) reads that flag to decide
// whether to skip stock decrement and whether to fire the admin notification.
// Tested directly at the model + email-service layer since fully simulating
// a Stripe webhook event is heavier than the bug surface this protects.

describe('Order.listItems — is_bookable flag (shop redesign step 5)', () => {
  // Two products: one stock-tracked physical, one bookable service.
  const BOOK_SLUGS = ['booking-test-physical', 'booking-test-service'];
  let physicalId, serviceId, orderId;

  beforeAll(async () => {
    await db.query(`DELETE FROM products WHERE slug = ANY($1::text[])`, [BOOK_SLUGS]);
    const physical = await Product.create({
      slug: BOOK_SLUGS[0], name: 'Booking Test Hoodie',
      price_isk: 4000, price_eur: 2800,
      category: 'product', stock: 10,
    });
    const service = await Product.create({
      slug: BOOK_SLUGS[1], name: 'Booking Test Consultation',
      price_isk: 60000, price_eur: 43000,
      category: 'tech_service', duration_minutes: 60,
      delivery_format: 'remote', is_bookable: true,
    });
    physicalId = physical.id;
    serviceId  = service.id;

    const order = await Order.createWithItems({
      guestEmail: 'booking-test@example.com',
      guestName:  'Booking Test',
      currency: 'ISK',
      shippingMethod: 'local_pickup',
      shippingAddress: null,
      shipping: 0,
      items: [
        { productId: physicalId, name: 'Booking Test Hoodie',       price: 4000,  quantity: 1 },
        { productId: serviceId,  name: 'Booking Test Consultation', price: 60000, quantity: 1 },
      ],
    });
    orderId = order.id;
  });

  afterAll(async () => {
    // CASCADE on order_items.order_id → no need to delete items manually.
    await db.query(`DELETE FROM orders   WHERE id   = $1`, [orderId]);
    await db.query(`DELETE FROM products WHERE slug = ANY($1::text[])`, [BOOK_SLUGS]);
  });

  test('exposes is_bookable from the products JOIN on every row', async () => {
    const items = await Order.listItems(orderId);
    expect(items).toHaveLength(2);
    const byProductId = Object.fromEntries(items.map(it => [it.product_id, it]));
    expect(byProductId[physicalId].is_bookable).toBe(false);
    expect(byProductId[serviceId].is_bookable).toBe(true);
  });

  test('preserves the snapshot columns alongside the joined flag', async () => {
    const items = await Order.listItems(orderId);
    for (const it of items) {
      expect(it).toEqual(expect.objectContaining({
        product_name_snapshot:  expect.any(String),
        product_price_snapshot: expect.any(Number),
        quantity: expect.any(Number),
        is_bookable: expect.any(Boolean),
      }));
    }
  });
});

// ─── Admin-side guards added during PR review ───────────────────────────────
// Two should-fix items the review flagged: product slugs that collide with
// the section sub-routes (so they'd be unreachable) must be rejected, and
// the free-text subcategory column needs a server-side length cap to mirror
// the admin form's maxlength="60". Both happen at the controller layer.

describe('POST /api/v1/admin/shop/products — reserved slugs + subcategory length', () => {
  // Reuse the existing admin session helper from the shared test harness so
  // we don't duplicate role-setup machinery.
  const helpers = require('../helpers');
  let adminCookie;

  beforeAll(async () => {
    await helpers.cleanTables();
    adminCookie = await helpers.getTestSessionCookie();
  });

  afterAll(async () => {
    // Remove anything this block created so other suites aren't tripped up.
    await db.query(`DELETE FROM products WHERE slug LIKE 'reserved-slug-test-%'`);
  });

  const baseBody = () => ({
    name: 'Reserved Slug Test',
    description: '',
    price_isk: 1000,
    price_eur: 700,
    stock: 0,
  });

  for (const reserved of ['products', 'tech', 'carpentry']) {
    test(`rejects slug='${reserved}' with a section-collision error`, async () => {
      const res = await request(app)
        .post('/api/v1/admin/shop/products')
        .set('Cookie', adminCookie)
        .send({ ...baseBody(), slug: reserved });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/reserved for the \/shop\//);
    });
  }

  test('accepts a normal slug (sanity check the reservation does not over-match)', async () => {
    const res = await request(app)
      .post('/api/v1/admin/shop/products')
      .set('Cookie', adminCookie)
      .send({ ...baseBody(), slug: 'reserved-slug-test-product' });
    expect(res.status).toBe(201);
  });

  test('rejects subcategory longer than 60 characters', async () => {
    const res = await request(app)
      .post('/api/v1/admin/shop/products')
      .set('Cookie', adminCookie)
      .send({
        ...baseBody(),
        slug: 'reserved-slug-test-long-sub',
        subcategory: 'x'.repeat(61),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subcategory must be 60 characters or fewer/);
  });

  test('accepts subcategory at exactly 60 characters (boundary)', async () => {
    const res = await request(app)
      .post('/api/v1/admin/shop/products')
      .set('Cookie', adminCookie)
      .send({
        ...baseBody(),
        slug: 'reserved-slug-test-boundary',
        subcategory: 'x'.repeat(60),
      });
    expect(res.status).toBe(201);
  });
});

describe('sendBookingNotification — guard rails (shop redesign step 5)', () => {
  // Resend is unconfigured under jest env (no RESEND_API_KEY), so the function
  // logs and returns rather than dispatching mail. We assert it never throws
  // for either of the early-return inputs so the webhook handler can call it
  // unconditionally inside Promise.allSettled.

  const fakeOrder = {
    order_number: 'TEST-0001',
    currency: 'ISK',
    total: 60000,
    guest_email: 'buyer@example.com',
    guest_name:  'Buyer',
  };
  const fakeItems = [{
    product_name_snapshot: 'Booking Test Consultation',
    product_price_snapshot: 60000,
    quantity: 1,
    is_bookable: true,
  }];

  test('returns silently when no admin recipients are supplied', async () => {
    await expect(sendBookingNotification({
      order: fakeOrder, bookableItems: fakeItems, adminEmails: [],
    })).resolves.toBeUndefined();
  });

  test('returns silently when bookableItems is empty', async () => {
    await expect(sendBookingNotification({
      order: fakeOrder, bookableItems: [], adminEmails: ['admin@example.com'],
    })).resolves.toBeUndefined();
  });

  test('returns silently when Resend is not configured (test env default)', async () => {
    // Both required inputs present, but RESEND_API_KEY is unset in tests,
    // so the function must log + return rather than crash.
    await expect(sendBookingNotification({
      order: fakeOrder, bookableItems: fakeItems, adminEmails: ['admin@example.com'],
    })).resolves.toBeUndefined();
  });
});
