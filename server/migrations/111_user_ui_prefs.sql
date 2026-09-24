-- 111_user_ui_prefs — reference copy; the authoritative entry is in
-- server/config/schema.js.
--
-- Per-account admin layout preferences, harvested from icelandicstore
-- (harvest-ice-b-2026-09-24). All four ride on the session payload like
-- `theme`, so they follow the login to another browser:
--   page_widths       — { '<page key>' | '*': 'normal'|'wide'|'full' }
--   page_width_motion — the admin shell slides to a new width; TRUE = yes
--   aside_widths      — { '<page key>' | '*': 'narrow'|'medium'|'wide' }
--   cookie_consent    — the analytics-cookie answer on the account; NULL =
--                       never answered while signed in
--
-- Equal to ice's 125_user_page_widths, 127_user_page_width_motion,
-- 128_user_cookie_consent and 135_user_aside_widths (ice's product file lists
-- them as aliases of this name). Expand-only (invariant 14).
ALTER TABLE users ADD COLUMN IF NOT EXISTS page_widths JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS page_width_motion BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS aside_widths JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cookie_consent TEXT
  CHECK (cookie_consent IN ('accepted', 'declined'));
