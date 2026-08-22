-- 087_event_logs — reference copy of the migration in server/config/schema.js
-- Admin → Monitoring event log (harvest 2026-08-22, from icelandicstore #195).
-- NOTE: ice numbers this table 093_event_logs (with a duplicate 093 in its
-- chain); the runner records by NAME and the chains diverged at 072.

CREATE TABLE IF NOT EXISTS event_logs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source      TEXT NOT NULL CHECK (source IN ('client','server')),
  level       TEXT NOT NULL DEFAULT 'error' CHECK (level IN ('error','warn','info')),
  message     TEXT NOT NULL,
  path        TEXT,
  status      INTEGER,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  username    TEXT,
  request_id  TEXT,
  user_agent  TEXT,
  context     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_logs_created_at ON event_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_user ON event_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_source_level ON event_logs (source, level, created_at DESC);
