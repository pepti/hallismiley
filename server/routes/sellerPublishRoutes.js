// Seller-area ingest — POST /api/v1/seller-publish (D-020).
//
// The ONE door by which data reaches the seller area on the public instance:
// ops runs `npm run publish:sellers`, which signs a snapshot and posts it here.
//
// Gating, in order:
//   1. INSTANCE_ROLE=public and SELLER_PUBLISH_SECRET (≥ 32 chars) set — else
//      404, so on ops (and on any unconfigured box) the route does not exist.
//   2. The HMAC signature over the raw bytes (services/sellerPublish/
//      signature.js), with a 5-minute timestamp window. Every failure is the
//      same 401; the reason goes to the log only.
//   3. shape() — every field whitelisted, bounded and typed.
//   4. apply() — newer-than-last and unique snapshot_id, one transaction.
//
// Mounted in app.js BEFORE express.json with its own express.raw parser (the
// Stripe-webhook pattern), so the MAC is checked against the exact bytes sent.
// Deliberately NOT behind csrfProtect or sanitizeBody (invariant 7 exemption):
// it is machine-to-machine with no cookie, so there is no session for CSRF to
// protect — the signature is the authentication — and sanitizeBody must not
// mutate the signed Buffer. Rate-limited on its own below.
const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../logger');
const { pool } = require('../config/database');
const { isPublicInstance } = require('../config/instanceRole');
const signature = require('../services/sellerPublish/signature');
const { shape, apply, PublishError } = require('../services/sellerPublish/ingest');

const router = express.Router();

const MAX_BODY = '5mb';

const publishLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many requests, please try again later.', code: 429 },
});

function enabled(req, res, next) {
  if (!isPublicInstance() || !signature.secretFromEnv()) {
    return res.status(404).json({ error: 'Not found', code: 404 });
  }
  return next();
}

router.post('/',
  enabled,
  publishLimiter,
  express.raw({ type: 'application/json', limit: MAX_BODY }),
  async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const check = signature.verify(signature.secretFromEnv(), req.get(signature.HEADER), raw);
    if (!check.ok) {
      logger.warn({ reason: check.reason, ip: req.ip }, 'seller publish refused: bad signature');
      return res.status(401).json({ error: 'Unauthorized', code: 401 });
    }
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch {
      return res.status(400).json({ error: 'Body is not valid JSON', code: 400 });
    }
    try {
      const snap = shape(body);
      const out = await apply(pool, snap, raw);
      logger.info({ snapshotId: snap.snapshotId, generatedAt: snap.generatedAt, ...out.counts },
        'seller publish applied');
      return res.status(201).json({ snapshot_id: snap.snapshotId, ...out });
    } catch (err) {
      if (err instanceof PublishError) {
        logger.warn({ err: err.message }, 'seller publish refused');
        return res.status(err.status).json({ error: err.message, code: err.status });
      }
      return next(err);
    }
  });

module.exports = router;
