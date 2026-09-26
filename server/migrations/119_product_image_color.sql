-- 119_product_image_color — reference copy; the authoritative entry is in
-- server/config/schema.js. Harvest 2 lane 6c; after 118_goods_receipts, before
-- 120_product_merge.
--
-- Ported from icelandicstore #182/#265 (ice 096_product_image_color) and #194
-- (ice 099_variant_archive):
--   * product_images.color — the variant colour a photo shows (NULL = not
--     colour-specific); the product page swaps the photo when a colour is picked.
--   * product_variants.archived_at — a variant an order or the stock history
--     still names is archived instead of deleted.
--   * the SKU and (product_id, attributes) unique rules become partial on
--     archived_at IS NULL, so an archived row frees both slots. Each partial
--     index is created before the old rule is dropped.
-- Additive; a no-op on icelandicstore (same DDL under its own names).
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_variants_sku_live
  ON product_variants (sku) WHERE archived_at IS NULL;
DO $$
  DECLARE c text;
  BEGIN
    FOR c IN
      SELECT con.conname
        FROM pg_constraint con
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
       WHERE con.conrelid = 'product_variants'::regclass
         AND con.contype = 'u'
         AND array_length(con.conkey, 1) = 1
         AND att.attname = 'sku'
    LOOP
      EXECUTE format('ALTER TABLE product_variants DROP CONSTRAINT %I', c);
    END LOOP;
  END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_variants_attrs_live
  ON product_variants (product_id, attributes) WHERE archived_at IS NULL;
DROP INDEX IF EXISTS uniq_product_variants_attrs;
CREATE INDEX IF NOT EXISTS idx_product_variants_live
  ON product_variants (product_id) WHERE archived_at IS NULL;
