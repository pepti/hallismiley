-- 113_variant_barcode — reference copy; the authoritative entry is in
-- server/config/schema.js.
--
-- A barcode per variant and the barcode lookup indexes the product import
-- matches on (harvest-ice-d-2026-09-24). The same DDL exists in icelandicstore
-- (product_variants.barcode with its catalogue columns; the indexes are ice
-- 102_barcode_lookup_index), so every statement is IF NOT EXISTS. Not unique
-- on purpose: the import refuses an ambiguous barcode rather than guessing.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE INDEX IF NOT EXISTS idx_products_barcode
  ON products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode
  ON product_variants (barcode) WHERE barcode IS NOT NULL;
