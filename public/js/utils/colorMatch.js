// Ported from icelandicstore #182/#265/#270 (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26) — the file as ice ships it. utils/colorLabels.js (lane 4b)
// imports matchKnownKey from here instead of carrying its own copy.
//
// Colour matching for the browser — DISPLAY ONLY: swatch fill, label and sort
// order. Do NOT re-derive the colour → photo match here; that lives in
// server/utils/colorMatch.js and reaches the client as `product.color_images`.
// A second, client-side matcher is exactly what shipped broken (the tee's
// "French Navy (FRNA)" never found the photo tagged `navy`, so 2 of 5 colours
// showed the wrong garment on PROD).
//
// Normalisation is NOT defined here: colorKey comes from ./variantAxis.js, the
// one definition shared with the server. The pure helpers below must stay
// behaviourally identical to server/utils/colorMatch.js — the server is
// CommonJS so the source cannot simply be shared, and
// tests/unit/colorMatch.test.js requires BOTH copies and asserts they agree.
// Change one, change the other.
import { colorKey, readAxis } from './variantAxis.js';

// Spelling variants of ONE colour name. See the server copy for why this is not
// a synonym table and why it does not live in variantAxis.colorKey.
const SPELLING_ALIASES = { gray: 'grey' };

function aliased(key) {
  return SPELLING_ALIASES[key] || key;
}

function tokensOf(key) {
  return key.split('-').filter(Boolean);
}

function tokensContained(inner, outer) {
  return inner.length > 0 && inner.every(t => outer.includes(t));
}

/**
 * Do two colour keys refer to the same colour? Exact (after spelling folding),
 * or one's tokens wholly contained in the other's ("navy" ⊆ "french-navy").
 */
export function keysMatch(a, b) {
  if (!a || !b) return false;
  const ka = aliased(a);
  const kb = aliased(b);
  if (ka === kb) return true;
  const at = tokensOf(ka);
  const bt = tokensOf(kb);
  return tokensContained(at, bt) || tokensContained(bt, at);
}

/**
 * The single entry of `known` naming the same colour as `value`, else null.
 * Palette lookups go through this so "French Navy (FRNA)" finds the `navy`
 * swatch instead of rendering blank.
 */
export function matchKnownKey(value, known) {
  const key = aliased(colorKey(value));
  if (!key) return null;
  if (known.includes(key)) return key;
  const near = known.filter(k => keysMatch(k, key));
  return near.length === 1 ? near[0] : null;
}

/**
 * The distinct colour options a product offers, for the admin's per-photo
 * colour picker: [{ key, label }] in first-seen order, deduplicated by key.
 *
 * ACTIVE variants only, deliberately. The storefront builds `color_images`
 * from activeOnly variants, so any inactive colour listed here is one no
 * shopper can select — and worse, it manufactures ambiguity: on TEST the tee
 * carries a live demo grid ("Navy", "Sage") alongside the retired import
 * spellings ("French Navy (FRNA)", "Sage Green (SAG)"), so a photo tagged
 * `navy` matched two entries, the picker declined to guess, and the admin
 * reported the photo as "not colour-specific" while the shop was swapping it.
 *
 * A row whose attributes carry the axis twice in different cases is skipped
 * rather than guessed at — readAxis throws on that, and it is not this
 * picker's job to resolve it.
 */
export function colorOptions(variants, axis) {
  const seen = new Set();
  const out = [];
  for (const v of variants || []) {
    if (!v || v.active === false) continue;
    let value;
    try { value = readAxis(v.attributes, axis); } catch { continue; }
    if (!value) continue;
    const key = colorKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: String(value) });
  }
  return out;
}

/** Title-case a normalised key for display: "french-navy" -> "French Navy". */
export function prettyColor(value) {
  const key = colorKey(value);
  if (!key) return '';
  return key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
