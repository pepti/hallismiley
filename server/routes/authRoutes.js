const express        = require('express');
const rateLimit      = require('express-rate-limit');
const router         = express.Router();
const authController = require('../controllers/authController');
const { validateSignup, validateResetPassword } = require('../middleware/validate');

const isTest = () => process.env.NODE_ENV === 'test';

// Brute-force protection on login
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: isTest,
  message: { error: 'Too many auth attempts, try again later.', code: 429 },
});

// Signup: 15 registrations per 10 minutes per IP
const signupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  skip: isTest,
  message: { error: 'Too many signup attempts, try again later.', code: 429 },
});

// Availability checks: tight limit to deter enumeration
const checkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  skip: isTest,
  message: { error: 'Too many requests, try again later.', code: 429 },
});

// Resend verification: 1 request per minute per IP
const resendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  skip: isTest,
  message: { error: 'Please wait 1 minute before requesting another verification email.', code: 429 },
});

// ── Existing auth ─────────────────────────────────────────────────────────────
router.post('/login',  authLimiter,   authController.login);
router.post('/logout',               authController.logout);
router.get('/session',               authController.session);

// ── New auth endpoints ────────────────────────────────────────────────────────
router.post('/signup',           signupLimiter, validateSignup, authController.signup);
router.post('/verify-email',                                    authController.verifyEmail);
router.post('/resend-verification', resendLimiter,              authController.resendVerification);
router.post('/forgot-password',                                 authController.forgotPassword);
router.post('/reset-password',         validateResetPassword,  authController.resetPassword);

// ── Availability checks ───────────────────────────────────────────────────────
router.get('/check-username/:username', checkLimiter, authController.checkUsername);
router.get('/check-email/:email',       checkLimiter, authController.checkEmail);

module.exports = router;
