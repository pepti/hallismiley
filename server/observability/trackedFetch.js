'use strict';

// fetch() with Application Insights dependency tracking.
//
// The classic `applicationinsights` SDK instruments Node's http/https and pg,
// but NOT undici's global fetch — so every outbound call this app makes
// (Regla SOAP/REST, Microsoft Graph mail, OAuth userinfo, the alert webhook,
// the Anthropic SDK) was invisible: 30 days of PROD `dependencies` were 100 %
// Postgres while eight Regla 502s went undiagnosed. See
// docs/LOGGING-AUDIT-2026-09-05.md §2.3 / §2.4b.
//
// This is a thin wrapper: same signature as fetch plus a leading dependency
// name, same return value, same exceptions. Timeouts stay where they are
// (callers pass their own AbortSignal in `init`); only the outcome is
// recorded. Dark without a connection string (getClient() → null).
//
// ESLint forbids bare `fetch` under server/ so new call sites come through
// here (eslint.config.js, no-restricted-globals).

// Module reference (not destructured) so tests can spy on getClient.
const aiClient = require('./aiClient');

function targetOf(url) {
  try { return new URL(String(url)).host; } catch { return String(url); }
}

// Strip query strings before recording — OAuth and Graph URLs can carry
// tokens/codes, and `data` lands in a log store.
function dataOf(url) {
  try {
    const u = new URL(String(url));
    return `${u.origin}${u.pathname}`;
  } catch { return String(url).split('?')[0]; }
}

function resultCodeFor(err) {
  if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) return 'TIMEOUT';
  return 'NETWORK';
}

/**
 * @param {string} name   dependency name shown in App Insights, e.g. "Regla SOAP CreateInvoice"
 * @param {string|URL} url
 * @param {RequestInit} [init]
 * @param {{ data?: string }} [opts]  `data` overrides what is recorded as the
 *   dependency's URL. Use it when the PATH carries a secret (Slack/Discord
 *   webhook URLs embed their token in the path, not the query string) —
 *   pass the origin only.
 * @returns {Promise<Response>}
 */
async function trackedFetch(name, url, init, opts = {}) {
  const client = aiClient.getClient();
  // Resolve the global at call time so test doubles that replace global.fetch
  // keep working — never capture fetch at module load.
  // eslint-disable-next-line no-restricted-syntax -- the one real fetch; everything else goes through here
  if (!client) return globalThis.fetch(url, init);

  const start = Date.now();
  let resultCode = 'NETWORK';
  let success = false;
  try {
    // eslint-disable-next-line no-restricted-syntax -- the one real fetch; everything else goes through here
    const res = await globalThis.fetch(url, init);
    resultCode = String(res.status);
    success = res.ok;
    return res;
  } catch (err) {
    resultCode = resultCodeFor(err);
    throw err;
  } finally {
    try {
      client.trackDependency({
        target: targetOf(url),
        name,
        data: opts.data !== undefined ? String(opts.data) : dataOf(url),
        duration: Date.now() - start,
        resultCode,
        success,
        dependencyTypeName: 'HTTP',
        // The App Insights backend reclassifies .asmx/.svc URLs as type
        // "Web Service" and REPLACES `name` with the URL (verified on TEST
        // 2026-09-06: "Regla SOAP Login" arrived as the endpoint URL). Keep the
        // intended name where nothing rewrites it.
        properties: { dependencyName: name },
      });
    } catch {
      // Telemetry must never take the app down.
    }
  }
}

/**
 * A fetch-compatible function bound to one dependency name — for SDKs that
 * accept a custom `fetch` (the Anthropic client does).
 */
function fetchNamed(name) {
  return (url, init) => trackedFetch(name, url, init);
}

module.exports = { trackedFetch, fetchNamed, targetOf, dataOf, resultCodeFor };
