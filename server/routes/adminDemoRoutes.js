// The demo instance's reset — /api/v1/admin/demo (R2b, D-020).
//
// 404 unless this is a demo instance (config/demoInstance.js), like MCP when
// it is dark. The normal admin stack: session auth, the `admin` role, CSRF on
// the write. The POST runs every check first (services/demoReset.js
// preflight: the environment, an interrupted reset, the 15-minute cooldown,
// the lock) and answers 409/429 in the envelope when one fails; only then 202,
// and the reset itself runs after the answer — it re-checks everything and
// ends with a restart.
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');
const { csrfProtect } = require('../middleware/csrf');
const { isDemoInstance, nextResetAt } = require('../config/demoInstance');
const demoReset = require('../services/demoReset');
const securityLogger = require('../observability/securityLogger');
const logger = require('../logger');
const { t } = require('../i18n');

router.use((req, res, next) => (isDemoInstance() ? next() : res.status(404).json({ error: 'Not found', code: 404 })));
router.use(requireAuth, requireRole('admin'));

const REASONS = new Set(['busy', 'cooldown', 'interrupted', 'refused']);

// GET / → { demo: true, lastReset: { at, trigger } | null, nextReset }
router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.json({ demo: true, lastReset: await demoReset.lastReset(), nextReset: nextResetAt().toISOString() });
  } catch (err) { return next(err); }
});

// POST /reset → 202 { started, retryAfterSeconds } | 409 / 429 { error, code, reason }
router.post('/reset', csrfProtect, async (req, res, next) => {
  try {
    await demoReset.preflight({ trigger: 'admin' });
  } catch (err) {
    if (!(err instanceof demoReset.DemoResetRefused)) return next(err);
    const reason = REASONS.has(err.reason) ? err.reason : 'refused';
    logger.warn({ err: err.message, reason }, '[demoReset] reset on request refused');
    return res.status(err.status).json({ error: t(req.locale, `errors.demo.${reason}`), code: err.status, reason });
  }
  securityLogger.adminAction(req.user.id, 'demo_reset', 'demo', {});
  res.status(202).json({ started: true, retryAfterSeconds: 60 });
  setImmediate(() => {
    demoReset.resetDemo({ trigger: 'admin' })
      .catch((err) => logger.error({ err }, '[demoReset] reset on request failed'));
  });
  return undefined;
});

module.exports = router;
