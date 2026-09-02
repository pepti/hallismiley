// UI themes — the server-side mirror of the client theme list.
//
// The canonical set lives in three places that MUST stay in sync:
//   • public/css/themes.css        — the token sets per html[data-theme]
//   • public/js/services/themePrefs.js + public/js/theme-boot.js — client list
//   • this file + the users.theme CHECK constraint (migration 083_user_theme)
//
// users.theme is NULLABLE and has NO column default: NULL means "this account
// has never picked a theme", which is deliberately distinct from 'classic'
// (the :root default, and the value meaning "no data-theme attribute on
// <html>"). Server code must handle a NULL theme — every account has one until
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
const THEMES = ['classic', 'ember', 'midnight'];

module.exports = { THEMES };
