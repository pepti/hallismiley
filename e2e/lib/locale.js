// The visitor-default locale for the Playwright suite — the e2e face of
// tests/lib/locale.js. A spec that reads the SPA's copy asserts
// `tClient('signup.passwordsMatch')`, the exact string of the visitor default
// (identity.locale.publicDefault under the PUBLIC_DEFAULT_LOCALE env var),
// never an Icelandic literal — so the engine's spec passes unchanged in a
// downstream whose default is English.
module.exports = require('../../tests/lib/locale');
