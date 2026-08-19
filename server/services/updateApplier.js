'use strict';

// ── Applying an update ───────────────────────────────────────────────────────
//
// Honest scope. On App Service the image pull is the PLATFORM's job: a CD
// webhook or a pipeline dispatch tells Azure to pull a digest and swap the
// container. This module's job is to trigger that, record what was running
// before it, and later verify that the swap actually happened. It does not
// replace the platform, and pretending otherwise would produce a mechanism that
// reports success while nothing moved.
//
// The trigger URL is a DEPLOYMENT SECRET (SELF_UPDATE_TRIGGER_URL, Key-Vault
// sourced), not configuration an admin can edit — which is why it does not go
// through the manifest allowlist in outboundAllowlist.js. It gets its own,
// narrower rule instead: https only, because App Service's own docker hook
// carries its credential in the URL userinfo, and that credential must never
// cross a plaintext connection. Allowing userinfo here and forbidding it there
// is deliberate: different threat, different rule.

const { buildInfo } = require('../config/version');
const { getSelfUpdateSettings, canApply, isAuto } = require('./selfUpdateSettings');
const SystemUpdate = require('../models/SystemUpdate');
const baseLogger = require('../logger');

const TRIGGER_TIMEOUT_MS = 15_000;

// How long after a trigger we still believe the swap is in flight. App Service
// pulls an image, starts the container, waits for health, then swaps; a cold
// pull of a ~300 MB image on a small tier is minutes, not seconds.
const VERIFY_GRACE_MS = 15 * 60 * 1000;

class UpdateNotPermittedError extends Error {
  constructor(message) { super(message); this.name = 'UpdateNotPermittedError'; this.status = 403; }
}
class UpdateStateError extends Error {
  constructor(message) { super(message); this.name = 'UpdateStateError'; this.status = 409; }
}
class TriggerNotConfiguredError extends Error {
  constructor(message) { super(message); this.name = 'TriggerNotConfiguredError'; this.status = 503; }
}

/**
 * The digest this instance is currently running, best effort.
 *
 * Nothing inside a container can read its own image digest, so this reads what
 * the platform was kind enough to inject, and falls back to the ledger: if we
 * got here by applying an update, the digest we applied is what we are running.
 * A null answer is not fatal — it only means a rollback has to be expressed as
 * "redeploy version X" rather than "pull digest Y", which is what the admin UI
 * then says.
 */
async function runningImageDigest() {
  const direct = process.env.RUNNING_IMAGE_DIGEST;
  if (direct && /^sha256:[0-9a-f]{64}$/.test(direct)) return direct;

  // App Service sets DOCKER_CUSTOM_IMAGE_NAME to what it was told to pull; when
  // the deploy pinned a digest, it is right there in the reference.
  const ref = process.env.DOCKER_CUSTOM_IMAGE_NAME || '';
  const m = /@(sha256:[0-9a-f]{64})$/.exec(ref.trim());
  if (m) return m[1];

  const rows = await SystemUpdate.listRecent(100);
  const lastApplied = rows.find(r => r.status === 'applied');
  return lastApplied ? lastApplied.image_digest : null;
}

