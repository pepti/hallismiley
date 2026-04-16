// Facebook OAuth 2.0 client backed by Arctic (ESM-only, loaded via dynamic import).
// Mirrors ./google.js — the rest of the project is CommonJS, so we cache the
// imported module and the instantiated Facebook client after the first call.
// Facebook OAuth does NOT use PKCE (Arctic's Facebook provider has no
// generateCodeVerifier), so only `state` is needed for CSRF defense.

let _cache = null;

async function loadArctic() {
  if (_cache) return _cache;

  const arctic = await import('arctic');
  const client = new arctic.Facebook(
    process.env.FACEBOOK_APP_ID,
    process.env.FACEBOOK_APP_SECRET,
    process.env.FACEBOOK_REDIRECT_URI,
  );

  _cache = {
    client,
    generateState: arctic.generateState,
  };
  return _cache;
}

/** True when all three FACEBOOK_* env vars are populated. */
function isConfigured() {
  return !!(
    process.env.FACEBOOK_APP_ID &&
    process.env.FACEBOOK_APP_SECRET &&
    process.env.FACEBOOK_REDIRECT_URI
  );
}

module.exports = { loadArctic, isConfigured };
