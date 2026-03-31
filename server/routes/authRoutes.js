const express        = require('express');
const router         = express.Router();
const authController = require('../controllers/authController');
const authLimiter    = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000,
  max: 10,  // max 10 login attempts per 15 min — brute force protection
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many auth attempts, try again later.', code: 429 },
});

router.post('/login',    authLimiter, authController.login);
router.post('/logout',               authController.logout);
router.get('/session',               authController.session);

module.exports = router;
