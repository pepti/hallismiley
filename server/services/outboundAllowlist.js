'use strict';

// ── Outbound fetch allowlist (SSRF guard) ────────────────────────────────────
//
// The self-update plan assumed this codebase already had an SSRF allowlist for
// outbound fetches. It did not — every existing outbound call goes to a
// hardcoded provider URL (Resend, Stripe, IndexNow, Anthropic), so nothing ever
// needed one. The update checker is the first outbound call whose URL comes
// from configuration, which is precisely the shape that needs a gate: config is
// editable, and "fetch this URL and act on what it says" is the SSRF template.
//
// The gate is deliberately strict and deny-by-default:
//   • https only — the manifest names the image digest we will run; plaintext
//     would let anyone on the path choose that digest
//   • host must be on the allowlist, matched exactly (no suffix matching: an
//     attacker registering evil-releases.orangesmiley.is.example.com must not
//     pass a naive endsWith check)
//   • no IP literals, no credentials in the URL, default ports only
//   • redirects are never followed by callers (redirect: 'manual'), because a
//     302 is a way off the allowlist
//
// Extending the list is a deployment decision, not a runtime one: it comes from
// OUTBOUND_ALLOWED_HOSTS, an env var, and is read on every call so tests and
// operators can change it without a restart-shaped code path.

const { clientConfig } = require('../config/clientConfig');

class OutboundBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OutboundBlockedError';
    this.status = 502;   // a blocked fetch is an upstream problem, not the caller's
  }
}

/** Hosts this instance may fetch from. Built fresh per call — env is live. */
function allowedHosts() {
  const hosts = new Set();

  // The configured manifest host is allowed by construction: it is the whole
  // point of the config key, and an operator who edits it has already been
  // trusted with the deployment. The remaining checks (https, no IP literals)
  // still apply to it.
  try {
    const configured = clientConfig.modules.selfUpdate.manifestUrl.replace(/\{channel\}/g, 'stable');
    hosts.add(new URL(configured).hostname.toLowerCase());
  } catch { /* a malformed configured URL simply contributes no host */ }

  for (const raw of String(process.env.OUTBOUND_ALLOWED_HOSTS || '').split(',')) {
    const host = raw.trim().toLowerCase();
    if (host) hosts.add(host);
  }
  return hosts;
}

// Bare IPv4/IPv6 literals never belong in a manifest URL, and they are how SSRF
// reaches link-local metadata endpoints (169.254.169.254) and internal ranges.
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Throw unless `rawUrl` is a URL this instance is permitted to fetch.
 * @returns {URL} the parsed, permitted URL
 */
function assertAllowedUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new OutboundBlockedError('outbound URL is not a valid URL');
  }

  if (url.protocol !== 'https:') {
    throw new OutboundBlockedError(`outbound URL must use https (got ${url.protocol.replace(':', '') || 'nothing'})`);
  }
  if (url.username || url.password) {
    throw new OutboundBlockedError('outbound URL must not carry credentials');
  }
  if (url.port && url.port !== '443') {
    throw new OutboundBlockedError(`outbound URL must use the default https port (got ${url.port})`);
  }

  const host = url.hostname.toLowerCase();
  if (IPV4_RE.test(host) || host.startsWith('[')) {
    throw new OutboundBlockedError('outbound URL must name a host, not an IP address');
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new OutboundBlockedError('outbound URL must not target localhost');
  }
  if (!allowedHosts().has(host)) {
    throw new OutboundBlockedError(`outbound host ${host} is not on the allowlist`);
  }
  return url;
}

/** Non-throwing form, for callers that want to branch rather than catch. */
function isAllowedUrl(rawUrl) {
  try { assertAllowedUrl(rawUrl); return true; } catch { return false; }
}

module.exports = { assertAllowedUrl, isAllowedUrl, allowedHosts, OutboundBlockedError };
