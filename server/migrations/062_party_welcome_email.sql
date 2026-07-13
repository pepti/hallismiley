-- Migration: 062_party_welcome_email
-- Party flow change: guests are auto-granted access on request (instant magic
-- link); the owner's "approve" action now sends a party-info ("welcome") email
-- instead of gating access. These columns track that send so the admin queue
-- can list guests who haven't received the info email yet, independent of
-- approval_status (which partyMagicLogin flips to 'approved' on every sign-in
-- and the password-login gate 403s when 'pending' — so it can't double as a
-- "welcome not sent" flag).
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application.

ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Data fix: guests created via the party request/invite flow got
-- preferred_locale='en' from the column default and from the old client bug
-- that persisted the English *fallback* locale as if it were a choice. The
-- party audience is Icelandic-first, so flip party-flow guests still on 'en'
-- to 'is'. Caveat: we cannot distinguish "polluted default" from "explicitly
-- chose English" for these rows; a genuinely-English guest is one explicit
-- switcher click away from restoring their preference (which re-PATCHes
-- users.preferred_locale).
UPDATE users SET preferred_locale = 'is'
 WHERE preferred_locale = 'en'
   AND role = 'user'
   AND (requested_at IS NOT NULL OR magic_login_token_created_at IS NOT NULL);
