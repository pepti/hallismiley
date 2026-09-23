-- 084_user_theme_widen — reference copy of the migration in server/config/schema.js
--
-- Widens users.theme for the five-theme set introduced with the product rename
-- (Rekstrarkerfið, 2026-08-20): mono, ember and midnight join classic + light.
--
-- DROP + ADD rather than a guarded ADD: 083_user_theme guards by constraint
-- NAME, so a second guarded block would no-op and leave the DB rejecting the
-- new themes. Both statements here are idempotent, so this is re-run safe.
--
-- WIDEN-ONLY (invariant 14): 'classic' and 'light' stay accepted even though
-- their labels changed, because during a self-update swap the previous
-- release's container still PATCHes the ids it knows.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_theme_check;

ALTER TABLE users ADD CONSTRAINT users_theme_check
  CHECK (theme IN ('classic', 'light', 'mono', 'ember', 'midnight'));
