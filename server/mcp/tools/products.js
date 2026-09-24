// Catalogue WRITE tools (harvested from icelandicstore #248/#250/#361 —
// harvest-ice-c-2026-09-24). Three gates, all must pass (registry.js):
//   scope 'write' in the token AND in MCP_ALLOWED_SCOPES (the stack ceiling),
//   its own mcp.write.* switch in config/client.json — ALL OFF by default,
//   and the shop module switched on.
// Every write goes through the same models the admin screens use:
//
//   create_product  → Product.create — ALWAYS a Draft (active = false): an
//                     admin reviews it and sets it active (Halli / ice rule:
//                     nothing Claude adds reaches the storefront unseen)
//   update_product  → Product.update — the product fields, never stock
//   set_stock       → Product.update / ProductVariant.update with a stock
//                     figure, i.e. Inventory.setAbsolute: the movement lands
//                     in inventory_adjustments with the token's owner as the
//                     actor and the reason given (models/Inventory.js)
//
// Stock is deliberately NOT a field of update_product: it has one audited
// writer and one tool that names it. Variants are out of scope (the admin
// variant grid adds them), but a variant SKU can have its stock set because
// set_stock resolves codes the way the scanner does. Each write is logged
// with who and what (securityLogger), never a request's free text.
const Product = require('../../models/Product');
const ProductVariant = require('../../models/ProductVariant');
const Inventory = require('../../models/Inventory');
const { foldSlug } = require('../../utils/slug');
const securityLogger = require('../../observability/securityLogger');
const { env } = require('../envTag');

const VAT_RATES = [0, 11, 24];
const CATEGORIES = ['product', 'tech_service', 'carpentry_service'];

function fail(message) {
  const err = new Error(message);
  err.expose = true;
  throw err;
}

// Shared argument surface for create/update (flat primitives only — the
// registry's validator has no arrays).
const FIELD_PROPS = {
  name:           { type: 'string',  description: 'product name (EN), at most 200 characters' },
  name_is:        { type: 'string',  description: 'product name (IS)' },
  description:    { type: 'string',  description: 'description (EN)' },
  description_is: { type: 'string',  description: 'description (IS)' },
  price_isk:      { type: 'integer', description: 'price in ISK, VAT INCLUSIVE, whole krónur (> 0)' },
  price_eur:      { type: 'integer', description: 'price in EUR cents, VAT inclusive (> 0)' },
  vat_rate:       { type: 'integer', enum: VAT_RATES, description: 'VAT rate: 24, 11 (the statutory list: books, food…) or 0' },
  sku:            { type: 'string',  description: 'product number, at most 100 characters' },
  barcode:        { type: 'string',  description: 'EAN/GTIN barcode, at most 64 characters' },
  category:       { type: 'string',  enum: CATEGORIES, description: 'shop section' },
  subcategory:    { type: 'string',  description: 'free-text tag, at most 60 characters' },
};

function checkFields(body, { creating }) {
  if (creating || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) fail('name is required (1–200 characters)');
  }
  for (const k of ['price_isk', 'price_eur']) {
    if (creating || body[k] !== undefined) {
      if (!Number.isInteger(body[k]) || body[k] <= 0) fail(`${k} must be a whole number above 0`);
    }
  }
  if (body.sku !== undefined && body.sku.length > 100) fail('sku must be at most 100 characters');
  if (body.barcode !== undefined && body.barcode.length > 64) fail('barcode must be at most 64 characters');
  if (body.subcategory !== undefined && body.subcategory.length > 60) fail('subcategory must be at most 60 characters');
}

function bodyFrom(args, keys) {
  const body = {};
  for (const k of keys) if (args[k] !== undefined && args[k] !== null) body[k] = args[k];
  return body;
}

// Lean, stable shape for tool output. `stock` is on hand.
function view(p) {
  return {
    id: p.id, slug: p.slug, name: p.name, sku: p.sku, barcode: p.barcode,
    price_isk: p.price_isk, price_eur: p.price_eur, vat_rate: p.vat_rate,
    category: p.category, stock: p.stock, active: p.active,
  };
}

async function findProduct({ product_id, sku }) {
  if (product_id) return Product.findById(String(product_id));
  if (sku) {
    const hit = await Product.resolveByCode(String(sku));
    return hit && !hit.variantId ? Product.findById(hit.productId) : null;
  }
  return null;
}

