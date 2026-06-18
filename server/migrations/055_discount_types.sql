-- Migration: 054_discount_types
-- Extend discounts with a `method` (code vs automatic/no-code) and a `type`
-- (order amount vs free shipping), plus the order-side discount snapshot columns
-- the checkout records. discount_code/discount_amount already exist (049); this
-- adds discount_title + shipping_discount. B2C scope — no product/collection
-- targeting or buy-X-get-Y (intentionally out of scope for this shop).
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application.

ALTER TABLE discounts ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'code';
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS type   TEXT NOT NULL DEFAULT 'order';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discounts_method_check') THEN
    ALTER TABLE discounts ADD CONSTRAINT discounts_method_check CHECK (method IN ('code','automatic'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discounts_type_check') THEN
    ALTER TABLE discounts ADD CONSTRAINT discounts_type_check CHECK (type IN ('order','free_shipping'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_discounts_automatic ON discounts (enabled) WHERE method = 'automatic';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_title    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_discount INTEGER NOT NULL DEFAULT 0 CHECK (shipping_discount >= 0);
