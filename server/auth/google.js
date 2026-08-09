// Google OAuth 2.0 client backed by Arctic (ESM-only, loaded via dynamic import).
// The rest of the project is CommonJS, so we cache the imported module and the
// instantiated Google client after the first call.

let _cache = null;

async function loadArctic() {
  if (_cache) return _cache;

  const arctic = await import('arctic');
  const client = new arctic.Google(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

  _cache = {
    client,
    generateState:        arctic.generateState,
    generateCodeVerifier: arctic.generateCodeVerifier,
  };
  return _cache;
}

/** True when all three GOOGLE_* env vars are populated. */
function isConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );
}

module.exports = { loadArctic, isConfigured };
