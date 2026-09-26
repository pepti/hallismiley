'use strict';

// Limits around "Read with AI" in the products import — the COST GATE. Ported
// from icelandicstore #306 (server/services/productImport/aiLimits.js), with the
// engine's budgets: per request, per file, per user per day and per instance
// per day, plus a sub-cap on the shared AI gate (services/aiGate.js). Kept
// apart from the extraction so the route can refuse cheaply — before an upload
// is buffered or a paid call is made.
//
// SHIPS DARK: PRODUCT_IMPORT_AI_ENABLED must be exactly 'true' AND Claude
// credentials must be configured (services/anthropicAuth.js). Every page read
// is billed by Anthropic, so the budgets below are what bound the bill:
//
//   PRODUCT_IMPORT_AI_MAX_PAGES        pages in ONE request (a chunk), default 10
//   PRODUCT_IMPORT_AI_CHUNK_PAGES      what the client is told to send, default 3
//   PRODUCT_IMPORT_AI_MAX_FILE_PAGES   pages of ONE file the client may send, default 40
//   PRODUCT_IMPORT_AI_USER_DAY_PAGES   pages per user per UTC day, default 60
//   PRODUCT_IMPORT_AI_DAY_PAGES        pages per instance per UTC day, default 200
//   PRODUCT_IMPORT_AI_MAX_CONCURRENT   of the aiGate slots, default 2
//
// The client splits a long PDF into chunks and sends them one request at a
// time (public/js/utils/aiPdfChunks.js). The server cannot tie those requests
// to one file, so the per-file cap is checked on the chunk's page range and
// the DAILY budgets are what bound a whole file — and a user who keeps
// re-sending. Pages are counted server-side (pdf-parse), never trusted from
// the client. In memory, per container: a restart forgets the day's count
// (a spend guard, not an audit record — the log line of every read is the
// audit, and Anthropic's console is the bill).

const anthropicAuth = require('../anthropicAuth');
const aiGate = require('../aiGate');

const DEFAULTS = {
  maxPages: 10, chunkPages: 3, maxFilePages: 40, userDayPages: 60, dayPages: 200, maxConcurrent: 2,
};

const intEnv = (name, fallback) => {
  const raw = parseInt(process.env[name], 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

// Its own flag AND the credentials. TRANSLATE_ENABLED being on must never
// switch this on.
function isEnabled() {
  return process.env.PRODUCT_IMPORT_AI_ENABLED === 'true' && anthropicAuth.isConfigured();
}
const maxPages = () => intEnv('PRODUCT_IMPORT_AI_MAX_PAGES', DEFAULTS.maxPages);
const chunkPages = () => Math.min(intEnv('PRODUCT_IMPORT_AI_CHUNK_PAGES', DEFAULTS.chunkPages), maxPages());
const maxFilePages = () => intEnv('PRODUCT_IMPORT_AI_MAX_FILE_PAGES', DEFAULTS.maxFilePages);
const userDayPages = () => intEnv('PRODUCT_IMPORT_AI_USER_DAY_PAGES', DEFAULTS.userDayPages);
const dayPages = () => intEnv('PRODUCT_IMPORT_AI_DAY_PAGES', DEFAULTS.dayPages);
const maxConcurrent = () => intEnv('PRODUCT_IMPORT_AI_MAX_CONCURRENT', DEFAULTS.maxConcurrent);

// ── daily page budgets (in memory, per container, UTC day) ─────────────────
let day = null;
let instanceUsed = 0;
const userUsed = new Map(); // userId → pages today

function roll(now) {
  const d = new Date(now).toISOString().slice(0, 10);
  if (d !== day) { day = d; instanceUsed = 0; userUsed.clear(); }
}

/** Pages this user may still read today (the smaller of both budgets). */
function remainingPages(userId, now = Date.now()) {
  roll(now);
  const mine = userUsed.get(String(userId)) || 0;
  return Math.max(0, Math.min(userDayPages() - mine, dayPages() - instanceUsed));
}

/** Charge `pages` if they fit → a charge token (for refundPages), or null. */
function chargePages(userId, pages, now = Date.now()) {
  if (remainingPages(userId, now) < pages) return null;
  const id = String(userId);
  userUsed.set(id, (userUsed.get(id) || 0) + pages);
  instanceUsed += pages;
  return { userId: id, pages, day };
}

/** Give a charge back — a FAILED model call, so the client's one retry of the
 *  chunk does not cost it twice. Never after a successful read. */
function refundPages(charge) {
  if (!charge || charge.day !== day) return;
  userUsed.set(charge.userId, Math.max(0, (userUsed.get(charge.userId) || 0) - charge.pages));
  instanceUsed = Math.max(0, instanceUsed - charge.pages);
}

/** Seconds until the UTC day rolls over (Retry-After for a spent budget). */
function secondsUntilReset(now = Date.now()) {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

// ── sub-cap on the shared AI gate ──────────────────────────────────────────
// The product import may hold at most maxConcurrent() of aiGate's slots, so a
// burst of PDF chunks can never starve the translator or another Claude call.
let inFlight = 0;

/** true = a slot is held (pair with release() in a finally). */
function acquire() {
  if (inFlight >= maxConcurrent()) return false;
  if (!aiGate.tryAcquire()) return false;
  inFlight += 1;
  return true;
}

function release() {
  if (inFlight > 0) {
    inFlight -= 1;
    aiGate.release();
  }
}

function _reset() {
  day = null; instanceUsed = 0; userUsed.clear(); inFlight = 0;
}

module.exports = {
  isEnabled, maxPages, chunkPages, maxFilePages, userDayPages, dayPages, maxConcurrent,
  remainingPages, chargePages, refundPages, secondsUntilReset,
  acquire, release, inFlight: () => inFlight,
  DEFAULTS, _reset,
};
