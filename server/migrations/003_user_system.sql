-- Migration 003: User system expansion
-- Adds profile fields, email verification, password reset, account disable.
-- Updates role constraint from (admin|editor|viewer) → (admin|moderator|user).

-- Migrate old roles to nearest equivalent before changing the constraint
UPDATE users SET role = 'user' WHERE role IN ('editor', 'viewer');

-- Replace role CHECK constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'moderator', 'user'));

-- New signups should default to 'user', not 'admin'
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

-- Profile fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar       TEXT NOT NULL DEFAULT 'avatar-01.png';

-- Email verification
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified      BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_expires TIMESTAMPTZ;

-- Password reset
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMPTZ;

-- Account disable / soft-delete
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled        BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at     TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_reason TEXT;
