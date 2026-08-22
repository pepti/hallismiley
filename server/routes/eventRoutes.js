// Client error-toast beacon. Open to signed-in AND anonymous visitors, so it
// uses softAuth (attaches req.user when a session cookie is present, never
// 401s) rather than requireAuth — a failure hit by a logged-out visitor is
// exactly the kind we most need recorded.
//
// CSRF IS enforced: unlike the analytics beacon (which uses navigator.sendBeacon
// and physically cannot set headers), this one posts with fetch and can carry
// X-CSRF-Token. The client drops the entry rather than retrying if the token is
// unavailable — a lost log line is always preferable to a retry storm on a page
// that is already failing.
const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');

const { collect }     = require('../controllers/eventLogController');
const { softAuth }    = require('../middleware/softAuth');
const { csrfProtect } = require('../middleware/csrf');

// Tighter than the analytics beacon (60/min): error toasts should be rare, and
// a page stuck in a failure loop must not be able to flood the table. Excess is
// dropped with a 429 the client ignores.
const collectLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many requests, please try again later.', code: 429 },
});

router.post('/collect', collectLimiter, softAuth, csrfProtect, collect);

module.exports = router;
