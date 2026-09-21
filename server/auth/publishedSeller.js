'use strict';
// Is this user a seller on the PUBLIC instance? (D-020 seller area.)
//
// Ops decides: a public user is a seller when the latest published snapshot
// lists their email — there is no grant on the public box to forget to revoke.
// Two conditions make the email match safe to trust:
//   • the account's email is PROVEN — verified through the signup link, or the
//     account was created by an admin invite (invited_at; the invitee sets a
//     password through a link sent to that mailbox). A stranger who signs up
//     with a seller's address first never verifies it, so never matches.
//   • the account is not disabled.
// On an ops instance this always answers null: sellers there use the admin shell.
const { isPublicInstance } = require('../config/instanceRole');

async function findPublishedSeller(dbQuery, userId) {
  if (!isPublicInstance() || !userId) return null;
  const { rows } = await dbQuery(
    `SELECT ps.email, ps.display_name, ps.can_leads, ps.can_accounts, ps.can_commission
       FROM users u
       JOIN published_sellers ps ON ps.email = lower(u.email)
      WHERE u.id = $1
        AND u.disabled = FALSE
        AND (u.email_verified = TRUE OR u.invited_at IS NOT NULL)`,
    [userId]
  );
  return rows[0] || null;
}

async function isPublishedSeller(dbQuery, userId) {
  return !!(await findPublishedSeller(dbQuery, userId));
}

module.exports = { findPublishedSeller, isPublishedSeller };
