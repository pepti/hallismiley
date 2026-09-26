'use strict';

// The product-merge PLANNER — pure, no database. Ported from icelandicstore
// #311/#315 (server/services/productMerge/planner.js), cut to the engine's
// catalogue: no add-axis (ice lets a Size-only master gain a Colour axis; the
// engine refuses a unit that does not fit the master's axes instead), no stock
// write-off mode (the engine has no cost price to value it at — stock always
// MOVES), no pack sizes, recipes, builds, discount scopes or customer prices
// (the engine has none of those tables). The engine loads the rows (under
// locks when it is about to write), hands them here, and executes only what
// comes back. The Duplicates screen's preview calls the same planner, so what
// the admin sees is exactly what the transaction re-checks.
//
// Vocabulary:
//   master  — the product that survives (the "survivor").
//   source  — a product folded into it (becomes inactive, merged_into_id set).
//   unit    — one sellable thing on a source: each LIVE (active) variant of a
//             variant product, or the product itself when it has no variants.
//   target  — where a unit goes:
//     { variantId }   an existing LIVE master variant: the unit's history
//                     follows to it, the source variant is switched off ("map").
//     { attributes }  a NEW master variant: a source variant row changes parent
//                     keeping its id, SKU and stock ("move"); a simple source
//                     becomes a new variant row ("new").
//     { master:true } the master itself — only when the master is a simple
//                     product ("master").
const crypto = require('crypto');
const { axisKey, valueKey, valueKeyFor } = require('../../utils/variantAxis');
const { splitColourTail, colourTailFor } = require('../../utils/productDedupe');

const MAX_SOURCES = 20;
const MAX_VALUE_LEN = 60;
const COLOUR_AXES = new Set(['color', 'colour', 'litur']);

const liveVariants = (p) => (p.variants || []).filter(v => v.active !== false);
const axesOf = (p) => (Array.isArray(p.variant_axes) ? p.variant_axes : []).map(String);
const isSimple = (p) => axesOf(p).length === 0 && liveVariants(p).length === 0;
const effPrice = (v, p) => (v && v.price_isk != null ? Number(v.price_isk) : Number(p.price_isk));
const effPriceEur = (v, p) => (v && v.price_eur != null ? Number(v.price_eur) : Number(p.price_eur));

// The master's axes, each with the key SPELLING its live variants actually use
// ("Color" from an import, "color" from the form) — variant_axes is not a
// reliable guide to that.
function masterAxes(master) {
  const spelled = new Map();
  for (const v of liveVariants(master)) for (const k of Object.keys(v.attributes || {})) {
    if (!spelled.has(axisKey(k))) spelled.set(axisKey(k), k);
  }
  return axesOf(master).map(n => spelled.get(axisKey(n)) || n);
}

// Two comparisons of one variant's attributes over the master's axes, both with
// axis NAMES folded:
//   attrKey  — FOLDED: a colour's supplier code is dropped ("Red" = "Red (RE)").
//              Every collision check uses this one.
//   exactKey — EXACT: values trimmed and case-folded, the code kept.
function attrKey(axes, attrs) {
  const byKey = new Map(Object.entries(attrs || {}).map(([k, v]) => [axisKey(k), v]));
  return axes.map(a => `${axisKey(a)}=${valueKeyFor(a, byKey.get(axisKey(a)))}`).join('|');
}

function exactKey(axes, attrs) {
  const byKey = new Map(Object.entries(attrs || {}).map(([k, v]) => [axisKey(k), v]));
  return axes.map(a => `${axisKey(a)}=${valueKey(byKey.get(axisKey(a)))}`).join('|');
}

// An exact match wins over a folded one. → [] | [one] | several (ambiguous).
function matchingMasterVariants(masterLive, axes, attrs) {
  const exact = exactKey(axes, attrs);
  const hits = masterLive.filter(m => m.exact === exact);
  if (hits.length) return hits;
  const folded = attrKey(axes, attrs);
  return masterLive.filter(m => m.key === folded);
}

