-- 065_user_invited_at
-- Human-reference duplicate of the authoritative migration in
-- server/config/schema.js. invited_at marks a customer as already sent the
-- set-password welcome invite so the admin "Send invites" action is idempotent.
-- Stamped only after a successful send so a mail failure stays retryable.

ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
