'use strict';
// Upload volume alerting — DETECTION, never prevention.
//
// Standing product decision (Halli, 2026-09-01): a large upload must always be
// allowed to finish. Throttling one is a broken-product experience — an admin
// drops a folder of stills and the batch dies half-way through with a 429. So
// POST /api/v1/admin/background/media is carved out of the global limiter in
// app.js, and this module replaces that backstop with a signal instead of a
// refusal: when a single admin's upload burst crosses a threshold, we record a
// warn row that surfaces in Admin -> Monitoring. The upload still completes.
//
// What actually gates this route is requireAuth + requireView('background') +
// CSRF. Those are the access control; the limiter never was.
//
// The counter is per-process and in memory on purpose. It drives a notification,
// not a decision, so a reset on restart or a second instance counting its own
// share costs us a slightly late alert and nothing else — which is the right
// trade to avoid putting a write on the hot path of every uploaded file.
const EventLog = require('../models/EventLog');

const WINDOW_MS = 15 * 60 * 1000;

// Every Nth upload inside the window raises one alert, so a genuinely huge batch
// escalates (200, 400, 600...) instead of firing once and going quiet.
function threshold() {
  const raw = Number(process.env.BG_UPLOAD_ALERT_THRESHOLD);
  return Number.isInteger(raw) && raw > 0 ? raw : 200;
}

// userId -> { windowStart, count, lastAlertedAt }
const bursts = new Map();

function reset() {
  bursts.clear();
}

// Drop windows nobody has touched in a while so a long-lived process does not
// accumulate a row per admin that ever uploaded.
function sweep(now) {
  for (const [key, burst] of bursts) {
    if (now - burst.windowStart > WINDOW_MS) bursts.delete(key);
  }
}

/**
 * Count one uploaded file and alert if the burst is large. Never throws and
 * never blocks — callers are in the success path of a request that has already
 * been accepted, and a failure here must not fail the upload.
 */
async function recordUpload({ userId, username = null, path = null, requestId = null } = {}) {
  try {
    const key = userId == null ? 'anonymous' : String(userId);
    const now = Date.now();
    sweep(now);

    let burst = bursts.get(key);
    if (!burst || now - burst.windowStart > WINDOW_MS) {
      burst = { windowStart: now, count: 0, lastAlertedAt: 0 };
      bursts.set(key, burst);
    }
    burst.count += 1;

    const step = threshold();
    if (burst.count % step !== 0) return null;

    burst.lastAlertedAt = now;
    const minutes = Math.max(1, Math.round((now - burst.windowStart) / 60000));
    return await EventLog.record({
      source: 'server',
      level: 'warn',
      message: `Large upload burst: ${burst.count} files in ~${minutes} min`,
      path,
      userId,
      username,
      requestId,
      context: {
        kind: 'upload_volume',
        files: burst.count,
        windowMinutes: minutes,
        threshold: step,
        // Say so explicitly: a reader of Monitoring must not mistake this row
        // for something that stopped the user.
        action: 'allowed',
      },
    });
  } catch {
    return null;   // alerting must never break an upload
  }
}

module.exports = { recordUpload, reset, WINDOW_MS };
