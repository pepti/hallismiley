'use strict';

// Variant axis normalisation — the single source of truth for how an axis name
// or an axis value is compared, shared by the server and (mirrored) by the SPA.
//
// Why this exists: `products.variant_axes` and `product_variants.attributes`
// are written by three different paths that do not agree on case. The Shopify
// importer trims but does not casefold, so it lands "Color"/"Size" verbatim;
// the admin product form lowercases when it builds axes; and migration 096 set
// '["Color","Size"]' directly. Nothing validates the two columns against each
// other, so a lookup MUST normalise before comparing or it silently misses.
//
// The bill-of-materials resolver depends on this: an axis-matched component
// that fails to match does not fall back or guess — it refuses the whole build.
// That is only safe if "matches" is defined in exactly one place.
//
// Mirror: public/js/utils/variantAxis.js (ESM). tests/unit/variantAxisParity
// asserts the two copies stay identical — change both or neither.

// Axis NAMES: case- and whitespace-insensitive.
//
// Deliberately NOT synonym-folding: `colour` and `color` are different axes and
// must fail loudly rather than quietly resolving to each other. A recipe that
// silently matched the wrong axis would decrement the wrong stock.
function axisKey(axis) {
  return String(axis || '').trim().toLowerCase();
}

// Axis VALUES: case- and whitespace-insensitive, underscores and runs of
// whitespace collapsed to a single hyphen.
//
// Applied to every axis, so "XX Large" and "xx_large" are the same size. Note
// what it does NOT do: "XL" and "X-Large" stay distinct, because guessing that
// they are the same is how a build decrements a size nobody asked for.
function valueKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

// Colour values additionally shed the trailing supplier code the wholesale
// catalogue carries: "Black (BL)" -> "black".
//
// This is lossy on purpose, and the loss is load-bearing: "Black (BL)" and
// "Black (BK)" both fold to "black", so a blanks product carrying both is
// AMBIGUOUS. The resolver must refuse that build rather than pick one — see
// resolveComponentVariant, which treats >1 match as a hard failure.
function colorKey(value) {
  return valueKey(String(value || '').replace(/\([^)]*\)/g, ''));
}

// Pick the right value normaliser for an axis. Only the colour axis strips
// supplier codes; every other axis gets plain folding.
function valueKeyFor(axis, value) {
  return axisKey(axis) === 'color' ? colorKey(value) : valueKey(value);
}

// Read an attributes object by axis name, ignoring the case the row was written
// in. Returns undefined when the axis is absent.
//
// Refuses to answer when the SAME object carries two keys that differ only by
// case ({"Color":"Navy","color":"Black"}) — that row is ambiguous and no
// reading of it is trustworthy. Throws so the caller fails the whole build
// rather than picking by object key order.
function readAxis(attributes, axis) {
  const want = axisKey(axis);
  const hits = Object.keys(attributes || {}).filter(k => axisKey(k) === want);
  if (hits.length === 0) return undefined;
  if (hits.length > 1) {
    const e = new Error(`ambiguous axis "${axis}": ${hits.join(', ')}`);
    e.code = 'AXIS_AMBIGUOUS';
    e.axis = axis;
    e.keys = hits;
    throw e;
  }
  return attributes[hits[0]];
}

module.exports = { axisKey, valueKey, colorKey, valueKeyFor, readAxis };
