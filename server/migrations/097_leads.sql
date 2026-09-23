-- 097_leads — reference copy of the migration in server/config/schema.js
-- Leads inbox (ENHANCEMENTS #2 + the 2026-08-27 addendum; Halli 2026-09-07):
-- every /hafa-samband submission is persisted alongside the notification
-- email, so a missed email no longer loses the lead and the sales team works
-- its own queue from the admin shell (view id `leads`).
--
-- PII TABLE. Retention is LEAD_RETENTION_DAYS (default 730 = the 24 months
-- /personuvernd promises), pruned daily by server/services/leadsCleanup.js.
-- Nothing here is ever public; every API response is Cache-Control: no-store.
-- users.id is TEXT (gen_random_uuid()::text), so the two FKs are TEXT too.

CREATE TABLE IF NOT EXISTS leads (
  id               SERIAL PRIMARY KEY,
  submission_id    UUID         NOT NULL UNIQUE,   -- the correlation id already in the log line + email
  name             VARCHAR(100) NOT NULL,
  email            VARCHAR(200) NOT NULL,
  company          VARCHAR(150),
  phone            VARCHAR(40),
  current_platform VARCHAR(20),                    -- contactController normalizePlatform() output, or NULL
  message          TEXT         NOT NULL,          -- <= 2000 chars by controller validation
  source           VARCHAR(30)  NOT NULL DEFAULT 'hafa-samband',
  locale           VARCHAR(5),
  status           VARCHAR(20)  NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'contacted', 'won', 'lost')),
  owner_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,   -- per-seller routing; customer accounts (#17) reuse it
  contacted_at     TIMESTAMPTZ,                    -- stamped on the FIRST move out of 'new', never restamped
  contacted_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status  ON leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_owner   ON leads (owner_user_id) WHERE owner_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Grant the view to the seeded sales role — append-only and idempotent.
-- `roles` has no updated_by column, so the 091/092 "seed untouched" guard is
-- unavailable; instead the id is only ever ADDED when absent. If Halli later
-- removes it in /admin/roles it stays removed (this migration never re-runs).
UPDATE roles
   SET view_access = view_access || '["leads"]'::jsonb
 WHERE name = 'solufolk' AND is_system = FALSE
   AND NOT (view_access @> '["leads"]'::jsonb);
