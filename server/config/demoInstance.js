'use strict';
// Is this the DEMO instance? (R2b, D-020 — demo.rekstrarkerfi.is.)
//
// A demo instance is a normal instance of a product whose data is sample data
// (the product's seed, server/demo/seed.js) and is thrown away every night and
// on request (services/demoReset.js). While it is one:
//   - no email leaves it, payments are off and MCP is off, whatever the env
//     says (a stray RESEND_API_KEY / STRIPE_SECRET_KEY / MCP_ENABLED must not
//     make sample data talk to the world);
//   - robots.txt disallows everything and every response says noindex;
//   - every page carries a slim banner (<html data-demo-instance>).
//
// Not to be confused with the per-browser "demo mode" of the TEST chrome
// (public/js/services/themePrefs.js getDemoMode), which only hides the TEST
// badge for a screen-share. That one is cosmetic; this one owns the data.
//
// Read per call, not cached, so a test can flip it (like config/instanceRole.js).

function isDemoInstance() {
  return String(process.env.DEMO_INSTANCE || '').trim().toLowerCase() === 'true';
}

// The nightly reset, in UTC (Iceland is UTC all year). 0–23; default 02:00 —
// before the self-update maintenance window (clientConfig.js: 03–05), so a
// reset never races an image swap.
function demoResetHourUtc() {
  const h = Number.parseInt(process.env.DEMO_RESET_HOUR_UTC ?? '2', 10);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 2;
}

// The next reset after `now`, as a Date.
function nextResetAt(now = new Date()) {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), demoResetHourUtc(), 0, 0));
  if (at <= now) at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

// The attributes for <html> (ssrMeta), '' when this is not a demo instance.
// The banner reads them; no request is needed to know.
function demoHtmlAttrs() {
  if (!isDemoInstance()) return '';
  return ` data-demo-instance="true" data-demo-reset-hour="${demoResetHourUtc()}"`;
}

module.exports = { isDemoInstance, demoResetHourUtc, nextResetAt, demoHtmlAttrs };
