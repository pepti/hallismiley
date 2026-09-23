// The product identity for the e2e suite — the same seam the server resolves
// (server/config/clientConfig.js: schema defaults < config/client.json <
// CLIENT_CONFIG_* env) and hands to every page as <script id="identity">.
//
// Two readers:
//   • `identity`        — resolved in THIS process from the repo's
//                          config/client.json + env, available synchronously
//                          so a spec can decide at describe time (test.skip)
//                          which product-specific cases apply;
//   • `readIdentity()`  — what the server actually served to the page, read
//                          off the hand-off tag. The two agree unless the web
//                          server runs with a different CLIENT_CONFIG_* env.
//
// Specs assert against these, never against a brand literal, so the engine's
// e2e suite passes unchanged in a downstream that sets its own identity.
const { clientConfig } = require('../../server/config/clientConfig');
// The two route rules the specs need at describe time, read from the same
// modules the server serves with (identity-seam-3): a hidden route (company
// pages a downstream hides — the cases that click through them skip) and a
// locale-locked one (the party pages, `identity.routes[*].locale` — its URL
// carries that locale, whatever the visitor's).
const { isHiddenRoute } = require('../../server/config/publicSurface');
const { forcedLocaleFor } = require('../../server/config/i18n');

const identity = clientConfig.identity;

async function readIdentity(page) {
  return page.evaluate(() => {
    const el = document.getElementById('identity');
    return el ? JSON.parse(el.textContent) : null;
  });
}

// A regex-safe form of a string, for toHaveAttribute / toHaveTitle patterns.
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { identity, readIdentity, escapeRe, isHiddenRoute, forcedLocaleFor };
