// Integration tests for the bulk delivery-note endpoint: one combined PDF with a
// page per order. CSRF is bypassed in test mode; the route is a GET anyway.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const Order   = require('../../server/models/Order');
const { getTestSessionCookie, cleanTables } = require('../helpers');

// supertest doesn't buffer application/pdf by default — collect the raw bytes so
// we can assert the response really is a PDF.
function binaryParser(res, callback) {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => callback(null, Buffer.from(data, 'binary')));
}

const URL  = '/api/v1/admin/shop/orders/bulk/delivery-notes.pdf';
const SLUG = 'bulk-pdf-test-product';
let adminCookie, orderA, orderB;

beforeAll(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie();
  const product = await Product.create({
    slug: SLUG, name: 'Bulk PDF Test Widget',
    price_isk: 1500, price_eur: 1000, category: 'product', stock: 100,
  });
  const mk = (email) => Order.createWithItems({
    guestEmail: email, guestName: 'Bulk Test',
    currency: 'ISK', shippingMethod: 'local_pickup', shippingAddress: null, shipping: 0,
    items: [{ productId: product.id, name: 'Bulk PDF Test Widget', price: 1500, quantity: 2 }],
  });
  orderA = await mk('bulk-a@example.com');
  orderB = await mk('bulk-b@example.com');
});

afterAll(async () => {
  await db.query('DELETE FROM orders WHERE id = ANY($1::text[])', [[orderA.id, orderB.id]]);
  await db.query('DELETE FROM products WHERE slug = $1', [SLUG]);
});

describe('GET /api/v1/admin/shop/orders/bulk/delivery-notes.pdf', () => {
  test('streams one combined PDF for several orders', async () => {
    const res = await request(app)
      .get(`${URL}?ids=${orderA.id},${orderB.id}`)
      .set('Cookie', adminCookie)
      .buffer().parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/delivery-notes\.pdf/);
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('skips unknown ids but still streams a PDF when at least one is valid', async () => {
    const res = await request(app)
      .get(`${URL}?ids=${orderA.id},no-such-order`)
      .set('Cookie', adminCookie)
      .buffer().parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('400 when no ids are given', async () => {
    const res = await request(app).get(`${URL}?ids=`).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  test('404 when every id is unknown', async () => {
    const res = await request(app)
      .get(`${URL}?ids=no-such-order-1,no-such-order-2`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  test('401 when unauthenticated', async () => {
    const res = await request(app).get(`${URL}?ids=${orderA.id}`);
    expect(res.status).toBe(401);
  });
});
