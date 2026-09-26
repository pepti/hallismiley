'use strict';

/**
 * Process-wide cap on concurrent PAID AI calls (Anthropic).
 *
 * Ported from icelandicstore #218 (server/services/visionGate.js), generalised
 * from ice's three vision endpoints to every Claude call this engine makes.
 * Each in-flight call holds its request payload, the SDK's serialised copies
 * and a socket for up to its timeout; on the 1.75 GB B1/S1 App Service tiers
 * an unbounded fan-out is real memory pressure — and real spend. It is
 * resource protection, not a usage budget: it only bites while AI_MAX_CONCURRENT
 * calls are literally mid-flight. (ice's owner decision stands: no per-IP rate
 * limit on these paths — staff must never hit a 429 budget mid-workflow.)
 *
 * Two ways to hold a slot, both releasing in a `finally` so a failure cannot
 * leak one:
 *
 *   withSlot(fn)            request-path callers: over the cap it throws
 *                           AiBusyError, which the central error middleware
 *                           answers 429 + Retry-After in the standard envelope.
 *   withQueuedSlot(fn, {waitMs})
 *                           background / fan-out callers (the translator's
 *                           parallel batches): waits FIFO for a slot up to
 *                           waitMs, then throws AiBusyError. The translator
 *                           catches it like any other failure and leaves the
 *                           target locale empty — its never-throw contract holds.
 *
 * ice's shutdown handshake (refuse new calls on SIGTERM, stretch the force-exit
 * grace to the vision timeout) is NOT ported: the engine's only AI calls are
 * bounded by TRANSLATE_TIMEOUT_MS (8 s default), inside server.js's 10 s grace.
 * Port it with the first AI call that can outlive that grace.
 */

const DEFAULT_MAX_CONCURRENT = 4;
const RETRY_AFTER_SECONDS = 15;

class AiBusyError extends Error {
  constructor(message = 'AI is busy with other requests') {
    super(message);
    this.name = 'AiBusyError';
    this.status = 429;
    // Read by middleware/errorHandler.js: the Retry-After header, the
    // localised message and the envelope's `reason`.
    this.retryAfterSeconds = RETRY_AFTER_SECONDS;
    this.messageKey = 'errors.ai.busy';
    this.reason = 'AI_BUSY';
  }
}

let inFlightCount = 0;
const waiters = []; // FIFO of { grant, timer }

function maxConcurrent() {
  const raw = parseInt(process.env.AI_MAX_CONCURRENT, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_CONCURRENT;
}

/** Claim a slot if one is free. true = claimed (pair with release()). */
function tryAcquire() {
  if (inFlightCount >= maxConcurrent()) return false;
  inFlightCount += 1;
  return true;
}

/** Give a slot back — straight to the longest waiter when there is one. */
function release() {
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.grant(); // the slot changes hands; the count stays the same
    return;
  }
  if (inFlightCount > 0) inFlightCount -= 1;
}

function inFlight() {
  return inFlightCount;
}

function queued() {
  return waiters.length;
}

/** Run fn in a slot, or throw AiBusyError at once when none is free. */
async function withSlot(fn) {
  if (!tryAcquire()) throw new AiBusyError();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Resolve once a slot is held; reject with AiBusyError after waitMs. */
function waitForSlot(waitMs) {
  if (tryAcquire()) return Promise.resolve();
  if (!(waitMs > 0)) return Promise.reject(new AiBusyError());
  return new Promise((resolve, reject) => {
    const entry = { grant: resolve, timer: null };
    entry.timer = setTimeout(() => {
      const i = waiters.indexOf(entry);
      if (i !== -1) waiters.splice(i, 1);
      reject(new AiBusyError());
    }, waitMs);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
    waiters.push(entry);
  });
}

/** Run fn in a slot, waiting up to waitMs for one to free up. */
async function withQueuedSlot(fn, { waitMs = 0 } = {}) {
  await waitForSlot(waitMs);
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Test-only: clear the counter and drop any waiters. */
function _reset() {
  inFlightCount = 0;
  while (waiters.length) clearTimeout(waiters.shift().timer);
}

module.exports = {
  AiBusyError,
  DEFAULT_MAX_CONCURRENT,
  RETRY_AFTER_SECONDS,
  maxConcurrent,
  tryAcquire,
  release,
  inFlight,
  queued,
  withSlot,
  withQueuedSlot,
  _reset,
};
