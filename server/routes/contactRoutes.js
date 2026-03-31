const express = require('express');
const router  = express.Router();
const { submit } = require('../controllers/contactController');
const rateLimit  = require('express-rate-limit');

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many messages sent. Please try again later.', code: 429 },
});

router.post('/', contactLimiter, submit);

module.exports = router;
