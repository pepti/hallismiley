-- Migration: 061_user_roles
-- Multi-role membership: a user may belong to several roles at once. user_roles is
-- the source of truth for the role SET; users.role is kept as a denormalized
-- "primary" role (display, the default at the user-INSERT sites, the
-- WHERE role='admin' notify queries, and the floor). Effective permissions = the
-- union across all of a user's roles (admin in the set => all views, via
-- Role.getViewsForRoles). The role_name FK is ON DELETE RESTRICT to preserve the
-- "reassign members before deleting a role" behaviour (the role-delete handler
-- catches FK 23503 -> roleInUse). Backfills every existing user's current single
-- role as their first membership.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application.

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_name  TEXT        NOT NULL REFERENCES roles(name) ON UPDATE CASCADE ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by TEXT        REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_name)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles (role_name);

-- Backfill: every existing user's current role becomes their first membership.
INSERT INTO user_roles (user_id, role_name)
  SELECT id, role FROM users ON CONFLICT DO NOTHING;

-- Mirror users.role (the primary) into user_roles automatically, so every
-- account-creation path (signup, OAuth, customer import, party guests, bootstrap)
-- and every primary-role change yields a membership without touching those INSERT
-- sites. The invariant "primary is always a membership" is enforced in the DB.
CREATE OR REPLACE FUNCTION sync_primary_user_role() RETURNS trigger AS $$
BEGIN
  INSERT INTO user_roles (user_id, role_name)
  VALUES (NEW.id, NEW.role)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_sync_primary_role ON users;
CREATE TRIGGER trg_users_sync_primary_role
  AFTER INSERT OR UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION sync_primary_user_role();
