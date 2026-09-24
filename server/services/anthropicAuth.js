'use strict';

// How the app authenticates to the Anthropic API — one place for every Claude
// feature (vision: order import, shelf check, products-import PDF reader;
// auto-translate).
//
// Two modes, chosen from the environment on every call:
//
//   workload_identity — no stored secret. The App Service's system-assigned
//     managed identity fetches an Entra token for our federation audience
//     (IDENTITY_ENDPOINT + IDENTITY_HEADER, which App Service injects into the
//     container; IMDS is NOT reachable on App Service), and the SDK exchanges
//     it at Anthropic's /v1/oauth/token (RFC 7523 jwt-bearer, the federation
//     rule decides which identity may act as which service account). The SDK's
//     own TokenCache holds the short-lived Anthropic token and re-exchanges
//     before expiry. Selected when ALL of ANTHROPIC_FEDERATION_RULE_ID,
//     ANTHROPIC_ORGANIZATION_ID and ANTHROPIC_WIF_AUDIENCE are set AND the
//     container has the managed-identity endpoint.
//
//   api_key — the static ANTHROPIC_API_KEY, the fallback while the federation
//     settings are not in place (and on a developer machine).
//
// Workload identity wins when both are configured, so the key can be removed
// only after a stack has been seen running on federation (selfCheck below
// logs which mode is live). Setup record: docs/azure-env.md § Anthropic.
//
// The federation rule id differs per identity — TEST, PROD production slot and
// PROD staging slot each have their own managed identity — so on PROD
// ANTHROPIC_FEDERATION_RULE_ID must be a SLOT setting (sticky), or a swap
// would hand the production slot the staging slot's rule.

const logger = require('../logger');
// App Insights dependency tracking for every token fetch (harvest-ice-f-2026-09-24;
// the global-fetch fallback this port carried until F landed is gone).
const { fetchNamed } = require('../observability/trackedFetch');

const MI_API_VERSION = '2019-08-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_AUTH_TIMEOUT_MS = 10000;
const WIF_VARS = ['ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_WIF_AUDIENCE'];
const CONTAINER_VARS = ['IDENTITY_ENDPOINT', 'IDENTITY_HEADER'];

const trimmed = (v) => String(v == null ? '' : v).trim();

function authTimeoutMs(env = process.env) {
  const raw = parseInt(env.ANTHROPIC_AUTH_TIMEOUT_MS, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AUTH_TIMEOUT_MS;
}

// Token acquisition happens INSIDE the SDK's request building, before the
// caller's abort signal is consulted, and the SDK's TokenCache makes every
// concurrent caller wait on the one in-flight refresh. An identity or token
// endpoint that accepts the connection and never answers would otherwise hold
// every Claude call on the instance for undici's ~300 s header timeout —
// past translate's 8 s budget (product saves await it) and vision's gate
// slots. So both token fetches carry their own bounded signal.
function boundedFetch(fetchImpl, ms) {
  return (url, init = {}) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetchImpl(url, { ...init, signal });
  };
}

function workloadIdentityConfigured(env = process.env) {
  return [...WIF_VARS, ...CONTAINER_VARS].every((k) => trimmed(env[k]));
}

// Federation was clearly MEANT (at least one of its settings is present) but
// is not complete → the names of what is missing (never values), else [].
function missingWorkloadIdentityVars(env = process.env) {
  if (!WIF_VARS.some((k) => trimmed(env[k]))) return [];
  return [...WIF_VARS, ...CONTAINER_VARS].filter((k) => !trimmed(env[k]));
}

/** 'workload_identity' | 'api_key' | null */
function authMode(env = process.env) {
  if (workloadIdentityConfigured(env)) return 'workload_identity';
  if (trimmed(env.ANTHROPIC_API_KEY)) return 'api_key';
  return null;
}

function isConfigured(env = process.env) {
  return authMode(env) !== null;
}

/**
 * An identity-token provider for the SDK: the App Service managed identity's
 * Entra access token for `resource` (our federation audience, api://<app id>).
 * Fetched on every exchange — the SDK only calls it when its Anthropic token
 * needs renewing, and App Service caches the Entra token itself.
 */
function azureManagedIdentityTokenProvider({ endpoint, header, resource, fetchImpl }) {
  return async () => {
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${endpoint}${sep}api-version=${MI_API_VERSION}&resource=${encodeURIComponent(resource)}`;
    const res = await fetchImpl(url, { headers: { 'X-IDENTITY-HEADER': header } });
    if (!res.ok) {
      // The body is Azure's error JSON (no token material on failure); keep it short.
      const text = await res.text().catch(() => '');
      throw new Error(`managed identity token request failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    const body = await res.json().catch(() => null);
    if (!body || typeof body.access_token !== 'string' || !body.access_token) {
      throw new Error('managed identity token response had no access_token');
    }
    return body.access_token;
  };
}

/**
 * The auth half of `new Anthropic({...})` for the current mode, or null when
 * nothing is configured. `name` labels the calls in App Insights.
 *
 * In workload-identity mode apiKey AND authToken are passed as null on
 * purpose: left undefined, the SDK reads ANTHROPIC_API_KEY from the
 * environment, and an api key wins over `credentials`.
 */
