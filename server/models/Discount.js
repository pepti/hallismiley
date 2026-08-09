// Repository for discount codes (B2C subset — see migration 049).
// Parameterised queries throughout (A03). Code-based, order-level discounts only.
const db = require('../config/database');

const COLUMNS = 'id, code, title, method, type, value_type, value, currency, min_subtotal, usage_limit, used_count, enabled, starts_at, ends_at, created_at, updated_at';

class Discount {
  static async findAll() {
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM discounts ORDER BY created_at DESC`);
    return rows;
  }

  static async findById(id) {
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM discounts WHERE id = $1`, [String(id)]);
    return rows[0] || null;
  }

  // Case-insensitive code lookup (the unique index is on LOWER(code)).
  static async findByCodeCI(code) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM discounts WHERE LOWER(code) = LOWER($1)`,
      [String(code)]
    );
    return rows[0] || null;
  }

  // Live automatic (no-code) discounts for a currency — the engine computes the
  // benefit of each and picks the best. Pre-filtered on enabled/window/limit.
  static async findLiveAutomatic({ currency }) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM discounts
        WHERE method = 'automatic' AND enabled = TRUE AND currency = $1
          AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())
          AND (usage_limit IS NULL OR used_count < usage_limit)
        ORDER BY created_at DESC`,
      [String(currency)]
    );
    return rows;
  }

  static async create(data) {
    const {
      code, title, method = 'code', type = 'order', value_type, value, currency = 'ISK',
      min_subtotal = null, usage_limit = null, enabled = true,
      starts_at = null, ends_at = null,
    } = data;
    const { rows } = await db.query(
      `INSERT INTO discounts (code, title, method, type, value_type, value, currency, min_subtotal, usage_limit, enabled, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW()), $12)
       RETURNING ${COLUMNS}`,
      [
        String(code), String(title || code), method, type, value_type, Number(value), currency,
        min_subtotal == null || min_subtotal === '' ? null : Number(min_subtotal),
        usage_limit == null || usage_limit === '' ? null : Number(usage_limit),
        Boolean(enabled), starts_at || null, ends_at || null,
      ]
    );
    return rows[0];
  }

  static async update(id, data) {
    const allowed = ['code', 'title', 'method', 'type', 'value_type', 'value', 'currency', 'min_subtotal', 'usage_limit', 'enabled', 'starts_at', 'ends_at'];
    const numeric = new Set(['value', 'min_subtotal', 'usage_limit']);
    const bool    = new Set(['enabled']);
    const nullableDate = new Set(['starts_at', 'ends_at']);
    const sets = [];
    const params = [];
    for (const f of allowed) {
      if (data[f] === undefined) continue;
      let v = data[f];
      if (numeric.has(f)) v = (v === null || v === '') ? null : Number(v);
      if (bool.has(f))    v = Boolean(v);
      if (nullableDate.has(f) && v === '') v = null;
      params.push(v);
      sets.push(`${f} = $${params.length}`);
    }
    if (sets.length === 0) return Discount.findById(id);
    params.push(String(id));
    const { rows } = await db.query(
      `UPDATE discounts SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params
    );
    return rows[0] || null;
  }

  // Atomic increment guarded by usage_limit — returns the new count, or null if
  // the limit was already reached (so callers can fail the redemption safely).
  static async incrementUsed(id) {
    const { rows } = await db.query(
      `UPDATE discounts SET used_count = used_count + 1
        WHERE id = $1 AND (usage_limit IS NULL OR used_count < usage_limit)
        RETURNING used_count`,
      [String(id)]
    );
    return rows[0]?.used_count ?? null;
  }
}

module.exports = Discount;
