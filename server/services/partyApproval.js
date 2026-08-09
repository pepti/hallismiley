// Shared approval logic for party guests, used by three entry points:
//   - the one-click email approval link        (partyController.actOnApproval)
//   - the admin Users / party-admin panel       (adminController.approveUser)
//   - owner-initiated direct invites            (partyController.ownerInvite)
// plus grantInstantAccess for the auto-grant path in partyController.requestAccess.
//
// approveGuest/grantInstantAccess flip the account to approved + party_access and
// (re)issue a fresh non-expiring magic-login token, returning the PLAINTEXT token
// so the caller can email it. The token is only ever stored hashed (see
// auth/tokens.hashToken); callers must never log or persist the plaintext beyond
// the outbound email.
const { query: dbQuery } = require('../config/database');
const { makeToken, hashToken } = require('../auth/tokens');
const logger = require('../logger');
const emailService = require('./emailService');
const { readPartyInfo } = require('./partyInfo');

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

/**
 * Auto-grant path for requestAccess: like approveGuest, but SETS the one-click
 * approval-action token instead of clearing it — access is granted immediately,
 * yet the owner's emailed one-click link must still work afterwards (it now
 * sends the party-info email rather than gating access). Also fills in the
 * display name the requester typed when the account has none.
 *
 * @returns {Promise<{user: object, magicToken: string}|null>} null if no such user.
 */
async function grantInstantAccess(userId, { name = null, actionTokenHash, actionExpires } = {}) {
  const magicToken = makeToken();
  const { rows } = await dbQuery(
    `UPDATE users
        SET approval_status              = 'approved',
            party_access                 = TRUE,
            approved_at                  = NOW(),
            requested_at                 = NOW(),
            display_name                 = COALESCE(NULLIF(display_name, ''), $2),
            magic_login_token_hash       = $3,
            magic_login_token_created_at = NOW(),
            approval_action_token_hash   = $4,
            approval_action_expires      = $5
      WHERE id = $1
      RETURNING id, email, username, display_name, role, party_access,
                approval_status, preferred_locale`,
    [userId, name, hashToken(magicToken), actionTokenHash, actionExpires]
  );
  const user = rows[0];
  if (!user) return null;
  return { user, magicToken };
}

/**
 * Owner-triggered "send the party info" action — shared by the one-click email
 * link (partyController.actOnApproval) and the admin panel
 * (adminController.approveUser).
 *
 * For the manual-review path (declined/revoked guests who re-requested and are
 * still 'pending'), this first re-grants access via approveGuest and emails the
 * fresh magic link. Then it renders the welcome email from the LIVE party info
 * (schedule/venue/activities as currently edited on the party page) in the
 * guest's locale, sends it, and stamps welcome_email_sent_at — clearing the
 * one-click action token so the emailed link keeps its single-use semantics.
 * Repeat calls simply re-send and re-stamp.
 *
 * @returns {Promise<object|null>} the updated user row, or null if no such user.
 */
async function sendWelcome(userId, { sentBy = null } = {}) {
  const { rows } = await dbQuery(
    `SELECT id, email, username, display_name, party_access, approval_status,
            preferred_locale
       FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  let user = rows[0];
  if (!user) return null;

  // Manual path: the guest doesn't have access yet (declined/revoked
  // re-request) — approve first, which rotates the magic token, and send the
  // invite so they can actually get in.
  if (!user.party_access || user.approval_status !== 'approved') {
    const result = await approveGuest(userId, { approvedBy: sentBy });
    if (!result) return null;
    user = { ...user, ...result.user };
    emailService.sendPartyInviteEmail({
      to:     result.user.email,
      name:   result.user.display_name,
      token:  result.magicToken,
      locale: result.user.preferred_locale || 'is',
    }).catch(err => logger.error({ err }, 'party invite email failed (sendWelcome re-grant)'));
  }

  const locale = user.preferred_locale || 'is';
  const partyInfo = await readPartyInfo(locale);
  // Awaited so the sent-stamp below only lands after the send didn't throw.
  // (With Resend unconfigured the send no-ops and we still stamp — fine for
  // dev/test.)
  await emailService.sendPartyWelcomeEmail({ user, partyInfo, locale });

  const { rows: updated } = await dbQuery(
    `UPDATE users
        SET welcome_email_sent_at      = NOW(),
            welcome_email_sent_by      = $2,
            approval_status            = 'approved',
            approved_at                = COALESCE(approved_at, NOW()),
            approval_action_token_hash = NULL,
            approval_action_expires    = NULL
      WHERE id = $1
      RETURNING id, email, username, display_name, role, party_access,
                approval_status, preferred_locale, welcome_email_sent_at`,
    [userId, sentBy]
  );
  return updated[0] ?? null;
}

module.exports = { approveGuest, declineGuest, grantInstantAccess, sendWelcome };

