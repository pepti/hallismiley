// Customer = a shop-facing view of the `users` table (people who can place
// orders), with order aggregates. B2C-shaped: no companies, no kennitala, no
// multi-store. Admin-created customers are passwordless (password_hash NULL,
// like OAuth users) with role hardwired to 'user'; a password-reset token powers
// the "set your password" invite, reusing the existing reset flow.
const crypto = require('crypto');
const { query: dbQuery, pool } = require('../config/database');
const { lucia } = require('../auth/lucia');
const UserRole = require('./UserRole');
const { Scrypt } = require('oslo/password');
// Name-only logins (harvested from icelandicstore #397, 2026-09-24): a person
// with no email gets a reserved <username>@noemail.invalid address, a generated
// username and a one-time password. The list and its search read such an
// address as NULL — it is never shown or matched as an address.
const { uniqueUsername } = require('../utils/username');
const { NO_EMAIL_DOMAIN, noEmailEmail, realEmailExpr } = require('../utils/placeholderEmail');
const { generatePassword } = require('../utils/generatePassword');
const U_EMAIL = realEmailExpr('u.email');

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days to accept an invite

// A party guest is a role='user' account that came through the party flow — it
// shares the users table with shop customers and shows up in this admin list,
// but its RSVP/guestbook/photo rows cascade on delete and are critical. These
// canonical party-flow markers (matching migration 062) identify such accounts
// so the shop Customers tools never delete them. `p` is the table alias ('' for
// unqualified). isPartyGuest → boolean expression; notPartyGuest → its negation.
const isPartyGuest = (p = '') => {
  const c = p ? `${p}.` : '';
  return `(${c}party_access = TRUE OR ${c}requested_at IS NOT NULL OR ${c}magic_login_token_hash IS NOT NULL)`;
};
const notPartyGuest = (p = '') => `NOT ${isPartyGuest(p)}`;

