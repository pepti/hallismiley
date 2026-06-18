-- Migration: 055_dynamic_roles
-- Dynamic roles: a `roles` table becomes the source of truth for role names and
-- which admin views each role may access. users.role becomes a FK on roles.name
-- (no data backfill — the column already holds the name string). The admin role
-- gets view_access ['*'] (all views, incl. future ones); the resolver also
-- hard-shortcuts role='admin', so admins can never be locked out. Built-in roles
-- are seeded BEFORE the FK is added / the old CHECK is dropped.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application. Statement order is load-bearing.

CREATE TABLE IF NOT EXISTS roles (
  name        TEXT        PRIMARY KEY,
  description TEXT        NOT NULL DEFAULT '',
  view_access JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- array of view-ids; ["*"] = all
  is_system   BOOLEAN     NOT NULL DEFAULT FALSE,         -- built-ins can't be deleted/renamed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_roles_updated_at ON roles;
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed the three built-in roles BEFORE touching users.role / the FK.
INSERT INTO roles (name, description, view_access, is_system) VALUES
  ('admin',     'Full access to every admin view',    '["*"]'::jsonb, TRUE),
  ('moderator', 'Content & party management',         '[]'::jsonb,    TRUE),
  ('user',      'Standard account (no admin views)',  '[]'::jsonb,    TRUE)
ON CONFLICT (name) DO NOTHING;

-- Defensive: coerce any unknown role value so the FK can be added.
UPDATE users SET role = 'user' WHERE role NOT IN (SELECT name FROM roles);

-- Replace the fixed-enum CHECK with the FK to roles(name).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_fkey') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_fkey
      FOREIGN KEY (role) REFERENCES roles(name) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;
