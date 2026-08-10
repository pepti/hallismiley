'use strict';

// System/instance identity + self-update surface (/api/v1/system).
//
// Gating, deliberately two-tier and matching the bookkeeping precedent in this
// codebase (read is delegable, mutation is not):
//   • reads   — requireAuth + admin role. Phase 4 swaps this for the `updates`
//               view id once the admin sidebar item exists (the parity test in
//               tests/unit/admin-views-parity.test.js forbids a view id without
//               a matching nav item, so the id cannot be introduced earlier).
//   • writes  — hard admin only, plus CSRF. Applying an update restarts the
//               instance; that is not a delegable permission.
//
// Nothing here is public: an unauthenticated caller cannot learn which version
// this instance runs, because "which version" is also "which published CVEs
// apply to me".
const express = require('express');
const rateLimit = require('express-rate-limit');
const router  = express.Router();

const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');
const { csrfProtect } = require('../middleware/csrf');
const { buildInfo }   = require('../config/version');
const { clientConfig } = require('../config/clientConfig');
const { applyUpdate, rollbackUpdate } = require('../services/updateApplier');

router.use(requireAuth, requireRole('admin'));

// Deploying is not an operation anyone needs to perform in a loop. Low enough
// that a stuck retry loop in a browser tab cannot machine-gun the platform's
// deployment webhook; high enough that a real "apply, it failed, roll back,
// try again" session never sees it.
const updateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many update operations, please wait before trying again.', code: 429 },
});

/**
 * The wire shape of a ledger row. Explicit allowlist rather than the raw row:
 * `detail` accumulates operational breadcrumbs (who triggered what, from which
 * version) and the browser has no business with all of it.
 */
function publicUpdate(row) {
  if (!row) return null;
  const detail = row.detail || {};
  return {
    id:             row.id,
    version:        row.version,
    channel:        row.channel,
    status:         row.status,
    imageDigest:    row.image_digest,
    previousDigest: row.previous_digest,
    discoveredAt:   row.discovered_at,
    appliedAt:      row.applied_at,
    publishedAt:    detail.publishedAt || null,
    critical:       detail.critical === true,
    compatible:     detail.compatible !== false,
    minCompatibleVersion: detail.minCompatibleVersion || null,
    scheduledFor:   detail.scheduledFor || null,
    failureReason:  detail.failureReason || null,
  };
}

// GET /api/v1/system/version → what this instance is, and where its updates
// would come from. `manifestHost` rather than the full URL: the admin needs to
// know who they trust for updates, not a copyable endpoint.
router.get('/version', (req, res, next) => {
  try {
    const selfUpdate = clientConfig.modules.selfUpdate;
    let manifestHost = null;
    try {
      manifestHost = new URL(selfUpdate.manifestUrl.replace(/\{channel\}/g, selfUpdate.channel)).host;
    } catch {
      manifestHost = null;
    }
    return res.json({
      build: {
        version: buildInfo.version,
        gitSha:  buildInfo.gitSha,
        builtAt: buildInfo.builtAt,
        channel: buildInfo.channel,
      },
      selfUpdate: {
        mode:    selfUpdate.mode,
        channel: selfUpdate.channel,
        manifestHost,
      },
    });
  } catch (err) { return next(err); }
});

// ── Applying an update ───────────────────────────────────────────────────────
//
// Everything below restarts the instance, so everything below is hard admin +
// CSRF + rate limited, regardless of what the read gate becomes. A `managed`
// instance gets 403 here: that mode means "Orange Smiley drives", and a control
// that exists but is refused is more honest than one that quietly does nothing.

// POST /api/v1/system/updates/:id/apply
router.post('/updates/:id/apply', updateLimiter, csrfProtect, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid update id', code: 400 });

    const update = await applyUpdate(id, { actor: req.user, reason: 'manual' });
    return res.json({ update: publicUpdate(update) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.status });
    return next(err);
  }
});

// POST /api/v1/system/updates/:id/rollback
router.post('/updates/:id/rollback', updateLimiter, csrfProtect, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid update id', code: 400 });

    const result = await rollbackUpdate(id, { actor: req.user });
    return res.json({
      triggered:      result.triggered,
      previousDigest: result.previousDigest,
      // When we could not do it, the operator gets the exact command instead of
      // a shrug. An honest "here is what a human must run" beats a fake button.
      command:        result.command,
      error:          result.error || null,
      update:         publicUpdate(result.update),
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.status });
    return next(err);
  }
});

module.exports = router;
