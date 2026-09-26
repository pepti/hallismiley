// Ported from icelandicstore (ice@941cf51d; harvest 2 lane 6c, 2026-09-26):
// the client twin server/utils/variantAxis.js has always named in its header,
// which the engine had not carried until now.
//
// Client mirror of server/utils/variantAxis.js — keep 1:1 with the server copy
// (tests/unit/variantAxisParity.test.js runs both through the same corpus and
// asserts identical output). Pure module — no window/localStorage.
//
// Variant axis names and values arrive however the source catalogue spelled
// them: the Shopify importer trims but does not casefold, so it lands
// "Color"/"Size" verbatim; the admin form lowercases; migration 096 set
// '["Color","Size"]' directly. Every comparison must normalise first.

// Axis NAMES: case- and whitespace-insensitive.
//
// Deliberately NOT synonym-folding: `colour` and `color` are different axes and
// must fail loudly rather than quietly resolving to each other.
export function axisKey(axis) {
  return String(axis || '').trim().toLowerCase();
}

// Axis VALUES: case- and whitespace-insensitive, underscores and runs of
// whitespace collapsed to a single hyphen. "XL" and "X-Large" stay distinct.
export function valueKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

// Colour values additionally shed the trailing supplier code the wholesale
// catalogue carries: "Black (BL)" -> "black". Lossy on purpose — "Black (BL)"
// and "Black (BK)" both fold to "black", which the BOM resolver treats as
// ambiguous rather than picking one.
export function colorKey(value) {
  return valueKey(String(value || '').replace(/\([^)]*\)/g, ''));
}

// Pick the right value normaliser for an axis. Only the colour axis strips
// supplier codes; every other axis gets plain folding.
export function valueKeyFor(axis, value) {
  return axisKey(axis) === 'color' ? colorKey(value) : valueKey(value);
}

// Read an attributes object by axis name, ignoring the case the row was written
// in. Returns undefined when the axis is absent. Throws when the same object
// carries two keys differing only by case — that row is ambiguous and no
// reading of it is trustworthy.
export function readAxis(attributes, axis) {
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
