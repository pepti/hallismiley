const Setting = require('../models/Setting');

function notFound(res) {
  return res.status(404).json({ error: 'Not found', code: 404 });
}

// Gate that only lets a request through when the app is NOT running in
// production. Returns 404 (not 403) so production reveals nothing about the
// route's existence. APP_ENV (if set) wins over NODE_ENV.
function resolvedEnv() {
  return process.env.APP_ENV || process.env.NODE_ENV || 'production';
}

function requireTestEnv(req, res, next) {
  if (resolvedEnv() === 'production') return notFound(res);
  next();
}

// Gate for the change-request submit endpoint (ice #206). Two ways in:
//   • a non-production app-env — unchanged: anyone on TEST can file requests,
//     logged out included, which is the whole point of a validation trial.
//   • the admin switch (Admin → Feedback) — lets the owner file requests
//     against PROD too, but ONLY as an admin. Customers must never see or
//     reach this, so a non-admin gets the same 404 as before.
// Must run AFTER softAuth so req.user is populated. 404 rather than 403 keeps
// production silent about the route either way.
async function changeRequestGate(req, res, next) {
  try {
    if (resolvedEnv() !== 'production') return next();
    if (!(await Setting.getChangeRequestsEnabled())) return notFound(res);
    if (req.user?.role !== 'admin') return notFound(res);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireTestEnv, changeRequestGate };
