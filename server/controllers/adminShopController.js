// Admin shop management — products CRUD, product images, order management.
// All routes require admin role (enforced in adminShopRoutes.js).
const fs = require('fs');
const path = require('path');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const Order   = require('../models/Order');
const Collection = require('../models/Collection');
const Setting = require('../models/Setting');
const { streamDeliveryNote, streamBulkDeliveryNotes } = require('../services/pdfService');
const { UPLOAD_ROOT } = require('../config/paths');
const { t }           = require('../i18n');
const { autoTranslateFields } = require('../services/autoTranslateFields');
const { submitLocalized }     = require('../services/indexNow');
const logger                  = require('../logger');

// EN → IS pairs for auto-translation on admin save.
// Shop-redesign section fields (category, subcategory, duration_minutes,
// delivery_format, is_bookable) are language-neutral and deliberately
// excluded — subcategory holds slug-like tags ('apparel', 'tv-wall'), and the
// rest are enums / numbers / booleans.
const PRODUCT_TRANSLATE_PAIRS = [
  ['name',        'name_is',        'plain'],
  ['description', 'description_is', 'markdown'],
];

// Shop redesign step 1 — top-level taxonomy + service-only field enums.
// Kept in sync with the CHECK constraints in migration 045_shop_sections.
const VALID_CATEGORY = ['product', 'tech_service', 'carpentry_service'];
const VALID_DELIVERY = ['remote', 'in_person', 'hybrid'];

// Slugs that collide with the section sub-routes added in step 2 — a product
// with one of these slugs would be unreachable in the UI because the router
// matches /shop/products etc. before the /shop/:slug detail pattern.
const RESERVED_SHOP_SLUGS = new Set(['products', 'tech', 'carpentry']);

// Server-side cap mirroring the admin form's maxlength="60" on the
// subcategory input — keeps non-browser clients from POSTing kilobyte
// blobs into a free-text column without a DB CHECK.
const SUBCATEGORY_MAX_LEN = 60;

function validateSlug(slug) {
  if (typeof slug !== 'string') return false;
  if (RESERVED_SHOP_SLUGS.has(slug)) return false;
  return /^[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?$/.test(slug);
}

// ── Products CSV export/import ───────────────────────────────────────────────
// One canonical header. SKU is the import match key; BIN/Price/Stock/Active are
// importable; Name/Variant/Barcode are export-only context (never written).
const PRODUCT_CSV_HEADER = ['SKU', 'Name', 'Variant', 'Barcode', 'BIN', 'Price ISK', 'Price EUR', 'Stock', 'Active'];
// Fields a CSV row may change — the same set for products and variants (both
// models' update() accept all of these). Stock is written DIRECTLY: HalliProjects
// has no inventory-adjustments audit table, so there's nothing to stay consistent
// with (revisit if an audited stock-adjust feature is ever ported).
const PRODUCT_IMPORT_FIELDS = ['bin', 'price_isk', 'price_eur', 'stock', 'active'];
const MAX_IMPORT_ROWS = 5000;

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function formatVariantAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return '';
  return Object.entries(attrs).map(([k, val]) => `${k}: ${val}`).join(', ');
}

// Map a listForExport() row → the 9 CSV cells. Variant rows carry the variant's
// own sku/bin/money (blank = inherits the product), product rows the product's.
function productExportCells(r) {
  const isVariant = r.variant_id != null;
  const val = (v) => (v == null ? '' : v);
  return [
    isVariant ? val(r.variant_sku) : val(r.product_sku),
    val(r.name),
    isVariant ? formatVariantAttrs(r.attributes) : '',
    val(r.barcode),
    isVariant ? val(r.variant_bin) : val(r.product_bin),
    isVariant ? val(r.variant_price_isk) : val(r.product_price_isk),
    isVariant ? val(r.variant_price_eur) : val(r.product_price_eur),
    isVariant ? val(r.variant_stock) : val(r.product_stock),
    (isVariant ? r.variant_active : r.product_active) ? 'true' : 'false',
  ];
}

