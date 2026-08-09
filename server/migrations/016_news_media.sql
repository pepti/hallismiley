-- News article media (images, video files, YouTube embeds).
-- Mirrors the project_media / project_videos pattern but unified into one table.

CREATE TABLE IF NOT EXISTS news_media (
  id          SERIAL      PRIMARY KEY,
  article_id  INTEGER     NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL DEFAULT 'image',
  file_path   TEXT,
  youtube_id  TEXT,
  caption     TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT news_media_kind_check CHECK (kind IN ('image', 'video_file', 'youtube')),
  CONSTRAINT news_media_payload CHECK (
    (kind = 'image'      AND file_path IS NOT NULL AND youtube_id IS NULL) OR
    (kind = 'video_file' AND file_path IS NOT NULL AND youtube_id IS NULL) OR
    (kind = 'youtube'    AND youtube_id IS NOT NULL AND file_path IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_news_media_article ON news_media (article_id);
