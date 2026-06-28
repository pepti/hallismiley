// Shared approval logic for party guests, used by three entry points:
//   - the one-click email approval link        (partyController.approveByToken)
//   - the admin Users / party-admin panel       (adminController.approveUser)
//   - owner-initiated direct invites            (partyController.ownerInvite)
//
// approveGuest flips the account to approved + party_access and (re)issues a fresh
// non-expiring magic-login token, returning the PLAINTEXT token so the caller can
// email it. The token is only ever stored hashed (see auth/tokens.hashToken);
// callers must never log or persist the plaintext beyond the outbound email.
const { query: dbQuery } = require('../config/database');
const { makeToken, hashToken } = require('../auth/tokens');

/**
 * Approve a guest: mark approved, grant party access, and (re)issue a fresh
 * magic-login token. Clears the single-use approval-action token so the one-click
 * email link can't be replayed. Re-approving rotates the magic credential.
 *
 * @returns {Promise<{user: object, magicToken: string}|null>} null if no such user.
 */
async function approveGuest(userId, { approvedBy = null } = {}) {
  const magicToken = makeToken();
  const { rows } = await dbQuery(
    `UPDATE users
        SET approval_status              = 'approved',
            party_access                 = TRUE,
            approved_at                  = NOW(),
            approved_by                  = $2,
            magic_login_token_hash       = $3,
            magic_login_token_created_at = NOW(),
            approval_action_token_hash   = NULL,
            approval_action_expires      = NULL
      WHERE id = $1
      RETURNING id, email, username, display_name, role, party_access,
                approval_status, preferred_locale`,
    [userId, approvedBy, hashToken(magicToken)]
  );
  const user = rows[0];
  if (!user) return null;
  return { user, magicToken };
}

/**
 * Decline a guest request: mark declined, revoke any party access, and clear both
 * the one-click approval token and any previously-issued magic-login token (so an
 * already-sent link stops working). Returns the updated row or null.
 */
async function declineGuest(userId, { approvedBy = null } = {}) {
  const { rows } = await dbQuery(
    `UPDATE users
        SET approval_status            = 'declined',
            party_access               = FALSE,
            approved_at                = NOW(),
            approved_by                = $2,
            magic_login_token_hash     = NULL,
            approval_action_token_hash = NULL,
            approval_action_expires    = NULL
      WHERE id = $1
      RETURNING id, email, username, display_name, role, party_access,
                approval_status, preferred_locale`,
    [userId, approvedBy]
  );
  return rows[0] ?? null;
}

module.exports = { approveGuest, declineGuest };
