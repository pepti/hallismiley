-- 105_seller_publication — reference copy. The runner reads server/config/schema.js,
-- not this file (invariant 4). The seller area (D-020): the one-way published copy
-- of each seller's leads, accounts and commission statements on the PUBLIC
-- instance. Written only by the signed ingest route (/api/v1/seller-publish).

CREATE TABLE IF NOT EXISTS seller_publications (
  id             BIGSERIAL   PRIMARY KEY,
  snapshot_id    UUID        NOT NULL UNIQUE,
  generated_at   TIMESTAMPTZ NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seller_count   INTEGER     NOT NULL CHECK (seller_count >= 0),
  lead_count     INTEGER     NOT NULL CHECK (lead_count >= 0),
  account_count  INTEGER     NOT NULL CHECK (account_count >= 0),
  statement_count INTEGER    NOT NULL CHECK (statement_count >= 0),
  body_sha256    TEXT        NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_seller_publications_generated ON seller_publications (generated_at DESC);

CREATE TABLE IF NOT EXISTS published_sellers (
  email          TEXT        PRIMARY KEY CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 200),
  display_name   TEXT        NOT NULL,
  can_leads      BOOLEAN     NOT NULL DEFAULT FALSE,
  can_accounts   BOOLEAN     NOT NULL DEFAULT FALSE,
  can_commission BOOLEAN     NOT NULL DEFAULT FALSE,
  payee_kind     TEXT        CHECK (payee_kind IS NULL OR payee_kind IN ('contractor', 'employee', 'internal'))
);

CREATE TABLE IF NOT EXISTS published_leads (
  ops_id           INTEGER     PRIMARY KEY,
  received_at      TIMESTAMPTZ NOT NULL,
  name             TEXT        NOT NULL,
  email            TEXT        NOT NULL,
  company          TEXT,
  phone            TEXT,
  current_platform TEXT,
  message          TEXT        NOT NULL,
  status           TEXT        NOT NULL CHECK (status IN ('new', 'contacted', 'won', 'lost')),
  owner_email      TEXT,
  owner_name       TEXT,
  contacted_at     TIMESTAMPTZ,
  note             TEXT
);

CREATE INDEX IF NOT EXISTS idx_published_leads_received ON published_leads (received_at DESC);

CREATE TABLE IF NOT EXISTS published_accounts (
  ops_id          INTEGER     PRIMARY KEY,
  seller_email    TEXT        NOT NULL,
  slug            TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  tier            TEXT        NOT NULL CHECK (tier IN ('vefur', 'verslun', 'rekstur')),
  status          TEXT        NOT NULL,
  contact_name    TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  prod_url        TEXT,
  contract_start  DATE,
  contract_end    DATE,
  build_fee_isk   BIGINT,
  monthly_fee_isk BIGINT,
  quota_units     INTEGER,
  updated_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_published_accounts_seller ON published_accounts (seller_email, name);

CREATE TABLE IF NOT EXISTS published_statements (
  ops_id              BIGINT      PRIMARY KEY,
  seller_email        TEXT        NOT NULL,
  period              DATE        NOT NULL,
  status              TEXT        NOT NULL CHECK (status IN ('open', 'paid', 'carried', 'superseded')),
  payee_kind          TEXT        NOT NULL,
  opening_balance_isk BIGINT      NOT NULL,
  earned_isk          BIGINT      NOT NULL,
  clawback_isk        BIGINT      NOT NULL,
  adjustment_isk      BIGINT      NOT NULL,
  settled_isk         BIGINT      NOT NULL,
  closing_balance_isk BIGINT      NOT NULL,
  minimum_isk         BIGINT      NOT NULL,
  payable_isk         BIGINT      NOT NULL,
  carried_isk         BIGINT      NOT NULL,
  amount_paid_isk     BIGINT      NOT NULL,
  note                TEXT        NOT NULL DEFAULT '',
  issued_at           TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_published_statements_seller ON published_statements (seller_email, period DESC);

CREATE TABLE IF NOT EXISTS published_statement_lines (
  id               BIGSERIAL PRIMARY KEY,
  statement_ops_id BIGINT    NOT NULL REFERENCES published_statements(ops_id) ON DELETE CASCADE,
  line_kind        TEXT      NOT NULL CHECK (line_kind IN ('earned', 'clawback', 'adjustment', 'payout')),
  account_name     TEXT,
  invoice_number   TEXT,
  description      TEXT      NOT NULL DEFAULT '',
  amount_isk       BIGINT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_published_statement_lines ON published_statement_lines (statement_ops_id, id);

CREATE TABLE IF NOT EXISTS published_payouts (
  id                    BIGSERIAL PRIMARY KEY,
  statement_ops_id      BIGINT    NOT NULL REFERENCES published_statements(ops_id) ON DELETE CASCADE,
  paid_on               DATE      NOT NULL,
  method                TEXT      NOT NULL CHECK (method IN ('bank_transfer', 'payroll', 'other')),
  seller_invoice_number TEXT,
  amount_isk            BIGINT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_published_payouts ON published_payouts (statement_ops_id, id);
