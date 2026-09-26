// The pricing step of "Read with AI" in the products import preview: cost +
// markup → price, and (engine addition) an ISK→EUR rate → the EUR price the
// engine's products also require. Pure: no DOM, no i18n — the view owns the
// fields, this owns the arithmetic. Ported from icelandicstore #314
// (public/js/utils/importMarkup.js); the EUR half is the engine's own, because
// every engine product needs price_eur > 0 and a supplier list prints none.
//
// A supplier price list prints what the SHOP pays. The AI reader puts that in
// cost_isk and never in price_isk (a supplier's cost silently becoming our
// selling price is the one mistake it must not make), so such a row cannot be
// created until it has a selling price. The markup is the admin saying, out
// loud, "sell these at cost + N %"; the rate is the admin saying "and at this
// many krónur to the euro". Both apply only to AI-read rows that lack the
// price; a printed selling price is never touched, and every priced row keeps
// (or gains) its "check the price" flag.
//
// Always applied to the rows AS READ, never to rows already priced, so
// changing 80 → 60 re-prices from cost instead of compounding.

export const MAX_MARKUP_PERCENT = 1000;
// A plausibility band, not a business rule (server/utils/fx.js PLAUSIBLE_RATE.EUR).
export const EUR_RATE_MIN = 50;
export const EUR_RATE_MAX = 500;

// "80" · "12,5" (Icelandic keyboard) · "12.5" · " 80 % " → number; blank → null.
// → { ok: true, percent: number|null } | { ok: false, reason: 'invalid'|'too_high' }
export function parseMarkupPercent(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, '').replace(/%$/, '');
  if (s === '') return { ok: true, percent: null };
  if (!/^\d{1,4}(?:[.,]\d{1,2})?$/.test(s)) return { ok: false, reason: 'invalid' };
  const percent = Number(s.replace(',', '.'));
  if (!Number.isFinite(percent)) return { ok: false, reason: 'invalid' };
  if (percent > MAX_MARKUP_PERCENT) return { ok: false, reason: 'too_high' };
  return { ok: true, percent };
}

// "150" · "149,5" → ISK per 1 EUR; blank → null; outside 50–500 → invalid.
// → { ok: true, rate: number|null } | { ok: false, reason: 'invalid' }
export function parseEurRate(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, '');
  if (s === '') return { ok: true, rate: null };
  if (!/^\d{1,3}(?:[.,]\d{1,4})?$/.test(s)) return { ok: false, reason: 'invalid' };
  const rate = Number(s.replace(',', '.'));
  if (!Number.isFinite(rate) || rate < EUR_RATE_MIN || rate > EUR_RATE_MAX) return { ok: false, reason: 'invalid' };
  return { ok: true, rate };
}

const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';

// A row the markup prices: read by AI, carries a cost, has no selling price.
export function isCostOnlyRow(row) {
  return Boolean(row && row.__ai === true && present(row.cost_isk) && !present(row.price_isk));
}

export function hasCostOnlyRows(rows) {
  return (Array.isArray(rows) ? rows : []).some(isCostOnlyRow);
}

// An AI row that has (or will have) an ISK price but no EUR price.
export function needsEurRow(row) {
  return Boolean(row && row.__ai === true && !present(row.price_eur) && (present(row.price_isk) || present(row.cost_isk)));
}

export function hasEurlessRows(rows) {
  return (Array.isArray(rows) ? rows : []).some(needsEurRow);
}

// cost × (1 + percent / 100), whole krónur, integer arithmetic on hundredths
// of a percent (12,5 % of 2 490 is 2 801, never 2 800.999…). null when the
// cost is not a whole non-negative number.
export function priceFromCost(cost, percent) {
  const c = Number(String(cost == null ? '' : cost).trim());
  if (!Number.isInteger(c) || c < 0) return null;
  const hundredths = Math.round(Number(percent) * 100);
  return Math.round((c * (10000 + hundredths)) / 10000);
}

// ISK → EUR cents at `rate` ISK per euro. null unless both are positive.
export function eurCentsFromIsk(isk, rate) {
  const k = Number(isk);
  const r = Number(rate);
  if (!Number.isFinite(k) || k <= 0 || !Number.isFinite(r) || r <= 0) return null;
  return Math.round((k * 100) / r);
}

function withFlag(row, field) {
  const flags = Array.isArray(row.__uncertain) ? row.__uncertain : [];
  return flags.includes(field) ? flags : [...flags, field];
}

/**
 * rows (as read) + { percent, eurRate } → new rows. Cost-only rows get
 * price_isk from the markup; AI rows with an ISK price and no EUR price get
 * price_eur from the rate. Every row keeps its fields as strings, like every
 * import cell. Either input null → that half is skipped.
 * → { rows, priced, eurPriced }
 */
export function applyPricing(rows, { percent = null, eurRate = null } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  let priced = 0;
  let eurPriced = 0;
  const out = list.map((row) => {
    let next = row;
    if (percent !== null && percent !== undefined && isCostOnlyRow(row)) {
      const price = priceFromCost(row.cost_isk, percent);
      if (price !== null && price > 0) {           // products.price_isk must be > 0
        priced += 1;
        next = { ...next, price_isk: String(price), __uncertain: withFlag(next, 'price') };
      }
    }
    if (eurRate !== null && eurRate !== undefined && next.__ai === true && present(next.price_isk) && !present(next.price_eur)) {
      const cents = eurCentsFromIsk(next.price_isk, eurRate);
      if (cents !== null && cents > 0) {
        eurPriced += 1;
        next = { ...next, price_eur: String(cents), __uncertain: withFlag(next, 'price_eur') };
      }
    }
    return next;
  });
  return { rows: out, priced, eurPriced };
}