/** POST the deployment trigger. Throws when it is not configured or fails. */
async function fireTrigger(payload, { fetchImpl = globalThis.fetch, log = baseLogger } = {}) {
  const raw = (process.env.SELF_UPDATE_TRIGGER_URL || '').trim();
  if (!raw) {
    throw new TriggerNotConfiguredError(
      'SELF_UPDATE_TRIGGER_URL is not set — this instance has no way to ask the platform to deploy'
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TriggerNotConfiguredError('SELF_UPDATE_TRIGGER_URL is not a valid URL');
  }
  if (url.protocol !== 'https:') {
    // The hook URL usually carries a credential; plaintext would hand it to the
    // network along with the ability to redeploy this instance at will.
    throw new TriggerNotConfiguredError('SELF_UPDATE_TRIGGER_URL must use https');
  }

  const res = await fetchImpl(url.toString(), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`deployment trigger returned HTTP ${res.status}`);
  log.info({ status: res.status, host: url.host }, '[updateApplier] deployment trigger accepted');
  return { status: res.status, host: url.host };
}

/**
 * Trigger the deployment of an update.
 *
 * Order matters and is not cosmetic: the row moves to `applying` and captures
 * previous_digest BEFORE the trigger fires. If the trigger succeeds, this
 * process may be killed mid-response by the platform swapping the container —
 * so anything not written before the trigger is never written at all.
 *
 * @returns {Promise<object>} the updated row
 */
async function applyUpdate(updateId, {
  settings = null, actor = null, fetchImpl = globalThis.fetch, log = baseLogger, reason = 'manual',
} = {}) {
  const cfg = settings || await getSelfUpdateSettings();
  if (!canApply(cfg.mode)) {
    throw new UpdateNotPermittedError('Updates on this instance are managed by Orange Smiley');
  }

  const update = await SystemUpdate.findById(updateId);
  if (!update) throw new UpdateStateError('No such update');
  if (!SystemUpdate.ACTIONABLE.includes(update.status)) {
    throw new UpdateStateError(`This update is ${update.status} and cannot be applied again`);
  }
  if (update.detail && update.detail.compatible === false) {
    throw new UpdateStateError(
      `Version ${update.version} cannot be reached from ${buildInfo.version} in one step — ` +
      `it requires at least ${update.detail.minCompatibleVersion}`
    );
  }

  const previous = await runningImageDigest();

  // The guarded transition IS the lock: a second concurrent apply gets null
  // here and stops, instead of firing a second deployment at an instance that
  // is already restarting.
  const claimed = await SystemUpdate.markApplying(updateId, previous, {
    triggeredAt: new Date().toISOString(),
    triggeredBy: actor ? { id: actor.id, username: actor.username } : { id: null, username: reason },
    triggeredFromVersion: buildInfo.version,
    reason,
  });
  if (!claimed) throw new UpdateStateError('This update is already being applied');

  try {
    await fireTrigger({
      updateId:      claimed.id,
      version:       claimed.version,
      imageDigest:   claimed.image_digest,
      channel:       claimed.channel,
      previousDigest: previous,
      reason,
    }, { fetchImpl, log });
  } catch (err) {
    // The platform was never asked, so nothing is in flight: fail the row now
    // rather than leaving it `applying` for the verifier to time out on.
    await SystemUpdate.markFailed(claimed.id, err.message, { failedAt: new Date().toISOString(), stage: 'trigger' });
    log.error({ err: err.message, updateId: claimed.id }, '[updateApplier] could not trigger the deployment');
    throw err;
  }

  log.warn(
    { updateId: claimed.id, version: claimed.version, from: buildInfo.version, previousDigest: previous },
    '[updateApplier] deployment triggered — this instance is expected to restart shortly'
  );
  return claimed;
}

/**
 * Assisted rollback. v1 is deliberately assisted, not automatic: an image that
 * fails to BOOT cannot roll itself back, because it is not running to do so.
 * The real safety net for that case is a platform guard (staging-slot swap, or
 * last-known-good) and it belongs to provisioning, not to this repo.
 *
 * What this does cover is the case that actually happens more often: the new
 * image boots, is wrong, and someone wants the previous digest back.
 *
 * @returns {Promise<{triggered:boolean, command:string, previousDigest:string|null, update:object}>}
 */
async function rollbackUpdate(updateId, {
  settings = null, actor = null, fetchImpl = globalThis.fetch, log = baseLogger,
} = {}) {
  const cfg = settings || await getSelfUpdateSettings();
  if (!canApply(cfg.mode)) {
    throw new UpdateNotPermittedError('Updates on this instance are managed by Orange Smiley');
  }

  const update = await SystemUpdate.findById(updateId);
  if (!update) throw new UpdateStateError('No such update');
  if (!['failed', 'applied'].includes(update.status)) {
    throw new UpdateStateError(`Only an applied or failed update can be rolled back (this one is ${update.status})`);
  }

  const previousDigest = update.previous_digest || null;
  // Handed to the operator verbatim when we cannot do it for them. Az CLI
  // rather than a portal click-path because it can be pasted.
  const command = previousDigest
    ? `az webapp config container set --name <app> --resource-group <rg> --docker-custom-image-name <registry>/<image>@${previousDigest}`
    : `# No previous digest was recorded for this instance.\n# Redeploy the release that preceded ${update.version} from CI.`;

  if (!previousDigest) {
    await SystemUpdate.mergeDetail(updateId, {
      rollbackRequestedAt: new Date().toISOString(),
      rollbackRequestedBy: actor ? actor.username : null,
      rollbackTriggered: false,
    });
    return { triggered: false, command, previousDigest, update: await SystemUpdate.findById(updateId) };
  }

  try {
    await fireTrigger({
      updateId:    update.id,
      version:     update.version,
      imageDigest: previousDigest,
      channel:     update.channel,
      reason:      'rollback',
      rollback:    true,
    }, { fetchImpl, log });
  } catch (err) {
    await SystemUpdate.mergeDetail(updateId, {
      rollbackRequestedAt: new Date().toISOString(),
      rollbackTriggered: false,
      rollbackError: err.message,
    });
    log.error({ err: err.message, updateId }, '[updateApplier] rollback trigger failed');
    return { triggered: false, command, previousDigest, update: await SystemUpdate.findById(updateId), error: err.message };
  }

  const row = await SystemUpdate.mergeDetail(updateId, {
    rollbackRequestedAt: new Date().toISOString(),
    rollbackRequestedBy: actor ? actor.username : null,
    rollbackTriggered: true,
  });
  log.warn({ updateId, previousDigest }, '[updateApplier] rollback triggered');
  return { triggered: true, command, previousDigest, update: row };
}

/**
 * Post-boot verification: did the update we triggered actually land?
 *
 * Runs at boot (after migrations, before listen) and again on every checker
 * tick — the tick is what lets the grace period expire on an instance whose new
 * image never booted, because in that case the OLD container is still running
 * and will never see another boot.
 *
 * @returns {Promise<{outcome:string, update?:object}>}
 *   outcome ∈ nothing-pending | applied | still-waiting | failed
 */
async function verifyPendingUpdate({ build = buildInfo, now = new Date(), graceMs = VERIFY_GRACE_MS, log = baseLogger } = {}) {
  const pending = await SystemUpdate.currentApplying();
  if (!pending) return { outcome: 'nothing-pending' };

  if (build.version === pending.version) {
    const row = await SystemUpdate.markApplied(pending.id);
    log.info({ updateId: pending.id, version: pending.version }, '[updateApplier] update verified — this instance is running the new release');
    return { outcome: 'applied', update: row };
  }

  const startedAt = new Date(pending.updated_at).getTime();
  if (now.getTime() - startedAt < graceMs) {
    return { outcome: 'still-waiting', update: pending };
  }

  const row = await SystemUpdate.markFailed(
    pending.id,
    `still running ${build.version} more than ${Math.round(graceMs / 60000)} minutes after the deployment was triggered`,
    { failedAt: now.toISOString(), stage: 'verify', observedVersion: build.version }
  );
  log.error(
    { updateId: pending.id, expected: pending.version, running: build.version },
    '[updateApplier] update did NOT land — the instance is still on the old release'
  );
  return { outcome: 'failed', update: row };
}

/**
 * Fire any auto-mode update whose scheduled slot has arrived. Called from the
 * checker tick, so "the window opened" is observed by the same loop that
 * discovered the update — no second scheduler.
 */
async function runDueScheduled({ settings = null, now = new Date(), fetchImpl = globalThis.fetch, log = baseLogger } = {}) {
  const cfg = settings || await getSelfUpdateSettings();
  if (!isAuto(cfg.mode)) return { fired: [] };

  const candidate = await SystemUpdate.latestActionable(cfg.channel);
  if (!candidate || candidate.status !== 'scheduled') return { fired: [] };

  const due = candidate.detail && candidate.detail.scheduledFor;
  if (!due || new Date(due).getTime() > now.getTime()) return { fired: [] };

  try {
    const row = await applyUpdate(candidate.id, { settings: cfg, fetchImpl, log, reason: 'auto' });
    return { fired: [row] };
  } catch (err) {
    log.error({ err: err.message, updateId: candidate.id }, '[updateApplier] scheduled update could not be applied');
    return { fired: [], error: err.message };
  }
}

module.exports = {
  applyUpdate, rollbackUpdate, verifyPendingUpdate, runDueScheduled,
  runningImageDigest, fireTrigger,
  UpdateNotPermittedError, UpdateStateError, TriggerNotConfiguredError,
  VERIFY_GRACE_MS,
};
