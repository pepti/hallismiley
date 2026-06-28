-- Migration: 058_party_access_requests
-- Party access overhaul: the shared invite code (026) is retired in favour of an
-- email-request -> owner-approval -> magic-link flow. approval_status defaults to
-- 'approved' so every existing row and the normal /signup path are unaffected; only
-- party-page requests are written as 'pending'. The magic-login token is a permanent,
-- reusable bearer credential, so it is stored sha256-HASHED (never plaintext, unlike
-- the older verify/reset tokens) and is revocable by nulling the hash. The
-- approval-action token backs the one-click email approve link (single-use,
-- short-lived). password_hash is already nullable (020), so pending guests are
-- created with no password.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application.

ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_approval_status_check;
ALTER TABLE users ADD CONSTRAINT users_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'declined'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by  TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS magic_login_token_hash       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS magic_login_token_created_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_magic_login_token_hash
  ON users (magic_login_token_hash) WHERE magic_login_token_hash IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_action_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_action_expires    TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_approval_action_token_hash
  ON users (approval_action_token_hash) WHERE approval_action_token_hash IS NOT NULL;

DELETE FROM site_content WHERE key = 'party_invite_code';
