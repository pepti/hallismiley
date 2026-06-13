-- Migration: 047_product_codes
-- Product inventory codes — SKU + barcode (EAN-13/UPC/GTIN/ISBN). Optional TEXT
-- on products; sku is indexed for lookup. Surfaced in the admin product editor,
-- with an optional native-camera barcode scanner that fills the field.
--
-- Authoritative copy lives in server/config/schema.js; this file is for
-- human reference and manual psql application.

ALTER TABLE products ADD COLUMN IF NOT EXISTS sku     TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku);
