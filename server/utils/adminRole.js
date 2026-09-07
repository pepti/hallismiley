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

// Does any role this user holds (primary OR set) grant `viewId` — or every
// view? Used to widen the 2FA gate (mfaService) to accounts holders: a seller
// who owns customer accounts can reach customer data and, via GitHub, deploy
// to those customers, so they face the same challenge as an admin
// (ENHANCEMENTS #17, plan §1a).
async function userHoldsView(dbQuery, userId, viewId) {
  const { rows } = await dbQuery(
    `SELECT 1
       FROM roles r
      WHERE (r.name = (SELECT role FROM users WHERE id = $1)
             OR r.name IN (SELECT role_name FROM user_roles WHERE user_id = $1))
        AND (r.view_access @> '["*"]'::jsonb OR r.view_access @> $2::jsonb)
      LIMIT 1`,
    [userId, JSON.stringify([viewId])]
  );
  return rows.length > 0;
}

module.exports = { userIsAdminAnywhere, userHoldsView };
