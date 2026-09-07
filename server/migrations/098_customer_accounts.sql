-- 098_customer_accounts — reference copy of the migration in server/config/schema.js
-- Customer accounts + staff roles + staff audit log + commission ledger
-- (ENHANCEMENTS #17 + #18; Halli approved 2026-09-07, decisions D-002/D-003/
-- D-005 in company/DECISIONS.md). Pure expand (invariant 14): three new tables,
-- one nullable column, two seeded roles. Money is BIGINT ISK (072 convention).
--
-- customer_accounts is the per-customer state of record: one row per company
-- Orange Smiley builds for, owned by ONE seller (owner_user_id) who earns the
-- commission while they own it. fleet.json is meant to be generated from it.

CREATE TABLE IF NOT EXISTS customer_accounts (
  id                    SERIAL PRIMARY KEY,
  slug                  VARCHAR(40)  NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),   -- repo name + Azure prefix
  kennitala             VARCHAR(10)  UNIQUE CHECK (kennitala IS NULL OR kennitala ~ '^[0-9]{10}$'),
  name                  TEXT         NOT NULL,
  market_company_id     INTEGER      REFERENCES market_companies(id) ON DELETE SET NULL,
  tier                  VARCHAR(10)  NOT NULL CHECK (tier IN ('vefur', 'verslun', 'rekstur')),
  status                VARCHAR(20)  NOT NULL DEFAULT 'lead'
                        CHECK (status IN ('lead', 'offered', 'signed', 'provisioning', 'building', 'live', 'paused', 'churned')),
  owner_user_id         TEXT         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,   -- the seller; commission follows this
  contact_name          TEXT,
  contact_email         TEXT,
  contact_phone         TEXT,
  repo_name             TEXT,
  test_url              TEXT,
  prod_url              TEXT,
  canonical_host        TEXT,
  azure_subscription_id TEXT,
  azure_rg_test         TEXT,
  azure_rg_prod         TEXT,
  contract_start        DATE,
  contract_end          DATE,
  build_fee_isk         BIGINT       CHECK (build_fee_isk IS NULL OR build_fee_isk >= 0),
  monthly_fee_isk       BIGINT       CHECK (monthly_fee_isk IS NULL OR monthly_fee_isk >= 0),
  quota_units           INTEGER      CHECK (quota_units IS NULL OR quota_units >= 0),
  build_rate_bp         INTEGER      NOT NULL DEFAULT 1500 CHECK (build_rate_bp BETWEEN 0 AND 10000),      -- D-003: 15%
  recurring_rate_bp     INTEGER      NOT NULL DEFAULT 1000 CHECK (recurring_rate_bp BETWEEN 0 AND 10000),  -- D-003: 10%
  notes                 TEXT,
  created_by            TEXT         REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_accounts_owner  ON customer_accounts (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_status ON customer_accounts (status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_customer_accounts_updated_at ON customer_accounts;
CREATE TRIGGER trg_customer_accounts_updated_at BEFORE UPDATE ON customer_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The seller's GitHub login, for the access-drift audit (plan §1a). Optional.
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_login TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_github_login ON users (github_login) WHERE github_login IS NOT NULL;

-- Staff audit log — the shape of books_audit_log (072) with the same immutable
-- trigger function. Closed action vocabulary in server/services/staffAudit.js.
CREATE TABLE IF NOT EXISTS staff_audit_log (
  id           BIGSERIAL   PRIMARY KEY,
  actor_id     TEXT        REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT        NOT NULL,
  entity_type  TEXT        NOT NULL,
  entity_id    TEXT,
  summary      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  request_id   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_audit_entity  ON staff_audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_audit_created ON staff_audit_log (created_at DESC);
DROP TRIGGER IF EXISTS trg_staff_audit_log_immutable ON staff_audit_log;
CREATE TRIGGER trg_staff_audit_log_immutable
  BEFORE UPDATE OR DELETE ON staff_audit_log
  FOR EACH ROW EXECUTE FUNCTION books_forbid_any_mutation();

-- Commission ledger — one row per commissionable service invoice, written in
-- the invoice's own transaction with the seller and rate SNAPSHOTTED (an owner
-- change moves only future commission). D-003: build 15% / recurring 10%,
-- earned only on receipt — the report derives "paid" from the invoice.
CREATE TABLE IF NOT EXISTS commission_events (
  id              BIGSERIAL   PRIMARY KEY,
  account_id      INTEGER     NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  seller_user_id  TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind            VARCHAR(10) NOT NULL CHECK (kind IN ('build', 'recurring')),
  period          DATE        NOT NULL,                       -- first day of the invoice month
  base_amount_isk BIGINT      NOT NULL CHECK (base_amount_isk >= 0),   -- invoice net (ex VSK)
  rate_bp         INTEGER     NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  amount_isk      BIGINT      NOT NULL CHECK (amount_isk >= 0),
  invoice_id      TEXT        NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commission_seller_period ON commission_events (seller_user_id, period);

-- Staff roles (D-002). Non-system, editable in /admin/roles. `solufolk` (090)
-- stays the trainee role; `leads` reached it in 097.
INSERT INTO roles (name, description, view_access, is_system) VALUES
  ('solumadur', 'Sölumaður — á viðskiptareikninga og fær sölulaun',
   '["handbok", "leads", "accounts", "commission"]'::jsonb, FALSE),
  ('verktaki',  'Verktaki — þjónustar alla viðskiptareikninga, engin sölulaun',
   '["handbok", "accounts", "allaccounts"]'::jsonb, FALSE)
ON CONFLICT (name) DO NOTHING;
