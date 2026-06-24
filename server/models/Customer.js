// Customer = a shop-facing view of the `users` table (people who can place
// orders), with order aggregates. B2C-shaped: no companies, no kennitala, no
// multi-store. Admin-created customers are passwordless (password_hash NULL,
// like OAuth users) with role hardwired to 'user'; a password-reset token powers
// the "set your password" invite, reusing the existing reset flow.
const crypto = require('crypto');
const { query: dbQuery } = require('../config/database');

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days to accept an invite

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

// A unique username derived from the email local-part, with a numeric suffix on
// collision (the users table has a UNIQUE username constraint).
async function deriveUsername(email) {
  const base = String(email).split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'customer';
  let candidate = base;
  for (let i = 0; i < 50; i += 1) {
    const { rows } = await dbQuery('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [candidate]);
    if (!rows.length) return candidate;
    candidate = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
  }
  return `${base}-${makeToken().slice(0, 8)}`;
}

const Customer = {
  // Customers (users) + order aggregates. Optional case-insensitive search across
  // email / name / username.
  async list({ q = '', limit = 200, offset = 0 } = {}) {
    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE u.email ILIKE $1 OR u.display_name ILIKE $1 OR u.username ILIKE $1`;
    }
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const off = Math.max(Number(offset) || 0, 0);
    params.push(lim, off);
    const { rows } = await dbQuery(
      `SELECT u.id, u.email, u.username, u.display_name, u.phone, u.role,
              u.email_verified, u.disabled, u.created_at,
              COALESCE(o.cnt, 0)::int    AS order_count,
              COALESCE(o.spent, 0)::bigint AS total_spent
         FROM users u
         LEFT JOIN (
           SELECT user_id, COUNT(*) AS cnt, SUM(total) AS spent
             FROM orders
            WHERE user_id IS NOT NULL AND payment_status = 'paid'
            GROUP BY user_id
         ) o ON o.user_id = u.id
         ${where}
        ORDER BY u.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows: cnt } = await dbQuery('SELECT COUNT(*)::int AS total FROM users');
    return { customers: rows, total: cnt[0].total };
  },

  // Lowercased emails that already exist (for import classification + dup checks).
  async findExistingEmails(emails) {
    const list = [...new Set((emails || []).map(e => String(e).toLowerCase().trim()).filter(Boolean))];
    if (!list.length) return new Set();
    const { rows } = await dbQuery(
      'SELECT LOWER(email) AS email FROM users WHERE LOWER(email) = ANY($1::text[])',
      [list]
    );
    return new Set(rows.map(r => r.email));
  },

  // Create one passwordless customer. Returns { user, resetToken }.
  async create({ email, display_name = null, phone = null }) {
    const lowered    = String(email).toLowerCase().trim();
    const username   = await deriveUsername(lowered);
    const resetToken = makeToken();
    const expires    = new Date(Date.now() + INVITE_TTL_MS);
    const { rows } = await dbQuery(
      `INSERT INTO users
         (username, email, password_hash, role, display_name, phone,
          email_verified, password_reset_token, password_reset_expires)
       VALUES ($1, $2, NULL, 'user', $3, $4, FALSE, $5, $6)
       RETURNING id, username, email, role, display_name, phone, email_verified, created_at`,
      [username, lowered, display_name, phone, resetToken, expires]
    );
    return { user: rows[0], resetToken };
  },

  // Bulk-create only NEW customers (passwordless, role 'user'); existing emails
  // are skipped via ON CONFLICT. No invite email on bulk. Returns created count.
  async bulkCreate(rows) {
    let created = 0;
    for (const r of rows) {
      const lowered  = String(r.email).toLowerCase().trim();
      if (!lowered) continue;
      const username = await deriveUsername(lowered);
      const { rowCount } = await dbQuery(
        `INSERT INTO users
           (username, email, password_hash, role, display_name, phone, email_verified)
         VALUES ($1, $2, NULL, 'user', $3, $4, FALSE)
         ON CONFLICT (email) DO NOTHING`,
        [username, lowered, r.display_name || null, r.phone || null]
      );
      created += rowCount;
    }
    return created;
  },
};

module.exports = Customer;
