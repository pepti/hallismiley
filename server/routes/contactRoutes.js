const express = require('express');
const router  = express.Router();
const { submit } = require('../controllers/contactController');
const rateLimit  = require('express-rate-limit');

// 5/hour/IP — the lead form is low-frequency by nature (a prospect submits
// once), so a strict cap costs real users nothing and blunts form spam.
// Exported so the policy can be asserted in a unit test: the limiter itself
// is skipped under NODE_ENV=test, which would otherwise leave the number
// completely untested.
const LEAD_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 5 };

const contactLimiter = rateLimit({
  windowMs: LEAD_RATE_LIMIT.windowMs,
  max: LEAD_RATE_LIMIT.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many messages sent. Please try again later.', code: 429 },
});

router.post('/', contactLimiter, submit);

module.exports = router;
module.exports.LEAD_RATE_LIMIT = LEAD_RATE_LIMIT;
