-- Migration: 071_party_photos_public
-- The album is fully public by owner decision (2026-07-26): anyone who can
-- reach /party can view and upload without an account, so uploads may have no
-- owner — user_id becomes nullable. NULL means "anonymous visitor"; such photos
-- can only be deleted by admin/moderator, since there is no owner to claim
-- them. The FK and its ON DELETE CASCADE are unchanged for rows that DO have an
-- owner.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application.

ALTER TABLE party_photos ALTER COLUMN user_id DROP NOT NULL;
