// UI themes — the server-side mirror of the client theme list.
//
// The canonical set lives in three places that MUST stay in sync:
//   • public/css/themes.css        — the token sets per html[data-theme]
//   • public/js/services/themePrefs.js + public/js/theme-boot.js — client list
//   • this file + the users.theme CHECK constraint (migration 081_user_theme)
//
// users.theme is NULLABLE and has NO column default: NULL means "this account
// has never picked a theme", which is deliberately distinct from 'classic'
// (the :root default, and the value meaning "no data-theme attribute on
// <html>"). Server code must handle a NULL theme — every account has one until
// the user opens a picker. Adding a theme needs a new migration to widen the
// CHECK constraint.
const THEMES = ['classic', 'glacier', 'moss', 'lava', 'aurora', 'black-sand'];

module.exports = { THEMES };