// A plain customer the Customers screen may read one-by-one and edit: the
// deleteCustomers guards (role 'user', no extra role grant, not a party
// guest). `p` is the table alias.
const EDITABLE = (p) => `${p}.role = 'user'
  AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = ${p}.id AND ur.role_name <> 'user')
  AND ${notPartyGuest(p)}`;

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
      where = `WHERE ${U_EMAIL} ILIKE $1 OR u.display_name ILIKE $1 OR u.username ILIKE $1`;
    }
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const off = Math.max(Number(offset) || 0, 0);
    params.push(lim, off);
    const { rows } = await dbQuery(
      `SELECT u.id, ${U_EMAIL} AS email, u.username, u.display_name, u.phone, u.role,
              u.email_verified, u.disabled, u.created_at, u.invited_at,
              ${isPartyGuest('u')} AS is_party_guest,
              (${EDITABLE('u')}) AS editable,
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
  //
  // nameOnly (admin-only callers, ice #397): the person has no email at all. The
  // row gets a reserved `<username>@noemail.invalid` address (users.email stays
  // NOT NULL, no migration), a username derived from the name (Icelandic
  // letters transliterated), a generated password hashed with the same oslo
  // Scrypt as the rest of auth, approval at once, and NO reset token: there is
  // nowhere to mail one. Returns { user, resetToken: null, password } — the
  // caller hands `password` to the admin ONCE and must never log or store it.
  //
  // expiresAt (migration 114): a time-limited login — a Date the caller has
  // validated (auth/accountExpiry.js parseExpiresAt), or null for never.
  async create({ email, display_name = null, phone = null, nameOnly = false, expiresAt = null }) {
    if (nameOnly) {
      const password = generatePassword();
      const hash     = await new Scrypt().hash(password);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const username = await uniqueUsername(display_name, null, { emailDomain: NO_EMAIL_DOMAIN });
        try {
          const { rows } = await dbQuery(
            `INSERT INTO users
               (username, email, password_hash, role, display_name, phone,
                approval_status, email_verified, expires_at)
             VALUES ($1, $2, $3, 'user', $4, $5, 'approved', FALSE, $6)
             RETURNING id, username, email, role, display_name, phone, email_verified, created_at, expires_at`,
            [username, noEmailEmail(username), hash, display_name, phone, expiresAt]
          );
          return { user: rows[0], resetToken: null, password };
        } catch (err) {
          if (err && err.code === '23505') continue; // lost the username/address race — re-derive
          throw err;
        }
      }
      throw new Error('Could not allocate a unique username');
    }
    const lowered    = String(email).toLowerCase().trim();
    const resetToken = makeToken();
    const expires    = new Date(Date.now() + INVITE_TTL_MS);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const username = await deriveUsername(lowered);
      try {
        const { rows } = await dbQuery(
          `INSERT INTO users
             (username, email, password_hash, role, display_name, phone,
              email_verified, password_reset_token, password_reset_expires, expires_at)
           VALUES ($1, $2, NULL, 'user', $3, $4, FALSE, $5, $6, $7)
           RETURNING id, username, email, role, display_name, phone, email_verified, created_at, expires_at`,
          [username, lowered, display_name, phone, resetToken, expires, expiresAt]
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

  // ── One customer (harvest 2 lane 3, ported from icelandicstore #336) ───────
  //
  // Only a PLAIN customer can be read or edited here: role='user', no extra
  // user_roles grant (the trigger mirrors the primary role, so a plain
  // customer holds exactly 'user'), and not a party guest. These are the same
  // guards deleteCustomers uses. The screen is gated on the `customers` view,
  // which a non-admin role can hold — without this, a seller with that view
  // could change a STAFF account's email and take it over through
  // forgot-password. A staff/unknown id simply is not found (404, never 403,
  // so the answer does not say the id exists).
  //
  // The contact + address of one editable customer, or null.
  async findEditable(id) {
    const { rows } = await dbQuery(
      `SELECT u.id, ${U_EMAIL} AS email, u.username, u.display_name, u.phone,
              u.address1, u.address2, u.city, u.zip, u.country,
              u.disabled, u.email_verified, u.invited_at, u.created_at,
              (u.password_hash IS NOT NULL) AS has_password
         FROM users u
        WHERE u.id = $1 AND ${EDITABLE('u')}`,
      [String(id)]
    );
    return rows[0] || null;
  },

  // Write the contact + address fields of one editable customer. The allow-list
  // is the ceiling; the caller decides which keys it sends (an omitted key is
  // left alone) and shapes a blank as null. Returns the updated row, or null
  // when the id is not an editable customer. A duplicate email surfaces as the
  // UNIQUE violation (23505) for the caller to map.
  async updateContact(id, fields = {}) {
    const ALLOWED = ['email', 'display_name', 'phone', 'address1', 'address2', 'city', 'zip', 'country'];
    const keys = ALLOWED.filter(k => k in fields);
    if (!keys.length) return Customer.findEditable(id);
    const set = keys.map((k, i) => `${k} = $${i + 2}`);
    // A NEW address inherits nothing from the old mailbox, in the same
    // statement (so it can never be half-applied): not its verification, not
    // a set-password/reset link still in flight, and not `invited_at` — the
    // seller area (auth/publishedSeller.js) reads invited_at as proof the
    // address is real, so keeping it would vouch for an address nobody
    // checked (lane 3 review, H1). The right-hand `email` is the OLD value.
    if (keys.includes('email')) {
      const p = `$${keys.indexOf('email') + 2}`;
      for (const col of ['password_reset_token', 'password_reset_expires', 'invited_at']) {
        set.push(`${col} = CASE WHEN email IS DISTINCT FROM ${p} THEN NULL ELSE ${col} END`);
      }
      set.push(`email_verified = CASE WHEN email IS DISTINCT FROM ${p} THEN FALSE ELSE email_verified END`);
    }
    const { rows } = await dbQuery(
      `UPDATE users u SET ${set.join(', ')}
        WHERE u.id = $1 AND ${EDITABLE('u')}
        RETURNING u.id, ${U_EMAIL} AS email, u.username, u.display_name, u.phone,
                  u.address1, u.address2, u.city, u.zip, u.country`,
      [String(id), ...keys.map(k => fields[k])]
    );
    return rows[0] || null;
  },

  // Mint a fresh set-password token for one editable, passwordless customer
  // (the per-customer "send invite"). Returns the token, or null when the row
  // is no longer an editable passwordless customer.
  async mintInviteToken(id) {
    const token   = makeToken();
    const expires = new Date(Date.now() + INVITE_TTL_MS);
    const { rowCount } = await dbQuery(
      `UPDATE users u SET password_reset_token = $2, password_reset_expires = $3
        WHERE u.id = $1 AND u.password_hash IS NULL AND ${EDITABLE('u')}`,
      [String(id), token, expires]
    );
    return rowCount ? token : null;
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
    let deletedAccounts;
    try {
      await client.query('BEGIN');
      // Guards here MUST match the DELETE below exactly — an account we snapshot
      // but then decline to delete would be left alive carrying a guest identity
      // on all its past orders (which the delivery note and order emails print).
      await client.query(
        `UPDATE orders o
            SET guest_email = COALESCE(o.guest_email, u.email),
                guest_name  = COALESCE(o.guest_name, u.display_name)
           FROM users u
          WHERE o.user_id = u.id AND u.id = ANY($1) AND u.role = 'user'
            AND NOT EXISTS (SELECT 1 FROM user_roles ur
                             WHERE ur.user_id = u.id AND ur.role_name <> 'user')
            AND ${notPartyGuest('u')}`,
        [ids]
      );
      // Guards, all AND-ed so a match must clear every one:
      //  • role='user' — never a staff/admin account.
      //  • no EXTRA user_roles grant — a DB trigger mirrors every user's PRIMARY
      //    role into user_roles, so plain customers hold exactly the 'user'
      //    membership; any role_name <> 'user' marks a staff-ish account to skip.
      //  • NOT a party guest — party guests are also role='user' and appear in
      //    this list, but their data (RSVP/guestbook/photos) is critical and
      //    cascades on user delete, so the shop Customers bulk tool must NEVER
      //    touch them (manage them from the party admin instead).
      const { rows } = await client.query(
        `DELETE FROM users
          WHERE id = ANY($1) AND role = 'user'
            AND NOT EXISTS (SELECT 1 FROM user_roles ur
                             WHERE ur.user_id = users.id AND ur.role_name <> 'user')
            AND ${notPartyGuest('users')}
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
