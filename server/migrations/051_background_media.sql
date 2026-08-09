-- Migration: 050_background_media
-- Flat global library of background images/videos the admin can pick the
-- home-hero background from. The active landing choice lives in site_content
-- key 'landing_background' { mode, photo_url, veil_percent } (mode video|photo|
-- plain; video = the current default hero).
--
-- Authoritative copy lives in server/config/schema.js; this file is for
-- human reference and manual psql application.

CREATE TABLE IF NOT EXISTS background_media (
  id          SERIAL      PRIMARY KEY,
  file_path   TEXT        NOT NULL,
  media_type  TEXT        NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video')),
  caption     TEXT,
  caption_is  TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_background_media_sort ON background_media (sort_order, id);
