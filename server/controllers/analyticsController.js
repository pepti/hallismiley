// First-party analytics endpoints.
//   collect            — PUBLIC, anonymous beacon. Records one page view.
//   summary/timeseries/topPages/topReferrers/devices/conversions — ADMIN only.
//
// The collect handler is fire-and-forget: it responds 204 immediately and never
// surfaces a failure to the visitor (analytics must never break a page or spam
// Sentry). All stored data is anonymous — see server/services/analyticsSalt.js.
const logger = require('../logger');
const { PageView, AnalyticsEvent } = require('../models/Analytics');
const { visitorToken, parseUserAgent } = require('../services/analyticsSalt');

const LOCALES = ['en', 'is'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function _coerceLocale(value, fallback) {
  if (typeof value === 'string' && LOCALES.includes(value)) return value;
  if (LOCALES.includes(fallback)) return fallback;
  return 'unknown';
}

// Reduce a referrer URL to its host: '' → null (shown as 'direct'),
// same-origin → 'internal', otherwise the bare hostname. Never stores query
// strings (which can carry PII).
function _referrerHost(ref, reqHost) {
  if (!ref || typeof ref !== 'string') return null;
  try {
    const host = new URL(ref).hostname.toLowerCase();
    if (!host) return null;
    if (reqHost && host === String(reqHost).toLowerCase()) return 'internal';
    return host.slice(0, 255);
  } catch {
    return null;
  }
}

// Inclusive date range from ?from / ?to, validated as YYYY-MM-DD, defaulting to
// the last 30 days. Invalid input silently falls back to the default.
function _range(req) {
  const to = DATE_RE.test(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10);
  const from = DATE_RE.test(req.query.from)
    ? req.query.from
    : new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

// ── PUBLIC ────────────────────────────────────────────────────────────────────

async function collect(req, res) {
  // Respond first — the visitor never waits on, or learns about, our insert.
  res.status(204).end();

  try {
    const body = req.body || {};
    const path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!path.startsWith('/') || path.length > 512) return; // garbage / non-app path — drop silently

    const ua = req.headers['user-agent'] || '';
    const { device, browser, os } = parseUserAgent(ua, body.screen);

    await PageView.record({
      path,
      referrer_host: _referrerHost(body.ref, req.hostname),
      device,
      browser,
      os,
      locale: _coerceLocale(body.locale, req.locale),
      visitor_token: visitorToken(req.ip, ua),
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'analytics collect insert failed');
  }
}

// ── ADMIN ───────────────────────────────────────────────────────────────────

async function summary(req, res, next) {
  try {
    const { from, to } = _range(req);
    res.json(await PageView.summary(from, to));
  } catch (err) { next(err); }
}

async function timeseries(req, res, next) {
  try {
    const { from, to } = _range(req);
    res.json(await PageView.timeseries(from, to));
  } catch (err) { next(err); }
}

async function topPages(req, res, next) {
  try {
    const { from, to } = _range(req);
    res.json(await PageView.topPages(from, to));
  } catch (err) { next(err); }
}

async function topReferrers(req, res, next) {
  try {
    const { from, to } = _range(req);
    res.json(await PageView.topReferrers(from, to));
  } catch (err) { next(err); }
}

async function devices(req, res, next) {
  try {
    const { from, to } = _range(req);
    res.json(await PageView.devices(from, to));
  } catch (err) { next(err); }
}

async function conversions(req, res, next) {
  try {
    const { from, to } = _range(req);
    res.json(await AnalyticsEvent.byType(from, to));
  } catch (err) { next(err); }
}

module.exports = { collect, summary, timeseries, topPages, topReferrers, devices, conversions };
