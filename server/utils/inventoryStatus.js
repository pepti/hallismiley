// Inventory Watch classification — pure, side-effect-free, unit-tested.
// Ported from icelandicstore #13 (Inventory Watch) and #243 (bucket on
// Available), harvest 2 lane 6a. The engine drops ice's made-to-order
// exclusion and its BIN on-hand classifier: the engine has neither concept.
//
// "Velocity" is units sold over a trailing window (default 90 days) expressed
// per month. "Cover" is how many months the AVAILABLE quantity (on hand −
// committed, models/Inventory.js) lasts at that velocity. Status is a coarse
// severity bucket over the cover, with two edge cases:
//   • available <= 0          → 'out'  (nothing left to sell, whatever the pace)
//   • sold_per_month <= 0     → 'ok'   (no recent sales → nothing at risk; cover is ∞)
//
// Thresholds are months-of-cover and live here as named constants so they are
// tuned in one place.

const WINDOW_DAYS    = 90;   // trailing sales window used to measure velocity
const DAYS_PER_MONTH = 30;   // window → months divisor (90d ⇒ 3 months)

const COVER_CRITICAL = 0.5;  // < 0.5 mo of cover → 'critical'
const COVER_LOW      = 1;    // < 1 mo            → 'low'
const COVER_WATCH    = 2;    // < 2 mo            → 'watch'  (≥ 2 mo ⇒ 'ok')

const STATUSES = ['out', 'critical', 'low', 'watch', 'ok'];
// Severity order — drives the default "most urgent first" table sort.
const STATUS_ORDER = { out: 0, critical: 1, low: 2, watch: 3, ok: 4 };

// Months of sales the window represents (90d ⇒ 3).
function windowMonths(windowDays = WINDOW_DAYS) {
  return windowDays / DAYS_PER_MONTH;
}

// qty / sold_per_month, or null when it cannot be expressed as a finite number
// (nothing left, or nothing selling). Callers render null as "—".
function coverMonths(qty, soldPerMonth) {
  const q = Number(qty);
  const spm = Number(soldPerMonth);
  if (!(q > 0) || !(spm > 0)) return null;
  return q / spm;
}

// Coarse severity bucket. See the module header for the two edge cases.
function classifyInventory(qty, soldPerMonth) {
  const q = Number(qty);
  if (!(q > 0)) return 'out';
  const spm = Number(soldPerMonth);
  if (!(spm > 0)) return 'ok';
  const cover = q / spm;
  if (cover < COVER_CRITICAL) return 'critical';
  if (cover < COVER_LOW)      return 'low';
  if (cover < COVER_WATCH)    return 'watch';
  return 'ok';
}

// Raw watch rows (Inventory.watchRows) → the report the page and the API send:
// one item per stocked unit (a product without variants, or one variant), the
// three numbers, velocity, cover and the bucket, plus the per-bucket counts.
// Bucket and cover use AVAILABLE — what can still be sold — not the shelf.
function buildWatchReport(rows, { windowDays = WINDOW_DAYS } = {}) {
  const months = windowMonths(windowDays);
  const counts = { out: 0, critical: 0, low: 0, watch: 0, ok: 0 };
  const items = (rows || []).map((r) => {
    const onHand = Math.trunc(Number(r.on_hand) || 0);
    const committed = Math.trunc(Number(r.committed) || 0);
    const available = onHand - committed;
    const unitsWindow = Math.max(0, Math.trunc(Number(r.units_window) || 0));
    const soldPerMonth = unitsWindow / months;
    const status = classifyInventory(available, soldPerMonth);
    counts[status] += 1;
    return {
      key: r.variant_id ? `v:${r.variant_id}` : `p:${r.product_id}`,
      product_id: r.product_id,
      variant_id: r.variant_id || null,
      name: r.name,
      attributes: r.attributes || null,
      sku: r.sku || null,
      bin: r.bin || null,
      active: r.active !== false,
      on_hand: onHand,
      committed,
      available,
      units_window: unitsWindow,
      sold_per_month: soldPerMonth,
      cover_months: coverMonths(available, soldPerMonth),
      status,
    };
  });
  return { items, counts, total: items.length, window_days: windowDays };
}

module.exports = {
  WINDOW_DAYS,
  DAYS_PER_MONTH,
  COVER_CRITICAL,
  COVER_LOW,
  COVER_WATCH,
  STATUSES,
  STATUS_ORDER,
  windowMonths,
  coverMonths,
  classifyInventory,
  buildWatchReport,
};
