// Admin shop management — products CRUD, product images, order management.
// All routes require admin role (enforced in adminShopRoutes.js).
const fs = require('fs');
const path = require('path');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const Inventory = require('../models/Inventory');
const Order   = require('../models/Order');
const Collection = require('../models/Collection');
const Setting = require('../models/Setting');
const { streamDeliveryNote, streamBulkDeliveryNotes } = require('../services/pdfService');
const { UPLOAD_ROOT } = require('../config/paths');
const { normaliseUpload, thumbPathFor } = require('../services/productImages');
const orderExport = require('../services/orderExport');
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
// One canonical column table (harvested from icelandicstore #249/#300/#302 —
// harvest-ice-d-2026-09-24): [header, field, kind]. `key` = a match key (SKU,
// then Barcode as the fallback — never written), `str`/`int`/`bool` = what an
// update may change, `ctx`/`display` = context the variant-creating import
// reads (Name, Variant, Slug). The export writes the first nine columns; every
// uploaded file — the export's own CSV, a supplier .xlsx, a PDF order or price
// list — is read SERVER-side by services/productImport/parseFile against this
// table plus the supplier synonyms in headerMap.js.
const PRODUCT_CSV_COLUMNS = [
  ['SKU',       'sku',       'key'],
  ['Name',      'name',      'ctx'],
  ['Variant',   '__variant', 'display'],
  ['Barcode',   'barcode',   'key'],
  ['BIN',       'bin',       'str'],
  ['Price ISK', 'price_isk', 'int'],
  ['Price EUR', 'price_eur', 'int'],
  ['Stock',     'stock',     'int'],
  ['Active',    'active',    'bool'],
  ['Slug',      'slug',      'display'],
];
const PRODUCT_CSV_HEADER = PRODUCT_CSV_COLUMNS.slice(0, 9).map(c => c[0]);
// Fields a row may change — the same set for products and variants (both
// models' update() accept all of these). A stock change is NOT a plain write:
// the models move it through Inventory.setAbsolute, so each imported figure
// lands in inventory_adjustments with reason 'import' and the admin who ran it
// (harvest-ice-c-2026-09-24).
const PRODUCT_IMPORT_FIELDS = ['bin', 'price_isk', 'price_eur', 'stock', 'active'];
const MAX_IMPORT_ROWS = 5000;

const { parseProductImportFile, ProductImportParseError } = require('../services/productImport/parseFile');
const { formatVariantCell } = require('../services/productImport/variantCell');
const { buildVariantGroups, refuseGroup } = require('../services/productImport/variantGroups');
const { foldSlug } = require('../utils/slug');

// ProductImportParseError.reason → i18n key.
const IMPORT_PARSE_MESSAGES = {
  empty:              'errors.admin.importFileRequired',
  unsupportedType:    'errors.admin.importUnsupportedFile',
  unreadable:         'errors.admin.importUnreadableFile',
  noText:             'errors.admin.importPdfNoText',
  noIdentifierColumn: 'errors.admin.importNoIdentifierColumn',
  noRows:             'errors.admin.importNoDataRows',
};

// Was a local copy that quoted correctly but did NOT neutralise leading
// = + - @, so a product name or variant attribute beginning with one of those
// became a live formula in the exported sheet. Now shared with the books exports.
const { csvCell } = require('../utils/csv');

// Map a listForExport() row → the 9 CSV cells. Variant rows carry the variant's
// own sku/bin/money (blank = inherits the product), product rows the product's.
// The Variant cell is written by the ONE formatter the import parses back
// (variantCell.js), in the product's axis order.
function productExportCells(r) {
  const isVariant = r.variant_id != null;
  const val = (v) => (v == null ? '' : v);
  return [
    isVariant ? val(r.variant_sku) : val(r.product_sku),
    val(r.name),
    isVariant ? formatVariantCell(r.attributes, Array.isArray(r.variant_axes) ? r.variant_axes : []) : '',
    val(r.barcode),
    isVariant ? val(r.variant_bin) : val(r.product_bin),
    isVariant ? val(r.variant_price_isk) : val(r.product_price_isk),
    isVariant ? val(r.variant_price_eur) : val(r.product_price_eur),
    isVariant ? val(r.variant_stock) : val(r.product_stock),
    (isVariant ? r.variant_active : r.product_active) ? 'true' : 'false',
  ];
}

