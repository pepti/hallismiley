// May this user still act through an MCP token? (R5a, 2026-09-24.)
//
// A token outlives the moment it was minted: an admin demoted in Admin →
// Roles, or disabled, used to keep a working connector until the token's
// expiry (the v1 check was "the token row is live", nothing about its owner).
// Now every MCP call and every OAuth token exchange re-resolves the owner the
// way a session request would — the role SET (models/UserRole), then the
// two-factor policy (auth/mfaPolicy.js applyMfaPolicy, which withholds `admin`
// from an unenrolled admin on an instance set to `required`) — and requires
// `admin`, the role that mints tokens and approves connections.
const db = require('../config/database');
const UserRole = require('../models/UserRole');
const { applyMfaPolicy } = require('../auth/mfaPolicy');
const { hasRole } = require('../auth/roles');
const logger = require('../logger');

async function ownerMayUseMcp(userId) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [String(userId)]);
  const user = rows[0];
  if (!user || user.disabled) return false;
  let roles;
  try {
    roles = await UserRole.listForUser(user.id);
  } catch (err) {
    logger.warn({ err: err.message, userId: user.id }, 'mcp owner role lookup failed; using users.role');
    roles = [];
  }
  applyMfaPolicy(user, roles.length ? roles : [user.role]);
  return hasRole(user, 'admin');
}

module.exports = { ownerMayUseMcp };
