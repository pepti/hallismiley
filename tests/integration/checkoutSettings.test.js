'use strict';

/**
 * Checkout settings (harvest2-lane7a-2026-09-26; ported from icelandicstore
 * #151). Two halves:
 *   1. the admin API (Admin → Greiðsla): who may read and write, the
 *      validation, all-or-nothing saves, CSRF, and what reaches the public
 *      /shop/config (never the owner alert list);
 *   2. ENFORCEMENT on the order path, verify-by-writing: the pause answers 503
 *      before any order row exists, the minimum reads the DB-trusted subtotal
 *      after discounts (in ISK, whatever the currency), the delivery price is
 *      the setting (env until saved) with the free-over threshold, the field
 *      rules drop hidden values and refuse missing required ones, and the
 *      owner alert fires where the order becomes paid without ever holding up
 *      or failing the Stripe webhook.
 * Stripe is stubbed at the service boundary (no network); Postgres is real.
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const Order   = require('../../server/models/Order');
const Discount = require('../../server/models/Discount');
const Setting = require('../../server/models/Setting');
const Role    = require('../../server/models/Role');
const stripeService = require('../../server/services/stripeService');
const emailService  = require('../../server/services/emailService');
const { tx } = require('../lib/locale');
const { t } = require('../../server/i18n');
const {
  getTestSessionCookie, cleanTables, createTestAdminUser, createTestRegularUser,
} = require('../helpers');

const BASE = '/api/v1/admin/checkout-settings';
const SLUG = 'l7a-co-';
const GUEST = 'l7a-guest@example.com';
let adminCookie, adminId, userCookie, checkoutRoleCookie, generalRoleCookie;
let mug; // 2000 kr. / 14.00 €

async function roleUser(name, views) {
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system)
     VALUES ($1, 'l7a test role', $2::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`,
    [name, JSON.stringify(views)]
  );
  Role.invalidateCache();
  const id = `l7a-${name}`;
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ($1, $2, $3, (SELECT password_hash FROM users WHERE id = $4), $5, TRUE)`,
    [id, `${name}@l7a.test`, name, adminId, name]
  );
  return getTestSessionCookie(id);
}

async function clearCheckoutSettings() {
  await db.query(`DELETE FROM app_settings WHERE key LIKE 'checkout.%' OR key LIKE 'shipping.%'`);
}
// Write settings the way the controller does (validate both groups, one transaction).
async function save({ shipping, ...checkoutPatch }) {
  await Setting.applyWrites([
    ...(await Setting.collectCheckoutWrites(checkoutPatch)),
    ...(shipping ? Setting.collectShippingWrites(shipping) : []),
  ]);
}

async function ordersFor(email = GUEST) {
  const { rows } = await db.query(
    `SELECT order_number, subtotal, shipping, total, discount_amount, shipping_address, notes, currency
       FROM orders WHERE guest_email = $1 ORDER BY created_at`, [email]);
  return rows;
}

const address = (extra = {}) => ({ name: 'Jón', line1: 'Gata 1', city: 'Reykjavík', postal: '101', country: 'IS', ...extra });
const checkout = (extra = {}, { locale } = {}) => {
  const r = request(app).post('/api/v1/shop/checkout');
  if (locale) r.set('X-Locale', locale);
  return r.send({
    items: [{ productId: mug.id, quantity: 1 }], currency: 'ISK', shipping_method: 'local_pickup',
    guest_email: GUEST, guest_name: 'L7A Guest', ...extra,
  });
};

let savedKey, sessionSpy;
beforeAll(async () => {
  await cleanTables();
  await clearCheckoutSettings();
  adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  userCookie = await getTestSessionCookie(await createTestRegularUser());
  checkoutRoleCookie = await roleUser('l7acheckout', ['checkout']);
  generalRoleCookie = await roleUser('l7ageneral', ['general']);
  await db.query(`DELETE FROM products WHERE slug LIKE '${SLUG}%'`);
  mug = await Product.create({ slug: `${SLUG}mug`, name: 'L7A Mug', price_isk: 2000, price_eur: 1400, category: 'product', stock: 500 });
});
beforeEach(() => {
  savedKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_l7a_stub';
  let n = 0;
  sessionSpy = jest.spyOn(stripeService, 'createCheckoutSession')
    .mockImplementation(async () => ({ id: `cs_test_l7a_${Date.now()}_${n++}`, url: 'https://checkout.stripe.test/l7a' }));
});
afterEach(async () => {
  sessionSpy.mockRestore();
  if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedKey;
  await clearCheckoutSettings();
});
afterAll(async () => {
  await db.query(`DELETE FROM orders WHERE guest_email = $1`, [GUEST]);
  await db.query(`DELETE FROM discounts WHERE code LIKE 'L7A%'`);
  await db.query(`DELETE FROM products WHERE slug LIKE '${SLUG}%'`);
  await clearCheckoutSettings();
});

// ── 1. The admin API ─────────────────────────────────────────────────────────

describe('GET/PATCH /api/v1/admin/checkout-settings — who may', () => {
  test('anonymous 401, a plain account 403, a role without the view 403', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await request(app).get(BASE).set('Cookie', userCookie)).status).toBe(403);
    expect((await request(app).get(BASE).set('Cookie', generalRoleCookie)).status).toBe(403);
    expect((await request(app).patch(BASE).set('Cookie', generalRoleCookie).send({ ordering_paused: true })).status).toBe(403);
    expect((await Setting.getCheckoutSettings()).ordering_paused).toBe(false);
  });

  test('the defaults reproduce today\'s checkout; the shipping price is the env fallback until saved', async () => {
    const res = await request(app).get(BASE).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({
      ordering_paused: false,
      ordering_paused_message: { en: '', is: '' },
      min_order_value_isk: 0,
      order_notify_emails: [],
      fields: { phone: 'optional', company: 'hidden', kennitala: 'hidden', note: 'optional' },
      shipping: { flat_rate_isk: Setting.DEFAULTS[Setting.KEYS.shippingFlatRateIsk], free_over_isk: 0 },
    });
    expect(res.body.status).toEqual(expect.objectContaining({ stripe_configured: expect.any(Boolean) }));
  });

  test('a role holding the `checkout` view reads and writes', async () => {
    const res = await request(app).patch(BASE).set('Cookie', checkoutRoleCookie).send({ min_order_value_isk: 3000 });
    expect(res.status).toBe(200);
    expect(res.body.settings.min_order_value_isk).toBe(3000);
    expect((await request(app).get(BASE).set('Cookie', checkoutRoleCookie)).status).toBe(200);
  });

  test('the write carries CSRF (checked outside test mode)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    let res;
    try {
      res = await request(app).patch(BASE).set('Cookie', adminCookie).send({ ordering_paused: true });
    } finally { process.env.NODE_ENV = prev; }
    expect(res.status).toBe(403);
    expect((await Setting.getCheckoutSettings()).ordering_paused).toBe(false);
  });
});

describe('PATCH /api/v1/admin/checkout-settings — validation', () => {
  const patch = (body) => request(app).patch(BASE).set('Cookie', adminCookie).send(body);

  test.each([
    [{ ordering_paused: 'yes' }, /ordering_paused/],
    [{ min_order_value_isk: -1 }, /min_order_value_isk/],
    [{ min_order_value_isk: '' }, /min_order_value_isk/],
    [{ min_order_value_isk: null }, /min_order_value_isk/],
    [{ min_order_value_isk: 12.5 }, /min_order_value_isk/],
    [{ min_order_value_isk: 100000001 }, /min_order_value_isk/],
    [{ fields: { phone: 'maybe' } }, /fields\.phone/],
    [{ fields: { fax: 'optional' } }, /fields\.fax/],
    [{ fields: 'required' }, /fields/],
    [{ order_notify_emails: 'owner@l7a.test, not-an-address' }, /not-an-address/],
    [{ order_notify_emails: 42 }, /order_notify_emails/],
    [{ order_notify_emails: ['a@x.is', 'b@x.is', 'c@x.is', 'd@x.is', 'e@x.is', 'f@x.is'] }, /at most 5/],
    [{ ordering_paused_message: 'closed' }, /ordering_paused_message/],
    [{ ordering_paused_message: { de: 'zu' } }, /ordering_paused_message\.de/],
    [{ ordering_paused_message: { is: 'x'.repeat(301) } }, /too long/],
    [{ shipping: { flat_rate_isk: null } }, /shipping\.flat_rate_isk/],
    [{ shipping: 'free' }, /shipping/],
  ])('%j → 400 in the error envelope', async (body, msg) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.stringMatching(msg), code: 400 });
  });

  test('valid values are normalised and read back', async () => {
    const res = await patch({
      ordering_paused_message: { is: '  Lokað vegna talningar  ' },
      min_order_value_isk: '5000',
      order_notify_emails: 'Owner@L7A.test; second@l7a.test owner@l7a.test',
      fields: { phone: 'required', kennitala: 'optional' },
      shipping: { flat_rate_isk: 1500, free_over_isk: '20000' },
    });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual(expect.objectContaining({
      ordering_paused_message: { en: '', is: 'Lokað vegna talningar' },
      min_order_value_isk: 5000,
      order_notify_emails: ['owner@l7a.test', 'second@l7a.test'],
      fields: { phone: 'required', company: 'hidden', kennitala: 'optional', note: 'optional' },
      shipping: { flat_rate_isk: 1500, free_over_isk: 20000 },
    }));
    // A per-locale patch keeps the other locale.
    const again = await patch({ ordering_paused_message: { en: 'Closed for stocktake' } });
    expect(again.body.settings.ordering_paused_message).toEqual({ en: 'Closed for stocktake', is: 'Lokað vegna talningar' });
  });

  test('a save is all or nothing: a bad shipping price leaves the pause unsaved', async () => {
    const res = await patch({ ordering_paused: true, min_order_value_isk: 9000, shipping: { flat_rate_isk: -5 } });
    expect(res.status).toBe(400);
    const s = await Setting.getCheckoutSettings();
    expect(s.ordering_paused).toBe(false);
    expect(s.min_order_value_isk).toBe(0);
  });

  test('tags are stripped from the pause message (sanitizeBody)', async () => {
    const res = await patch({ ordering_paused_message: { en: '<script>x</script>Back <b>soon</b>' } });
    expect(res.body.settings.ordering_paused_message.en).toBe('xBack soon');
  });
});

describe('GET /api/v1/shop/config — what the storefront may see', () => {
  test('the pause, the minimum, the field rules and the live rates — never the alert list', async () => {
    await save({ ordering_paused: true, ordering_paused_message: { is: 'Lokað' }, min_order_value_isk: 4000,
      order_notify_emails: ['secret-owner@l7a.test'], fields: { company: 'required' },
      shipping: { flat_rate_isk: 990, free_over_isk: 15000 } });
    const res = await request(app).get('/api/v1/shop/config');
    expect(res.status).toBe(200);
    expect(res.body.checkout).toEqual({
      ordering_paused: true,
      ordering_paused_message: { en: '', is: 'Lokað' },
      min_order_value_isk: 4000,
      fields: { phone: 'optional', company: 'required', kennitala: 'hidden', note: 'optional' },
    });
    expect(res.body.shipping).toEqual(expect.objectContaining({
      flat_rate: expect.objectContaining({ priceIsk: 990 }), free_over_isk: 15000,
    }));
    expect(JSON.stringify(res.body)).not.toContain('secret-owner');
  });
});

// ── 2. Enforcement on the order path ─────────────────────────────────────────

describe('the ordering pause', () => {
  test('503 with the default reason, before any order row — and before any other check', async () => {
    await save({ ordering_paused: true });
    const before = (await ordersFor()).length;
    const res = await checkout();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: tx('errors.shop.orderingPaused'), code: 503, reason: 'ORDERING_PAUSED' });
    // A malformed body and a missing Stripe key still get the pause, not their own error.
    const junk = await request(app).post('/api/v1/shop/checkout').send({ items: 'nope' });
    expect(junk.status).toBe(503);
    delete process.env.STRIPE_SECRET_KEY;
    expect((await checkout()).body.reason).toBe('ORDERING_PAUSED');
    expect((await ordersFor()).length).toBe(before);
    expect(sessionSpy).not.toHaveBeenCalled();
  });

  test('the admin\'s message, per locale, falling back to the default for a blank locale', async () => {
    await save({ ordering_paused: true, ordering_paused_message: { is: 'Lokað vegna talningar' } });
    const is = await checkout({}, { locale: 'is' });
    expect(is.body.error).toBe('Lokað vegna talningar');
    const en = await checkout({}, { locale: 'en' });
    expect(en.body.error).toBe(t('en', 'errors.shop.orderingPaused'));
  });

  test('open again → the order lands', async () => {
    await save({ ordering_paused: false });
    const res = await checkout();
    expect(res.status).toBe(201);
  });
});

describe('the minimum order value', () => {
  test('refused under it with the amount; taken at it', async () => {
    await save({ min_order_value_isk: 5000 });
    const low = await checkout({ items: [{ productId: mug.id, quantity: 2 }] }, { locale: 'en' }); // 4000
    expect(low.status).toBe(400);
    expect(low.body).toEqual({
      error: t('en', 'errors.shop.minOrderValue', { amount: '5,000' }),
      code: 400, reason: 'MIN_ORDER_VALUE', params: { amount: 5000 },
    });
    const ok = await checkout({ items: [{ productId: mug.id, quantity: 3 }] }); // 6000
    expect(ok.status).toBe(201);
    const [row] = (await ordersFor()).filter(o => o.order_number === ok.body.orderNumber);
    expect(Number(row.subtotal)).toBe(6000);
  });

  test('measured AFTER the order discount', async () => {
    await Discount.create({ code: 'L7A20', method: 'code', type: 'order', value_type: 'percentage', value: 20, currency: 'ISK' });
    await save({ min_order_value_isk: 5000 });
    // 3 × 2000 = 6000, less 20 % = 4800 < 5000.
    const res = await checkout({ items: [{ productId: mug.id, quantity: 3 }], discount_code: 'L7A20' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('MIN_ORDER_VALUE');
    // 4 × 2000 = 8000, less 20 % = 6400 ≥ 5000.
    const ok = await checkout({ items: [{ productId: mug.id, quantity: 4 }], discount_code: 'L7A20' });
    expect(ok.status).toBe(201);
  });

  test('a EUR basket is measured by its ISK prices — the currency is no way around it', async () => {
    await save({ min_order_value_isk: 5000 });
    const res = await checkout({ currency: 'EUR', items: [{ productId: mug.id, quantity: 2 }] }); // 4000 kr.
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('MIN_ORDER_VALUE');
    expect((await checkout({ currency: 'EUR', items: [{ productId: mug.id, quantity: 3 }] })).status).toBe(201);
  });
});

describe('the delivery price — one rule for the total and the display', () => {
  const shipped = (qty, extra = {}) => checkout({
    items: [{ productId: mug.id, quantity: qty }], shipping_method: 'flat_rate', shipping_address: address(), ...extra,
  });
  const shippingOf = async (orderNumber) =>
    Number((await ordersFor()).find(o => o.order_number === orderNumber).shipping);

  test('before an admin saves one, the env fallback charges exactly what it did', async () => {
    const res = await shipped(1);
    expect(res.status).toBe(201);
    expect(await shippingOf(res.body.orderNumber)).toBe(Setting.DEFAULTS[Setting.KEYS.shippingFlatRateIsk]);
  });

  test('the saved flat rate, free at the threshold, pickup always free', async () => {
    await save({ shipping: { flat_rate_isk: 1500, free_over_isk: 10000 } });
    const under = await shipped(4); // 8000
    expect(await shippingOf(under.body.orderNumber)).toBe(1500);
    const at = await shipped(5);    // 10000 — the threshold itself is free
    expect(await shippingOf(at.body.orderNumber)).toBe(0);
    const pickup = await checkout({ items: [{ productId: mug.id, quantity: 1 }] });
    expect(await shippingOf(pickup.body.orderNumber)).toBe(0);
    // The total the Stripe session is built from carries the same number.
    expect(sessionSpy.mock.calls.find(c => c[0].orderNumber === under.body.orderNumber)[0].shipping).toBe(1500);
  });

  test('a EUR basket pays the env EUR rate, and the ISK threshold frees it', async () => {
    await save({ shipping: { flat_rate_isk: 1500, free_over_isk: 10000 } });
    const { SHIPPING_METHODS } = require('../../server/config/shipping');
    const under = await shipped(2, { currency: 'EUR' });
    expect(await shippingOf(under.body.orderNumber)).toBe(SHIPPING_METHODS.flat_rate.priceEur);
    const over = await shipped(5, { currency: 'EUR' });
    expect(await shippingOf(over.body.orderNumber)).toBe(0);
  });

  test('/shop/config hands the display the same rates the order used', async () => {
    await save({ shipping: { flat_rate_isk: 1500, free_over_isk: 10000 } });
    const cfg = (await request(app).get('/api/v1/shop/config')).body.shipping;
    const { computeShippingPrice, shippingRates } = require('../../server/config/shipping');
    const rates = await shippingRates();
    expect(cfg).toEqual({
      flat_rate: { priceIsk: rates.flatRateIsk, priceEur: rates.flatRateEur },
      local_pickup: { priceIsk: 0, priceEur: 0 },
      free_over_isk: rates.freeOverIsk,
    });
    expect(computeShippingPrice({ method: 'flat_rate', currency: 'ISK', rates, iskSubtotal: 9999 })).toBe(1500);
  });
});

describe('the field rules — hidden is ignored, required is enforced', () => {
  test('phone: required on a shipped order; hidden drops a posted one', async () => {
    await save({ fields: { phone: 'required' } });
    const missing = await checkout({ shipping_method: 'flat_rate', shipping_address: address() });
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ error: tx('errors.shop.phoneRequired'), code: 400, reason: 'FIELD_REQUIRED' });
    expect((await checkout({ shipping_method: 'flat_rate', shipping_address: address({ phone: '+354 555 1234' }) })).status).toBe(201);
    // Pickup has no address, so the phone is not asked there.
    expect((await checkout()).status).toBe(201);

    await save({ fields: { phone: 'hidden' } });
    const hidden = await checkout({ shipping_method: 'flat_rate', shipping_address: address({ phone: '+354 555 9999' }) });
    expect(hidden.status).toBe(201);
    const row = (await ordersFor()).find(o => o.order_number === hidden.body.orderNumber);
    expect(row.shipping_address.phone).toBeNull();
  });

  test('note: hidden drops a posted note; required refuses a blank one', async () => {
    await save({ fields: { note: 'hidden' } });
    const hidden = await checkout({ note: 'Please gift wrap' });
    expect(hidden.status).toBe(201);
    expect((await ordersFor()).find(o => o.order_number === hidden.body.orderNumber).notes).toBeNull();

    await save({ fields: { note: 'required' } });
    const blank = await checkout({ note: '   ' });
    expect(blank.status).toBe(400);
    expect(blank.body.error).toBe(tx('errors.shop.noteRequired'));
    const ok = await checkout({ note: 'Ring twice' });
    expect((await ordersFor()).find(o => o.order_number === ok.body.orderNumber).notes).toBe('Ring twice');
  });

  test('company: required refuses a blank one; too long is refused', async () => {
    await save({ fields: { company: 'required' } });
    const res = await checkout();
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(tx('errors.shop.companyRequired'));
    expect((await checkout({ company: 'x'.repeat(201) })).status).toBe(400);
    expect((await checkout({ company: 'Kaffibrennslan Glóð ehf.' })).status).toBe(201);
  });

  test('kennitala: shape and check digit when filled, required when set, ignored when hidden', async () => {
    await save({ fields: { kennitala: 'optional' } });
    for (const bad of ['123', '1234567890', '0101303029', 'abcdefghij']) {
      const res = await checkout({ kennitala: bad });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: tx('errors.shop.kennitalaInvalid'), code: 400, reason: 'FIELD_INVALID' });
    }
    expect((await checkout({ kennitala: '010130-3019' })).status).toBe(201);
    expect((await checkout()).status).toBe(201); // optional: blank is fine

    await save({ fields: { kennitala: 'required' } });
    expect((await checkout()).body.error).toBe(tx('errors.shop.kennitalaRequired'));
    expect((await checkout({ kennitala: '0101303019' })).status).toBe(201);

    await save({ fields: { kennitala: 'hidden' } });
    expect((await checkout({ kennitala: 'garbage' })).status).toBe(201);
  });
});

// ── The owner's paid-order alert: fired where the order becomes paid ────────

describe('the owner order alert (Stripe webhook)', () => {
  const SECRET = 'whsec_l7a_test';
  let stripe, alertSpy;
  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const Stripe = require('stripe');
    stripe = new Stripe('sk_test_l7a_dummy');
  });
  afterEach(() => { if (alertSpy) alertSpy.mockRestore(); alertSpy = null; });

  async function pendingOrder() {
    return Order.createWithItems({
      guestEmail: GUEST, guestName: 'L7A Guest', currency: 'ISK', shippingMethod: 'local_pickup',
      items: [{ productId: mug.id, name: 'L7A Mug', price: 2000, quantity: 1 }], shipping: 0,
    });
  }
  async function pay(order) {
    const id = `${order.id}_${Date.now()}`;
    await Order.setStripeSession(order.id, `cs_l7a_${id}`);
    const payload = JSON.stringify({
      id: `evt_l7a_${id}`, type: 'checkout.session.completed',
      data: { object: { id: `cs_l7a_${id}`, payment_intent: `pi_l7a_${id}` } },
    });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    return request(app).post('/api/v1/shop/webhook')
      .set('Stripe-Signature', header).set('Content-Type', 'application/json').send(payload);
  }

  test('the alert list gets the paid order', async () => {
    await save({ order_notify_emails: ['owner@l7a.test', 'second@l7a.test'] });
    alertSpy = jest.spyOn(emailService, 'sendOrderOwnerAlert').mockResolvedValue(true);
    const order = await pendingOrder();
    const res = await pay(order);
    expect(res.status).toBe(200);
    expect((await Order.findById(order.id)).status).toBe('paid');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const arg = alertSpy.mock.calls[0][0];
    expect(arg.to).toEqual(['owner@l7a.test', 'second@l7a.test']);
    expect(arg.order.order_number).toBe(order.order_number);
    expect(arg.items).toHaveLength(1);
  });

  test('a failing or hanging mail send never fails or holds the webhook', async () => {
    await save({ order_notify_emails: ['owner@l7a.test'] });
    alertSpy = jest.spyOn(emailService, 'sendOrderOwnerAlert').mockRejectedValue(new Error('smtp down'));
    const a = await pendingOrder();
    expect((await pay(a)).status).toBe(200);
    expect((await Order.findById(a.id)).status).toBe('paid');

    alertSpy.mockImplementation(() => new Promise(() => {})); // never settles
    const b = await pendingOrder();
    const started = Date.now();
    const res = await pay(b);
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
    expect(Date.now() - started).toBeLessThan(5000);
    expect((await Order.findById(b.id)).status).toBe('paid');
  });

  test('no list and no ORDER_NOTIFY_EMAIL → no alert; the env value is the fallback', async () => {
    const prev = process.env.ORDER_NOTIFY_EMAIL;
    alertSpy = jest.spyOn(emailService, 'sendOrderOwnerAlert').mockResolvedValue(true);
    try {
      delete process.env.ORDER_NOTIFY_EMAIL;
      await pay(await pendingOrder());
      expect(alertSpy).not.toHaveBeenCalled();
      process.env.ORDER_NOTIFY_EMAIL = 'env-owner@l7a.test';
      await pay(await pendingOrder());
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0][0].to).toEqual(['env-owner@l7a.test']);
    } finally {
      if (prev === undefined) delete process.env.ORDER_NOTIFY_EMAIL; else process.env.ORDER_NOTIFY_EMAIL = prev;
    }
  });

  test('the sender itself: nobody to send to, or no transport → false, no throw', async () => {
    const order = await pendingOrder();
    expect(await emailService.sendOrderOwnerAlert({ order, items: [], to: [] })).toBe(false);
    // The test env has no RESEND_API_KEY: logged and alerted, never thrown.
    expect(await emailService.sendOrderOwnerAlert({ order, items: [], to: ['owner@l7a.test'] })).toBe(false);
  });
});
