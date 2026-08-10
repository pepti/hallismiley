-- Migration: 081_system_updates
-- Self-update ledger: one row per release this instance has heard about, on
-- the channel it heard about it from. (channel, version) is unique so the
-- hourly manifest check is idempotent.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application. It is GENERATED from that array — do
-- not hand-edit it, and if the two ever disagree, schema.js wins.

CREATE TABLE IF NOT EXISTS system_updates (
  id              SERIAL      PRIMARY KEY,
  discovered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version         TEXT        NOT NULL,
  image_digest    TEXT        NOT NULL,
  channel         TEXT        NOT NULL,
  changelog_md    TEXT,
  status          TEXT        NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available','scheduled','applying','applied','failed','dismissed')),
  applied_at      TIMESTAMPTZ,
  previous_digest TEXT,
  detail          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_system_updates_channel_version
  ON system_updates (channel, version);

CREATE INDEX IF NOT EXISTS idx_system_updates_status
  ON system_updates (status, discovered_at DESC);
