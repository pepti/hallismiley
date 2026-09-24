// Harvested from icelandicstore (ice@4694289 #302, harvest-ice-d-2026-09-24),
// cut to the engine's product shape: the parent carries a name (and a slug
// when the file has one), every variant row must carry BOTH prices (the
// engine's products need price_isk AND price_eur above zero).
//
// Group the rows of an import that describe ONE product with several variants —
// the "Size: M, Color: Black" rows this page's own export writes, or a supplier
// grid whose Stærð / Litur columns parseFile already folded into the same
// Variant cell — and decide, per group, whether it can be created as one
// variant product. Pure: no database, no i18n. The controller feeds it rows
// that matched nothing in the catalogue and maps the reasons it returns.
//
// The one rule that shapes everything here: a group is created whole or not
// at all. One bad row (an unreadable Variant cell, a missing price, an axis the
// other rows do not have, a duplicate combination, a vendor that disagrees)
// refuses every row of the product, because a half-created grid — three sizes
// of a five-size shirt — is worse than no product: it looks finished.
//
// Rows group by Slug when the file carries one, else by name + vendor. Only
// rows WITH a Variant cell take part; a row without one is a single-SKU product
// and stays on the existing create path.
const { parseVariantCell } = require('./variantCell');
const { normalizeHeader, AXIS_HEADERS } = require('./headerMap');
const { axisKey, valueKeyFor } = require('../../utils/variantAxis');

// Fields that live on the parent product. Every row of a group may carry them;
// blank is "no opinion", and two rows that both carry one must agree.
const PARENT_FIELDS = ['name'];
// Fields that live on the variant row, plus stock — opening stock is per variant.
const VARIANT_FIELDS = ['barcode', 'bin', 'price_isk', 'price_eur', 'stock', 'active'];

// A Variant-cell key is folded the same way a column header is: "Stærð" and
// "Size" both become `size`, anything else keeps its own name lower-cased —
// the product form stores axes lower-case, so a created product reads like a
// hand-made one. The fold happens here and in headerMap only (import boundary).
function foldAxis(key) {
  return AXIS_HEADERS[normalizeHeader(key)] || axisKey(key);
}

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = (Array.isArray(a) ? a : []).map(String);
    const y = (Array.isArray(b) ? b : []).map(String);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return String(a) === String(b);
}

// The grouping key for one row: an explicit valid Slug wins (that is what the
// export writes, and it survives a renamed product); otherwise the name and
// vendor the row carries, normalised. `null` when the row names nothing.
function groupKeyFor(row) {
  const slug = String(row.slug == null ? '' : row.slug).trim().toLowerCase();
  if (slug) return `slug:${slug}`;
  const name = normalizeHeader(row.fields && row.fields.name);
  if (!name) return null;
  const vendor = normalizeHeader(row.fields && row.fields.vendor);
  return `name:${name}|${vendor}`;
}

/**
 * rows — one entry per import row that carries a Variant cell and matched no
 * existing product: { index, sku, variant (the raw cell), slug?, fields
 * (normalised writable fields, or null when the row failed normalisation),
 * error? ({ reason, errorField }) }.
 *
 * → { groups: [group], byIndex: Map<index, verdict> }
 *   group   = { key, slugGiven, name, vendor, axes, rows, parent, ok, reasons }
 *   verdict = { group, ok, reason?, errorField? }
 * Reasons are keys the controller translates; errorField is a FIELD name (or
 * an axis name) the controller turns into a column header.
 */
