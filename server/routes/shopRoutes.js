const express = require('express');
const rateLimit = require('express-rate-limit');
const router  = express.Router();

const shopController  = require('../controllers/shopController');
const { csrfProtect } = require('../middleware/csrf');
const { lucia }       = require('../auth/lucia');
const { applyMfaPolicy } = require('../auth/mfaPolicy');

// Soft auth for guest checkout is the shared middleware: it attaches the role
// SET, so any role-aware behaviour that lands on checkout sees the same
// req.user.roles every other gate does. A private copy that only attached the
// user row lived here until 2026-09-03 — the same copy changeRequestRoutes had
// deleted for 404ing every admin granted through Admin → Roles.
const { softAuth } = require('../middleware/softAuth');

// Still private on purpose, for now: the shared auth/middleware.js requireAuth
// also rotates fresh cookies, re-resolves req.locale and answers 403 (not 401)
// for a disabled account — behaviour changes for /orders/mine that deserve
// their own change, not a ride-along on the soft-auth cleanup.
async function requireAuth(req, res, next) {
  const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
  if (!sessionId) return res.status(401).json({ error: 'Unauthorized', code: 401 });
  const { session, user } = await lucia.validateSession(sessionId);
  if (!session || !user || user.disabled) {
    return res.status(401).json({ error: 'Unauthorized', code: 401 });
  }
  req.user = applyMfaPolicy(user);   // auth/mfaPolicy.js
  req.session = session;
  next();
}

// Stricter rate limit on checkout — 50 attempts / 15 min / IP (was 10; ×5, ice #201)
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many checkout attempts, please try again later.', code: 429 },
});

// Discount-code validation — public preview; rate-limited to deter code guessing.
const discountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many attempts, please try again later.', code: 429 },
});

// ── Public read endpoints ────────────────────────────────────────────────────
router.get('/config',             shopController.getConfig);
router.get('/products',           shopController.listProducts);
router.get('/collections',        shopController.listCollections);
router.get('/products/:slug',     shopController.getProduct);
router.get('/orders/by-session/:sessionId', shopController.getOrderBySession);

// Logged-in user's order history
router.get('/orders/mine', requireAuth, shopController.getMyOrders);

// Checkout — soft auth (optional login), CSRF-protected, rate-limited
router.post('/checkout',
  checkoutLimiter,
  softAuth,
  csrfProtect,
  shopController.createCheckoutSession);

// Discount-code preview (display-only; checkout re-validates server-side).
router.post('/discounts/validate', discountLimiter, shopController.validateDiscount);

module.exports = router;
