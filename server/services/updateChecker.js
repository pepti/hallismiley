'use strict';

// ── Update checker ───────────────────────────────────────────────────────────
//
// Asks the release channel "is there anything newer than me?" on an interval,
// and writes what it learns to the system_updates ledger. It never applies
// anything — that is phase 3 — and it never crashes the app: a release host
// that is down, slow, or serving nonsense is a warning line and a longer nap.
//
// Trust model. The manifest is public and unauthenticated, and that is fine,
// because nothing here trusts its CONTENT with anything dangerous: the only
// value that reaches a deployment is `imageDigest`, and a digest is
// self-verifying — the registry will not hand back different bytes for it. What
// does need protecting is WHO we ask, so the URL goes through the outbound
// allowlist and redirects are never followed.
//
// A dev build never checks at all. `version: "dev"` is not comparable to a
// release, so a developer's laptop cannot decide it is out of date, and CI/e2e
// runs stay quiet.

const { buildInfo, isDevBuild } = require('../config/version');
const { getSelfUpdateSettings, manifestUrlFor, isAuto, isEnabled } = require('./selfUpdateSettings');
const { assertAllowedUrl, OutboundBlockedError } = require('./outboundAllowlist');
const { isNewer, gte, isValid } = require('../utils/semver');
const { nextWindowStart } = require('../utils/maintenanceWindow');
const SystemUpdate = require('../models/SystemUpdate');
const { verifyPendingUpdate, runDueScheduled } = require('./updateApplier');
const baseLogger = require('../logger');

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

// A changelog is prose for one release. Anything larger is a mistake or an
// attempt to fill the disk one hourly check at a time.
const MAX_CHANGELOG_BYTES = 64 * 1024;
const MAX_BODY_BYTES      = 256 * 1024;
const FETCH_TIMEOUT_MS    = 10_000;

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;   // hourly
const MAX_INTERVAL_MS     = 6 * 60 * 60 * 1000;
const JITTER              = 0.1;              // ±10%

/**
 * Validate a manifest body. Strict: every field this app will act on must be
 * present and well-formed, and anything else in the document is ignored rather
 * than carried forward.
 * @returns {{ok:true, manifest:object} | {ok:false, errors:string[]}}
 */
function validateManifest(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['manifest is not a JSON object'] };
  }

  if (!isValid(raw.version)) errors.push(`version "${String(raw.version).slice(0, 40)}" is not semver`);
  if (typeof raw.imageDigest !== 'string' || !DIGEST_RE.test(raw.imageDigest)) {
    errors.push('imageDigest must be sha256:<64 hex chars>');
  }
  if (typeof raw.publishedAt !== 'string' || Number.isNaN(Date.parse(raw.publishedAt))) {
    errors.push('publishedAt must be an ISO 8601 timestamp');
  }
  if (raw.minCompatibleVersion !== undefined && !isValid(raw.minCompatibleVersion)) {
    errors.push('minCompatibleVersion must be semver when present');
  }
  if (raw.changelogMd !== undefined && typeof raw.changelogMd !== 'string') {
    errors.push('changelogMd must be a string when present');
  }
  if (typeof raw.changelogMd === 'string' && Buffer.byteLength(raw.changelogMd, 'utf8') > MAX_CHANGELOG_BYTES) {
    errors.push(`changelogMd exceeds ${MAX_CHANGELOG_BYTES} bytes`);
  }
  if (raw.critical !== undefined && typeof raw.critical !== 'boolean') {
    errors.push('critical must be a boolean when present');
  }
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    manifest: {
      version:              raw.version,
      imageDigest:          raw.imageDigest,
      publishedAt:          new Date(raw.publishedAt).toISOString(),
      minCompatibleVersion: raw.minCompatibleVersion || null,
      changelogMd:          typeof raw.changelogMd === 'string' ? raw.changelogMd : null,
      critical:             raw.critical === true,
    },
  };
}

