-- 114_user_expires_at — reference copy; the authoritative entry is in
-- server/config/schema.js.
--
-- Time-limited logins (login-expiry-2026-09-26, roadmap R2b, D-020): a login
-- a seller makes for a prospect on the demo instance stops working after N
-- days. NULL = never expires. Additive; every sign-in path and the session
-- check refuse a row whose expires_at has passed (server/auth/accountExpiry.js).
-- Rolling back to the previous image re-opens expired logins for the length of
-- the rollback: the old code ignores the column.
ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
