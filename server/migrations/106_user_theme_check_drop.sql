-- 106_user_theme_check_drop — reference copy. The runner reads server/config/schema.js,
-- not this file (invariant 4). D-021, 2026-09-22.
--
-- Every repo in the estate created users_theme_check with a different theme set,
-- and 084's unguarded DROP/ADD fails on any row holding a theme outside its own
-- list — a boot crash-loop the moment a downstream merges the engine. Theme ids
-- are product configuration (invariant 13; themePrefs.js validates on write), so
-- the constraint only ever encoded one product's picker. Pure contract of a
-- constraint nothing reads (invariant 14).

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_theme_check;