// Normalise one client-parsed import row → { values } or { error: 'invalidValue' }.
function normalizeImportRow(row) {
  const out = {};
  for (const f of ['price_isk', 'price_eur', 'stock']) {
    if (row[f] == null || row[f] === '') continue;
    const n = Number(row[f]);
    // Prices must be > 0 (DB CHECK); stock may be 0. Flag up front so preview
    // classifies a bad value as an error rather than failing opaquely on UPDATE.
    const invalid = !Number.isFinite(n) || (f === 'stock' ? n < 0 : n <= 0);
    if (invalid) return { error: 'invalidValue' };
    out[f] = f === 'stock' ? Math.trunc(n) : n;
  }
  if (row.bin != null && String(row.bin).trim() !== '') out.bin = String(row.bin).trim();
  if (row.active != null && String(row.active).trim() !== '') {
    const s = String(row.active).trim().toLowerCase();
    if (['true', '1', 'yes', 'active'].includes(s)) out.active = true;
    else if (['false', '0', 'no', 'inactive'].includes(s)) out.active = false;
    else return { error: 'invalidValue' };
  }
  return { values: out };
}

// Diff normalised values against the current DB row → only changed fields.
function importChanges(values, current) {
  const changes = {};
  for (const f of PRODUCT_IMPORT_FIELDS) {
    if (!(f in values)) continue;
    if (f === 'bin') { if ((current.bin || '') !== values.bin) changes.bin = values.bin; }
    else if (f === 'active') { if (Boolean(current.active) !== values.active) changes.active = values.active; }
    else { const cur = current[f] == null ? null : Number(current[f]); if (cur !== values[f]) changes[f] = values[f]; }
  }
  return changes;
}

// Classify every import row against the DB (shared by preview + apply), variant-first.
async function classifyImportRows(rows) {
  const skus  = rows.map(r => String(r.sku || '').trim()).filter(Boolean);
  const bySku = await Product.findForImport(skus);
  return rows.map((r) => {
    const sku = String(r.sku || '').trim();
    if (!sku) return { sku: '', status: 'error', reason: 'noSku' };
    const match = bySku.get(sku);
    if (!match) return { sku, status: 'unmatched' };
    const norm = normalizeImportRow(r);
    if (norm.error) return { sku, status: 'error', reason: norm.error, kind: match.kind };
    const changes = importChanges(norm.values, match.current);
    if (!Object.keys(changes).length) return { sku, status: 'nochange', kind: match.kind };
    const target = match.kind === 'variant' ? { variantId: match.variantId } : { productId: match.productId };
    return { sku, status: 'update', kind: match.kind, changes, target };
  });
}

// Returns an error message if any section-redesign field is malformed,
// otherwise null. Shared between create + update so both endpoints reject
// the same payloads with the same error shape.
function validateSectionFields(body) {
  if (body.category != null && body.category !== '' && !VALID_CATEGORY.includes(body.category)) {
    return `category must be one of: ${VALID_CATEGORY.join(', ')}`;
  }
  if (body.delivery_format != null && body.delivery_format !== '' &&
      !VALID_DELIVERY.includes(body.delivery_format)) {
    return `delivery_format must be one of: ${VALID_DELIVERY.join(', ')}`;
  }
  if (body.duration_minutes != null && body.duration_minutes !== '') {
    const n = Number(body.duration_minutes);
    if (!Number.isInteger(n) || n <= 0) {
      return 'duration_minutes must be a positive integer';
    }
  }
  if (body.subcategory != null && typeof body.subcategory === 'string' &&
      body.subcategory.length > SUBCATEGORY_MAX_LEN) {
    return `subcategory must be ${SUBCATEGORY_MAX_LEN} characters or fewer`;
  }
  return null;
}

