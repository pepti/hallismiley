'use strict';
// Is this user an admin ANYWHERE in the role system?
//
// Migration 061 made user_roles the source of truth for the role SET, with
// users.role kept as a denormalized "primary" role — and "admin in the set ⇒
// all views". The 2FA gate and the OAuth-admin refusal, both added later,
// tested only users.role: an account whose primary role is 'user' but whose
// role SET contains 'admin' held every admin permission while walking past
// both protections. Flagged in the 2026-08-19 base-sync deferred queue;
// closed by the 2026-08-22 harvest.
//
// Every security gate that asks "is this an admin?" must ask this helper, so
// the two columns can never diverge on the answer again.
async function userIsAdminAnywhere(dbQuery, userId) {
  const { rows } = await dbQuery(
    `SELECT 1 FROM users WHERE id = $1 AND role = 'admin'
      UNION ALL
     SELECT 1 FROM user_roles WHERE user_id = $1 AND role_name = 'admin'
     LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

module.exports = { userIsAdminAnywhere };
