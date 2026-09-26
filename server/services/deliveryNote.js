'use strict';

// Lines for the printed delivery note (Fylgiseðill): the order lines with the
// live SKU and shelf, plus per line a variant label ("White / M") and a small
// picture. Ported from icelandicstore #334/#335 (ice@941cf51d; harvest 2 lane
// 6c, 2026-09-26) — ice's services/deliveryNote.js, trimmed of its
// made-to-order column.
//
// Why: a delivery note of four identical "T-Shirt" lines is no pick list
// (Orri, 2026-09-16, holding ice's note next to a Shopify packing slip:
// pictures, shelves, sizes). The pdfkit layout (pdfService.drawDeliveryNote)
// is synchronous, so all the async work — the image query, reading and
// shrinking photos — happens here, before the PDF stream starts.
//
// A picture is a nice-to-have on a pick list, never a reason to fail it: any
// image problem is logged and that line simply prints without one.
const Order = require('../models/Order');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const logger = require('../logger');
const { lineAttributes, lineVariantLabel } = require('../utils/variantLabel');
const { resolveColorImages, variantColorValues } = require('../utils/colorMatch');
const { colorKey } = require('../utils/variantAxis');
const { sourcePathForUrl, printThumbnail } = require('./productImages');

// The colour key a line is for — the same colour-axis rule the colour → photo
// map is built with (variantColorValues), so the two can never disagree.
function lineColor(item) {
  const attrs = lineAttributes(item);
  const [value] = attrs ? variantColorValues([{ attributes: attrs }]) : [];
  return value ? colorKey(value) : null;
}

// One image per line: the photo tagged with the line's colour when that match
// is unambiguous (resolveColorImages, fed ALL the product's colours so its
// ambiguity guard sees the whole picture — the map the product page uses),
// otherwise the product's first image.
function pickImage(item, images, colorMap) {
  if (!images || images.length === 0) return null;
  const color = lineColor(item);
  if (color && colorMap && colorMap[color]) {
    const hit = images.find(img => img.id === colorMap[color]);
    if (hit) return hit;
  }
  return images[0];
}

// At most this many photos are read + decoded at once, process-wide. A bulk
// print can ask for 100 orders' worth, and an original without a thumbnail can
// be a multi-MB PNG held in memory while it decodes — on a small App Service
// plan that must queue rather than fan out.
const DECODE_CONCURRENCY = 4;
// A slot is given back after this long even if the work has not settled, so
// one stalled Azure Files read cannot park the shared queue — that line just
// prints without its picture.
const DECODE_TIMEOUT_MS = 15000;
let active = 0;
const waiting = [];

async function withDecodeSlot(fn) {
  // Slots are handed over, not re-contended: release passes its slot straight
  // to the next waiter without decrementing, so a caller arriving in between
  // cannot take it and push the count past the limit.
  if (active < DECODE_CONCURRENCY) active++;
  else await new Promise(resolve => waiting.push(resolve));
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`picture timed out after ${DECODE_TIMEOUT_MS} ms`)), DECODE_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    const next = waiting.shift();
    if (next) next(); else active--;
  }
}

// One decode per image per request (the cache is per call): a bulk print that
// shows the same photo on fifty lines reads it once. pdfService then embeds
// the resulting Buffer once per document.
async function loadPicture(image, cache) {
  if (cache.has(image.id)) return cache.get(image.id);
  const job = (async () => {
    const src = sourcePathForUrl(image.url);
    if (!src) return null;
    try {
      return await withDecodeSlot(() => printThumbnail(src));
    } catch (err) {
      logger.warn({ err: err.message, imageId: image.id }, 'deliveryNote.picture failed');
      return null;
    }
  })();
  cache.set(image.id, job);
  return job;
}

function groupBy(rows, key) {
  const out = new Map();
  for (const r of rows || []) {
    const k = String(r[key]);
    const arr = out.get(k);
    if (arr) arr.push(r); else out.set(k, [r]);
  }
  return out;
}

// Images + colour → photo maps for a set of products, in two queries however
// many orders the products came from.
async function loadProductPictures(productIds) {
  const empty = { imagesByProduct: new Map(), colorMapByProduct: new Map() };
  if (productIds.length === 0) return empty;
  try {
    const [images, variants] = await Promise.all([
      Product.listImagesForProducts(productIds),
      ProductVariant.listForProducts(productIds, { activeOnly: true }),
    ]);
    const imagesByProduct = groupBy(images, 'product_id');
    const variantsByProduct = groupBy(variants, 'product_id');
    const colorMapByProduct = new Map(productIds.map(id => [
      id,
      resolveColorImages(imagesByProduct.get(id) || [], variantColorValues(variantsByProduct.get(id) || [])),
    ]));
    return { imagesByProduct, colorMapByProduct };
  } catch (err) {
    logger.warn({ err: err.message }, 'deliveryNote.images query failed');
    return empty;
  }
}

/**
 * Delivery-note lines for several orders at once — the bulk print. Line
 * queries run per order; the image and variant queries run ONCE over every
 * product in the batch, and each photo is decoded once however many orders
 * show it.
 *
 * @param {string[]} orderIds
 * @returns {Promise<Array<Array>>} one array per order id, in the same order:
 *   Order.listItemsWithSku rows + `variant_label` and `image` (JPEG Buffer or null)
 */
async function loadDeliveryNoteItemsForOrders(orderIds) {
  const lists = await Promise.all(orderIds.map(id => Order.listItemsWithSku(id)));
  const productIds = [...new Set(lists.flat().map(it => it.product_id).filter(Boolean).map(String))];
  const { imagesByProduct, colorMapByProduct } = await loadProductPictures(productIds);
  const imageCache = new Map();

  return Promise.all(lists.map(items => Promise.all(items.map(async (it) => {
    const pid = it.product_id ? String(it.product_id) : null;
    const image = pid ? pickImage(it, imagesByProduct.get(pid), colorMapByProduct.get(pid)) : null;
    return {
      ...it,
      variant_label: lineVariantLabel(it),
      image: image ? await loadPicture(image, imageCache) : null,
    };
  }))));
}

/** Delivery-note lines for ONE order (see loadDeliveryNoteItemsForOrders). */
async function loadDeliveryNoteItems(orderId) {
  const [items] = await loadDeliveryNoteItemsForOrders([orderId]);
  return items;
}

module.exports = {
  loadDeliveryNoteItems, loadDeliveryNoteItemsForOrders, DECODE_CONCURRENCY,
  _withDecodeSlot: withDecodeSlot, // exported for tests/unit/deliveryNote.test.js only
};
