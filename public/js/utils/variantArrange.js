// Ported from icelandicstore #352 + #381 (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26) — the file as ice ships it. Engine users: ProductView (the
// storefront picker order, which replaced its own AXIS_ORDER table),
// components/VariantGrid.js and the admin product detail panel.
//
// "Arrange by type" — order a product's variant lines the way a person reads a
// garment grid: colour first, then size (XS → 2XL), instead of the SKU order the
// API returns. SKU order only looks right when the SKUs happen to be sequential;
// `DEMO-RVK-BLK-XS` style SKUs sort L, M, S, XL, XS.
//
// DISPLAY ONLY. Nothing here writes to the server and no list changes its
// default order. The rankings are also what ProductView orders its option chips
// by, so the product page and the line lists cannot drift apart; the clickable
// headers that apply them live in ./variantSort.js.
import { axisKey, colorKey } from './variantAxis.js';
import { matchKnownKey } from './colorMatch.js';

// Axis names that mean "colour" / "size" for ORDERING purposes only. This is not
// the BOM resolver: variantAxis.axisKey deliberately refuses to fold colour →
// color for matching, and that stays true. Here a wrong guess costs a sort order.
const COLOR_AXES = ['color', 'colour', 'litur'];
const SIZE_AXES  = ['size', 'stærð', 'staerd'];

// Each inner list is ONE rank: XXL and 2XL are the same size spelled two ways.
const SIZE_RANKS = [
  ['xxs', '2xs'], ['xs'], ['s'], ['m'], ['l'], ['xl'],
  ['xxl', '2xl'], ['xxxl', '3xl'], ['xxxxl', '4xl'], ['5xl'],
];

// Known colours, in shop-window order. Matched through matchKnownKey so
// "French Navy (FRNA)" ranks as navy rather than falling to the end.
export const COLOR_ORDER = ['Black', 'Navy', 'Grey', 'Sage', 'Red', 'White'];
const COLOR_ORDER_KEYS = COLOR_ORDER.map(colorKey);

const UNKNOWN = Number.MAX_SAFE_INTEGER;

export function axisKind(axis) {
  const k = axisKey(axis);
  if (COLOR_AXES.includes(k)) return 'color';
  if (SIZE_AXES.includes(k)) return 'size';
  return 'other';
}

export function sizeRank(value) {
  const k = String(value == null ? '' : value).trim().toLowerCase();
  const i = SIZE_RANKS.findIndex(group => group.includes(k));
  return i === -1 ? UNKNOWN : i;
}

export function colorRank(value) {
  const known = matchKnownKey(value, COLOR_ORDER_KEYS);
  return known ? COLOR_ORDER_KEYS.indexOf(known) : UNKNOWN;
}

let _collator = null;
function collator() {
  // numeric:true → a waist "32" sorts before "100"; base → case-insensitive.
  if (!_collator) _collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return _collator;
}

// Compare two VALUES of one axis: known rank first, then natural text order.
export function compareAxisValues(axis, a, b) {
  const kind = axisKind(axis);
  if (kind !== 'other') {
    const rank = kind === 'color' ? colorRank : sizeRank;
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
  }
  return collator().compare(String(a == null ? '' : a), String(b == null ? '' : b));
}

// The order the axes are sorted in: colour, then size, then the rest as listed.
export function arrangeAxes(axes) {
  const list = Array.isArray(axes) ? axes.filter(Boolean) : [];
  const weight = { color: 0, size: 1, other: 2 };
  return list
    .map((axis, i) => ({ axis, i, w: weight[axisKind(axis)] }))
    .sort((a, b) => a.w - b.w || a.i - b.i)
    .map(x => x.axis);
}

// Case-blind attribute read ("Color" and "color" both occur in real data). On a
// row that carries the axis twice, the first spelling wins — this only orders
// lines, so it must never throw the way the BOM resolver's readAxis does.
function attr(attributes, axis) {
  let attrs = attributes;
  if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch { attrs = null; } }
  if (!attrs || typeof attrs !== 'object') return '';
  const want = axisKey(axis);
  const hit = Object.keys(attrs).find(k => axisKey(k) === want);
  return hit === undefined ? '' : attrs[hit];
}

export function compareVariants(axes) {
  const order = arrangeAxes(axes);
  return (a, b) => {
    for (const axis of order) {
      const d = compareAxisValues(axis, attr(a && a.attributes, axis), attr(b && b.attributes, axis));
      if (d !== 0) return d;
    }
    return 0;
  };
}

// A NEW array; Array.prototype.sort is stable, so rows equal on every axis keep
// the order they arrived in (SKU order from the API).
export function arrangeVariants(variants, axes) {
  const list = Array.isArray(variants) ? variants.slice() : [];
  if (!arrangeAxes(axes).length) return list;
  return list.sort(compareVariants(axes));
}
