'use strict';

// MCP catalogue write tools (harvest-ice-c-2026-09-24, from icelandicstore
// #248/#250/#361): create_product, update_product, set_stock. Three gates —
// the scope double-gate, each tool's own mcp.write.* switch in
// config/client.json (ALL OFF by default), and the shop module — then each
// tool going through the same models as the admin screens: a created product
// is always a Draft, update never touches stock, set_stock is audited with the
// token owner as the actor.
process.env.MCP_ENABLED = 'true';

const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const McpToken = require('../../server/models/McpToken');
const Product = require('../../server/models/Product');
const { createTestAdminUser, cleanTables } = require('../helpers');

const FLAGS = {
  productCreate: 'CLIENT_CONFIG_MCP_WRITE_PRODUCT_CREATE',
  productUpdate: 'CLIENT_CONFIG_MCP_WRITE_PRODUCT_UPDATE',
  stock:         'CLIENT_CONFIG_MCP_WRITE_STOCK',
};
const TOOLS = ['create_product', 'update_product', 'set_stock'];

let adminId, writeToken;
const rpc = (bearer, body) => request(app).post('/api/v1/mcp').set('Authorization', `Bearer ${bearer}`).send(body);
const call = (name, args) => rpc(writeToken, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const payload = (res) => JSON.parse(res.body.result.content[0].text);
const listed = async () => (await rpc(writeToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).body.result.tools.map(t => t.name);

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE mcp_tokens RESTART IDENTITY CASCADE');
  await db.query(`DELETE FROM products WHERE slug LIKE 'mcp-cat-%'`);
  adminId = await createTestAdminUser();
  writeToken = (await McpToken.create({ userId: adminId, name: 'writer', scopes: ['read', 'write'] })).token;
  process.env.MCP_ALLOWED_SCOPES = 'read,write';
  for (const env of Object.values(FLAGS)) delete process.env[env];
});

afterAll(async () => {
  delete process.env.MCP_ALLOWED_SCOPES;
  for (const env of Object.values(FLAGS)) delete process.env[env];
  await db.query(`DELETE FROM products WHERE slug LIKE 'mcp-cat-%'`);
});

describe('the switches', () => {
  test('all three are off by default: not listed, and a call is an unknown tool', async () => {
    const names = await listed();
    for (const tool of TOOLS) expect(names).not.toContain(tool);
    const res = await call('create_product', { name: 'X', price_isk: 1, price_eur: 1 });
    expect(res.body.result.isError).toBe(true);
    expect(payload(res).error).toMatch(/Unknown tool/);
  });

  test('each switch opens exactly its own tool', async () => {
    process.env[FLAGS.stock] = 'true';
    const names = await listed();
    expect(names).toContain('set_stock');
    expect(names).not.toContain('create_product');
    expect(names).not.toContain('update_product');
  });

  test('a switch on a read-only stack still offers nothing', async () => {
    process.env[FLAGS.productCreate] = 'true';
    process.env.MCP_ALLOWED_SCOPES = 'read';
    expect(await listed()).not.toContain('create_product');
  });
});

describe('the tools', () => {
  beforeEach(() => { for (const env of Object.values(FLAGS)) process.env[env] = 'true'; });

  test('create_product makes a Draft, derives the slug, and records opening stock with the actor', async () => {
    const res = await call('create_product', { name: 'MCP Cat Þórs mug', price_isk: 2490, price_eur: 1700, stock: 6, slug: 'mcp-cat-thors-mug' });
    const out = payload(res);
    expect(res.body.result.isError).toBeUndefined();
    expect(out).toMatchObject({ created: true, visible_in_shop: false });
    expect(out.product).toMatchObject({ active: false, stock: 6, slug: 'mcp-cat-thors-mug' });
    const { rows } = await db.query('SELECT reason, delta, user_id FROM inventory_adjustments WHERE product_id = $1', [out.product.id]);
    expect(rows).toEqual([{ reason: 'opening', delta: 6, user_id: adminId }]);
  });

  test('create_product refuses a missing price', async () => {
    const res = await call('create_product', { name: 'MCP Cat bad', price_isk: 0, price_eur: 100, slug: 'mcp-cat-bad' });
    expect(res.body.result.isError).toBe(true);
    expect(payload(res).error).toMatch(/price_isk/);
  });

  test('update_product changes the fields given and never stock', async () => {
    const p = await Product.create({ slug: 'mcp-cat-upd', name: 'Before', price_isk: 1000, price_eur: 700, stock: 3, sku: 'MCP-UPD' });
    const res = await call('update_product', { sku: 'MCP-UPD', name: 'After', vat_rate: 11 });
    expect(payload(res).product).toMatchObject({ name: 'After', vat_rate: 11, stock: 3 });
    const bad = await call('update_product', { sku: 'MCP-UPD', stock: 9 });
    expect(bad.body.result.isError).toBe(true);
    expect((await Product.findById(p.id)).stock).toBe(3);
  });

  test('set_stock moves on hand through the audited writer, with reason, note and actor', async () => {
    const p = await Product.create({ slug: 'mcp-cat-stock', name: 'Stocked', price_isk: 1000, price_eur: 700, stock: 2, sku: 'MCP-STK' });
    const res = await call('set_stock', { sku: 'MCP-STK', stock: 10, reason: 'received', note: 'delivery' });
    expect(payload(res)).toMatchObject({ updated: true, previous: 2, stock: 10 });
    const { rows } = await db.query(
      `SELECT reason, delta, note, user_id FROM inventory_adjustments WHERE product_id = $1 AND reason <> 'opening'`, [p.id]
    );
    expect(rows).toEqual([{ reason: 'received', delta: 8, note: 'MCP: delivery', user_id: adminId }]);
  });

  test('the shop module switched off hides them all', async () => {
    process.env.CLIENT_CONFIG_MODULES_SHOP_ENABLED = 'false';
    let freshApp;
    jest.isolateModules(() => { freshApp = require('../../server/app'); });
    try {
      const res = await request(freshApp).post('/api/v1/mcp').set('Authorization', `Bearer ${writeToken}`)
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const names = res.body.result.tools.map(t => t.name);
      for (const tool of TOOLS) expect(names).not.toContain(tool);
    } finally {
      delete process.env.CLIENT_CONFIG_MODULES_SHOP_ENABLED;
    }
  });
});