function buildVariantGroups(rows) {
  const groups = new Map();
  const byIndex = new Map();

  for (const row of rows || []) {
    const key = groupKeyFor(row);
    if (!key) {
      // Nothing to group under — the row cannot become a product either way.
      byIndex.set(row.index, { group: null, ok: false, reason: 'create_missing_fields', errorField: 'name' });
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        slugGiven: key.startsWith('slug:') ? key.slice(5) : null,
        name: null, vendor: null,
        axes: [], rows: [], parent: {}, ok: true, reasons: [],
      });
    }
    groups.get(key).rows.push(row);
  }

  for (const group of groups.values()) {
    const seenCombos = new Map(); // combo key → first row index
    const parent = {};
    const parentFrom = {};        // field → the row index that set it
    const rowVerdicts = [];

    for (const row of group.rows) {
      let verdict = { ok: true, attributes: null, fields: row.fields || {} };
      if (row.error) {
        verdict = { ok: false, reason: row.error.reason, errorField: row.error.errorField || null };
      } else {
        const parsed = parseVariantCell(row.variant);
        if (!parsed.ok) {
          verdict = { ok: false, reason: parsed.reason, errorField: null };
        } else {
          // Fold every key; two keys that fold together are the same axis
          // twice, which parseVariantCell could not see through a synonym.
          const attributes = {};
          for (const [k, v] of Object.entries(parsed.attributes)) {
            const axis = foldAxis(k);
            if (axis in attributes) { verdict = { ok: false, reason: 'variant_invalid', errorField: null }; break; }
            attributes[axis] = String(v).trim();
          }
          if (verdict.ok) {
            verdict.attributes = attributes;
            for (const axis of Object.keys(attributes)) {
              if (!group.axes.includes(axis)) group.axes.push(axis);
            }
            if (row.fields.price_isk === undefined) {
              verdict = { ok: false, reason: 'variant_price_required', errorField: 'price_isk' };
            } else if (row.fields.price_eur === undefined) {
              verdict = { ok: false, reason: 'variant_price_required', errorField: 'price_eur' };
            }
          }
        }
      }
      if (verdict.ok) {
        // Parent-level fields must agree across the group.
        for (const f of PARENT_FIELDS) {
          const v = row.fields[f];
          if (v === undefined) continue;
          if (parent[f] === undefined) { parent[f] = v; parentFrom[f] = row.index; continue; }
          if (!sameValue(parent[f], v)) { verdict = { ok: false, reason: 'group_field_conflict', errorField: f }; break; }
        }
      }
      rowVerdicts.push({ row, verdict });
    }

    // Second pass over the rows that parsed: every row must carry every axis
    // the group uses, and no two rows may be the same combination.
    for (const rv of rowVerdicts) {
      if (!rv.verdict.ok) continue;
      const attrs = rv.verdict.attributes;
      const missing = group.axes.find(a => !(a in attrs));
      if (missing) { rv.verdict = { ok: false, reason: 'variant_axes_mismatch', errorField: missing }; continue; }
      const combo = group.axes.map(a => `${a}=${valueKeyFor(a, attrs[a])}`).join('&');
      if (seenCombos.has(combo)) { rv.verdict = { ok: false, reason: 'variant_duplicate', errorField: null }; continue; }
      seenCombos.set(combo, rv.row.index);
    }

    group.name   = parent.name   || null;
    group.vendor = parent.vendor || null;
    if (!parent.name) {
      // A slug-keyed group whose rows never named the product.
      for (const rv of rowVerdicts) {
        if (rv.verdict.ok) rv.verdict = { ok: false, reason: 'create_missing_fields', errorField: 'name' };
      }
      // `parent` is only collected from rows that passed, so a group whose every
      // row was refused up front (a shared SKU, say) had no name and its preview
      // heading read "Not created — — (3 rows)" (QA 2026-09-13 A3). The heading
      // still names what the rows call the product. Display only: a group with
      // no parent name is refused just above, so this never reaches a create.
      const named = group.rows.find(r => r.fields && typeof r.fields.name === 'string' && r.fields.name.trim());
      if (named) group.name = named.fields.name.trim();
    }
    const anyFailed = rowVerdicts.some(rv => !rv.verdict.ok);
    group.ok = !anyFailed;
    group.reasons = rowVerdicts.filter(rv => !rv.verdict.ok)
      .map(rv => ({ index: rv.row.index, reason: rv.verdict.reason, errorField: rv.verdict.errorField || null }));

    if (group.ok) {
      // The parent is priced at its cheapest variant (the catalogue shows
      // "from"); everything else it carries came from the rows above. Draft
      // unless EVERY row says Active — an import never publishes by omission.
      const prices = rowVerdicts.map(rv => Number(rv.row.fields.price_isk));
      const pricesEur = rowVerdicts.map(rv => Number(rv.row.fields.price_eur));
      group.parent = {
        ...parent,
        price_isk: Math.min(...prices),
        price_eur: Math.min(...pricesEur),
        active: rowVerdicts.every(rv => rv.row.fields.active === true),
      };
      // Status on a variant row is the EFFECTIVE status (the export writes Draft
      // on every row of a Draft product). When no row says Active, the Draft is
      // the product's, not each variant's: the variants are created on, so
      // publishing the product later does not find every size switched off.
      const noneActive = !rowVerdicts.some(rv => rv.row.fields.active === true);
      group.variants = rowVerdicts.map(rv => {
        const f = rv.row.fields;
        const v = { index: rv.row.index, sku: rv.row.sku, attributes: rv.verdict.attributes };
        for (const field of VARIANT_FIELDS) if (f[field] !== undefined) v[field] = f[field];
        if (noneActive) delete v.active;
        return v;
      });
    } else {
      group.parent = parent;
      group.variants = [];
    }

    for (const rv of rowVerdicts) {
      if (rv.verdict.ok && !group.ok) {
        // This row was fine; a sibling was not, and the product is created whole
        // or not at all.
        byIndex.set(rv.row.index, { group, ok: false, reason: 'group_refused', errorField: null });
      } else if (rv.verdict.ok) {
        byIndex.set(rv.row.index, { group, ok: true, attributes: rv.verdict.attributes });
      } else {
        byIndex.set(rv.row.index, { group, ok: false, reason: rv.verdict.reason, errorField: rv.verdict.errorField || null });
      }
    }
  }

  return { groups: [...groups.values()], byIndex };
}

// Refuse a whole group after the fact (the controller's database checks: the
// product already exists, a SKU or barcode is taken). Every row of the group
// gets `reason`, the offending row — when known — keeps its own errorField.
function refuseGroup(group, byIndex, reason, { index = null, errorField = null } = {}) {
  group.ok = false;
  group.reasons.push({ index, reason, errorField });
  group.variants = [];
  for (const row of group.rows) {
    const own = index === null || index === row.index;
    byIndex.set(row.index, {
      group, ok: false,
      reason: own ? reason : 'group_refused',
      errorField: own ? errorField : null,
    });
  }
}

module.exports = {
  buildVariantGroups,
  refuseGroup,
  groupKeyFor,
  foldAxis,
  PARENT_FIELDS,
  VARIANT_FIELDS,
};
