'use strict';

// Duplicate-product suggestions — the evidence behind Products → Duplicates.
// Ported from icelandicstore #309 (+ the two-segment colourway of #315),
// server/utils/productDedupe.js, cut to the engine's catalogue: the engine has
// no vendor column (ice compared vendors; here the product TYPE — `category` —
// is the only "same seller of the same kind of thing" guard), no internal
// components, no "-RETIRED-YYYYMMDD" SKU archiver and no Shopify-invented SKUs,
// so those ice-only rules are gone. What stays is generic:
//
// PURE: no database, no I/O — models/ProductMerge.findDuplicateGroups loads the
// rows and hands them here, so every signal is unit-testable. Read-only by
// design: this finds candidates and says WHY; it never merges. The merge
// engine (services/productMerge) re-checks everything under locks.
//
// The signals, strongest first:
//   barcode    — the same GTIN (check digit valid, padded to 14) on two products
//                or their live variants.
//   sku        — the same SKU (case-folded) on two products or live variants.
//   identical  — the same name once case, accents and punctuation are ignored,
//                within one product type.
//   colourway  — a per-colour product that belongs under a multi-colour master:
//                "T-Shirt | Classic | Red" (sizes only) next to "T-Shirt |
//                Classic" (Colour × Size). Also sets of per-colour siblings with
//                no master yet. The strongest tell is an INACTIVE master variant
//                carrying the per-colour product's colour (a row someone
//                switched off when the colour moved to its own product).
//   similar    — names whose word sets overlap ≥ 80 %, same product type.
//
// Inactive variants are ignored by the barcode and SKU signals (a switched-off
// row's codes are not a live claim) but ARE the colourway tell.

const { axisKey, colorKey } = require('./variantAxis');

const SIGNAL_RANK = { barcode: 5, sku: 5, identical: 4, colourway: 3, similar: 2 };
const COLOURWAY_MIN = 0.7;
const SIMILAR_MIN = 0.8;
const COLOUR_AXES = new Set(['color', 'colour', 'litur']);

// "Reykjavík — T-Shirt!" → "reykjavik t shirt"
function normalizeText(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9þæðø]+/g, ' ')
    .trim();
}

