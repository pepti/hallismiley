// Gate for the change-request submit endpoint (ice #206). Admins only, always;
// two ways in for them:
//   • the test stack (config/appEnv.js isTestStack) — no switch needed.
//   • the admin switch (Admin → Feedback) — lets the owner file requests
//     against the live site too.
// Customers and logged-out visitors get the 404 on every stack. The test stack
// used to take anonymous requests (a validation trial); since 2026-09-22 the
// TEST chrome and the widget are admin-only in the client (Halli), and the
// door closes to match rather than stay open with no UI in front of it.
// Must run AFTER softAuth so req.user (and its role set) is populated. 404
// rather than 403 keeps production silent about the route either way.
//
// Order matters on the live site: the admin check is a free read of the role
// set softAuth already resolved, while the switch is an uncached SELECT — so
// the role check comes first. Anonymous and non-admin traffic then gets its
// 404 without touching the database, and a database failure can no longer
// turn into a 500 for a caller the 404 contract is meant to stonewall: the
// error path is reachable only by an admin.
//
// (This file was requireTestEnv.js until 2026-09-03: it exported a
// requireTestEnv middleware that no longer exists, so it took the name of the
// one thing it does.)
const Setting = require('../models/Setting');
const { isTestStack } = require('../config/appEnv');
const { hasRole } = require('../auth/roles');

function notFound(res) {
  return res.status(404).json({ error: 'Not found', code: 404 });
}

async function changeRequestGate(req, res, next) {
  try {
    if (!hasRole(req.user, 'admin')) return notFound(res);
    if (isTestStack()) return next();
    if (!(await Setting.getChangeRequestsEnabled())) return notFound(res);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { changeRequestGate };
