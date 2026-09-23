// UI themes — the server-side reader of the product's theme set.
//
// The SET is `identity.theme.picker` in config/client.json (defaults in
// server/config/clientConfig.js). ssrMeta.js hands the same list to the
// browser on <html data-theme-picker>, which theme-boot.js and themePrefs.js
// read — so the four readers cannot disagree. What still has to match by hand
// is public/css/themes.css: every id in the picker needs a token set there
// (the users.theme CHECK constraint of 083 was dropped by 106 so a product can
// add ids without an engine migration).
//
// users.theme is NULLABLE and has NO column default: NULL means "this account
// has never picked a theme", which is deliberately distinct from 'classic'
// (the :root token set — "no data-theme attribute on <html>" — which since
// 2026-09-02 is NOT the visitor default: that is 'ember', chosen client-side
// in themePrefs.js/theme-boot.js; the server has no default of its own). Server code must handle a NULL theme — every account has one until
// the user opens a picker. Adding a theme needs a new migration to widen the
// CHECK constraint (084_user_theme_widen is the worked example; read the
// WARNING on 083 before writing another one).
//
// 'classic' is BJART, the light default, since 2026-08-20 — the id outlived
// the palette it was named for. See the header of public/css/themes.css.
//
// Cut from five to three on 2026-09-02 (Halli). 'light' and 'mono' are
// rejected here with the typed 400 like any unknown value; migration 094
// moved the accounts that had them to classic. The CHECK constraint still
// admits the old ids — invariant 14 says it narrows in a later release, after
// no running container can write them.
const { identity } = require('./identity');
const THEMES = identity.theme.picker.slice();

module.exports = { THEMES };