const adminShopController = {
  // ── Products ──────────────────────────────────────────────────────────────

  async listProducts(req, res, next) {
    try {
      const products = await Product.findAll({ activeOnly: false, limit: 200 });
      if (products.length === 0) return res.json({ products: [] });
      const productIds = products.map(p => p.id);
      // Admin needs to see inactive variants too, so activeOnly: false.
      const [images, variants] = await Promise.all([
        Product.listImagesForProducts(productIds),
        ProductVariant.listForProducts(productIds, { activeOnly: false }),
      ]);
      const imagesByProduct   = new Map();
      const variantsByProduct = new Map();
      for (const img of images) {
        const arr = imagesByProduct.get(img.product_id);
        if (arr) arr.push(img); else imagesByProduct.set(img.product_id, [img]);
      }
      for (const v of variants) {
        const arr = variantsByProduct.get(v.product_id);
        if (arr) arr.push(v); else variantsByProduct.set(v.product_id, [v]);
      }
      const withAll = products.map(p => ({
        ...p,
        images:   imagesByProduct.get(p.id)   || [],
        variants: variantsByProduct.get(p.id) || [],
      }));
      return res.json({ products: withAll });
    } catch (err) { next(err); }
  },

  async getProduct(req, res, next) {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: t(req.locale, 'errors.admin.productNotFound'), code: 404 });
      const [images, variants, collections] = await Promise.all([
        Product.listImages(product.id),
        ProductVariant.listForProduct(product.id, { activeOnly: false }),
        Collection.listForProduct(product.id),
      ]);
      return res.json({ product: { ...product, images, variants, collections } });
    } catch (err) { next(err); }
  },

  async createProduct(req, res, next) {
    try {
      // Auto-fill empty IS fields from EN before we pluck fields out of body.
      await autoTranslateFields(req.body, PRODUCT_TRANSLATE_PAIRS);

      const {
        slug, name, description,
        name_is, description_is,
        price_isk, price_eur, stock, weight_grams, shape, capacity_litres, active,
        sku, barcode,
        category, subcategory, duration_minutes, delivery_format, is_bookable,
      } = req.body;
      if (typeof slug === 'string' && RESERVED_SHOP_SLUGS.has(slug)) {
        return res.status(400).json({
          error: `slug '${slug}' is reserved for the /shop/${slug} section page`,
          code: 400,
        });
      }
      if (!validateSlug(slug)) {
        return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens (1-80 chars)', code: 400 });
      }
      if (!name || typeof name !== 'string' || name.length > 200) {
        return res.status(400).json({ error: 'name required (max 200 chars)', code: 400 });
      }
      const priceIsk = Number(price_isk);
      const priceEur = Number(price_eur);
      if (!Number.isInteger(priceIsk) || priceIsk <= 0) {
        return res.status(400).json({ error: 'price_isk must be a positive integer (whole krónur)', code: 400 });
      }
      if (!Number.isInteger(priceEur) || priceEur <= 0) {
        return res.status(400).json({ error: 'price_eur must be a positive integer (eurocents)', code: 400 });
      }
      const VALID_SHAPES = ['aero', 'tall', 'long', 'low', 'cube', 'classic'];
      if (shape != null && !VALID_SHAPES.includes(shape)) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.shapeEnum', { values: VALID_SHAPES.join(', ') }), code: 400 });
      }
      if (sku != null && (typeof sku !== 'string' || sku.length > 100)) {
        return res.status(400).json({ error: 'sku must be a string (max 100 chars)', code: 400 });
      }
      if (barcode != null && (typeof barcode !== 'string' || barcode.length > 64)) {
        return res.status(400).json({ error: 'barcode must be a string (max 64 chars)', code: 400 });
      }
      const sectionErr = validateSectionFields(req.body);
      if (sectionErr) return res.status(400).json({ error: sectionErr, code: 400 });
      const product = await Product.create({
        slug, name,
        description:    description || '',
        name_is:        name_is        || null,
        description_is: description_is || null,
        price_isk: priceIsk,
        price_eur: priceEur,
        stock: Number(stock) || 0,
        weight_grams: weight_grams != null ? Number(weight_grams) : null,
        shape: shape || null,
        capacity_litres: capacity_litres != null ? Number(capacity_litres) : null,
        sku: sku || null,
        barcode: barcode || null,
        category:         category || 'product',
        subcategory:      subcategory || null,
        duration_minutes: duration_minutes != null && duration_minutes !== '' ? Number(duration_minutes) : null,
        delivery_format:  delivery_format || null,
        is_bookable:      Boolean(is_bookable),
        active: active !== false,
      });
      if (product.active) submitLocalized(`/shop/${product.slug}`);
      return res.status(201).json({ product });
    } catch (err) {
      if (err.code === '23505') { // unique_violation on slug
        return res.status(409).json({ error: t(req.locale, 'errors.admin.slugTaken'), code: 409 });
      }
      next(err);
    }
  },

  async updateProduct(req, res, next) {
    try {
      if (req.body.slug !== undefined) {
        if (typeof req.body.slug === 'string' && RESERVED_SHOP_SLUGS.has(req.body.slug)) {
          return res.status(400).json({
            error: `slug '${req.body.slug}' is reserved for the /shop/${req.body.slug} section page`,
            code: 400,
          });
        }
        if (!validateSlug(req.body.slug)) {
          return res.status(400).json({ error: 'invalid slug', code: 400 });
        }
      }
      const sectionErr = validateSectionFields(req.body);
      if (sectionErr) return res.status(400).json({ error: sectionErr, code: 400 });
      // Look up current product so auto-translate won't overwrite manual IS
      // edits when the payload only changes EN fields.
      const existingRow = await Product.findById(req.params.id);
      await autoTranslateFields(req.body, PRODUCT_TRANSLATE_PAIRS, { existingRow });

      const product = await Product.update(req.params.id, req.body);
      if (!product) return res.status(404).json({ error: t(req.locale, 'errors.admin.productNotFound'), code: 404 });
      // Optional collection membership: a `collection_ids` array replaces the
      // product's collections in one PATCH (the editor sends it on save).
      if (Array.isArray(req.body.collection_ids)) {
        await Collection.setForProduct(product.id, req.body.collection_ids);
      }
      // Notify IndexNow for active products. If the slug changed, hit the old
      // one too so Bing drops the now-404 URL from its index.
      if (product.active) {
        submitLocalized(`/shop/${product.slug}`);
        if (existingRow?.slug && existingRow.slug !== product.slug) {
          submitLocalized(`/shop/${existingRow.slug}`);
        }
      }
      return res.json({ product });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: t(req.locale, 'errors.admin.slugAlreadyTaken'), code: 409 });
      }
      next(err);
    }
  },

  async deactivateProduct(req, res, next) {
    try {
      const product = await Product.deactivate(req.params.id);
      if (!product) return res.status(404).json({ error: t(req.locale, 'errors.admin.productNotFound'), code: 404 });
      // Ping IndexNow so Bing re-fetches and drops the now-inactive product.
      submitLocalized(`/shop/${product.slug}`);
      return res.json({ product });
    } catch (err) { next(err); }
  },

  // ── Product images ────────────────────────────────────────────────────────

  async uploadImage(req, res, next) {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: t(req.locale, 'errors.admin.productNotFound'), code: 404 });
      if (!req.file) return res.status(400).json({ error: t(req.locale, 'errors.admin.noFileUploaded'), code: 400 });

      const url = `/assets/products/${product.id}/${req.file.filename}`;
      const image = await Product.addImage(product.id, {
        url,
        alt_text: req.body.alt_text || null,
      });
      return res.status(201).json({ image });
    } catch (err) { next(err); }
  },

  async deleteImage(req, res, next) {
    try {
      const deleted = await Product.deleteImage(req.params.id, req.params.imageId);
      if (!deleted) return res.status(404).json({ error: t(req.locale, 'errors.admin.imageNotFound'), code: 404 });

      // Best-effort unlink the file on disk
      try {
        if (deleted.url && deleted.url.startsWith('/assets/products/')) {
          const rel = deleted.url.replace('/assets/', '');
          const abs = path.join(UPLOAD_ROOT, rel);
          if (abs.startsWith(UPLOAD_ROOT)) fs.unlink(abs, () => {});
        }
      } catch { /* non-fatal */ }

      return res.status(204).send();
    } catch (err) { next(err); }
  },

  async reorderImages(req, res, next) {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array of {id, position}', code: 400 });
      }
      const images = await Product.reorderImages(req.params.id, order);
      return res.json({ images });
    } catch (err) { next(err); }
  },

  // ── Orders ────────────────────────────────────────────────────────────────

  async listOrders(req, res, next) {
    try {
      const { status, paymentStatus, fulfillmentStatus, q, sort, dir } = req.query;
      const filter = {
        status:            status            ? String(status) : null,
        paymentStatus:     paymentStatus     ? String(paymentStatus) : null,
        fulfillmentStatus: fulfillmentStatus ? String(fulfillmentStatus) : null,
        q:                 q                 ? String(q) : null,
      };
      const [orders, total] = await Promise.all([
        Order.listAll({ ...filter, sort: sort ? String(sort) : 'date', dir: dir === 'asc' ? 'asc' : 'desc', limit: 200 }),
        Order.count(filter),
      ]);
      return res.json({ orders, total });
    } catch (err) { next(err); }
  },

  async getOrder(req, res, next) {
    try {
      const order = await Order.findDetailById(req.params.id);
      if (!order) return res.status(404).json({ error: t(req.locale, 'errors.admin.orderNotFound'), code: 404 });
      const items = await Order.listItems(order.id);
      return res.json({ order, items });
    } catch (err) { next(err); }
  },

  // ── Product variants ──────────────────────────────────────────────────────

  async listVariants(req, res, next) {
    try {
      const variants = await ProductVariant.listForProduct(req.params.id, { activeOnly: false });
      return res.json({ variants });
    } catch (err) { next(err); }
  },

  async createVariant(req, res, next) {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: t(req.locale, 'errors.admin.productNotFound'), code: 404 });

      const { sku, attributes, price_isk, price_eur, stock, active } = req.body || {};
      if (!sku || typeof sku !== 'string' || sku.length > 100) {
        return res.status(400).json({ error: 'sku is required (max 100 chars)', code: 400 });
      }
      if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
        return res.status(400).json({ error: 'attributes must be an object', code: 400 });
      }

      const variant = await ProductVariant.create({
        product_id: product.id,
        sku, attributes,
        price_isk: price_isk != null ? Number(price_isk) : null,
        price_eur: price_eur != null ? Number(price_eur) : null,
        stock: Number(stock) || 0,
        active: active !== false,
      });
      return res.status(201).json({ variant });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          error: t(req.locale, 'errors.admin.variantAttrsTaken'),
          code: 409,
        });
      }
      next(err);
    }
  },

  async updateVariant(req, res, next) {
    try {
      const variant = await ProductVariant.update(req.params.variantId, req.body || {});
      if (!variant) return res.status(404).json({ error: t(req.locale, 'errors.admin.variantNotFound'), code: 404 });
      return res.json({ variant });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: t(req.locale, 'errors.admin.skuTaken'), code: 409 });
      }
      next(err);
    }
  },

  async deactivateVariant(req, res, next) {
    try {
      const variant = await ProductVariant.update(req.params.variantId, { active: false });
      if (!variant) return res.status(404).json({ error: t(req.locale, 'errors.admin.variantNotFound'), code: 404 });
      return res.json({ variant });
    } catch (err) { next(err); }
  },

  async updateOrderStatus(req, res, next) {
    try {
      let { payment_status, fulfillment_status } = req.body || {};
      // Back-compat: a legacy { status: 'shipped' | 'cancelled' } maps onto the
      // new independent payment/fulfillment statuses.
      const legacy = req.body?.status;
      if (!payment_status && !fulfillment_status && legacy) {
        if (legacy === 'shipped')        fulfillment_status = 'fulfilled';
        else if (legacy === 'cancelled') payment_status = 'voided';
      }
      if (!payment_status && !fulfillment_status) {
        return res.status(400).json({ error: 'payment_status or fulfillment_status required', code: 400 });
      }
      const order = await Order.setOrderStatuses(req.params.id, { payment_status, fulfillment_status });
      if (!order) return res.status(404).json({ error: t(req.locale, 'errors.admin.orderNotFound'), code: 404 });
      return res.json({ order });
    } catch (err) {
      if (String(err.message || '').startsWith('Invalid ')) {
        return res.status(400).json({ error: err.message, code: 400 });
      }
      next(err);
    }
  },

  async updateOrderTags(req, res, next) {
    try {
      const { tags } = req.body || {};
      if (!Array.isArray(tags)) {
        return res.status(400).json({ error: 'tags must be an array of strings', code: 400 });
      }
      const order = await Order.updateTags(req.params.id, tags);
      if (!order) return res.status(404).json({ error: t(req.locale, 'errors.admin.orderNotFound'), code: 404 });
      return res.json({ order });
    } catch (err) { next(err); }
  },

  // ── Reports ─────────────────────────────────────────────────────────────────

  async salesReport(req, res, next) {
    try {
      const days = Number(req.query.days) || 30;
      const report = await Order.salesReport({ days });
      return res.json({ report });
    } catch (err) { next(err); }
  },

  // GET /api/v1/admin/shop/orders/:id/delivery-note → streams an A4 PDF.
  async deliveryNote(req, res, next) {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ error: t(req.locale, 'errors.admin.orderNotFound'), code: 404 });
      const [items, store] = await Promise.all([
        Order.listItems(order.id),
        Setting.getGeneralSettings(),
      ]);
      return streamDeliveryNote({ res, order, items, store });
    } catch (err) { next(err); }
  },

  // GET /api/v1/admin/shop/orders/bulk/delivery-notes.pdf?ids=1,2,3
  // → one combined PDF, a page per order, so a batch prints in a single job.
  async getBulkDeliveryNotes(req, res, next) {
    try {
      const ids = String(req.query.ids || '')
        .split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);
      if (!ids.length) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.bulkIdsInvalid'), code: 400 });
      }
      const store  = await Setting.getGeneralSettings();
      const found  = await Promise.all(ids.map(async (id) => {
        const order = await Order.findById(id);
        if (!order) return null;
        const items = await Order.listItems(order.id);
        return { order, items };
      }));
      const orders = found.filter(Boolean);
      if (!orders.length) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.orderNotFound'), code: 404 });
      }
      return streamBulkDeliveryNotes({ res, orders, store });
    } catch (err) { next(err); }
  },

  // ── Products CSV ──────────────────────────────────────────────────────────────

  // GET /api/v1/admin/shop/products/export.csv → full catalogue, one row per unit.
  async exportProducts(req, res, next) {
    try {
      const rows  = await Product.listForExport();
      const lines = [PRODUCT_CSV_HEADER, ...rows.map(productExportCells)]
        .map(cells => cells.map(csvCell).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',
        `attachment; filename="products-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(String.fromCharCode(0xFEFF) + lines);
    } catch (err) { next(err); }
  },

  // POST /api/v1/admin/shop/products/import/preview → classify rows (read-only).
  async previewProductImport(req, res, next) {
    try {
      const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
      if (!rows) return res.status(400).json({ error: t(req.locale, 'errors.admin.importRowsRequired'), code: 400 });
      if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: t(req.locale, 'errors.admin.importTooManyRows'), code: 400 });
      const classified = await classifyImportRows(rows);
      const counts = { update: 0, nochange: 0, unmatched: 0, error: 0 };
      for (const c of classified) counts[c.status] = (counts[c.status] || 0) + 1;
      return res.json({
        counts,
        rows: classified.map(c => ({
          sku: c.sku, status: c.status, kind: c.kind || null,
          reason: c.reason || null, changes: c.changes ? Object.keys(c.changes) : null,
        })),
      });
    } catch (err) { next(err); }
  },

  // POST /api/v1/admin/shop/products/import/apply → apply updates, existing rows
  // only (never create/delete). Stock is written directly (no audit table here).
  async applyProductImport(req, res, next) {
    try {
      const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
      if (!rows) return res.status(400).json({ error: t(req.locale, 'errors.admin.importRowsRequired'), code: 400 });
      if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: t(req.locale, 'errors.admin.importTooManyRows'), code: 400 });
      const classified = await classifyImportRows(rows);
      let updated = 0, skipped = 0, failed = 0;
      for (const c of classified) {
        if (c.status !== 'update') { skipped += 1; continue; }
        try {
          if (c.kind === 'variant') await ProductVariant.update(c.target.variantId, c.changes);
          else await Product.update(c.target.productId, c.changes);
          updated += 1;
        } catch (err) {
          failed += 1;
          logger.warn({ err, sku: c.sku }, 'product CSV import: row update failed');
        }
      }
      return res.json({ updated, skipped, failed, total: rows.length });
    } catch (err) { next(err); }
  },

  // ── Collections ─────────────────────────────────────────────────────────────

  async listCollections(req, res, next) {
    try {
      const collections = await Collection.findAll({ activeOnly: false });
      return res.json({ collections });
    } catch (err) { next(err); }
  },

  async createCollection(req, res, next) {
    try {
      const { slug, title, description, active } = req.body || {};
      if (!validateSlug(slug)) {
        return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens (1-80 chars)', code: 400 });
      }
      if (!title || typeof title !== 'string' || title.length > 200) {
        return res.status(400).json({ error: 'title required (max 200 chars)', code: 400 });
      }
      const collection = await Collection.create({ slug, title, description: description || null, active: active !== false });
      return res.status(201).json({ collection });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: t(req.locale, 'errors.admin.slugTaken'), code: 409 });
      }
      next(err);
    }
  },

  async updateCollection(req, res, next) {
    try {
      if (req.body.slug !== undefined && !validateSlug(req.body.slug)) {
        return res.status(400).json({ error: 'invalid slug', code: 400 });
      }
      const collection = await Collection.update(req.params.id, req.body || {});
      if (!collection) return res.status(404).json({ error: 'collection not found', code: 404 });
      return res.json({ collection });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: t(req.locale, 'errors.admin.slugTaken'), code: 409 });
      }
      next(err);
    }
  },

  async setProductCollections(req, res, next) {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: t(req.locale, 'errors.admin.productNotFound'), code: 404 });
      const ids = Array.isArray(req.body.collection_ids) ? req.body.collection_ids : [];
      const collections = await Collection.setForProduct(product.id, ids);
      return res.json({ collections });
    } catch (err) { next(err); }
  },
};

module.exports = adminShopController;
