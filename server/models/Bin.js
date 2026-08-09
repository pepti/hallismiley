// Repository + derivation logic for the BIN System board (admin view 'bins').
//
// A "bin" is a short shelf code stored as TEXT on products / product_variants
// (e.g. 'A-001', 'BK-6'). There is no bins registry: zones (the letter prefix)
// and the per-zone numeric grid are DERIVED from the assigned bins, with unused
// numbers between a zone's lowest and highest bin shown as "free" slots.
//
// The pure helpers (parseBin / summariseZones / buildZoneCells) hold all the
// zone-parse + free-gap logic and are unit-tested without a DB
// (tests/unit/bins-grid.test.js). The async methods just feed them rows.
//
// Parameterised queries throughout (prevents SQL injection). Variants carry
// their own sku + bin but no barcode, so barcode always comes from the parent
// product.
const db = require('../config/database');

// A well-formed bin is <letters><optional dash><digits>. Used both in JS
// (parseBin) and in SQL (the mismatch filter) — keep the two in sync.
const BIN_RE    = /^([A-Za-z]+)(-?)(\d+)$/;
const BIN_SQL_RE = '^[A-Za-z]+-?[0-9]+$';

class Bin {
  // ── PURE HELPERS (exported via static methods for unit tests) ───────────────

  // Parse a bin code into { zone (upper), sep, num, width } or null if it does
  // not fit <letters><digits>. `width` preserves the written digit count so
  // generated "free" cells reproduce the zone's zero-padding (A-001, not A-1).
  static parseBin(code) {
    if (code == null) return null;
    const m = String(code).trim().match(BIN_RE);
    if (!m) return null;
    return { zone: m[1].toUpperCase(), sep: m[2], num: parseInt(m[3], 10), width: m[3].length };
  }

  // Roll up assigned-bin rows [{ bin, item_count }] into the zone chips +
  // headline counts. Malformed bins are excluded from zones and counted as
  // mismatches. `bins` = distinct occupied bins, `items` = stocked rows.
  static summariseZones(rows) {
    const zones = new Map();
    let mismatches = 0;
    let occupiedBins = 0;
    let items = 0;
    for (const r of rows) {
      const count = Number(r.item_count) || 0;
      const p = Bin.parseBin(r.bin);
      if (!p) { mismatches += count; continue; }
      let z = zones.get(p.zone);
      if (!z) { z = { zone: p.zone, bins: 0, items: 0 }; zones.set(p.zone, z); }
      z.bins  += 1;
      z.items += count;
      occupiedBins += 1;
      items += count;
    }
    const zoneList = [...zones.values()].sort((a, b) => a.zone.localeCompare(b.zone, 'en'));
    return { zones: zoneList, bins: occupiedBins, items, mismatches };
  }

  // Build the grid for one zone from ALL assigned-bin rows. Fills every integer
  // from the zone's min..max bin number; present numbers are 'occupied' (or
  // 'multi' when a bin holds >1 item), absent numbers are 'free'. Occupied cells
  // keep their real stored code so the detail panel queries the right bin; free
  // cells get a reconstructed code in the zone's observed format.
  static buildZoneCells(zoneName, rows) {
    const zone = String(zoneName || '').toUpperCase();
    const parsed = [];
    for (const r of rows) {
      const p = Bin.parseBin(r.bin);
      if (p && p.zone === zone) parsed.push({ ...p, raw: String(r.bin).trim(), count: Number(r.item_count) || 0 });
    }
    if (parsed.length === 0) return { zone, min: null, max: null, cells: [] };

    const sep   = parsed.find(p => p.sep)?.sep ?? '';
    const width = Math.max(...parsed.map(p => p.width));
    const countByNum = new Map();
    const rawByNum   = new Map();
    for (const p of parsed) {
      countByNum.set(p.num, (countByNum.get(p.num) || 0) + p.count);
      if (!rawByNum.has(p.num)) rawByNum.set(p.num, p.raw);
    }
    const nums = parsed.map(p => p.num);
    const min = Math.min(...nums);
    const max = Math.max(...nums);

    const cells = [];
    for (let n = min; n <= max; n++) {
      const count = countByNum.get(n) || 0;
      const bin = rawByNum.get(n) || `${zone}${sep}${String(n).padStart(width, '0')}`;
      cells.push({ bin, count, kind: count === 0 ? 'free' : (count > 1 ? 'multi' : 'occupied') });
    }
    return { zone, min, max, cells };
  }

  // ── READ ────────────────────────────────────────────────────────────────────

  // Every assigned bin with how many stocked rows (products + variants) sit in
  // it. One row per distinct bin code.
  static async assignedBins() {
    const { rows } = await db.query(
      `SELECT bin, COUNT(*)::int AS item_count
         FROM (
           SELECT bin FROM products         WHERE bin IS NOT NULL AND bin <> ''
           UNION ALL
           SELECT bin FROM product_variants WHERE bin IS NOT NULL AND bin <> ''
         ) t
        GROUP BY bin`
    );
    return rows;
  }

