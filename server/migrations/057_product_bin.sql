-- Migration: 057_product_bin
-- Warehouse BIN code per product / variant. A bin is a short shelf code like
-- 'A-001'; the BIN System board (admin view 'bins') derives zones (the letter
-- prefix) and the per-zone numeric grid from assigned bins — there is no
-- separate bins registry. Variant bin overrides product bin via COALESCE
-- (mirrors sku/barcode). Indexed for the board's GROUP BY zone + per-bin lookup.
--
-- Authoritative copy lives in server/config/schema.js; this file is for
-- human reference and manual psql application.

ALTER TABLE products         ADD COLUMN IF NOT EXISTS bin TEXT;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS bin TEXT;
CREATE INDEX IF NOT EXISTS idx_products_bin         ON products (bin);
CREATE INDEX IF NOT EXISTS idx_product_variants_bin ON product_variants (bin);
