-- Migration: 045_shop_sections
-- Shop redesign step 1 — see docs/SHOP_REDESIGN.md.
--
-- The existing products.category (from 024_product_variants) held apparel-style
-- values like 'apparel', 'accessories', 'roof_box'. The redesign treats those
-- as *subcategory* and uses `category` for the new top-level taxonomy:
--   'product' | 'tech_service' | 'carpentry_service'
--
-- Rename the old column → subcategory, then add a fresh top-level category
-- (NOT NULL DEFAULT 'product' backfills existing apparel rows correctly).
-- Service-only fields (duration_minutes, delivery_format, is_bookable) stay
-- NULL/FALSE on physical products and drive section filters + the booking
-- follow-up flow in later build-order steps.
--
-- Authoritative copy lives in server/config/schema.js; this file is for
-- human reference and manual psql application.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='products' AND column_name='category')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='products' AND column_name='subcategory')
  THEN ALTER TABLE products RENAME COLUMN category TO subcategory;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_products_category;
CREATE INDEX IF NOT EXISTS idx_products_subcategory ON products (subcategory);

ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'product';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_category_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_category_check
      CHECK (category IN ('product','tech_service','carpentry_service'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);

ALTER TABLE products ADD COLUMN IF NOT EXISTS duration_minutes INTEGER
  CHECK (duration_minutes IS NULL OR duration_minutes > 0);

ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_format TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_delivery_format_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_delivery_format_check
      CHECK (delivery_format IS NULL OR delivery_format IN ('remote','in_person','hybrid'));
  END IF;
END $$;

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bookable BOOLEAN NOT NULL DEFAULT FALSE;
