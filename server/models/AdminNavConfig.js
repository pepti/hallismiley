// Per-admin sidebar layout, stored as a JSONB blob on the user row.
// null when the admin has never customized it (the frontend then uses the
// code-defined default ADMIN_NAV).
const db = require('../config/database');

class AdminNavConfig {
  static async getNavConfig(userId) {
    const { rows } = await db.query(
      `SELECT admin_nav_config FROM users WHERE id = $1`,
      [String(userId)]
    );
    return rows[0] ? rows[0].admin_nav_config : null;
  }

  // Persist the layout, or — with config === null — clear it ("reset to default").
  // Returns the stored value (object | null).
  static async setNavConfig(userId, config) {
    const { rows } = await db.query(
      `UPDATE users SET admin_nav_config = $2 WHERE id = $1
       RETURNING admin_nav_config`,
      [String(userId), config === null ? null : JSON.stringify(config)]
    );
    return rows[0] ? rows[0].admin_nav_config : null;
  }
}

module.exports = AdminNavConfig;
