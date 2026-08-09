-- Migration 004: project media gallery
-- Stores per-project images and videos, ordered by sort_order.

CREATE TABLE IF NOT EXISTS project_media (
  id          SERIAL      PRIMARY KEY,
  project_id  INTEGER     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_path   TEXT        NOT NULL,
  media_type  TEXT        NOT NULL CHECK (media_type IN ('image', 'video')),
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  caption     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_media_project_id ON project_media (project_id);