function clientAuthOptions({ env = process.env, name = 'Anthropic' } = {}) {
  const mode = authMode(env);
  if (mode === 'api_key') return { apiKey: trimmed(env.ANTHROPIC_API_KEY) };
  if (mode !== 'workload_identity') return null;

  const { oidcFederationProvider } = require('@anthropic-ai/sdk/lib/credentials/oidc-federation.js');
  const credentials = oidcFederationProvider({
    identityTokenProvider: azureManagedIdentityTokenProvider({
      endpoint: trimmed(env.IDENTITY_ENDPOINT),
      header: trimmed(env.IDENTITY_HEADER),
      resource: trimmed(env.ANTHROPIC_WIF_AUDIENCE),
      fetchImpl: boundedFetch(fetchNamed('Azure managed identity token'), authTimeoutMs(env)),
    }),
    federationRuleId: trimmed(env.ANTHROPIC_FEDERATION_RULE_ID),
    organizationId: trimmed(env.ANTHROPIC_ORGANIZATION_ID),
    serviceAccountId: trimmed(env.ANTHROPIC_SERVICE_ACCOUNT_ID) || undefined,
    workspaceId: trimmed(env.ANTHROPIC_WORKSPACE_ID) || undefined,
    baseURL: trimmed(env.ANTHROPIC_BASE_URL) || DEFAULT_BASE_URL,
    fetch: boundedFetch(fetchNamed(`${name} token exchange`), authTimeoutMs(env)),
  });
  return { apiKey: null, authToken: null, credentials };
}

/**
 * A string that changes whenever the auth configuration does — callers cache
 * their client on it (a key rotation or a switch to federation rebuilds it).
 */
function authSignature(env = process.env) {
  const mode = authMode(env);
  if (mode === 'api_key') return `key:${trimmed(env.ANTHROPIC_API_KEY)}`;
  if (mode === 'workload_identity') {
    return ['wif', env.ANTHROPIC_FEDERATION_RULE_ID, env.ANTHROPIC_ORGANIZATION_ID,
      env.ANTHROPIC_SERVICE_ACCOUNT_ID, env.ANTHROPIC_WORKSPACE_ID, env.ANTHROPIC_WIF_AUDIENCE]
      .map(trimmed).join('|');
  }
  return '';
}

/**
 * Boot-time proof of which mode is live. In workload-identity mode it runs the
 * whole chain once — managed-identity token → Anthropic exchange → one cheap
 * authenticated call (models.list, no tokens billed) — and logs the outcome:
 * info on success (console log stream), warn on failure (also App Insights
 * traces). Never throws, never blocks startup, never logs a token.
 * `makeClient` is injectable for tests.
 */
async function selfCheck({ env = process.env, makeClient } = {}) {
  const mode = authMode(env);
  // A half-configured federation silently falls back (to the key, or to off),
  // which is exactly when an operator believes it is live. Say so at warn, so
  // it reaches App Insights traces, naming the missing settings only.
  const missing = missingWorkloadIdentityVars(env);
  if (missing.length) {
    logger.warn({ anthropicAuth: mode || 'none', missing },
      `[anthropic] workload identity settings are incomplete — using ${mode === 'api_key' ? 'the static API key' : 'NO credentials'} instead`);
  }
  const featuresOn = env.VISION_ENABLED === 'true' || env.TRANSLATE_ENABLED === 'true';
  if (!mode) {
    const fields = { anthropicAuth: 'none', visionEnabled: env.VISION_ENABLED === 'true', translateEnabled: env.TRANSLATE_ENABLED === 'true' };
    if (featuresOn) logger.warn(fields, '[anthropic] no credentials configured but Claude features are switched on — they stay off');
    else logger.info(fields, '[anthropic] no credentials configured — Claude features stay off');
    return { mode: null, ok: false, missing };
  }
  if (mode === 'api_key') {
    logger.info({ anthropicAuth: 'api_key' }, '[anthropic] authenticating with the static API key');
    return { mode, ok: true, checked: false, missing };
  }
  const started = Date.now();
  try {
    const client = makeClient ? makeClient(clientAuthOptions({ env, name: 'Anthropic self-check' })) : (() => {
      const AnthropicMod = require('@anthropic-ai/sdk');
      const Ctor = AnthropicMod.default || AnthropicMod.Anthropic || AnthropicMod;
      return new Ctor({ ...clientAuthOptions({ env, name: 'Anthropic self-check' }), maxRetries: 0, timeout: 20000, fetch: fetchNamed('Anthropic models (self-check)') });
    })();
    await client.models.list({ limit: 1 });
    logger.info({ anthropicAuth: 'workload_identity', ok: true, ms: Date.now() - started },
      '[anthropic] workload identity OK — managed identity exchanged for an Anthropic token');
    return { mode, ok: true, checked: true, missing };
  } catch (err) {
    logger.warn({
      anthropicAuth: 'workload_identity', ok: false, ms: Date.now() - started,
      status: err && (err.status || err.statusCode) ? (err.status || err.statusCode) : null,
      error: String((err && err.message) || err).slice(0, 500),
    }, '[anthropic] workload identity FAILED — Claude calls will fail until fixed (the static key is NOT used while federation settings are present)');
    return { mode, ok: false, checked: true, missing };
  }
}

module.exports = {
  authMode,
  isConfigured,
  clientAuthOptions,
  authSignature,
  selfCheck,
  // exported for tests
  _internal: { azureManagedIdentityTokenProvider, workloadIdentityConfigured, missingWorkloadIdentityVars, boundedFetch, authTimeoutMs },
};
