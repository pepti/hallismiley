-- Migration 006: enriched user profiles
-- Bio, theme preference, notification prefs, login tracking, connected accounts, favorites

-- Bio (max 500 chars enforced in app layer and as CHECK)
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_bio_length;
ALTER TABLE users ADD CONSTRAINT users_bio_length CHECK (LENGTH(bio) <= 500);

-- Theme preference
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'dark';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_theme_check;
ALTER TABLE users ADD CONSTRAINT users_theme_check CHECK (theme IN ('dark', 'light'));

-- Notification preferences
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_comments BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_updates  BOOLEAN NOT NULL DEFAULT TRUE;

-- Login tracking (last_login_at already exists from 002)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ua  TEXT;

-- Connected accounts
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_username   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS linkedin_username TEXT;

-- Favorites
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id    ON user_favorites (user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_project_id ON user_favorites (project_id);
