const express        = require('express');
const rateLimit      = require('express-rate-limit');
const router         = express.Router();
const authController       = require('../controllers/authController');
const googleAuthController = require('../controllers/googleAuthController');
const { validateSignup, validateResetPassword } = require('../middleware/validate');
const { csrfProtect } = require('../middleware/csrf');

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

// Password-reset flow: 5 requests per hour per IP to limit flooding / token guessing
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  skip: isTest,
  message: { error: 'Too many password reset requests, please try again in an hour.', code: 429 },
});

// ── Existing auth ─────────────────────────────────────────────────────────────
router.post('/login',  authLimiter,              authController.login);
// csrfProtect on logout: the client already fetches a fresh CSRF token before
// calling this endpoint (see public/js/services/auth.js → logout()).
router.post('/logout', csrfProtect,              authController.logout);
router.get('/session',                           authController.session);

// ── New auth endpoints ────────────────────────────────────────────────────────
router.post('/signup',           signupLimiter, validateSignup, authController.signup);
router.post('/verify-email',                                    authController.verifyEmail);
router.post('/resend-verification', resendLimiter,              authController.resendVerification);
router.post('/forgot-password', resetLimiter,                  authController.forgotPassword);
router.post('/reset-password',  resetLimiter, validateResetPassword, authController.resetPassword);

// ── Availability checks ───────────────────────────────────────────────────────
router.get('/check-username/:username', checkLimiter, authController.checkUsername);
router.get('/check-email/:email',       checkLimiter, authController.checkEmail);

// ── Google OAuth ──────────────────────────────────────────────────────────────
// No CSRF (top-level redirects can't carry CSRF headers; state cookie covers it).
// Reuse authLimiter — 10 requests per 15 min per IP — to deter abuse.
router.get('/google',           authLimiter, googleAuthController.start);
router.get('/google/callback',  authLimiter, googleAuthController.callback);

module.exports = router;
