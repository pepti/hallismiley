'use strict';

// The read-only sales tools on the MCP connector (harvest 2 lane 5):
// sales_report and recent_orders. Gated by scope 'read', the shop module and —
// new — the token OWNER's admin views (mcp/owner.js ownerViewAccess): on a
// product that hides its shop from an all-views admin, the tools are neither
// listed nor callable. Real Postgres (invariant 9); the product's hidden-views
// list (a frozen config object) is read through a thin stand-in so each test
// can choose it — configuration, not the database, is what is substituted.
process.env.MCP_ENABLED = 'true';

let mockHidden = null;
jest.mock('../../server/config/identity', () => {
  const actual = jest.requireActual('../../server/config/identity');
  const identity = {};
  for (const k of Object.keys(actual.identity)) {
    Object.defineProperty(identity, k, {
      enumerable: true,
      get: () => (k === 'surface'
        ? { ...actual.identity.surface, hiddenAdminViews: mockHidden || actual.identity.surface.hiddenAdminViews }
        : actual.identity[k]),
    });
  }
  return { ...actual, identity };
});

const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const McpToken = require('../../server/models/McpToken');
const { identity } = require('../../server/config/identity');
const { createTestAdminUser, cleanTables } = require('../helpers');

let token;
let savedHidden;

const rpc = body => request(app).post('/api/v1/mcp').set('Authorization', `Bearer ${token}`).send(body);
const call = (name, args = {}) => rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const payload = res => JSON.parse(res.body.result.content[0].text);
const listNames = async () => (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).body.result.tools.map(t => t.name);

async function seedOrder({ total, vat, currency = 'ISK', paidAt = 'now()', fulfillment = 'unfulfilled', n }) {
  await db.query(
    `INSERT INTO orders (order_number, guest_email, guest_name, currency, subtotal, shipping, total, status,
        shipping_method, shipping_address, payment_status, fulfillment_status, paid_at, vat_total, notes)
     VALUES ($1, 'secret@example.is', 'Anna', $2, $3, 0, $3, 'paid', 'flat_rate',
             '{"line1":"Leynigata 1","city":"Reykjavík","postal":"101"}'::jsonb, 'paid', $4, ${paidAt}, $5, 'leyndarmál')`,
    [`MCP-${n}`, currency, total, fulfillment, vat]
  );
}

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE mcp_tokens RESTART IDENTITY CASCADE');
  const adminId = await createTestAdminUser();
  token = (await McpToken.create({ userId: adminId, name: 'sales tools' })).token;
  savedHidden = identity.surface.hiddenAdminViews || [];
});

afterEach(() => { mockHidden = null; });

describe('on a product that hides the shop from its admin nav', () => {
  test('neither tool is listed, and a call is the same refusal as an unknown tool', async () => {
    mockHidden = [...new Set([...savedHidden, 'sales', 'orders'])];
    const names = await listNames();
    expect(names).not.toContain('sales_report');
    expect(names).not.toContain('recent_orders');
    const res = await call('sales_report');
    expect(res.body.result.isError).toBe(true);
    expect(payload(res).error).toBe('Unknown tool: sales_report');
  });
});

describe('where the owner sees sales and orders', () => {
  beforeEach(() => {
    mockHidden = savedHidden.filter(v => v !== 'sales' && v !== 'orders');
  });

  test('both are listed as read tools', async () => {
    const names = await listNames();
    expect(names).toEqual(expect.arrayContaining(['sales_report', 'recent_orders']));
  });

  test('sales_report: net per currency, inclusive dates, a comparison window', async () => {
    await seedOrder({ total: 12400, vat: 2400, n: 1 });
    await seedOrder({ total: 8900, vat: 1723, currency: 'EUR', n: 2 });
    await seedOrder({ total: 6200, vat: 1200, paidAt: "now() - INTERVAL '40 days'", n: 3 });
    const today = new Date().toISOString().slice(0, 10);
    const d = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const res = await call('sales_report', { from: d(6), to: today, compare_from: d(45), compare_to: d(7) });
    expect(res.body.result.isError).toBeUndefined();
    const r = payload(res);
    expect(r._environment).toBeDefined();
    const isk = r.kpis.byCurrency.find(c => c.currency === 'ISK');
    expect(isk).toMatchObject({ orders: 1, revenue: 12400, vat: 2400, revenue_net: 10000 });
    expect(r.kpis.byCurrency.find(c => c.currency === 'EUR')).toMatchObject({ revenue_net: 7177 });
    expect(r.kpisPrev.byCurrency).toEqual([expect.objectContaining({ currency: 'ISK', revenue_net: 5000 })]);
  });

  test('sales_report refuses a bad or backwards period with a readable message', async () => {
    const bad = await call('sales_report', { from: '2026-09-10', to: '2026-09-01' });
    expect(payload(bad).error).toBe('The period is empty or backwards');
    const junk = await call('sales_report', { from: 'last week' });
    expect(payload(junk).error).toMatch(/YYYY-MM-DD/);
  });

  test('recent_orders: newest first, open_only is the "to fulfil" list, no contact details', async () => {
    await seedOrder({ total: 1000, vat: 194, n: 10, paidAt: "now() - INTERVAL '2 hours'" });
    await seedOrder({ total: 2000, vat: 387, n: 11, fulfillment: 'fulfilled' });
    const all = payload(await call('recent_orders', { limit: 5 }));
    expect(all.total).toBe(2);
    expect(all.orders[0]).toMatchObject({ order_number: 'MCP-11', customer: 'Anna', vat_total: 387, total: 2000 });
    const open = payload(await call('recent_orders', { open_only: true }));
    expect(open.orders.map(o => o.order_number)).toEqual(['MCP-10']);
    const text = JSON.stringify(all);
    for (const secret of ['secret@example.is', 'Leynigata', 'leyndarmál']) expect(text).not.toContain(secret);
  });
});
