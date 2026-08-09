-- Migration: 070_party_photo_album
-- Photo album: turns party_photos from an images-only side table into the
-- backing store for the guest-facing album, where guests dump whole camera
-- rolls — photos and videos, originals kept at full quality.
--
-- thumb_path exists because we keep originals and have no server-side image
-- processing (no sharp anywhere in this project). The browser generates the
-- thumbnail — a canvas downscale for photos, a captured poster frame for videos
-- — and uploads it alongside the original, so the grid never pulls full-res
-- files down a phone connection. It is NULLABLE on purpose: a browser that
-- cannot decode the file (HEVC video, say) still gets to upload it, it just
-- lands without a thumbnail. Losing the thumbnail must never cost us the
-- original.
--
-- media_type mirrors project_media's image/video CHECK rather than sniffing the
-- extension at render time, so the frontend knows to render a <video> and a play
-- badge without parsing file_path.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application.

ALTER TABLE party_photos
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image';

ALTER TABLE party_photos
  ADD COLUMN IF NOT EXISTS thumb_path TEXT;

-- Named constraint added separately so re-running the migration is a no-op;
-- ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL 16.
DO $$ BEGIN
  ALTER TABLE party_photos
    ADD CONSTRAINT party_photos_media_type_check
    CHECK (media_type IN ('image', 'video'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- (created_at DESC, id DESC) matches the default "newest first" ordering
-- exactly, so paging through a few hundred rows stays an index scan.
CREATE INDEX IF NOT EXISTS idx_party_photos_created
  ON party_photos (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_party_photos_user
  ON party_photos (user_id);