const tools = [
  {
    name: 'create_product',
    scope: 'write',
    writeFlag: 'productCreate',
    module: 'shop',
    description: 'Create a product in the shop catalogue. Required: name, price_isk and price_eur (VAT-inclusive). The slug is derived from the name unless given. The product is created as a DRAFT (not visible in the shop) — an admin reviews it and sets it active. Opening stock may be given; later changes go through set_stock so they are audited.',
    inputSchema: {
      type: 'object',
      properties: {
        ...FIELD_PROPS,
        slug:  { type: 'string',  description: 'URL slug (lowercase a-z, 0-9 and hyphens); derived from the name when omitted' },
        stock: { type: 'integer', description: 'opening on-hand quantity (default 0)' },
      },
      required: ['name', 'price_isk', 'price_eur'],
    },
    async handler(args, { token }) {
      const body = bodyFrom(args, [...Object.keys(FIELD_PROPS), 'slug', 'stock']);
      checkFields(body, { creating: true });
      if (!body.slug) body.slug = foldSlug(body.name);
      if (!/^[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?$/.test(body.slug) || ['products', 'tech', 'carpentry'].includes(body.slug)) {
        fail('slug must be lowercase a-z, 0-9 and hyphens (1–80 characters) — pass one explicitly');
      }
      if (body.stock !== undefined && (!Number.isInteger(body.stock) || body.stock < 0)) fail('stock must be a whole number of 0 or more');
      body.active = false;   // always a Draft
      let product;
      try {
        product = await Product.create(body, { userId: token.user_id });
      } catch (err) {
        if (err.code === '23505') fail(`slug "${body.slug}" is already taken — pass a different slug`);
        throw err;
      }
      securityLogger.adminAction(token.user_id, 'mcp_create_product', String(product.id), { tokenId: token.id });
      return {
        environment: env(), created: true, visible_in_shop: false,
        note: 'Created as a Draft; an admin sets it active in Admin → Products.',
        product: view(product),
      };
    },
  },
  {
    name: 'update_product',
    scope: 'write',
    writeFlag: 'productUpdate',
    module: 'shop',
    description: 'Update fields on an existing shop product, found by product_id or its product-level sku/barcode. Only the fields you pass change. Stock is not accepted here — use set_stock.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string',  description: 'product id' },
        sku:        { type: 'string',  description: 'product-level SKU or barcode, alternative to product_id' },
        new_sku:    { type: 'string',  description: 'new product number' },
        active:     { type: 'boolean', description: 'false = draft / hidden from the shop' },
        ...Object.fromEntries(Object.entries(FIELD_PROPS).filter(([k]) => k !== 'sku')),
      },
      required: [],
    },
    async handler(args, { token }) {
      const product = await findProduct(args);
      if (!product) fail('product not found — pass product_id, or the SKU of a product without variants');
      const body = bodyFrom({ ...args, sku: args.new_sku }, [...Object.keys(FIELD_PROPS), 'active']);
      if (!Object.keys(body).length) fail('nothing to update — pass at least one field');
      checkFields(body, { creating: false });
      let updated;
      try {
        updated = await Product.update(product.id, body, { userId: token.user_id });
      } catch (err) {
        if (err.code === '23505') fail('that SKU or slug is already taken');
        throw err;
      }
      securityLogger.adminAction(token.user_id, 'mcp_update_product', String(product.id), { tokenId: token.id, fields: Object.keys(body) });
      return { environment: env(), updated: true, product: view(updated) };
    },
  },
  {
    name: 'set_stock',
    scope: 'write',
    writeFlag: 'stock',
    module: 'shop',
    description: 'Set the on-hand quantity of a product or variant, found by product_id or a SKU/barcode (variant SKUs resolve to the variant). Audited like an admin stock correction: the reason and note are recorded with the token owner as the actor. Available (on hand minus what paid orders hold) follows.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string',  description: 'product id (products without variants)' },
        sku:        { type: 'string',  description: 'product or variant SKU / barcode, alternative to product_id' },
        stock:      { type: 'integer', description: 'the new on-hand count (≥ 0)' },
        reason:     { type: 'string',  enum: Inventory.ADJUSTMENT_REASONS.slice(), description: 'why (default correction)' },
        note:       { type: 'string',  description: 'free-text note for the audit row (at most 400 characters)' },
      },
      required: ['stock'],
    },
    async handler(args, { token }) {
      if (!Number.isInteger(args.stock) || args.stock < 0) fail('stock must be a whole number of 0 or more');
      if (args.note !== undefined && args.note.length > 400) fail('note must be at most 400 characters');
      let productId = null; let variantId = null; let label = null;
      if (args.sku) {
        const hit = await Product.resolveByCode(String(args.sku));
        if (!hit) fail(`no product or variant with SKU/barcode "${args.sku}"`);
        productId = hit.productId; variantId = hit.variantId; label = hit.name;
      } else if (args.product_id) {
        const p = await Product.findById(String(args.product_id));
        if (!p) fail('product not found');
        if (Array.isArray(p.variant_axes) && p.variant_axes.length) fail('this product has variants — pass the variant SKU instead');
        productId = p.id; label = p.name;
      } else {
        fail('pass product_id or sku');
      }
      const opts = {
        userId: token.user_id,
        stockReason: args.reason || 'correction',
        stockNote: args.note ? `MCP: ${args.note}` : 'MCP',
      };
      const before = variantId ? await ProductVariant.findById(variantId) : await Product.findById(productId);
      const after = variantId
        ? await ProductVariant.update(variantId, { stock: args.stock }, opts)
        : await Product.update(productId, { stock: args.stock }, opts);
      if (!after) fail('product not found');
      securityLogger.adminAction(token.user_id, 'mcp_set_stock', String(variantId || productId), { tokenId: token.id, stock: args.stock });
      return {
        environment: env(), updated: true, name: label, productId, variantId,
        previous: before ? Number(before.stock) : null, stock: Number(after.stock),
      };
    },
  },
];

module.exports = tools;
