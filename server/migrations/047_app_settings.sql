-- Migration: 046_app_settings
-- Key-value application settings. One row per setting: a stable string key +
-- a JSONB value (so booleans, strings, and future structured values all fit
-- without per-setting columns). Backs the admin "General settings" page and is
-- the intended home for feature flags introduced by later features.
--
-- Authoritative copy lives in server/config/schema.js; this file is for
-- human reference and manual psql application.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
