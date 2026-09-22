'use strict';

// ── App environment: one definition ─────────────────────────────────────────
//
// "Which environment is this process in?" was answered independently in five
// places — the change-request gate, ssrMeta's <meta name="app-env"> stamp,
// the settings endpoint, the submit rate-limiter's skip, and the MCP env tag —
// with different rules. The review of PR #2 (2026-09-03) found two of them
// disagreeing on the same request: ssrMeta stamped a NODE_ENV=staging stack as
// "test" (so the widget mounted for every visitor) while the gate treated the
// same stack as live (so every submit 404ed). This module is the single
// answer; the consumers derive from it and cannot drift from each other.
//
// APP_ENV is the deployment's own label and wins when set; NODE_ENV is the
// fallback because on a deployed container it is always 'production'
// (Dockerfile bakes it), so a TEST stack is APP_ENV=test with
// NODE_ENV=production. Read per call, not at module load: the integration
// tests set APP_ENV at runtime, and a memoised value would silently pin
// whatever the first request saw.
//
// Only 'test' and 'development' are "not the live site". Anything else — an
// unset value, 'production', or a stack somebody named 'staging' — is live: a
// value the UI would never badge must not open the switch-free submit door.

const OPEN_ENVS = new Set(['test', 'development']);

function appEnv() {
  return process.env.APP_ENV || process.env.NODE_ENV || 'production';
}

// The test stack: admins get the change-request widget without the Admin →
// Feedback switch, the write limiters step aside, and the client shows admins
// the blue TEST chrome. One question, one answer.
function isTestStack() {
  return OPEN_ENVS.has(appEnv());
}

// What ssrMeta stamps for the client. The client (themePrefs.getEffectiveEnv)
// recognises exactly one value as the test stack — 'test' — so every env this
// module calls open is stamped as 'test', and everything else is stamped as
// itself, which the client treats as production. Client and gate therefore
// agree by construction.
function clientAppEnv() {
  return isTestStack() ? 'test' : appEnv();
}

module.exports = { appEnv, isTestStack, clientAppEnv, OPEN_ENVS };
