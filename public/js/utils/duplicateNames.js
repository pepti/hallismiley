// Which items in a visible list share a display name with a DIFFERENT item.
// Ported from icelandicstore #399 (2026-09-21).
//
// A catalogue can carry distinct products under one name (ice had five
// "Gullfoss" postcards), and a buyer choosing between identical names cannot
// tell which one they are adding. The shop card then shows the SKU beside the
// name — only for the names that actually collide, so the ordinary list stays
// uncluttered.
//
// `nameOf(item)` gives the display name, `idOf(item)` the identity that makes
// two items different (a product id; variant rows of ONE product share their
// product's id and are never "duplicates" of each other). Names compare
// case- and whitespace-insensitively. Returns the Set of colliding ids (as
// strings).
export function duplicateNameIds(items, nameOf, idOf) {
  const byName = new Map();
  for (const it of items || []) {
    const key = String(nameOf(it) ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('is');
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, new Set());
    byName.get(key).add(String(idOf(it)));
  }
  const out = new Set();
  for (const ids of byName.values()) {
    if (ids.size > 1) for (const id of ids) out.add(id);
  }
  return out;
}
