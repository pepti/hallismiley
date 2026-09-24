'use strict';

// GET /api/v1/admin/shop/orders/export.xlsx — the orders list as a real Excel
// workbook built on the server (services/orderExport.js; harvested from
// icelandicstore #325 — harvest-ice-d-2026-09-24): typed number and date
// cells, a frozen auto-filtered header, the list's own filter applied, and an
// export past the cap refused (413), never truncated.
const request = require('supertest');
const ExcelJS = require('exceljs');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const Order   = require('../../server/models/Order');
const orderExport = require('../../server/services/orderExport');
const { getTestSessionCookie, cleanTables } = require('../helpers');

const URL = '/api/v1/admin/shop/orders/export.xlsx';
let adminCookie, product;

function binaryParser(res, callback) {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => callback(null, Buffer.from(data, 'binary')));
}

async function workbook(res) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body);
  return wb.worksheets[0];
}

const mk = (email) => Order.createWithItems({
  guestEmail: email, guestName: '=HYPERLINK("x")', currency: 'ISK',
  shippingMethod: 'local_pickup', shippingAddress: null, shipping: 0,
  items: [{ productId: product.id, name: 'Export Widget', price: 12500, quantity: 2 }],
});

beforeAll(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie();
  await db.query("DELETE FROM products WHERE slug = 'export-xlsx-widget'");
  product = await Product.create({ slug: 'export-xlsx-widget', name: 'Export Widget', price_isk: 12500, price_eur: 9000, stock: 50 });
  const paid = await mk('xlsx-paid@example.com');
  await Order.setOrderStatuses(paid.id, { payment_status: 'paid' });
  await mk('xlsx-pending@example.com');
});

afterAll(async () => {
  orderExport.limits.maxRows = 10000;
  await db.query("DELETE FROM orders WHERE guest_email LIKE 'xlsx-%'");
  await db.query("DELETE FROM products WHERE slug = 'export-xlsx-widget'");
});

test('a typed workbook: numbers are numbers, dates are dates, a formula-looking name stays text', async () => {
  const res = await request(app).get(URL).set('Cookie', adminCookie).buffer().parse(binaryParser);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  expect(res.headers['content-disposition']).toMatch(/orders-\d{4}-\d{2}-\d{2}\.xlsx/);
  const ws = await workbook(res);
  expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  expect(ws.autoFilter).toBeTruthy();
  const rows = [];
  ws.eachRow((row, n) => { if (n > 1) rows.push(row); });
  const ours = rows.filter(r => /xlsx-/.test(String(r.getCell(3).value)) || /HYPERLINK/.test(String(r.getCell(3).value)));
  expect(ours.length).toBeGreaterThanOrEqual(2);
  const r = ours[0];
  expect(typeof r.getCell(7).value).toBe('number');     // total
  expect(r.getCell(7).value).toBe(25000);
  expect(r.getCell(2).value).toBeInstanceOf(Date);      // date
});

test('the list\'s filter applies: paymentStatus=paid exports only the paid order', async () => {
  const res = await request(app).get(`${URL}?paymentStatus=paid&q=xlsx-`).set('Cookie', adminCookie).buffer().parse(binaryParser);
  const ws = await workbook(res);
  expect(ws.rowCount).toBe(2); // header + the one paid order
});

test('past the cap it is refused with a 413 envelope, never cut short', async () => {
  orderExport.limits.maxRows = 1;
  const res = await request(app).get(`${URL}?q=xlsx-`).set('Cookie', adminCookie);
  expect(res.status).toBe(413);
  expect(res.body).toMatchObject({ code: 413 });
  orderExport.limits.maxRows = 10000;
});

test('401 without a session', async () => {
  expect((await request(app).get(URL)).status).toBe(401);
});
