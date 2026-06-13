-- Migration: 049_discounts
-- Discount codes — B2C subset of the icelandicstore engine: code-based,
-- order-level percentage/fixed discounts with min-subtotal, total usage limit,
-- and a date window. orders gains a discount_code + discount_amount snapshot.
--
-- Authoritative copy lives in server/config/schema.js; this file is for
-- human reference and manual psql application.

CREATE TABLE IF NOT EXISTS discounts (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code          TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  value_type    TEXT        NOT NULL CHECK (value_type IN ('percentage','fixed')),
  value         INTEGER     NOT NULL CHECK (value >= 0),
  currency      TEXT        NOT NULL DEFAULT 'ISK' CHECK (currency IN ('ISK','EUR')),
  min_subtotal  INTEGER     CHECK (min_subtotal IS NULL OR min_subtotal >= 0),
  usage_limit   INTEGER     CHECK (usage_limit IS NULL OR usage_limit >= 1),
  used_count    INTEGER     NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
  starts_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discounts_code_lower ON discounts (LOWER(code));

DROP TRIGGER IF EXISTS trg_discounts_updated_at ON discounts;
CREATE TRIGGER trg_discounts_updated_at BEFORE UPDATE ON discounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
