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
const router  = express.Router();

const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');
const { buildInfo }   = require('../config/version');
const { clientConfig } = require('../config/clientConfig');

router.use(requireAuth, requireRole('admin'));

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

module.exports = router;
