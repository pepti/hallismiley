'use strict';

// System/instance identity + self-update surface (/api/v1/system).
//
// Gating, deliberately two-tier and matching the bookkeeping precedent in this
// codebase (read is delegable, mutation is not):
//   • reads   — the `updates` view id, so an ops role can watch the fleet
//               without being handed the site.
//   • writes  — hard admin only, plus CSRF. Applying an update restarts the
//               instance; that is not a delegable permission, and neither is
//               changing how updates arrive.
//
// Nothing here is public: an unauthenticated caller cannot learn which version
// this instance runs, because "which version" is also "which published CVEs
// apply to me".
const express = require('express');
const rateLimit = require('express-rate-limit');
const router  = express.Router();

const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');
const { requireView } = require('../auth/requireView');
const { csrfProtect } = require('../middleware/csrf');
const { buildInfo }   = require('../config/version');
const { applyUpdate, rollbackUpdate } = require('../services/updateApplier');
const { getSelfUpdateSettings, isEnabled, ADMIN_MODES, CHANNELS, KEYS } = require('../services/selfUpdateSettings');
const { renderChangelog } = require('../services/changelogRender');
const { nextWindowStart, DAY_KEYS } = require('../utils/maintenanceWindow');
const SystemUpdate = require('../models/SystemUpdate');
const Setting = require('../models/Setting');

// A module that is switched off answers 404, not 403. 403 says "this exists and
// you may not have it"; on an instance where self-update was never provisioned,
// that would be a lie and a hint. The base (HalliProjects) ships the flag off,
// so the engine carries this dormant until a fleet turns it on.
router.use((req, res, next) => {
  if (!isEnabled()) return res.status(404).json({ error: 'Not found', code: 404 });
  return next();
});

router.use(requireAuth);

const canRead  = requireView('updates');
const canWrite = requireRole('admin');

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

/** The host we trust for updates — never the full URL. */
function manifestHostOf(settings) {
  try {
    return new URL(settings.manifestUrl.replace(/\{channel\}/g, settings.channel)).host;
  } catch {
    return null;
  }
}

function nextWindowIso(settings) {
  const at = nextWindowStart(new Date(), settings.maintenanceWindow);
  return at ? at.toISOString() : null;
}

/** @returns {string|null} the reason it is invalid, or null when it is fine. */
function validateWindow(win) {
  if (!win || typeof win !== 'object' || Array.isArray(win)) return 'maintenanceWindow must be an object';
  if (!Array.isArray(win.days) || !win.days.length) return 'maintenanceWindow.days must be a non-empty array';
  if (win.days.length > 7 || !win.days.every(d => DAY_KEYS.includes(d))) {
    return `maintenanceWindow.days must be day keys from ${DAY_KEYS.join(', ')}`;
  }
  for (const key of ['fromHour', 'toHour']) {
    if (!Number.isInteger(win[key]) || win[key] < 0 || win[key] > 23) {
      return `maintenanceWindow.${key} must be an integer between 0 and 23`;
    }
  }
  // A zero-length window is the config that silently never fires; refusing it
  // here is cheaper than explaining later why auto mode never did anything.
  if (win.fromHour === win.toHour) return 'maintenanceWindow must not be zero-length';
  if (typeof win.tz !== 'string' || !win.tz) return 'maintenanceWindow.tz is required';
  try { new Intl.DateTimeFormat('en-US', { timeZone: win.tz }); }
  catch { return 'maintenanceWindow.tz is not a recognised IANA time zone'; }
  return null;
}

// GET /api/v1/system/version → what this instance is, and where its updates
// would come from. `manifestHost` rather than the full URL: the admin needs to
// know who they trust for updates, not a copyable endpoint.
router.get('/version', canRead, async (req, res, next) => {
  try {
    const selfUpdate = await getSelfUpdateSettings();
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
        manifestHost: manifestHostOf(selfUpdate),
      },
    });
  } catch (err) { return next(err); }
});

// GET /api/v1/system/updates → everything the updates screen paints in one
// round trip: what is running, how updates behave here, what is waiting, and
// what has happened before.
router.get('/updates', canRead, async (req, res, next) => {
  try {
    const settings = await getSelfUpdateSettings();
    const available = await SystemUpdate.latestActionable(settings.channel);
    const history = await SystemUpdate.listRecent(25);

    return res.json({
      build: {
        version: buildInfo.version,
        gitSha:  buildInfo.gitSha,
        builtAt: buildInfo.builtAt,
        channel: buildInfo.channel,
      },
      settings: {
        mode:              settings.mode,
        channel:           settings.channel,
        managed:           settings.managed,
        manifestHost:      manifestHostOf(settings),
        maintenanceWindow: settings.maintenanceWindow,
        // What "the next window" actually means in wall-clock terms, computed
        // server-side so the browser's own clock and zone cannot disagree with
        // the scheduler that will actually fire.
        nextWindowStart:   nextWindowIso(settings),
        // Whether this instance could deploy at all if asked. A button that
        // 503s at the moment of truth is worse than one that is disabled with
        // a reason.
        triggerConfigured: Boolean((process.env.SELF_UPDATE_TRIGGER_URL || '').trim()),
      },
      available: available ? { ...publicUpdate(available), changelogHtml: renderChangelog(available.changelog_md) } : null,
      history: history.map(publicUpdate),
    });
  } catch (err) { return next(err); }
});

// PATCH /api/v1/system/settings → the admin's own choices. Hard admin + CSRF:
// switching an instance to `auto` is a decision to let it restart itself at
// 03:00, which is not something a delegated view holder should be able to do.
router.patch('/settings', canWrite, csrfProtect, async (req, res, next) => {
  try {
    const settings = await getSelfUpdateSettings();
    if (settings.managed) {
      return res.status(403).json({ error: 'Updates on this instance are managed by Orange Smiley', code: 403 });
    }

    const body = req.body || {};
    const writes = [];

    if (body.mode !== undefined) {
      if (!ADMIN_MODES.includes(body.mode)) {
        return res.status(400).json({ error: `mode must be one of ${ADMIN_MODES.join(', ')}`, code: 400 });
      }
      writes.push([KEYS.mode, body.mode]);
    }

    if (body.channel !== undefined) {
      if (!CHANNELS.includes(body.channel)) {
        return res.status(400).json({ error: `channel must be one of ${CHANNELS.join(', ')}`, code: 400 });
      }
      writes.push([KEYS.channel, body.channel]);
    }

    if (body.maintenanceWindow !== undefined) {
      const invalid = validateWindow(body.maintenanceWindow);
      if (invalid) return res.status(400).json({ error: invalid, code: 400 });
      writes.push([KEYS.window, body.maintenanceWindow]);
    }

    if (!writes.length) return res.status(400).json({ error: 'Nothing to update', code: 400 });
    for (const [key, value] of writes) await Setting.set(key, value);

    const updated = await getSelfUpdateSettings();
    return res.json({
      settings: {
        mode:              updated.mode,
        channel:           updated.channel,
        managed:           updated.managed,
        manifestHost:      manifestHostOf(updated),
        maintenanceWindow: updated.maintenanceWindow,
        nextWindowStart:   nextWindowIso(updated),
        triggerConfigured: Boolean((process.env.SELF_UPDATE_TRIGGER_URL || '').trim()),
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
router.post('/updates/:id/apply', canWrite, updateLimiter, csrfProtect, async (req, res, next) => {
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
router.post('/updates/:id/rollback', canWrite, updateLimiter, csrfProtect, async (req, res, next) => {
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
