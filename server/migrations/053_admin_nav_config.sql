-- Migration: 052_admin_nav_config
-- Per-admin sidebar layout customization. One JSONB blob per admin user,
-- shaped { v, sections:[{key,title,items:[id]}], labels }. NULL = default
-- layout (the code-defined ADMIN_NAV).
--
-- Authoritative copy lives in server/config/schema.js; this file is for
-- human reference and manual psql application.

ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_nav_config JSONB;
