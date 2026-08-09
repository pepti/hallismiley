// Public analytics ingestion. Anonymous beacon traffic — deliberately NO auth
// and NO CSRF (navigator.sendBeacon cannot send custom headers). Protected by a
// tight per-IP rate limiter and the global 100kb body cap + sanitizeBody.
const express   = require('express');
const router    = express.Router();
const { collect } = require('../controllers/analyticsController');
const rateLimit = require('express-rate-limit');

const collectLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many requests, please try again later.', code: 429 },
});

router.post('/collect', collectLimiter, collect);

module.exports = router;
