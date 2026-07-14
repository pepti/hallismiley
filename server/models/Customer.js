// Customer = a shop-facing view of the `users` table (people who can place
// orders), with order aggregates. B2C-shaped: no companies, no kennitala, no
// multi-store. Admin-created customers are passwordless (password_hash NULL,
// like OAuth users) with role hardwired to 'user'; a password-reset token powers
// the "set your password" invite, reusing the existing reset flow.
const crypto = require('crypto');
const { query: dbQuery, pool } = require('../config/database');
const { lucia } = require('../auth/lucia');
const UserRole = require('./UserRole');

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days to accept an invite

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

// A username UNIQUE violation (as opposed to an email one) — lets create/bulkCreate
// retry username derivation on a race without misreporting it as an email conflict.
function isUsernameConflict(err) {
  return !!err && err.code === '23505' && /username/i.test(err.constraint || '');
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
  // deriveUsername does a SELECT-then-INSERT, so a concurrent signup/import that
  // derives the same base can win the username UNIQUE race — re-derive and retry
  // on that specific conflict (an email conflict is pre-checked by the caller and
  // bubbles up unchanged).
  async create({ email, display_name = null, phone = null }) {
    const lowered    = String(email).toLowerCase().trim();
    const resetToken = makeToken();
    const expires    = new Date(Date.now() + INVITE_TTL_MS);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const username = await deriveUsername(lowered);
      try {
        const { rows } = await dbQuery(
          `INSERT INTO users
             (username, email, password_hash, role, display_name, phone,
              email_verified, password_reset_token, password_reset_expires)
           VALUES ($1, $2, NULL, 'user', $3, $4, FALSE, $5, $6)
           RETURNING id, username, email, role, display_name, phone, email_verified, created_at`,
          [username, lowered, display_name, phone, resetToken, expires]
        );
        return { user: rows[0], resetToken };
      } catch (err) {
        if (isUsernameConflict(err)) continue; // lost the username race — re-derive
        throw err;                             // email conflict / anything else bubbles
      }
    }
    throw new Error('Could not allocate a unique username');
  },

  // Bulk-create only NEW customers (passwordless, role 'user'); existing emails
  // are skipped via ON CONFLICT. No invite email on bulk. Returns created count.
  async bulkCreate(rows) {
    let created = 0;
    for (const r of rows) {
      const lowered = String(r.email).toLowerCase().trim();
      if (!lowered) continue;
      // Retry the row on a username race so one clash never aborts the batch;
      // email dups are silently skipped by ON CONFLICT.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const username = await deriveUsername(lowered);
        try {
          const { rowCount } = await dbQuery(
            `INSERT INTO users
               (username, email, password_hash, role, display_name, phone, email_verified)
             VALUES ($1, $2, NULL, 'user', $3, $4, FALSE)
             ON CONFLICT (email) DO NOTHING`,
            [username, lowered, r.display_name || null, r.phone || null]
          );
          created += rowCount;
          break;
        } catch (err) {
          if (isUsernameConflict(err)) continue;
          throw err;
        }
      }
    }
    return created;
  },

  // Hard-delete customers from the admin list, in one transaction. Hard-guarded
  // to role='user' AND no extra user_roles grants, so the customers page can
  // NEVER delete a staff/admin account (a forged/staff/unknown id simply isn't
  // in the RETURNING set — that's also how skipped ids are reported, by absence).
  // orders.user_id is ON DELETE SET NULL, so past orders are KEPT — but unlike
  // real guest orders they'd have no contact identity, so we snapshot the user's
  // email/name into guest_email/guest_name first. Sessions for every deleted user
  // are invalidated after commit (user_sessions rows already CASCADE). excludeId
  // defensively drops the acting admin from the set. Returns { deletedAccounts }.
  async deleteCustomers({ userIds = [], excludeId = null } = {}) {
    const exclude = excludeId == null ? '' : String(excludeId);
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(String).filter(Boolean))]
      .filter(id => id !== exclude);
    if (!ids.length) return { deletedAccounts: [] };

    const client = await pool.connect();
    let deletedAccounts = [];
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE orders o
            SET guest_email = COALESCE(o.guest_email, u.email),
                guest_name  = COALESCE(o.guest_name, u.display_name)
           FROM users u
          WHERE o.user_id = u.id AND u.id = ANY($1) AND u.role = 'user'`,
        [ids]
      );
      // Note: a DB trigger mirrors every user's PRIMARY role into user_roles, so
      // plain customers always hold exactly the 'user' membership — only an EXTRA
      // grant (any role_name <> 'user') marks a staff-ish account we must skip.
      const { rows } = await client.query(
        `DELETE FROM users
          WHERE id = ANY($1) AND role = 'user'
            AND NOT EXISTS (SELECT 1 FROM user_roles ur
                             WHERE ur.user_id = users.id AND ur.role_name <> 'user')
          RETURNING id`,
        [ids]
      );
      deletedAccounts = rows.map(r => r.id);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // CASCADE already removed user_sessions; invalidate is a safe no-op kept for
    // consistency with adminController.deleteUser, and the role cache must drop
    // the id so a recreated account can't read a stale entry.
    for (const id of deletedAccounts) {
      await lucia.invalidateUserSessions(id);
      UserRole.invalidateUser(id);
    }
    return { deletedAccounts };
  },
};

module.exports = Customer;
