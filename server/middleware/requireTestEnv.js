const Setting = require('../models/Setting');

function notFound(res) {
  return res.status(404).json({ error: 'Not found', code: 404 });
}

// Which app-env the process is in. APP_ENV (if set) wins over NODE_ENV.
function resolvedEnv() {
  return process.env.APP_ENV || process.env.NODE_ENV || 'production';
}

// Only these two are "not the live site". Anything else — 'production', an
// unset value, or a stack somebody named 'staging' — is treated as live: the
// rest of the codebase (ssrMeta's TEST chrome, the MCP env tag) recognises
// only 'test' as the test stack, so a value the UI would never badge must not
// silently open a submit surface (review finding, 2026-09-02).
const OPEN_ENVS = new Set(['test', 'development']);

// The authoritative permission source is the role SET (req.user.roles, resolved
// by auth/middleware.js and middleware/softAuth.js); users.role is only the
// denormalized primary, and an admin granted through Admin → Roles never has
// it updated. Same fallback rule as auth/roles.js requireRole.
function holdsAdmin(user) {
  if (!user) return false;
  const held = Array.isArray(user.roles) ? user.roles : [user.role];
  return held.includes('admin');
}

// Gate for the change-request submit endpoint (ice #206). Two ways in:
//   • a test/development app-env — anyone can file requests, logged out
//     included, which is the whole point of a validation trial.
//   • the admin switch (Admin → Feedback) — lets the owner file requests
//     against the live site too, but ONLY as an admin. Customers must never
//     see or reach this, so a non-admin gets the same 404 as before.
// Must run AFTER softAuth so req.user (and its role set) is populated. 404
// rather than 403 keeps production silent about the route either way.
async function changeRequestGate(req, res, next) {
  try {
    if (OPEN_ENVS.has(resolvedEnv())) return next();
    if (!(await Setting.getChangeRequestsEnabled())) return notFound(res);
    if (!holdsAdmin(req.user)) return notFound(res);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { changeRequestGate, holdsAdmin, OPEN_ENVS };
