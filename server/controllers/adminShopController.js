// Admin shop management — products CRUD, product images, order management.
// All routes require admin role (enforced in adminShopRoutes.js).
const fs = require('fs');
const path = require('path');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const Order   = require('../models/Order');
const { UPLOAD_ROOT } = require('../config/paths');

function validateSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?$/.test(slug);
}

const adminShopController = {
  // ── Products ──────────────────────────────────────────────────────────────

  async listProducts(req, res, next) {
    try {
      const products = await Product.findAll({ activeOnly: false, limit: 200 });
      // Attach first image + variants (admin needs to see inactive variants too)
      const withAll = await Promise.all(products.map(async (p) => {
        const [images, variants] = await Promise.all([
          Product.listImages(p.id),
          ProductVariant.listForProduct(p.id, { activeOnly: false }),
        ]);
        return { ...p, images, variants };
      }));
      return res.json({ products: withAll });
    } catch (err) { next(err); }
  },

  async getProduct(req, res, next) {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found', code: 404 });
      const [images, variants] = await Promise.all([
        Product.listImages(product.id),
        ProductVariant.listForProduct(product.id, { activeOnly: false }),
      ]);
      return res.json({ product: { ...product, images, variants } });
    } catch (err) { next(err); }
  },

  async createProduct(req, res, next) {
    try {
      const { slug, name, description, price_isk, price_eur, stock, weight_grams, shape, capacity_litres, active } = req.body;
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
        return res.status(400).json({ error: `shape must be one of: ${VALID_SHAPES.join(', ')}`, code: 400 });
      }
      const product = await Product.create({
        slug, name,
        description: description || '',
        price_isk: priceIsk,
        price_eur: priceEur,
        stock: Number(stock) || 0,
        weight_grams: weight_grams != null ? Number(weight_grams) : null,
        shape: shape || null,
        capacity_litres: capacity_litres != null ? Number(capacity_litres) : null,
        active: active !== false,
      });
      return res.status(201).json({ product });
    } catch (err) {
      if (err.code === '23505') { // unique_violation on slug
        return res.status(409).json({ error: 'A product with that slug already exists', code: 409 });
      }
      next(err);
    }
  },

  async updateProduct(req, res, next) {
    try {
      if (req.body.slug !== undefined && !validateSlug(req.body.slug)) {
        return res.status(400).json({ error: 'invalid slug', code: 400 });
      }
      const product = await Product.update(req.params.id, req.body);
      if (!product) return res.status(404).json({ error: 'Product not found', code: 404 });
      return res.json({ product });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Slug already taken', code: 409 });
      }
      next(err);
    }
  },

  async deactivateProduct(req, res, next) {
    try {
      const product = await Product.deactivate(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found', code: 404 });
      return res.json({ product });
    } catch (err) { next(err); }
  },

  // ── Product images ────────────────────────────────────────────────────────

  async uploadImage(req, res, next) {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found', code: 404 });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded', code: 400 });

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
      if (!deleted) return res.status(404).json({ error: 'Image not found', code: 404 });

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
      const status = req.query.status || null;
      const orders = await Order.listAll({ status, limit: 200 });
      return res.json({ orders });
    } catch (err) { next(err); }
  },

  async getOrder(req, res, next) {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Order not found', code: 404 });
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
      if (!product) return res.status(404).json({ error: 'Product not found', code: 404 });

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
          error: 'A variant with those attributes (or that SKU) already exists',
          code: 409,
        });
      }
      next(err);
    }
  },

  async updateVariant(req, res, next) {
    try {
      const variant = await ProductVariant.update(req.params.variantId, req.body || {});
      if (!variant) return res.status(404).json({ error: 'Variant not found', code: 404 });
      return res.json({ variant });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'SKU already in use', code: 409 });
      }
      next(err);
    }
  },

  async deactivateVariant(req, res, next) {
    try {
      const variant = await ProductVariant.update(req.params.variantId, { active: false });
      if (!variant) return res.status(404).json({ error: 'Variant not found', code: 404 });
      return res.json({ variant });
    } catch (err) { next(err); }
  },

  async updateOrderStatus(req, res, next) {
    try {
      const { status } = req.body;
      const allowed = ['shipped', 'cancelled'];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Admins may set status to one of: ${allowed.join(', ')}`,
          code: 400,
        });
      }
      const order = await Order.updateStatus(req.params.id, status);
      if (!order) return res.status(404).json({ error: 'Order not found', code: 404 });
      return res.json({ order });
    } catch (err) { next(err); }
  },
};

module.exports = adminShopController;