function tokens(s) {
  const t = normalizeText(s);
  return new Set(t ? t.split(' ') : []);
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const nameSegments = (name) => String(name == null ? '' : name).split('|').map(s => s.trim()).filter(Boolean);

// Words, optionally a "(CODE)" — "Light Olive", "Red (RE)"; never a sentence.
function colourShaped(tail) {
  if (!/^[\p{L}][\p{L} '-]{0,28}(\s*\([A-Za-z0-9]{1,5}\))?$/u.test(tail)) return false;
  return tail.replace(/\([^)]*\)/g, '').trim().split(/\s+/).length <= 3;
}

// A colour value with a supplier code: "Red (RE)".
const CODED_COLOUR = /\s*\([A-Za-z0-9]{1,5}\)$/;

const live = (v) => v && v.active !== false;

// A trailing "| Colour" segment, when the name has at least three segments and
// the last one reads like a colour (words, optionally a "(CODE)"), else null.
function splitColourTail(name) {
  const parts = nameSegments(name);
  if (parts.length < 3) return null;
  const tail = parts[parts.length - 1];
  if (!colourShaped(tail)) return null;
  return { base: parts.slice(0, -1).join(' | '), tail };
}

function hasColourAxis(axes) {
  return Array.isArray(axes) && axes.some(a => COLOUR_AXES.has(axisKey(a)));
}

function colourOf(attributes) {
  for (const [k, v] of Object.entries(attributes || {})) if (COLOUR_AXES.has(axisKey(k))) return v;
  return undefined;
}

// Every colour a product's variants carry, inactive ones included, as colorKey()s.
function knownColourKeys(product) {
  const out = new Set();
  for (const v of (product && product.variants) || []) {
    const c = colourOf(v.attributes);
    if (c != null && String(c).trim()) out.add(colorKey(c));
  }
  return out;
}

// The colour tail of `name` read AGAINST one candidate master (ice #315 D).
// Three or more segments: splitColourTail. A TWO-segment "Tee | Red (RE)" is
// far more ambiguous ("Postcard | Reykjavik" is a design, not a colour), so it
// needs all three: the head names the master (the same word set), the master
// has a colour axis, and the tail is colour-shaped AND either carries a
// supplier code or is a colour the master already comes in.
function colourTailFor(name, master) {
  const strict = splitColourTail(name);
  if (strict) return strict;
  const parts = nameSegments(name);
  if (parts.length !== 2 || !master) return null;
  const [base, tail] = parts;
  if (!colourShaped(tail) || !hasColourAxis(master.variant_axes)) return null;
  const head = tokens(base), own = tokens(master.name);
  if (!head.size || head.size !== own.size || jaccard(head, own) !== 1) return null;
  if (!CODED_COLOUR.test(tail) && !knownColourKeys(master).has(colorKey(tail))) return null;
  return { base, tail };
}

function gtinValid(digits) {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i -= 1, w = w === 3 ? 1 : 3) sum += Number(body[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

// A barcode as a GTIN-14 key, or null when it is not a valid GTIN.
function gtinKey(barcode) {
  const d = String(barcode == null ? '' : barcode).replace(/[\s-]/g, '');
  if (!gtinValid(d)) return null;
  return d.padStart(14, '0');
}

// A comparable SKU, or null when blank.
function skuKey(sku) {
  const s = String(sku == null ? '' : sku).trim().toLowerCase();
  return s || null;
}

const sameType = (a, b) => normalizeText(a.category) === normalizeText(b.category);

// rows: [{ id, slug, name, sku, barcode, category, active, variant_axes,
//          variants: [{ sku, barcode, attributes, active }] }]
// → [{ type, signals, confidence, masterId, products: [{ id, role, colour, archivedColourMatch }] }]
function findDuplicateGroups(rows) {
  const parent = new Map(rows.map(r => [String(r.id), String(r.id)]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const edges = [];
  const addEdge = (a, b, signal, extra = {}) => {
    const A = String(a), B = String(b);
    if (A === B) return;
    edges.push({ a: A, b: B, signal, ...extra });
    parent.set(find(A), find(B));
  };

  // barcode + sku: bucket every live code, pair everything in a bucket.
  const buckets = (keyOf) => {
    const m = new Map();
    const put = (key, id) => { if (!key) return; if (!m.has(key)) m.set(key, new Set()); m.get(key).add(String(id)); };
    for (const r of rows) {
      put(keyOf(r), r.id);
      for (const v of r.variants || []) if (live(v)) put(keyOf(v), r.id);
    }
    return m;
  };
  const pairBucket = (m, signal) => {
    for (const ids of m.values()) {
      const list = [...ids];
      for (let i = 1; i < list.length; i += 1) addEdge(list[0], list[i], signal);
    }
  };
  pairBucket(buckets((x) => gtinKey(x.barcode)), 'barcode');
  pairBucket(buckets((x) => skuKey(x.sku)), 'sku');

  // identical names — within one product type.
  const byName = new Map();
  for (const r of rows) {
    const name = normalizeText(r.name);
    if (!name) continue;
    const k = `${name} | ${normalizeText(r.category)}`;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(String(r.id));
  }
  for (const ids of byName.values()) for (let i = 1; i < ids.length; i += 1) addEdge(ids[0], ids[i], 'identical');

  // colourway: per-colour products → master, or → each other
  const colourInfo = new Map(); // productId → { colour, archivedColourMatch, masterId }
  const masters = rows.filter(r => hasColourAxis(r.variant_axes));
  const tellFor = (m, tail) => (m.variants || []).some(v => !live(v) && colorKey(colourOf(v.attributes)) === colorKey(tail));
  const perColour = [];
  for (const r of rows) {
    if (hasColourAxis(r.variant_axes)) continue;
    const split = splitColourTail(r.name);
    if (split) { perColour.push({ row: r, ...split, baseTokens: tokens(split.base) }); continue; }
    // A two-segment name is a colourway only under a master it names; it never
    // forms master-less sibling sets.
    if (nameSegments(r.name).length !== 2) continue;
    let hit = null;
    for (const m of masters) {
      if (String(m.id) === String(r.id) || !sameType(m, r)) continue;
      const loose = colourTailFor(r.name, m);
      if (loose) { hit = { m, ...loose }; break; }
    }
    if (!hit) continue;
    const archivedColourMatch = tellFor(hit.m, hit.tail);
    colourInfo.set(String(r.id), { colour: hit.tail, archivedColourMatch, masterId: String(hit.m.id) });
    addEdge(hit.m.id, r.id, 'colourway', { score: 1, archivedColourMatch });
  }
  for (const pc of perColour) {
    let best = null;
    for (const m of masters) {
      if (String(m.id) === String(pc.row.id) || !sameType(m, pc.row)) continue;
      const score = jaccard(tokens(m.name), pc.baseTokens);
      if (score >= COLOURWAY_MIN && (!best || score > best.score)) best = { m, score };
    }
    if (best) {
      const archivedColourMatch = tellFor(best.m, pc.tail);
      colourInfo.set(String(pc.row.id), { colour: pc.tail, archivedColourMatch, masterId: String(best.m.id) });
      addEdge(best.m.id, pc.row.id, 'colourway', { score: best.score, archivedColourMatch });
    } else {
      colourInfo.set(String(pc.row.id), { colour: pc.tail, archivedColourMatch: false, masterId: null });
    }
  }
  // siblings with no master: same base words and product type, different colour
  for (let i = 0; i < perColour.length; i += 1) {
    for (let j = i + 1; j < perColour.length; j += 1) {
      const a = perColour[i], b = perColour[j];
      if (colourInfo.get(String(a.row.id)).masterId || colourInfo.get(String(b.row.id)).masterId) continue;
      if (!sameType(a.row, b.row)) continue;
      if (normalizeText(a.base) === normalizeText(b.base) && colorKey(a.tail) !== colorKey(b.tail)) {
        addEdge(a.row.id, b.row.id, 'colourway', { score: 1, archivedColourMatch: false });
      }
    }
  }

  // similar names (only pairs no stronger signal already joined directly)
  const linked = new Set(edges.map(e => [e.a, e.b].sort().join('|')));
  const toks = rows.map(r => ({ r, t: tokens(r.name) }));
  for (let i = 0; i < toks.length; i += 1) {
    for (let j = i + 1; j < toks.length; j += 1) {
      const a = toks[i].r, b = toks[j].r;
      if (linked.has([String(a.id), String(b.id)].sort().join('|'))) continue;
      if (!sameType(a, b)) continue;
      if (normalizeText(a.name) === normalizeText(b.name)) continue;
      const ta = splitColourTail(a.name), tb = splitColourTail(b.name);
      if (ta && tb && normalizeText(ta.base) === normalizeText(tb.base)) continue;
      const score = jaccard(toks[i].t, toks[j].t);
      if (score >= SIMILAR_MIN) addEdge(a.id, b.id, 'similar', { score });
    }
  }

  // assemble groups
  const groups = new Map();
  for (const e of edges) {
    const root = find(e.a);
    if (!groups.has(root)) groups.set(root, { ids: new Set(), edges: [] });
    const g = groups.get(root);
    g.ids.add(e.a); g.ids.add(e.b); g.edges.push(e);
  }

  const out = [];
  for (const g of groups.values()) {
    const signals = [...new Set(g.edges.map(e => e.signal))].sort((x, y) => SIGNAL_RANK[y] - SIGNAL_RANK[x]);
    // The badge names the WEAKEST signal holding the group together: the admin
    // should see the guess, not the proof.
    const type = signals[signals.length - 1];
    const similarScores = g.edges.filter(e => e.signal === 'similar').map(e => e.score);
    const confidence = type === 'similar' ? Math.min(...similarScores) : null;
    const colourMasters = g.edges
      .filter(e => e.signal === 'colourway' && colourInfo.get(e.b) && colourInfo.get(e.b).masterId === e.a)
      .map(e => e.a);
    const masterId = colourMasters[0] || null;
    const products = [...g.ids].map((id) => {
      const info = colourInfo.get(id);
      return {
        id,
        role: masterId === id ? 'master' : (info ? 'colourway' : 'product'),
        colour: info ? info.colour : null,
        archivedColourMatch: Boolean(info && info.archivedColourMatch),
      };
    });
    out.push({ type, signals, confidence, masterId, products });
  }
  return out;
}

module.exports = {
  normalizeText, tokens, jaccard, splitColourTail, colourTailFor,
  gtinValid, gtinKey, skuKey, hasColourAxis, findDuplicateGroups,
  SIGNAL_RANK, COLOURWAY_MIN, SIMILAR_MIN,
};
