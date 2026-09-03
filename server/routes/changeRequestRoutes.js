// Submit endpoint for the in-app change-request tool. Gated by
// changeRequestGate (see that file for the policy — it is not restated here).
// Works for logged-out testers on the test stack; softAuth attaches the user
// when a session cookie is present, and has to run BEFORE the gate because the
// gate checks the role set. The 5 MB JSON limit for inline screenshots is
// mounted in app.js, ahead of the global parser.
const express   = require('express');
const rateLimit = require('express-rate-limit');
const router    = express.Router();

const ctrl = require('../controllers/changeRequestController');
const { changeRequestGate } = require('../middleware/changeRequestGate');
const { isTestStack }       = require('../config/appEnv');
const { csrfProtect }    = require('../middleware/csrf');
// The shared soft auth resolves req.user.roles; the gate decides on the role
// SET, so a private copy that only attached the user row would 404 every admin
// granted through Admin → Roles.
const { softAuth }       = require('../middleware/softAuth');

// Light abuse cap. Skipped on the test stack — by the SAME predicate the gate
// opens on. The other write limiters skip on raw NODE_ENV, which on a deployed
// TEST stack is 'production' (Dockerfile bakes it; APP_ENV=test is the label),
// so a skip keyed on NODE_ENV would leave the limiter live on exactly the stack
// where the gate lets everyone in: a validation trial behind one office IP
// would hit 150 and start 429ing with no admin-visible cause.
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150, // was 30 — ×5 (ice #201)
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestStack,
  message: { error: 'Too many change requests, please try again later.', code: 429 },
});

router.post('/', submitLimiter, softAuth, changeRequestGate, csrfProtect, ctrl.createBatch);

module.exports = router;
