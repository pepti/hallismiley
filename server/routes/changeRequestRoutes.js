// Submit endpoint for the in-app change-request tool. Gated by
// changeRequestGate: everyone in a non-prod app-env, and on PROD only admins,
// once the Admin → Feedback switch is on (404 otherwise — ice #206). Works for
// logged-out testers; softAuth attaches the user when a session cookie is
// present, and has to run BEFORE the gate because the gate checks the role.
// NOTE: inline screenshots (part 2) need a larger JSON body limit for this path
// than the global parser — to be added in app.js when the widget lands.
const express   = require('express');
const rateLimit = require('express-rate-limit');
const router    = express.Router();

const ctrl = require('../controllers/changeRequestController');
const { changeRequestGate } = require('../middleware/requireTestEnv');
const { csrfProtect }    = require('../middleware/csrf');
// The shared soft auth resolves req.user.roles; the gate decides on the role
// SET, so a private copy that only attached the user row would 404 every admin
// granted through Admin → Roles.
const { softAuth }       = require('../middleware/softAuth');

// Light abuse cap. Skipped in dev/test like the other write limiters.
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150, // was 30 — ×5 (ice #201)
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many change requests, please try again later.', code: 429 },
});

router.post('/', submitLimiter, softAuth, changeRequestGate, csrfProtect, ctrl.createBatch);

module.exports = router;