// Rewrite attribute keys to the master's spelling; null when an axis is
// missing/blank/too long or an extra key is present.
function normaliseAttributes(axes, attrs) {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return null;
  const want = new Map(axes.map(a => [axisKey(a), a]));
  const out = {};
  for (const [k, raw] of Object.entries(attrs)) {
    const spelled = want.get(axisKey(k));
    if (!spelled) return null;
    const val = String(raw == null ? '' : raw).trim();
    if (!val || val.length > MAX_VALUE_LEN) return null;
    out[spelled] = val;
  }
  return Object.keys(out).length === axes.length && axes.length > 0 ? out : null;
}

function unitsOf(source) {
  if (isSimple(source)) {
    return [{ key: `${source.id}`, productId: String(source.id), variantId: null, source, variant: null,
      sku: source.sku || null, barcode: source.barcode || null, attributes: null, stock: Number(source.stock) || 0 }];
  }
  return liveVariants(source).map(v => ({
    key: `${source.id}|${v.id}`, productId: String(source.id), variantId: String(v.id), source, variant: v,
    sku: v.sku || null, barcode: v.barcode || null, attributes: v.attributes || {}, stock: Number(v.stock) || 0,
  }));
}

function colourAxisOf(names) {
  return names.find(n => COLOUR_AXES.has(axisKey(n))) || null;
}

// A starting map for the Duplicates screen: barcode match first, then the
// unit's attributes plus the source's name colour ("… | Red (RE)"), then
// nothing (the admin decides).
function propose(state) {
  const { master, sources } = state;
  const axes = masterAxes(master);
  const colourAxis = colourAxisOf(axes);
  const masterLive = liveVariants(master).map(v => ({ v, key: attrKey(axes, v.attributes), exact: exactKey(axes, v.attributes) }));
  const map = [];
  for (const source of sources) {
    const tail = colourTailFor(source.name, master) || splitColourTail(source.name);
    for (const u of unitsOf(source)) {
      let target = null;
      if (isSimple(master)) {
        target = u.variantId ? null : { master: true };
      } else {
        const byBarcode = u.barcode && masterLive.find(m => m.v.barcode && String(m.v.barcode) === String(u.barcode));
        if (byBarcode) target = { variantId: String(byBarcode.v.id) };
        else {
          const attrs = { ...(u.attributes || {}) };
          if (colourAxis && tail && !Object.keys(attrs).some(k => axisKey(k) === axisKey(colourAxis))) attrs[colourAxis] = tail.tail;
          const norm = normaliseAttributes(axes, attrs);
          if (norm) {
            const hits = matchingMasterVariants(masterLive, axes, norm);
            // Two master rows answer equally well: guessing would put the
            // history on a row the admin never chose. Leave it to them.
            if (hits.length === 1) target = { variantId: String(hits[0].v.id) };
            else if (!hits.length) target = { attributes: norm };
          }
        }
      }
      map.push({ source: { productId: u.productId, variantId: u.variantId }, target });
    }
  }
  return { variant_map: map };
}

// state fingerprint + the normalised request → the preview's `expect` token. A
// change to any row the merge reads (price, VAT, codes, stock, attributes,
// activity) between preview and apply makes the apply STALE_PREVIEW.
function fingerprint(state, request) {
  const rowOf = (p) => ({
    id: p.id, updated_at: p.updated_at ? new Date(p.updated_at).toISOString() : null, stock: p.stock,
    active: p.active, merged_into_id: p.merged_into_id || null, variant_axes: p.variant_axes, vat_rate: p.vat_rate,
    is_bookable: Boolean(p.is_bookable), sku: p.sku || null, barcode: p.barcode || null,
    price_isk: p.price_isk, price_eur: p.price_eur, bin: p.bin || null,
    variants: (p.variants || []).map(v => ({
      id: v.id, attributes: v.attributes, stock: v.stock, active: v.active !== false,
      sku: v.sku || null, barcode: v.barcode || null, price_isk: v.price_isk ?? null, price_eur: v.price_eur ?? null,
      bin: v.bin || null,
    })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  });
  const body = JSON.stringify({
    master: rowOf(state.master),
    sources: state.sources.map(rowOf).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    request,
  });
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 32);
}

