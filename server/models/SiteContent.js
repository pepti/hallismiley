// Repository for site_content — key/value store for admin-editable homepage text.
// All SQL is parameterised (A03: SQL injection prevention).
const db = require('../config/database');

class SiteContent {
  /** Returns all rows as a plain object { key: value, … } */
  static async getAll() {
    const { rows } = await db.query(
      'SELECT key, value FROM site_content ORDER BY key'
    );
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  /**
   * Upsert multiple key/value pairs in a single transaction.
   * @param {Record<string,string>} updates - plain { key: value } object
   * @param {string} updatedBy - user id of the editor
   */
  static async setMany(updates, updatedBy) {
    const entries = Object.entries(updates);
    if (entries.length === 0) return;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of entries) {
        await client.query(
          `INSERT INTO site_content (key, value, updated_at, updated_by)
           VALUES ($1, $2, NOW(), $3)
           ON CONFLICT (key) DO UPDATE
             SET value      = EXCLUDED.value,
                 updated_at = EXCLUDED.updated_at,
                 updated_by = EXCLUDED.updated_by`,
          [key, String(value), updatedBy]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = SiteContent;