/** Fetch + parse the manifest. Throws on anything that isn't a usable body. */
async function fetchManifest(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url, {
    method: 'GET',
    // A redirect is a way off the allowlist — the host we vetted is not
    // necessarily the host that would answer.
    redirect: 'manual',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status >= 300 && res.status < 400) {
    throw new Error(`manifest host answered with a redirect (${res.status}) — not followed`);
  }
  if (!res.ok) throw new Error(`manifest fetch returned HTTP ${res.status}`);

  const declared = Number(res.headers?.get?.('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new Error(`manifest is too large (${declared} bytes)`);

  const text = await res.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new Error('manifest is too large');

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('manifest is not valid JSON');
  }
}

/**
 * One check. Pure enough to test: every collaborator is injectable and the only
 * side effect is the ledger row.
 *
 * @returns {Promise<{outcome:string, update?:object, reason?:string, manifest?:object}>}
 *   outcome ∈ skipped-dev | blocked | fetch-failed | invalid-manifest |
 *             up-to-date | recorded
 */
async function checkOnce({
  settings = null,
  build = buildInfo,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  log = baseLogger,
} = {}) {
  const cfg = settings || await getSelfUpdateSettings();

  if (build.version === 'dev') {
    return { outcome: 'skipped-dev', reason: 'this build has no release identity' };
  }

  const url = manifestUrlFor(cfg);
  try {
    assertAllowedUrl(url);
  } catch (err) {
    if (err instanceof OutboundBlockedError) {
      log.error({ url }, `[updateChecker] refusing to fetch the manifest: ${err.message}`);
      return { outcome: 'blocked', reason: err.message };
    }
    throw err;
  }

  let raw;
  try {
    raw = await fetchManifest(url, fetchImpl);
  } catch (err) {
    // Expected in normal operation: DNS blips, a release host being redeployed,
    // an instance behind a captive network. Never fatal.
    log.warn({ url, err: err.message }, '[updateChecker] could not read the release manifest');
    return { outcome: 'fetch-failed', reason: err.message };
  }

  const parsed = validateManifest(raw);
  if (!parsed.ok) {
    log.error({ url, errors: parsed.errors }, '[updateChecker] release manifest is malformed — ignoring it');
    return { outcome: 'invalid-manifest', reason: parsed.errors.join('; ') };
  }
  const manifest = parsed.manifest;

  if (!isNewer(manifest.version, build.version)) {
    return { outcome: 'up-to-date', manifest };
  }

  // "Can this instance jump straight to that release?" A release may declare
  // the oldest version it can upgrade FROM (expand/contract migrations only
  // guarantee one hop). If we are older than that, the update is still recorded
  // and still visible — it is simply never auto-applied, because the operator
  // has to walk the instance through the intermediate release first.
  const compatible = !manifest.minCompatibleVersion || gte(build.version, manifest.minCompatibleVersion);

  const update = await SystemUpdate.recordAvailable({
    version:     manifest.version,
    imageDigest: manifest.imageDigest,
    channel:     cfg.channel,
    changelogMd: manifest.changelogMd,
    detail: {
      publishedAt:          manifest.publishedAt,
      critical:             manifest.critical,
      minCompatibleVersion: manifest.minCompatibleVersion,
      compatible,
      discoveredFromVersion: build.version,
    },
  });

  log.info(
    { version: manifest.version, channel: cfg.channel, critical: manifest.critical, compatible },
    '[updateChecker] a newer release is available'
  );

  // auto mode picks its own slot. Everything else waits for a human: `manual`
  // for the instance's admin, `managed` for us.
  if (isAuto(cfg.mode) && compatible && update && (update.status === 'available' || update.status === 'scheduled')) {
    const scheduled = await scheduleWithinWindow(update, { settings: cfg, manifest, now, log });
    if (scheduled) return { outcome: 'recorded', update: scheduled, manifest };
  }

  return { outcome: 'recorded', update, manifest };
}

/**
 * Put an auto-mode update in the next maintenance window — or now, if it is
 * critical and the instance permits that. Returns the updated row, or null.
 */
async function scheduleWithinWindow(update, { settings, manifest, now = new Date(), log = baseLogger }) {
  const window = settings.maintenanceWindow;
  const immediate = manifest.critical && settings.allowCriticalOutsideWindow;

  const at = immediate ? new Date(now.getTime()) : nextWindowStart(now, window);
  if (!at) {
    // A window nothing can ever match (no days, zero length). clientConfig warns
    // about this at boot; here it means the update simply waits for a human.
    log.warn(
      { updateId: update.id, window },
      '[updateChecker] auto mode is on but the maintenance window never opens — leaving the update for an admin'
    );
    return null;
  }

  const row = await SystemUpdate.markScheduled(update.id, at.toISOString());
  if (row) {
    log.info(
      { updateId: update.id, version: update.version, scheduledFor: at.toISOString(), immediate },
      immediate
        ? '[updateChecker] critical update scheduled immediately (outside the maintenance window, by config)'
        : '[updateChecker] update scheduled for the next maintenance window'
    );
  }
  return row;
}

// ── Scheduling ───────────────────────────────────────────────────────────────

/** ±JITTER around ms, so a fleet of instances does not stampede the host. */
function jitter(ms) {
  const spread = ms * JITTER;
  return Math.round(ms - spread + Math.random() * spread * 2);
}

/**
 * Start the periodic check. Self-rescheduling setTimeout rather than
 * setInterval: a failing host earns an exponentially longer nap, which
 * setInterval cannot express.
 *
 * @returns {{stop:Function}|null} null when this build never checks (dev).
 */
function startUpdateChecker({ intervalMs = DEFAULT_INTERVAL_MS, log = baseLogger, runNow = false } = {}) {
  if (!isEnabled()) {
    log.info('[updateChecker] not started — the self-update module is switched off on this instance');
    return null;
  }
  if (isDevBuild) {
    log.info('[updateChecker] not started — this is a dev build with no release identity');
    return null;
  }

  let timer = null;
  let stopped = false;
  let failures = 0;

  const schedule = (ms) => {
    if (stopped) return;
    timer = setTimeout(tick, jitter(ms));
    // Never hold the process open: a pending update check is not a reason to
    // refuse to shut down.
    if (typeof timer.unref === 'function') timer.unref();
  };

  async function tick() {
    try {
      // Resolve any update that is mid-flight BEFORE looking for new ones. On
      // an instance whose new image never booted, this tick is the only thing
      // that will ever expire the grace period — the old container is still
      // running and will not see another boot.
      await verifyPendingUpdate({ log }).catch(err => log.error({ err }, '[updateChecker] verification failed'));

      const result = await checkOnce({ log });

      // auto mode: fire anything whose window has now opened. Same loop, so
      // there is no second scheduler to keep in sync.
      await runDueScheduled({ log }).catch(err => log.error({ err }, '[updateChecker] scheduled apply failed'));

      // Only network/host problems earn backoff. A malformed manifest is the
      // publisher's bug and re-reading it sooner costs nothing.
      failures = (result.outcome === 'fetch-failed' || result.outcome === 'blocked') ? failures + 1 : 0;
    } catch (err) {
      failures += 1;
      log.error({ err }, '[updateChecker] check failed unexpectedly');
    }
    const backoff = Math.min(intervalMs * Math.pow(2, Math.min(failures, 4)), MAX_INTERVAL_MS);
    schedule(failures ? backoff : intervalMs);
  }

  schedule(runNow ? 0 : intervalMs);
  log.info({ intervalMs }, '[updateChecker] started');

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

module.exports = {
  checkOnce, startUpdateChecker, validateManifest, fetchManifest, scheduleWithinWindow,
  DEFAULT_INTERVAL_MS, MAX_CHANGELOG_BYTES, MAX_BODY_BYTES,
};