// Normalise one import row → { values } or { error: 'invalidValue', errorField }.
function normalizeImportRow(row) {
  const out = {};
  for (const f of ['price_isk', 'price_eur', 'stock']) {
    if (row[f] == null || row[f] === '') continue;
    // A supplier cell may read "1.234" or "1 234" (Icelandic thousands); a
    // decimal comma is not a whole number and is refused below.
    const n = Number(String(row[f]).replace(/[\s.](?=\d{3}(\D|$))/g, ''));
    // Prices must be > 0 (DB CHECK); stock may be 0. Flag up front so preview
    // classifies a bad value as an error rather than failing opaquely on UPDATE.
    const invalid = !Number.isFinite(n) || !Number.isInteger(n) || (f === 'stock' ? n < 0 : n <= 0);
    if (invalid) return { error: 'invalidValue', errorField: f };
    out[f] = n;
  }
  if (row.bin != null && String(row.bin).trim() !== '') out.bin = String(row.bin).trim();
  if (row.active != null && String(row.active).trim() !== '') {
    const s = String(row.active).trim().toLowerCase();
    if (['true', '1', 'yes', 'active', 'já', 'ja', 'virk'].includes(s)) out.active = true;
    else if (['false', '0', 'no', 'inactive', 'nei', 'óvirk', 'draft'].includes(s)) out.active = false;
    else return { error: 'invalidValue', errorField: 'active' };
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

// A generated slug for a new product: fold the name, take the next free suffix,
// never a reserved section slug.
async function freeSlug(name, taken) {
  const base = (foldSlug(name) || 'product').slice(0, 72).replace(/-+$/, '') || 'product';
  const used = new Set([...(await Product.slugsLike(base)), ...taken]);
  let slug = base;
  for (let i = 2; used.has(slug) || RESERVED_SHOP_SLUGS.has(slug); i += 1) slug = `${base}-${i}`;
  taken.add(slug);
  return slug;
}

// Classify every import row against the DB (shared by preview + apply).
// Match order: SKU (variant-first), then Barcode as the FALLBACK key — a
// supplier file carries our GTIN and their article number, never our SKU (ice
// #249). A SKU or barcode twice in one file, or a barcode on two catalogue
// rows, is refused, never guessed. With `create` on, unmatched rows that carry
// a Variant cell ("size: M, color: Black") group into ONE new product per name
// (or Slug) with those rows as its variants, created whole or not at all (ice
// #302). An unmatched row without a Variant cell stays unmatched: this import
// never creates single products.
async function classifyImportRows(rows, { create = false } = {}) {
  const count = (field) => {
    const m = new Map();
    for (const r of rows) {
      const v = String(r?.[field] == null ? '' : r[field]).trim();
      if (v) m.set(v, (m.get(v) || 0) + 1);
    }
    return m;
  };
  const skuCounts = count('sku');
  const barcodeCounts = count('barcode');
  const [bySku, byBarcode] = await Promise.all([
    Product.findForImport([...skuCounts.keys()]),
    Product.findForImportByBarcode([...barcodeCounts.keys()]),
  ]);

  const groupRows = [];
  const results = rows.map((r, index) => {
    const sku     = String(r?.sku == null ? '' : r.sku).trim();
    const barcode = String(r?.barcode == null ? '' : r.barcode).trim();
    const variant = String(r?.__variant == null ? '' : r.__variant).trim();
    const label   = sku || barcode;
    const groupable = create && variant && !(sku && bySku.has(sku));
    // A grid cell refused here still joins its siblings, so the product is
    // refused whole rather than created without it.
    const defer = (error, fields = null) => {
      groupRows.push({
        index, sku: label, barcode, variant,
        slug: String(r?.slug == null ? '' : r.slug).trim().toLowerCase(),
        fields: fields || { name: r?.name == null ? undefined : String(r.name).trim() },
        error,
      });
      return null;
    };

    if (!sku && !barcode) return groupable ? defer({ reason: 'noSku' }) : { sku: '', status: 'error', reason: 'noSku' };
    if (sku && skuCounts.get(sku) > 1) {
      return groupable ? defer({ reason: 'duplicateSku' }) : { sku, status: 'error', reason: 'duplicateSku' };
    }
    let match = sku ? bySku.get(sku) : undefined;
    if (!match && barcode) {
      if (barcodeCounts.get(barcode) > 1) {
        return groupable ? defer({ reason: 'duplicateBarcode', errorField: 'barcode' })
          : { sku: label, status: 'error', reason: 'duplicateBarcode' };
      }
      const hit = byBarcode.get(barcode);
      if (hit && hit.ambiguous) return { sku: label, status: 'error', reason: 'ambiguousBarcode' };
      // A NEW grid cell whose barcode is already another row's is a collision.
      if (hit && groupable && sku) return defer({ reason: 'barcodeTaken', errorField: 'barcode' });
      if (hit) match = hit;
    }
    if (!match) {
      if (!groupable || !sku) return groupable ? defer({ reason: 'noSku' }) : { sku: label, status: 'unmatched' };
      const norm = normalizeImportRow(r);
      if (norm.error) return defer({ reason: norm.error, errorField: norm.errorField });
      const name = r?.name == null ? '' : String(r.name).trim();
      return defer(null, { ...norm.values, ...(name ? { name } : {}), ...(barcode ? { barcode } : {}) });
    }
    // A row read from a PDF by AI (aiExtract marks it __ai) may only CREATE:
    // its codes were checked when the PDF was read, but a code can become ours
    // before Apply, and Apply re-runs this. Never an update (ice #306).
    if (r && r.__ai === true) return { sku: label, status: 'error', reason: 'aiCreateOnly', kind: match.kind };
    const norm = normalizeImportRow(r);
    if (norm.error) return { sku: label, status: 'error', reason: norm.error, errorField: norm.errorField, kind: match.kind };
    const changes = importChanges(norm.values, match.current);
    if (!Object.keys(changes).length) return { sku: label, status: 'nochange', kind: match.kind };
    const target = match.kind === 'variant' ? { variantId: match.variantId } : { productId: match.productId };
    return { sku: label, status: 'update', kind: match.kind, changes, target };
  });
  if (!groupRows.length) return results;

  // The groups: the pure grouper settles what the file alone decides; the
  // catalogue checks (a product already at that slug or name, a barcode already
  // on a row) come after and refuse the whole group — "add variants to an
  // existing product" is not an import.
  const { groups, byIndex } = buildVariantGroups(groupRows);
  const okGroups = groups.filter(g => g.ok);
  const [existing, barcodesInUse] = await Promise.all([
    Product.findExistingForGroups({
      slugs: okGroups.map(g => g.slugGiven).filter(Boolean),
      names: okGroups.map(g => g.name).filter(Boolean),
    }),
    Product.findBarcodesInUse(okGroups.flatMap(g => g.variants.map(v => v.barcode).filter(Boolean))),
  ]);
  const usedBarcodes = new Set(barcodesInUse);
  const takenSlugs = new Set();
  for (const g of okGroups) {
    if (g.slugGiven && !validateSlug(g.slugGiven)) { refuseGroup(g, byIndex, 'invalidValue', { errorField: 'slug' }); continue; }
    if ((g.slugGiven && existing.slugs.has(g.slugGiven)) || existing.names.has(String(g.name).toLowerCase())) {
      refuseGroup(g, byIndex, 'groupExists'); continue;
    }
    const taken = g.variants.find(v => v.barcode && usedBarcodes.has(v.barcode));
    if (taken) { refuseGroup(g, byIndex, 'barcodeTaken', { index: taken.index, errorField: 'barcode' }); continue; }
    g.slug = g.slugGiven && !takenSlugs.has(g.slugGiven) ? g.slugGiven : await freeSlug(g.name, takenSlugs);
    takenSlugs.add(g.slug);
  }
  const REASON = { variant_invalid: 'variantInvalid', variant_ambiguous: 'variantInvalid', variant_price_required: 'priceRequired',
    variant_axes_mismatch: 'axesMismatch', variant_duplicate: 'variantDuplicate', group_field_conflict: 'groupConflict',
    create_missing_fields: 'nameRequired', group_refused: 'groupRefused' };
  for (const gr of groupRows) {
    const verdict = byIndex.get(gr.index);
    const g = verdict.group;
    const group = g ? { key: g.key, name: g.name, count: g.rows.length, axes: g.axes, ok: g.ok, slug: g.slug || null } : null;
    if (!verdict.ok) {
      results[gr.index] = { sku: gr.sku, status: 'error', reason: REASON[verdict.reason] || verdict.reason,
        errorField: verdict.errorField || null, group };
      continue;
    }
    results[gr.index] = { sku: gr.sku, status: 'create', group, _group: g };
  }
  return results;
}

// The client-facing shape of a classified row (never the model targets).
function importRowView(c) {
  return {
    sku: c.sku, status: c.status, kind: c.kind || null,
    reason: c.reason || null, errorField: c.errorField || null,
    changes: c.changes ? Object.keys(c.changes) : null,
    group: c.group ? { name: c.group.name, count: c.group.count, axes: c.group.axes, slug: c.group.slug } : null,
  };
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

// Fields the bulk Edit… action may set on many products at once (harvested from
// icelandicstore #247, cut to the engine's columns). Deliberately no
// name/slug/price/stock: those are per-product by nature, and stock has its own
// audited path.
const BULK_EDIT_FIELDS = ['category', 'subcategory', 'vat_rate', 'active', 'bin'];
const BIN_MAX_LEN = 40;

// The acting admin, for the audit rows.
function actorId(req) { return (req.user && req.user.id) || null; }

// A stock figure from an admin body: absent → undefined (leave it), else a
// whole number ≥ 0 or a localised 400 via the returned error string.
function stockError(req, body) {
  if (!body || body.stock === undefined || body.stock === null || body.stock === '') return null;
  const n = Number(body.stock);
  if (!Number.isInteger(n) || n < 0) return t(req.locale, 'errors.inventory.stockInvalid');
  if (body.stock_reason !== undefined && body.stock_reason !== null && body.stock_reason !== ''
      && !Inventory.ADJUSTMENT_REASONS.includes(body.stock_reason)) {
    return t(req.locale, 'errors.inventory.reasonInvalid');
  }
  if (body.stock_note != null && (typeof body.stock_note !== 'string' || body.stock_note.length > 500)) {
    return t(req.locale, 'errors.inventory.reasonInvalid');
  }
  return null;
}

// The reason + note the admin gave for a stock change (validated by stockError).
function stockOpts(req, body) {
  return {
    userId: actorId(req),
    stockReason: (body && body.stock_reason) || 'correction',
    stockNote: (body && typeof body.stock_note === 'string' && body.stock_note.trim()) ? body.stock_note.trim() : null,
  };
}

// INSUFFICIENT_STOCK (models/Inventory.js) → a localised 409 naming the line.
async function insufficientStockResponse(req, res, err) {
  let name = '';
  try {
    if (err.variantId) {
      const v = await ProductVariant.findById(err.variantId);
      const p = v ? await Product.findById(v.product_id) : null;
      name = p ? `${p.name} (${v.sku})` : '';
    } else if (err.productId) {
      const p = await Product.findById(err.productId);
      name = p ? p.name : '';
    }
  } catch { /* name is decoration */ }
  return res.status(409).json({
    error: t(req.locale, 'errors.inventory.insufficientStock', { name, onHand: err.onHand, wanted: err.wanted }),
    code: 409, reason: 'INSUFFICIENT_STOCK',
  });
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
      // on_hand / committed / available on each product and variant.
      await Inventory.decorate(withAll);
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
      // on_hand / committed / available on the product and each variant.
      const full = await Inventory.decorate({ ...product, images, variants, collections });
      return res.json({ product: full });
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
        sku, barcode, vat_rate,
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
      const stockErr = stockError(req, req.body);
      if (stockErr) return res.status(400).json({ error: stockErr, code: 400 });
      const product = await Product.create({
        slug, name,
        description:    description || '',
        name_is:        name_is        || null,
        description_is: description_is || null,
        price_isk: priceIsk,
        // VSK rate charged on this product. Defaults to the standard 24%; 11% is a
        // closed statutory list (books, printed matter, food) — server/utils/vat.js.
        vat_rate: vat_rate === undefined ? 24 : Number(vat_rate),
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
      }, { userId: actorId(req) });
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
      const stockErr = stockError(req, req.body);
      if (stockErr) return res.status(400).json({ error: stockErr, code: 400 });
      // Look up current product so auto-translate won't overwrite manual IS
      // edits when the payload only changes EN fields.
      const existingRow = await Product.findById(req.params.id);
      await autoTranslateFields(req.body, PRODUCT_TRANSLATE_PAIRS, { existingRow });

      const product = await Product.update(req.params.id, req.body, stockOpts(req, req.body));
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

  // GET /products/:id/adjustments — the stock audit trail of one product (its
  // variants included), newest first: who moved how much, why, which order.
  async productAdjustments(req, res, next) {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: t(req.locale, 'errors.admin.productNotFound'), code: 404 });
      const adjustments = await Inventory.history(product.id, { limit: req.query.limit });
      return res.json({ adjustments });
    } catch (err) { next(err); }
  },

  // POST /products/bulk  { ids:[], action:'activate'|'deactivate' }
  //                      { ids:[], action:'edit', fields:{ … } }
  // Bulk actions from the products list (harvested from icelandicstore #247).
  // 'edit' applies the BULK_EDIT_FIELDS subset to every selected product, each
  // value checked by the same rules the product form's save uses.
  async bulkUpdateProducts(req, res, next) {
    try {
      const { ids, action, fields } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100
          || ids.some(x => typeof x !== 'string' || !x || x.length > 64)) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.bulkProductIdsInvalid'), code: 400 });
      }
      if (!['activate', 'deactivate', 'edit'].includes(action)) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.bulkActionInvalid'), code: 400 });
      }
      let patch;
      if (action === 'edit') {
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
          return res.status(400).json({ error: t(req.locale, 'errors.admin.bulkFieldsInvalid'), code: 400 });
        }
        patch = {};
        for (const [k, v] of Object.entries(fields)) {
          if (!BULK_EDIT_FIELDS.includes(k)) {
            return res.status(400).json({ error: t(req.locale, 'errors.admin.bulkFieldsInvalid'), code: 400 });
          }
          if (v === undefined || v === null || v === '') continue;
          patch[k] = v;
        }
        if (!Object.keys(patch).length) {
          return res.status(400).json({ error: t(req.locale, 'errors.admin.bulkFieldsInvalid'), code: 400 });
        }
        const sectionErr = validateSectionFields(patch);
        if (sectionErr) return res.status(400).json({ error: sectionErr, code: 400 });
        if (patch.vat_rate !== undefined && ![0, 11, 24].includes(Number(patch.vat_rate))) {
          return res.status(400).json({ error: t(req.locale, 'errors.admin.bulkFieldsInvalid'), code: 400 });
        }
        if (patch.active !== undefined && typeof patch.active !== 'boolean') {
          return res.status(400).json({ error: t(req.locale, 'errors.admin.bulkFieldsInvalid'), code: 400 });
        }
        if (patch.bin !== undefined && (typeof patch.bin !== 'string' || patch.bin.trim().length > BIN_MAX_LEN)) {
          return res.status(400).json({ error: t(req.locale, 'errors.admin.bulkFieldsInvalid'), code: 400 });
        }
        if (patch.vat_rate !== undefined) patch.vat_rate = Number(patch.vat_rate);
        if (typeof patch.bin === 'string') patch.bin = patch.bin.trim();
      } else {
        patch = { active: action === 'activate' };
      }
      const updated = await Product.bulkEdit(ids, patch);
      return res.json({ updated: updated.length });
    } catch (err) { next(err); }
  },

  // ── Product images ────────────────────────────────────────────────────────

  async uploadImage(req, res, next) {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: t(req.locale, 'errors.admin.productNotFound'), code: 404 });
      if (!req.file) return res.status(400).json({ error: t(req.locale, 'errors.admin.noFileUploaded'), code: 400 });

      // Auto-orient, cap the long edge, strip metadata — and prove the bytes
      // decode (services/productImages.js, ice #240/#241/#242). The magic-byte
      // check already ran; a file that sharp cannot decode would otherwise be
      // stored and served as a broken <img>.
      try {
        await normaliseUpload(req.file.path, req.file.mimetype);
      } catch (err) {
        if (err.code !== 'UNREADABLE_IMAGE') throw err;
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: t(req.locale, 'errors.upload.productImage.unreadable'), code: 400 });
      }

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
          // Compare the RELATIVE path: a sibling like '/app/uploads-old/x' starts
          // with '/app/uploads' too.
          const relPath = path.relative(UPLOAD_ROOT, abs);
          if (relPath && !relPath.startsWith('..') && !path.isAbsolute(relPath)) {
            fs.unlink(abs, () => {});
            fs.unlink(thumbPathFor(abs), () => {}); // the on-demand thumbnail, if one was ever made
          }
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
      const stockErr = stockError(req, req.body);
      if (stockErr) return res.status(400).json({ error: stockErr, code: 400 });
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
      }, { userId: actorId(req) });
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
      const stockErr = stockError(req, req.body);
      if (stockErr) return res.status(400).json({ error: stockErr, code: 400 });
      // A variant of ANOTHER product is not this route's to edit.
      const owned = await ProductVariant.findById(req.params.variantId);
      if (!owned || String(owned.product_id) !== String(req.params.id)) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.variantNotFound'), code: 404 });
      }
      // stockOpts: a stock cell edit lands in inventory_adjustments naming who
      // moved it (the variant grid PATCHes one field at a time — ice #275).
      const variant = await ProductVariant.update(req.params.variantId, req.body || {}, stockOpts(req, req.body));
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
      // Fulfilment moves on hand here (Order.setOrderStatuses → Inventory), with
      // the acting admin on the audit rows.
      const order = await Order.setOrderStatuses(req.params.id, { payment_status, fulfillment_status }, { userId: actorId(req) });
      if (!order) return res.status(404).json({ error: t(req.locale, 'errors.admin.orderNotFound'), code: 404 });
      return res.json({ order });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_STOCK') return insufficientStockResponse(req, res, err);
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

  // POST /api/v1/admin/shop/products/import/parse-file (multipart, field `file`)
  // → { source, rows, headers, ignored, orderQtyColumns, importableFields,
  //     truncated }. The ONE reader for every product file — the export's own
  //     CSV, a supplier .xlsx, a generated PDF order or price list (ice #249/#300).
  // Memory-only, never stored; the rows go back through preview → apply.
  async parseProductImportFile(req, res, next) {
    try {
      if (!req.file) return res.status(400).json({ error: t(req.locale, 'errors.admin.importFileRequired'), code: 400 });
      let parsed;
      try {
        parsed = await parseProductImportFile(req.file, { columns: PRODUCT_CSV_COLUMNS, maxRows: MAX_IMPORT_ROWS });
      } catch (err) {
        if (!(err instanceof ProductImportParseError)) throw err;
        // The reader's own error rides on `cause`; log it so an "unreadable"
        // 400 leaves a trace, never the file's contents.
        logger.warn({
          reason: err.reason, filename: String(req.file.originalname || '').slice(0, 120),
          mimetype: req.file.mimetype, size: req.file.size,
          cause: err.cause ? { name: err.cause.name, message: err.cause.message } : null,
        }, 'product import: file not readable');
        return res.status(400).json({
          error: t(req.locale, IMPORT_PARSE_MESSAGES[err.reason] || 'errors.admin.importUnreadableFile'),
          code: 400, reason: err.reason,
        });
      }
      return res.json(parsed);
    } catch (err) { next(err); }
  },

  // POST /api/v1/admin/shop/products/import/preview → classify rows (read-only).
  // `create: true` also plans the variant-creating import (ice #302).
  async previewProductImport(req, res, next) {
    try {
      const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
      if (!rows) return res.status(400).json({ error: t(req.locale, 'errors.admin.importRowsRequired'), code: 400 });
      if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: t(req.locale, 'errors.admin.importTooManyRows'), code: 400 });
      const classified = await classifyImportRows(rows, { create: req.body.create === true });
      const counts = { update: 0, nochange: 0, unmatched: 0, error: 0, create: 0 };
      for (const c of classified) counts[c.status] = (counts[c.status] || 0) + 1;
      const products = new Set(classified.filter(c => c.status === 'create').map(c => c.group.key)).size;
      return res.json({ counts, createProducts: products, rows: classified.map(importRowView) });
    } catch (err) { next(err); }
  },

  // POST /api/v1/admin/shop/products/import/apply → apply updates to existing
  // rows, and (with `create: true`) create each planned product WITH its
  // variants in one transaction. Stock moves are audited (reason 'import';
  // opening stock 'opening'). Nothing is ever deleted.
  async applyProductImport(req, res, next) {
    try {
      const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
      if (!rows) return res.status(400).json({ error: t(req.locale, 'errors.admin.importRowsRequired'), code: 400 });
      if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: t(req.locale, 'errors.admin.importTooManyRows'), code: 400 });
      const classified = await classifyImportRows(rows, { create: req.body.create === true });
      let updated = 0, skipped = 0, failed = 0, created = 0, createdVariants = 0;
      const opts = { userId: actorId(req), stockReason: 'import' };
      const groups = new Map();
      for (const c of classified) {
        if (c.status === 'create') { groups.set(c._group.key, c._group); continue; }
        if (c.status !== 'update') { skipped += 1; continue; }
        try {
          if (c.kind === 'variant') await ProductVariant.update(c.target.variantId, c.changes, opts);
          else await Product.update(c.target.productId, c.changes, opts);
          updated += 1;
        } catch (err) {
          failed += 1;
          logger.warn({ err, sku: c.sku }, 'product import: row update failed');
        }
      }
      for (const g of groups.values()) {
        try {
          const { variants } = await Product.createWithVariants(
            { slug: g.slug, name: g.name, price_isk: g.parent.price_isk, price_eur: g.parent.price_eur,
              axes: g.axes, active: g.parent.active },
            g.variants, { userId: actorId(req) }
          );
          created += 1;
          createdVariants += variants.length;
        } catch (err) {
          failed += g.rows.length;
          logger.warn({ err: { message: err.message, code: err.code }, group: g.key }, 'product import: product create failed');
        }
      }
      return res.json({ updated, created, createdVariants, skipped, failed, total: rows.length });
    } catch (err) { next(err); }
  },

  // GET /api/v1/admin/shop/orders/export.xlsx — every order matching the list's
  // filters (same query string as GET /orders, minus paging) as a real Excel
  // workbook with typed cells (services/orderExport.js; ice #325). An export
  // past the cap is refused (413), never truncated.
  async exportOrders(req, res, next) {
    try {
      const { status, paymentStatus, fulfillmentStatus, q, sort, dir } = req.query;
      const filter = {
        status:            status            ? String(status) : null,
        paymentStatus:     paymentStatus     ? String(paymentStatus) : null,
        fulfillmentStatus: fulfillmentStatus ? String(fulfillmentStatus) : null,
        q:                 q                 ? String(q) : null,
      };
      const cap = orderExport.limits.maxRows;
      const orders = await Order.listAll({ ...filter, sort: sort ? String(sort) : 'date', dir: dir === 'asc' ? 'asc' : 'desc', limit: cap + 1 });
      if (orders.length > cap) {
        return res.status(413).json({ error: t(req.locale, 'errors.admin.exportTooLarge', { n: cap }), code: 413 });
      }
      const { identity } = require('../config/identity');
      const brand = (identity.brand && identity.brand.name) || '';
      const wb = orderExport.buildOrdersWorkbook(orders, req.locale, { creator: brand });
      const buf = await wb.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(Buffer.from(buf));
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