  // Count of ACTIVE items with no bin yet (the "Queue" badge). Single-SKU
  // products queue on product.bin; variant products queue per unbinned variant
  // (their parent product carries no bin), so a variant product never shows a
  // product-level queue row.
  static async queueCount() {
    const { rows } = await db.query(
      `SELECT (
         (SELECT COUNT(*) FROM products p
            WHERE (p.bin IS NULL OR p.bin = '') AND p.active = TRUE
              AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id))
         +
         (SELECT COUNT(*) FROM product_variants v JOIN products p ON p.id = v.product_id
            WHERE (v.bin IS NULL OR v.bin = '') AND v.active = TRUE AND p.active = TRUE)
       )::int AS queue`
    );
    return rows[0].queue;
  }

  // The whole board: zone chips + headline summary.
  static async board() {
    const [assigned, queue] = await Promise.all([Bin.assignedBins(), Bin.queueCount()]);
    const { zones, bins, items, mismatches } = Bin.summariseZones(assigned);
    return { zones, summary: { bins, items, queue, mismatches } };
  }

  // The grid for one zone.
  static async zone(zoneName) {
    const assigned = await Bin.assignedBins();
    return Bin.buildZoneCells(zoneName, assigned);
  }

  // The products/variants stored in one exact bin (the detail panel).
  static async itemsInBin(bin) {
    const { rows } = await db.query(
      `SELECT p.id AS product_id, NULL::text AS variant_id, p.name,
              p.sku, p.barcode, p.bin
         FROM products p
        WHERE p.bin = $1
       UNION ALL
       SELECT v.product_id, v.id AS variant_id, p.name,
              COALESCE(v.sku, p.sku) AS sku, p.barcode, v.bin
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.bin = $1
        ORDER BY name`,
      [String(bin)]
    );
    return rows.map(Bin._itemShape);
  }

  // Active items with no bin (the Queue list).
  static async queue() {
    const { rows } = await db.query(
      `SELECT p.id AS product_id, NULL::text AS variant_id, p.name,
              p.sku, p.barcode, p.bin
         FROM products p
        WHERE (p.bin IS NULL OR p.bin = '') AND p.active = TRUE
          AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id)
       UNION ALL
       SELECT v.product_id, v.id AS variant_id, p.name,
              COALESCE(v.sku, p.sku) AS sku, p.barcode, v.bin
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE (v.bin IS NULL OR v.bin = '') AND v.active = TRUE AND p.active = TRUE
        ORDER BY name`
    );
    return rows.map(Bin._itemShape);
  }

  // Items whose assigned bin does not fit the convention (the Mismatches list).
  static async mismatches() {
    const { rows } = await db.query(
      `SELECT p.id AS product_id, NULL::text AS variant_id, p.name,
              p.sku, p.barcode, p.bin
         FROM products p
        WHERE p.bin IS NOT NULL AND p.bin <> '' AND p.bin !~ $1
       UNION ALL
       SELECT v.product_id, v.id AS variant_id, p.name,
              COALESCE(v.sku, p.sku) AS sku, p.barcode, v.bin
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.bin IS NOT NULL AND v.bin <> '' AND v.bin !~ $1
        ORDER BY name`,
      [BIN_SQL_RE]
    );
    return rows.map(Bin._itemShape);
  }

  // Free-text search across name / sku / barcode / bin for the search box.
  static async search(q, { limit = 25 } = {}) {
    const term = `%${String(q || '').trim()}%`;
    const { rows } = await db.query(
      `SELECT * FROM (
         SELECT p.id AS product_id, NULL::text AS variant_id, p.name,
                p.sku, p.barcode, p.bin
           FROM products p
          WHERE p.name ILIKE $1 OR p.sku ILIKE $1 OR p.barcode ILIKE $1 OR p.bin ILIKE $1
         UNION ALL
         SELECT v.product_id, v.id AS variant_id, p.name,
                COALESCE(v.sku, p.sku) AS sku, p.barcode, v.bin
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
          WHERE v.sku ILIKE $1 OR v.bin ILIKE $1 OR p.name ILIKE $1
       ) hits
       ORDER BY name
       LIMIT $2`,
      [term, Number(limit)]
    );
    return rows.map(Bin._itemShape);
  }

  // ── WRITE ─────────────────────────────────────────────────────────────────

  // Relocate a single product or variant to a new bin. `bin` empty/null clears
  // the assignment. Returns the updated item, or null if the row doesn't exist.
  static async move({ productId, variantId = null, bin }) {
    const value = bin == null || String(bin).trim() === '' ? null : String(bin).trim();
    if (variantId) {
      const { rows } = await db.query(
        `UPDATE product_variants v SET bin = $1
           FROM products p
          WHERE v.id = $2 AND p.id = v.product_id
        RETURNING v.product_id, v.id AS variant_id, p.name,
                  COALESCE(v.sku, p.sku) AS sku, p.barcode, v.bin`,
        [value, String(variantId)]
      );
      return rows[0] ? Bin._itemShape(rows[0]) : null;
    }
    const { rows } = await db.query(
      `UPDATE products SET bin = $1
        WHERE id = $2
      RETURNING id AS product_id, NULL::text AS variant_id, name, sku, barcode, bin`,
      [value, String(productId)]
    );
    return rows[0] ? Bin._itemShape(rows[0]) : null;
  }

  // Normalise a DB row into the camelCase shape the BIN System surfaces consume.
  static _itemShape(r) {
    return {
      productId: r.product_id,
      variantId: r.variant_id || null,
      name:      r.name,
      sku:       r.sku || null,
      barcode:   r.barcode || null,
      bin:       r.bin || null,
    };
  }
}

module.exports = Bin;
