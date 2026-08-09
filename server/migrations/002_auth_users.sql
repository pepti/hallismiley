-- Migration: 002_auth_users
-- Adds proper user model and Lucia-compatible session table.
-- Drops the legacy refresh_tokens table (replaced by user_sessions).

CREATE TABLE IF NOT EXISTS users (
  id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email                 TEXT        NOT NULL UNIQUE,
  username              TEXT        NOT NULL UNIQUE,
  password_hash         TEXT        NOT NULL,
  role                  TEXT        NOT NULL DEFAULT 'admin'
                                    CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at         TIMESTAMPTZ,
  failed_login_attempts INTEGER     NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Lucia session table — id/user_id/expires_at are required by the adapter
CREATE TABLE IF NOT EXISTS user_sessions (
  id          TEXT        PRIMARY KEY,
  user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address  TEXT,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id   ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);

-- Drop legacy refresh_tokens table (replaced by Lucia-managed user_sessions)
DROP TABLE IF EXISTS refresh_tokens CASCADE;
