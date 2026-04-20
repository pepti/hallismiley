const express = require('express');
const rateLimit = require('express-rate-limit');
const router  = express.Router();

const shopController  = require('../controllers/shopController');
const { csrfProtect } = require('../middleware/csrf');
const { lucia }       = require('../auth/lucia');

// Soft auth — populate req.user if a valid session cookie is present, but
// don't reject if missing (guest checkout is supported).
async function softAuth(req, res, next) {
  try {
    const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
    if (!sessionId) return next();
    const { session, user } = await lucia.validateSession(sessionId);
    if (session && user && !user.disabled) {
      req.user = user;
      req.session = session;
    }
    return next();
  } catch {
    return next();
  }
}

async function requireAuth(req, res, next) {
  const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
  if (!sessionId) return res.status(401).json({ error: 'Unauthorized', code: 401 });
  const { session, user } = await lucia.validateSession(sessionId);
  if (!session || !user || user.disabled) {
    return res.status(401).json({ error: 'Unauthorized', code: 401 });
  }
  req.user = user;
  req.session = session;
  next();
}

// Stricter rate limit on checkout — 10 attempts / 15 min / IP
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many checkout attempts, please try again later.', code: 429 },
});

// ── Public read endpoints ────────────────────────────────────────────────────
router.get('/config',             shopController.getConfig);
router.get('/products',           shopController.listProducts);
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

module.exports = router;
