-- Migration: 051_change_requests
-- In-app change-request (feedback) tool — non-production only. One testing
-- session submits a batch of items → admin inbox. Parent batch + child items;
-- per-item open/resolved status.
--
-- Authoritative copy lives in server/config/schema.js; this file is for
-- human reference and manual psql application.

CREATE TABLE IF NOT EXISTS change_request_batches (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  submitter_user_id TEXT        REFERENCES users(id) ON DELETE SET NULL,
  submitter_email   TEXT,
  user_agent        TEXT,
  item_count        INTEGER     NOT NULL DEFAULT 0,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_cr_batches_updated_at ON change_request_batches;
CREATE TRIGGER trg_cr_batches_updated_at BEFORE UPDATE ON change_request_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS change_requests (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  batch_id         TEXT        NOT NULL REFERENCES change_request_batches(id) ON DELETE CASCADE,
  page_url         TEXT        NOT NULL,
  page_label       TEXT,
  element_selector TEXT,
  element_label    TEXT,
  note             TEXT        NOT NULL,
  screenshot_path  TEXT,
  status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_cr_updated_at ON change_requests;
CREATE TRIGGER trg_cr_updated_at BEFORE UPDATE ON change_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_cr_batch_id ON change_requests (batch_id);
CREATE INDEX IF NOT EXISTS idx_cr_status   ON change_requests (status);
CREATE INDEX IF NOT EXISTS idx_cr_batches_submitted_at ON change_request_batches (submitted_at DESC);
