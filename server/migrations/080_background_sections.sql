-- Migration: 080_background_sections
-- Named, ordered sections for the background media library (051). Lets the
-- admin group backgrounds ("Winter", "Studio", …) with per-locale names and
-- descriptions, and reorder media within/across sections.
--
-- background_media already exists, so section_id is ADDED here rather than
-- declared in 051 — applied migrations are never edited. section_id is
-- nullable with ON DELETE SET NULL, so deleting a section ungroups its media
-- instead of destroying uploads.
--
-- Authoritative copy lives in server/config/schema.js; this file is for
-- human reference and manual psql application.

CREATE TABLE IF NOT EXISTS background_sections (
  id             SERIAL      PRIMARY KEY,
  name           TEXT        NOT NULL,
  name_is        TEXT,
  description    TEXT,
  description_is TEXT,
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE background_media
  ADD COLUMN IF NOT EXISTS section_id INTEGER
  REFERENCES background_sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_background_media_section ON background_media (section_id);
