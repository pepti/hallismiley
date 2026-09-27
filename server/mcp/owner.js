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
const { isExpired } = require('../auth/accountExpiry');
const logger = require('../logger');

async function ownerMayUseMcp(userId) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [String(userId)]);
  const user = rows[0];
  // A time-limited login that ran out (migration 114) loses its connector
  // with its sessions: the token outlives the login otherwise.
  if (!user || user.disabled || isExpired(user)) return false;
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

// Which admin views the token's owner holds on this instance (harvest 2 lane
// 5): a read tool that names a `view` (registry.js) is listed and callable only
// when this says yes — the same answer the admin home gives the owner in a
// browser (services/adminHome.js homeAccess): the role set's views, minus a
// switched-off module's, minus — for an all-views holder — the product's
// hidden admin views. So a product that hides its shop from the admin nav
// does not hand its orders to Claude either. Returns (view) → boolean.
async function ownerViewAccess(userId) {
  const Role = require('../models/Role');
  const { homeAccess } = require('../services/adminHome');
  const { disabledAdminViews } = require('../config/modules');
  const { identity } = require('../config/identity');
  const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [String(userId)]);
  if (!rows.length) return () => false;
  let roles;
  try {
    roles = await UserRole.listForUser(userId);
  } catch (err) {
    logger.warn({ err: err.message, userId }, 'mcp owner role lookup failed; using users.role');
    roles = [];
  }
  const views = await Role.getViewsForRoles(roles.length ? roles : [rows[0].role]);
  return homeAccess({
    views,
    disabled: disabledAdminViews(),
    hidden: (identity.surface && identity.surface.hiddenAdminViews) || [],
  }).can;
}

module.exports = { ownerMayUseMcp, ownerViewAccess };
