-- 117_user_address — reference copy; the authoritative entry is in
-- server/config/schema.js.
--
-- A customer's own postal address, edited on the admin Customers screen
-- (harvest 2 lane 3, ported from icelandicstore #336, where the same DDL is
-- 114_user_address — ice aliases it). All nullable, IF NOT EXISTS,
-- expand-only. Rollback: DROP the five columns once no release reads them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS address1 TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address2 TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS zip      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country  TEXT;
