// The "Variant" cell of the products CSV — "Color: Black, Size: M" — has ONE
// formatter and ONE parser, here, so what the export writes is exactly what
// the import reads back (and what the variant-creating import groups on).
//
// Keys come out in the product's variant_axes order, then any attribute the
// axes do not name, in stored order. Postgres keeps `attributes` as jsonb,
// which orders keys by length then bytes, so without this a product whose
// axes read [size, color] exported "Color: Black, Size: M" and a re-import
// saw the axes swapped.
//
// axisKey is case-insensitive and deliberately NOT synonym-folding (see
// utils/variantAxis): "Colour" and "Color" are different axes here too. The
// import boundary (headerMap.axisFor) is the one place a synonym is folded.
const { axisKey } = require('../../utils/variantAxis');

const MAX_AXES  = 3;
const MAX_KEY   = 50;
const MAX_VALUE = 100;

function formatVariantCell(attributes, axes = []) {
  if (!attributes || typeof attributes !== 'object') return '';
  const rank = new Map();
  (Array.isArray(axes) ? axes : []).forEach((a, i) => {
    const k = axisKey(a);
    if (k && !rank.has(k)) rank.set(k, i);
  });
  return Object.entries(attributes)
    .map(([k, v], i) => ({ k, v, i, r: rank.has(axisKey(k)) ? rank.get(axisKey(k)) : Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .map(({ k, v }) => `${k}: ${v}`)
    .join(', ');
}

// Split ONLY at a comma that introduces the next "Key:" — a value such as
// "Black, matte" or "S/M" survives, because a bare comma inside a value is
// not a new axis.
const PART_SPLIT = /,\s*(?=[^,:]+:)/;

/**
 * Parse one Variant cell.
 * → { ok: true, attributes }              key → value, insertion order kept
 * → { ok: false, reason, detail? }        reason ∈ variant_invalid | variant_ambiguous
 *
 * Refuses: a part with no colon, an empty key or value, two keys equal under
 * axisKey, more than MAX_AXES axes, an over-long key or value, and — belt and
 * braces — a cell whose own formatting does not read back to the same
 * attributes, so nothing ambiguous ever becomes a variant nobody can match.
 */
function parseVariantCell(cell) {
  const text = String(cell == null ? '' : cell).trim();
  if (!text) return { ok: false, reason: 'variant_invalid', detail: 'empty' };
  const attributes = {};
  const seen = new Set();
  for (const part of text.split(PART_SPLIT)) {
    const at = part.indexOf(':');
    if (at < 0) return { ok: false, reason: 'variant_invalid', detail: `no colon: ${part.trim()}` };
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (!key || !value) return { ok: false, reason: 'variant_invalid', detail: `empty key or value: ${part.trim()}` };
    if (key.length > MAX_KEY || value.length > MAX_VALUE) return { ok: false, reason: 'variant_invalid', detail: 'too long' };
    const k = axisKey(key);
    if (seen.has(k)) return { ok: false, reason: 'variant_invalid', detail: `axis repeated: ${key}` };
    seen.add(k);
    attributes[key] = value;
  }
  if (Object.keys(attributes).length > MAX_AXES) return { ok: false, reason: 'variant_invalid', detail: `more than ${MAX_AXES} axes` };

  // Idempotence: what we would write for these attributes must read back as
  // these attributes. It cannot fail for a cell the export wrote; it catches a
  // hand-edited one whose value would be split differently on the way back.
  const again = String(formatVariantCell(attributes, Object.keys(attributes))).split(PART_SPLIT);
  if (again.length !== Object.keys(attributes).length) {
    return { ok: false, reason: 'variant_ambiguous', detail: text };
  }
  return { ok: true, attributes };
}

module.exports = { formatVariantCell, parseVariantCell, MAX_AXES, MAX_KEY, MAX_VALUE };
