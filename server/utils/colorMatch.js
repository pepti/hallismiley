'use strict';

// Ported from icelandicstore #182/#265/#270 (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26) — the file as ice ships it. Client twin:
// public/js/utils/colorMatch.js (tests/unit/colorMatch.test.js holds both).
//
// Colour MATCHING — which photo a variant colour should show, and which palette
// entry it renders as. Normalisation itself is NOT here: axisKey/colorKey live
// in ./variantAxis.js and are imported, so there is exactly one definition of
// "how a colour value folds to a key" across the server and the SPA.
//
// Why the match lives on the SERVER: on icelandicstore the product page used
// to derive it in the browser (ProductView._imageIdxForColor did its own
// findIndex over `img.color`), which quietly broke on PROD while every test
// and the TEST stack looked fine. TEST was seeded with tidy colour names
// (`Navy`, `Sage`), but the real wholesale catalogue carries Shopify's supplier
// spellings — `French Navy (FRNA)`, `Sage Green (SAG)` — against photos tagged
// `navy` and `sage`. Folding the parenthetical away is not enough:
// `french-navy` !== `navy`, so 2 of the tee's 5 colours never swapped the photo
// and the customer reported it (Orri, 2026-09-08, "Variants - Colors").
//
// Deriving it once, server-side, means the API, the SPA and any future SSR
// consumer cannot drift apart again. public/js/utils/colorMatch.js mirrors the
// pure helpers for display use; tests/unit/colorMatch.test.js pins the two
// copies equal.
const { colorKey } = require('./variantAxis');

// Spelling variants of ONE colour name, folded before comparison. This is not a
// synonym table for different colours (that would need a new entry per supplier
// colour the catalogue ever gains — containment below handles those); it is
// only for the same word spelled two ways. Kept here rather than in
// variantAxis.colorKey so the shared normaliser stays lossless about spelling.
const SPELLING_ALIASES = { gray: 'grey' };

function aliased(key) {
  return SPELLING_ALIASES[key] || key;
}

function tokensOf(key) {
  return key.split('-').filter(Boolean);
}

// Is every token of `inner` present in `outer`? ("navy" ⊆ "french-navy")
function tokensContained(inner, outer) {
  return inner.length > 0 && inner.every(t => outer.includes(t));
}

// Do two colour keys refer to the same colour? Exact (after spelling folding),
// or one's tokens wholly contained in the other's. Containment is what makes
// the supplier spellings usable without a synonym table per colour.
function keysMatch(a, b) {
  if (!a || !b) return false;
  const ka = aliased(a);
  const kb = aliased(b);
  if (ka === kb) return true;
  const at = tokensOf(ka);
  const bt = tokensOf(kb);
  return tokensContained(at, bt) || tokensContained(bt, at);
}

// The single entry of `known` that refers to the same colour as `value`, or
// null when none does or more than one could. Used for palette lookups (swatch
// fill, display label, sort order), which face the same "French Navy (FRNA)"
// vs "navy" gap as the photo match.
function matchKnownKey(value, known) {
  const key = aliased(colorKey(value));
  if (!key) return null;
  if (known.includes(key)) return key;
  const near = known.filter(k => keysMatch(k, key));
  return near.length === 1 ? near[0] : null;
}

// The distinct colour values declared by a product's variants, in first-seen
// order. Attribute KEYS arrive however the source catalogue spelled them — the
// Shopify importer writes `Color`, older seeds and the e2e fixture use `color`
// — so the axis name is folded before the lookup.
function variantColorValues(variants) {
  const seen = new Set();
  const values = [];
  for (const v of variants || []) {
    const attrs = v && v.attributes;
    if (!attrs || typeof attrs !== 'object') continue;
    for (const [name, value] of Object.entries(attrs)) {
      if (colorKey(name) !== 'color' && colorKey(name) !== 'colour') continue;
      const key = colorKey(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      values.push(String(value));
    }
  }
  return values;
}

// Map each variant colour to the id of the photo that shows that colour:
//   { black: 'img-1', 'french-navy': 'img-3', ... }
//
// Two stages, deliberately conservative — a colour with no confident match is
// simply ABSENT from the map, and the caller leaves the gallery alone. Showing
// the wrong garment is worse than showing the same one.
//   1. exact key equality (`black` === `black`);
//   2. token containment either way (`navy` ⊆ `french-navy`), accepted only
//      when it is unambiguous in BOTH directions: exactly one photo may match
//      the colour, and a photo two colours could claim is dropped from both —
//      whether the rival claim is another containment match (a single `green`
//      photo cannot stand for "Sage Green" AND "Forest Green") or an exact one
//      (a `navy` photo belongs to "Navy", not also to "French Navy (FRNA)").
function resolveColorImages(images, colorValues) {
  const tagged = (images || [])
    .filter(img => img && img.id != null && colorKey(img.color))
    .map(img => ({ id: img.id, key: colorKey(img.color) }));
  if (tagged.length === 0) return {};

  const out = Object.create(null);
  const taken = new Set();     // image ids already spoken for by an EXACT match
  const fuzzy = [];            // { key, imageId } candidates from stage 2
  const claimedBy = new Map(); // imageId -> count of colours claiming it fuzzily

  for (const value of colorValues || []) {
    const key = colorKey(value);
    if (!key || out[key]) continue;

    const exact = tagged.filter(t => aliased(t.key) === aliased(key));
    if (exact.length === 1) { out[key] = exact[0].id; taken.add(exact[0].id); continue; }
    if (exact.length > 1) continue; // two photos tagged the same colour: ambiguous

    const near = tagged.filter(t => keysMatch(t.key, key));
    if (near.length !== 1) continue;

    fuzzy.push({ key, imageId: near[0].id });
    claimedBy.set(near[0].id, (claimedBy.get(near[0].id) || 0) + 1);
  }

  for (const { key, imageId } of fuzzy) {
    // Ambiguous either way: the photo is already the exact match for another
    // colour ("navy" tagged, both "Navy" and "French Navy (FRNA)" on sale), or
    // two colours reached for it by containment. Leave those colours unmapped.
    if (taken.has(imageId)) continue;
    if (claimedBy.get(imageId) === 1) out[key] = imageId;
  }
  return out;
}

// Store a colour tag normalised, so the tag and the variant value compare on
// equal terms. Blank clears it — "not colour-specific" is a real answer for a
// lifestyle shot.
function normaliseColorTag(value) {
  if (value == null) return null;
  const key = colorKey(value);
  return key === '' ? null : key;
}

// Attach the map to a product payload as `color_images`. Nothing here is
// private — a garment colour and a photo id are public — so every viewer of
// the public product payload gets the same map (shopController.getProduct).
function decorateColorImages(product) {
  if (!product || typeof product !== 'object') return product;
  product.color_images = resolveColorImages(product.images, variantColorValues(product.variants));
  return product;
}

module.exports = {
  keysMatch, matchKnownKey, variantColorValues, resolveColorImages,
  normaliseColorTag, decorateColorImages,
};
