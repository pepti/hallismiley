// Public submit endpoint for the in-app change-request tool. Non-prod only
// (requireTestEnv → 404 in production). Works for logged-out testers; softAuth
// attaches the user when a session cookie is present.
// NOTE: inline screenshots (part 2) need a larger JSON body limit for this path
// than the global parser — to be added in app.js when the widget lands.
const express   = require('express');
const rateLimit = require('express-rate-limit');
const router    = express.Router();

const ctrl = require('../controllers/changeRequestController');
const { requireTestEnv } = require('../middleware/requireTestEnv');
const { csrfProtect }    = require('../middleware/csrf');
const { lucia }          = require('../auth/lucia');

// Optional auth — attach req.user if a valid session cookie is present, but
// don't reject if missing (logged-out testers can file requests).
async function softAuth(req, res, next) {
  try {
    const sid = lucia.readSessionCookie(req.headers.cookie ?? '');
    if (!sid) return next();
    const { session, user } = await lucia.validateSession(sid);
    if (session && user && !user.disabled) { req.user = user; req.session = session; }
    return next();
  } catch {
    return next();
  }
}

// Light abuse cap. Skipped in dev/test like the other write limiters.
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many change requests, please try again later.', code: 429 },
});

router.post('/', requireTestEnv, submitLimiter, softAuth, csrfProtect, ctrl.createBatch);

module.exports = router;
