'use strict';

// Ported from icelandicstore #334/#335 (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26). Trimmed: the browser mirror of nameCarriesLabel is not taken
// (no engine screen appends a label to a line name); the engine's delivery
// note is its one user (services/deliveryNote.js → services/pdfService.js).
//
// Human-readable variant label for an order line — "White / M".
//
// Why this exists: only storefront checkout bakes the size into the line name
// (shopController.buildLineName → "T-Shirt — White / M"). Every staff path
// (email/AI import, POS, Invoice Merger, order edit) stores the bare product
// name and no variant_attributes, so a printed delivery note showed four
// identical "T-Shirt | Cats of Reykjavik" lines (Orri, 2026-09-16).
//
// Axis NAMES are matched through readAxis, so a product whose axes say "Size"
// still reads a variant written as {"size": "M"}; the three writers of
// variant_axes/attributes do not agree on case (see utils/variantAxis.js).
const { readAxis } = require('./variantAxis');

function capitalise(v) {
  const s = String(v).trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * @param {object|null} attributes  e.g. { Color: 'White', Size: 'M' }
 * @param {string[]|null} axes      e.g. ['Color', 'Size'] — the display order
 * @returns {string|null}           'White / M', or null when there is nothing to show
 */
function variantLabel(attributes, axes) {
  if (!attributes || typeof attributes !== 'object') return null;
  const read = (keys) => {
    const bits = [];
    for (const axis of keys) {
      let value;
      try {
        value = readAxis(attributes, axis);
      } catch {
        continue; // two keys differing only by case — no trustworthy reading
      }
      if (value == null || String(value).trim() === '') continue;
      bits.push(capitalise(value));
    }
    return bits;
  };
  let bits = Array.isArray(axes) && axes.length ? read(axes) : [];
  // Axes that name none of the attribute keys ("stærð" axes over {"Size": "M"} —
  // the writers disagree) must not hide the size: fall back to every value, as
  // the SPA's attributesLabel does, so paper and screen read the same.
  if (bits.length === 0) bits = read(Object.keys(attributes));
  return bits.length ? bits.join(' / ') : null;
}

function nonEmpty(attrs) {
  return attrs && typeof attrs === 'object' && Object.keys(attrs).length > 0 ? attrs : null;
}

/**
 * The attributes a line was sold as: its snapshot, else its variant's live
 * ones. An empty `{}` snapshot (a scan-appended default variant) counts as no
 * snapshot, or it would hide the live size.
 *
 * @param {object} item  an Order.listItemsWithSku row
 * @returns {object|null}
 */
function lineAttributes(item) {
  if (!item) return null;
  return nonEmpty(item.variant_attributes) || nonEmpty(item.variant_attributes_current);
}

// The separators a line name puts before its variant title: checkout writes
// "Name — White / M" (buildLineName), the Shopify-imported "#NNNN" orders carry
// Shopify's "Name - XS", and an en dash turns up in pasted text.
const NAME_VARIANT_SEPARATORS = [' — ', ' – ', ' - '];

function labelParts(s) {
  return String(s).split('/').map(p => p.trim().toLowerCase()).filter(Boolean);
}

/**
 * Does the line name already end with this variant label? True when the text
 * after a name/variant separator contains every part of the label, in any order
 * and any case — "Hoodie | … | Forest Green (FGR) - XS" carries "XS", and
 * "Tee - S / Blush Pink" carries "Blush Pink / S". A product name that merely
 * contains a hyphen ("T-Shirt - I Puffin Love You") does not carry "S".
 *
 * (Ice keeps a browser mirror, public/js/utils/variantLabel.js; the engine has
 * no caller for one — tests/unit/variantLabel.test.js pins this copy.)
 *
 * @param {string} name   product_name_snapshot
 * @param {string} label  e.g. "White / M"
 */
function nameCarriesLabel(name, label) {
  const want = labelParts(label || '');
  if (want.length === 0) return false;
  const text = String(name || '').trim();
  return NAME_VARIANT_SEPARATORS.some((sep) => {
    const i = text.lastIndexOf(sep);
    if (i < 0) return false;
    const have = labelParts(text.slice(i + sep.length));
    return want.every(p => have.includes(p));
  });
}

/**
 * The label to print UNDER a line's name, from lineAttributes. Null when the
 * name already carries it (nameCarriesLabel) — a checkout line reads
 * "T-Shirt — White / M" and an imported Shopify line "Hoodie - XS"; neither
 * should print the size a second time.
 *
 * @param {object} item  an Order.listItemsWithSku row
 */
function lineVariantLabel(item) {
  if (!item) return null;
  const label = variantLabel(lineAttributes(item), item.variant_axes);
  if (!label) return null;
  if (nameCarriesLabel(item.product_name_snapshot, label)) return null;
  return label;
}

module.exports = { variantLabel, lineAttributes, lineVariantLabel, nameCarriesLabel };
