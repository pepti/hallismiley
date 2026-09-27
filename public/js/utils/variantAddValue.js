// Ported from icelandicstore #430 (ice@965014ee; harvest 2 lane 6c,
// 2026-09-26) — the file as ice ships it. Engine user: components/VariantGrid.js
// ("+ Add a colour"), which POSTs each planned row through the existing
// one-variant route.
//
// "Add a colour" on the variant grid — the pure half, so it can be unit-tested.
//
// A product with axes Color × Size already holds, say, 12 colours in XS–2XL.
// Adding a thirteenth used to mean "+ Add variant" six times and typing the
// colour, size, SKU and barcode into every row. This plans those rows in one go:
// the new value on the chosen axis, crossed with every value the OTHER axes
// already use, in the order a person reads a garment grid (XS → 2XL).
//
// It also reads a block pasted from a spreadsheet, so SKU and barcode for every
// row arrive in one paste rather than twelve fields. Nothing here talks to the
// server: the view POSTs each planned row through the existing one-variant route.
import { compareAxisValues } from './variantArrange.js';
import { axisKey, valueKeyFor } from './variantAxis.js';

// Case-blind attribute read: real rows carry "Color" and "color" both.
function attr(attributes, axis) {
  if (!attributes || typeof attributes !== 'object') return null;
  const want = axisKey(axis);
  const hit = Object.keys(attributes).find(k => axisKey(k) === want);
  return hit === undefined ? null : attributes[hit];
}

// Distinct values an axis already uses on the product, in display order. A value
// is the same value whatever its case or spacing ("black" = "Black "), and on the
// colour axis whatever supplier code it carries ("Black (BL)" = "Black").
export function axisValues(rows, axis) {
  const seen = new Map();
  for (const r of rows || []) {
    const raw = r ? attr(r.attributes, axis) : null;
    const v = raw == null ? '' : String(raw).trim();
    if (!v) continue;
    const k = valueKeyFor(axis, v);
    if (!seen.has(k)) seen.set(k, v);
  }
  return [...seen.values()].sort((a, b) => compareAxisValues(axis, a, b));
}

// The rows to create for `value` on `axis`. Returns { rows, error } where rows is
// a list of attribute objects keyed by every axis of the product.
//   error 'empty'   — no value typed
//   error 'exists'  — the axis already has this value (a second "Black" would
//                     collide with every existing Black row on the server)
//   error 'noOthers'— another axis has no values yet, so there is nothing to
//                     cross with (the product has no variants to copy from)
export function planNewValue({ axes, rows, axis, value }) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return { rows: [], error: 'empty' };
  if (!Array.isArray(axes) || !axes.includes(axis)) return { rows: [], error: 'empty' };
  const k = valueKeyFor(axis, v);
  if (axisValues(rows, axis).some(x => valueKeyFor(axis, x) === k)) return { rows: [], error: 'exists' };

  const others = axes.filter(a => a !== axis);
  const lists = others.map(a => axisValues(rows, a));
  if (lists.some(l => l.length === 0)) return { rows: [], error: 'noOthers' };

  // Cartesian product of the other axes, first axis outermost.
  let combos = [{}];
  others.forEach((a, i) => {
    const next = [];
    for (const c of combos) for (const val of lists[i]) next.push({ ...c, [a]: val });
    combos = next;
  });
  return {
    rows: combos.map(c => {
      const attributes = {};
      for (const a of axes) attributes[a] = a === axis ? v : c[a];
      return attributes;
    }),
    error: null,
  };
}

// Split one pasted line into cells. A spreadsheet copies TAB-separated; a hand-
// typed list tends to use ";" or "," — accepted when there is no tab.
function cells(line) {
  if (line.includes('\t')) return line.split('\t').map(s => s.trim());
  if (line.includes(';')) return line.split(';').map(s => s.trim());
  if (line.includes(',')) return line.split(',').map(s => s.trim());
  return [line.trim()];
}

// Read a pasted block into { sku, barcode } per planned row.
//
// Two shapes, and the block is one or the other:
//
//   KEYED — lines start with a row's label, i.e. its other-axis value(s):
//           "XS  EP01-MA0  5055…". Any order; each line goes to its own row, so a
//           stray line (a header, a size the table lacks) cannot shift the rest.
//           Lines that name no row are reported and skipped.
//   IN ORDER — "SKU [barcode]" per line, row after row. ALL OR NOTHING: the line
//           count must equal the row count exactly. A copied header line or one
//           missing row would otherwise slide every SKU onto the wrong size,
//           which is the one mistake here nobody would notice.
//
// A SKU with whitespace inside is refused in both shapes: it means the columns
// were separated by spaces, and the "SKU" is really a whole line.
//
// Returns { values: [{sku, barcode}|null per row], errors: [{line, reason, …}] }
//   reason 'unknown' — keyed block: this line names no row in the table
//   reason 'dupe'    — keyed block: a second line for the same row
//   reason 'count'   — in-order block: {got} lines for {n} rows; nothing filled
//   reason 'spaces'  — the SKU on this line contains spaces; nothing filled
//                      from it (in order: nothing at all)
export function parsePaste(text, plannedRows, axes, axis) {
  const rows = plannedRows || [];
  const values = rows.map(() => null);
  const errors = [];
  const lines = String(text || '').split(/\r?\n/).map((raw, i) => ({ raw, n: i + 1 }))
    .filter(l => l.raw.trim() !== '');
  if (!lines.length) return { values, errors };

  const others = (axes || []).filter(a => a !== axis);
  const keyOf = (cell) => String(cell || '').toLowerCase().replace(/\s+/g, '');
  // The label of a row = its other-axis values joined, e.g. "XS" or "XS / Slim".
  const labelOf = (attrs) => others.map(a => attrs[a]).join('/');
  const byLabel = new Map(others.length ? rows.map((attrs, i) => [keyOf(labelOf(attrs)), i]) : []);
  const hasSpace = (s) => /\s/.test(String(s || '').trim());

  const parsed = lines.map(l => ({ ...l, c: cells(l.raw) }));

  if (parsed.some(p => p.c.length >= 2 && byLabel.has(keyOf(p.c[0])))) {
    for (const p of parsed) {
      const i = p.c.length >= 2 ? byLabel.get(keyOf(p.c[0])) : undefined;
      if (i === undefined) { errors.push({ line: p.n, reason: 'unknown' }); continue; }
      if (values[i]) { errors.push({ line: p.n, reason: 'dupe' }); continue; }
      const [sku = '', barcode = ''] = p.c.slice(1);
      if (hasSpace(sku)) { errors.push({ line: p.n, reason: 'spaces' }); continue; }
      values[i] = { sku, barcode };
    }
    return { values, errors };
  }

  // In order. Three or more cells means the first one was meant as a label that
  // matched no row (e.g. "XXL" against "2XL") — not a SKU.
  if (parsed.length !== rows.length) {
    return { values, errors: [{ line: 0, reason: 'count', got: parsed.length }] };
  }
  const bad = parsed.filter(p => p.c.length > 2 || hasSpace(p.c[0]));
  if (bad.length) {
    return { values, errors: bad.map(p => ({ line: p.n, reason: p.c.length > 2 ? 'unknown' : 'spaces' })) };
  }
  parsed.forEach((p, i) => { values[i] = { sku: p.c[0] || '', barcode: p.c[1] || '' }; });
  return { values, errors };
}