// → { ok, refusals, warnings, units, axes, shape, stockMode, summary, expect, request }
function plan(state, raw) {
  const refusals = [];
  const warnings = [];
  const refuse = (code, extra = {}) => refusals.push({ code, ...extra });
  const warn = (code, extra = {}) => warnings.push({ code, ...extra });
  const { master, sources } = state;

  const request = {
    master: String(master.id),
    ids: sources.map(s => String(s.id)).sort(),
    variant_map: (Array.isArray(raw && raw.variant_map) ? raw.variant_map : []).map(e => ({
      source: { productId: String(e && e.source && e.source.productId || ''), variantId: e && e.source && e.source.variantId ? String(e.source.variantId) : null },
      target: e && e.target ? (e.target.variantId ? { variantId: String(e.target.variantId) }
        : e.target.master === true ? { master: true }
          : e.target.attributes ? { attributes: e.target.attributes } : null) : null,
    })),
  };

  // ── whole-merge refusals ──────────────────────────────────────────────────
  if (sources.length > MAX_SOURCES) refuse('too_many', { max: MAX_SOURCES });
  if (master.merged_into_id) refuse('already_merged', { productId: String(master.id) });
  for (const s of sources) {
    if (s.merged_into_id) refuse('already_merged', { productId: String(s.id) });
    // A bookable service holds no stock at product level; folding a stocked
    // product into one (or the reverse) would change what its stock means.
    if (Boolean(s.is_bookable) !== Boolean(master.is_bookable)) refuse('bookable_mismatch', { productId: String(s.id) });
    if (String(s.category || '') !== String(master.category || '')) warn('category_differs', { productId: String(s.id) });
  }
  if (!master.active) warn('master_inactive');

  const masterSimple = isSimple(master);
  const axes = masterAxes(master);

  const masterLive = new Map();
  const liveKeys = new Map();      // folded key → the first live variant with it
  const foldGroups = new Map();    // folded key → [{ id, sku, exact }]
  for (const v of liveVariants(master)) {
    masterLive.set(String(v.id), v);
    const k = attrKey(axes, v.attributes || {});
    if (!liveKeys.has(k)) liveKeys.set(k, String(v.id));
    if (!foldGroups.has(k)) foldGroups.set(k, []);
    foldGroups.get(k).push({ id: String(v.id), sku: v.sku || null, exact: exactKey(axes, v.attributes || {}) });
  }

  // ── units ─────────────────────────────────────────────────────────────────
  const byKey = new Map();
  for (const e of request.variant_map) byKey.set(`${e.source.productId}|${e.source.variantId || ''}`, e.target);
  const units = [];
  const newKeys = new Map();
  const skuSeen = new Set();
  for (const s of sources) {
    for (const u of unitsOf(s)) {
      const target = byKey.get(`${u.productId}|${u.variantId || ''}`) || null;
      const unit = {
        key: u.key, productId: u.productId, variantId: u.variantId, name: s.name,
        sku: u.sku, barcode: u.barcode, attributes: u.attributes, stock: u.stock,
        target, kind: null, newAttributes: null, newSku: null,
      };
      units.push(unit);
      if (!target) { refuse('unit_unmapped', { unit: u.key }); continue; }

      if (target.master) {
        if (!masterSimple) { refuse('target_invalid', { unit: u.key }); continue; }
        // Collapsing a variant into a simple product would lose what it was.
        if (u.variantId) { refuse('master_simple_variants', { unit: u.key }); continue; }
        unit.kind = 'master';
        if (Number(s.vat_rate) !== Number(master.vat_rate)) refuse('vat_mismatch', { unit: u.key });
        if (effPrice(null, s) !== Number(master.price_isk)) warn('price_differs', { unit: u.key });
      } else if (target.variantId) {
        const tv = masterLive.get(target.variantId);
        if (!tv) { refuse('target_not_live', { unit: u.key, variantId: target.variantId }); continue; }
        unit.kind = 'map';
        if (Number(s.vat_rate) !== Number(master.vat_rate)) refuse('vat_mismatch', { unit: u.key });
        if (effPrice(u.variant, s) !== effPrice(tv, master)) warn('price_differs', { unit: u.key });
      } else if (target.attributes) {
        if (masterSimple) { refuse('master_simple_variants', { unit: u.key }); continue; }
        const norm = normaliseAttributes(axes, target.attributes);
        if (!norm) { refuse('attributes_invalid', { unit: u.key }); continue; }
        const k = attrKey(axes, norm);
        if (liveKeys.has(k)) { refuse('attribute_collision', { unit: u.key, variantId: liveKeys.get(k) }); continue; }
        if (newKeys.has(k)) { refuse('attribute_collision', { unit: u.key, with: newKeys.get(k) }); continue; }
        newKeys.set(k, u.key);
        unit.newAttributes = norm;
        unit.kind = u.variantId ? 'move' : 'new';
        // The engine's variants carry no VAT rate of their own: they take the
        // product's, so a unit only changes parent at the same rate.
        if (Number(s.vat_rate) !== Number(master.vat_rate)) refuse('vat_mismatch', { unit: u.key });
        if (unit.kind === 'new') {
          // product_variants.sku is NOT NULL and unique: a simple source brings
          // its own SKU, or — when it has none — its (unique) slug.
          const sku = String(u.sku || s.slug || '').trim();
          unit.newSku = sku || null;
          const lower = sku.toLowerCase();
          const owner = state.variantSkus && state.variantSkus.get(lower);
          if (!sku || owner || skuSeen.has(lower)) refuse('sku_collision', { unit: u.key, sku: sku || null });
          skuSeen.add(lower);
        }
        if (effPrice(u.variant, s) !== Number(master.price_isk) || effPriceEur(u.variant, s) !== Number(master.price_eur)) {
          warn('price_kept_on_variant', { unit: u.key });
        }
      } else {
        refuse('target_invalid', { unit: u.key });
      }
    }
  }
  if (!units.length) refuse('nothing_to_merge');
  for (const e of request.variant_map) {
    if (!units.some(u => u.productId === e.source.productId && (u.variantId || null) === e.source.variantId)) {
      refuse('unit_unknown', { unit: `${e.source.productId}|${e.source.variantId || ''}` });
    }
  }

  // ── master variants that already read the same (ice #315 E) ────────────────
  // Two LIVE master rows under one folded key ("Red (RE) / XL" beside "Red /
  // XL"). A refusal only when a unit is MAPPED onto a row that has an IDENTICAL
  // twin — which one inherits the history would be an accident; otherwise one
  // warning (the engine writes by variant id, so the twin is never touched).
  const pairs = [];
  for (const group of foldGroups.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        pairs.push({ variantIds: [group[i].id, group[j].id], skus: [group[i].sku, group[j].sku], identical: group[i].exact === group[j].exact });
      }
    }
  }
  if (pairs.length) {
    const mappedOnto = new Map();
    for (const u of units) if (u.kind === 'map') mappedOnto.set(String(u.target.variantId), [...(mappedOnto.get(String(u.target.variantId)) || []), u.key]);
    const touching = [], untouched = [], touchedUnits = new Set();
    for (const p of pairs) {
      const hitUnits = p.identical ? p.variantIds.flatMap(id => mappedOnto.get(id) || []) : [];
      if (hitUnits.length) { touching.push(p); hitUnits.forEach(k => touchedUnits.add(k)); } else untouched.push(p);
    }
    if (touching.length) refuse('master_variants_inconsistent', { pairs: touching, units: [...touchedUnits] });
    if (untouched.length) warn('master_variants_inconsistent', { pairs: untouched });
  }

  let stockMoved = 0;
  for (const u of units) if (u.kind && u.kind !== 'move') stockMoved += u.stock;

  const summary = {
    moved: units.filter(u => u.kind === 'move').length,
    mapped: units.filter(u => u.kind === 'map').length,
    created: units.filter(u => u.kind === 'new').length,
    into_master: units.filter(u => u.kind === 'master').length,
    stockMoved,
  };
  return {
    ok: refusals.length === 0,
    refusals, warnings, units, axes,
    shape: masterSimple ? 'simple' : 'variants',
    stockMode: 'move',
    summary, request,
    expect: fingerprint(state, request),
  };
}

module.exports = { plan, propose, masterAxes, attrKey, normaliseAttributes, unitsOf, isSimple, MAX_SOURCES };
