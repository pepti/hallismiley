-- 120_product_merge — reference copy; the authoritative entry is in
-- server/config/schema.js.
--
-- Product merge (harvest 2 lane 6b, ported from icelandicstore #309/#311/#312/
-- #315 — ice's 112_product_merges, mirrored statement for statement so ice can
-- alias it). A merged product stays as an inactive row with merged_into_id =
-- the survivor (its URL 301s there; history keeps a parent); product_merges is
-- the only record of what a merge moved. Expand-only. Rollback: DROP TABLE
-- product_merges; ALTER TABLE products DROP COLUMN merged_into_id.
SET LOCAL lock_timeout = '5s';
ALTER TABLE products ADD COLUMN IF NOT EXISTS merged_into_id TEXT REFERENCES products(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'products_merged_into_not_self'
                    AND conrelid = 'products'::regclass) THEN
    ALTER TABLE products ADD CONSTRAINT products_merged_into_not_self
      CHECK (merged_into_id IS NULL OR merged_into_id <> id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_products_merged_into ON products (merged_into_id) WHERE merged_into_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS product_merges (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  master_id         TEXT        REFERENCES products(id) ON DELETE SET NULL,
  merged_id         TEXT        REFERENCES products(id) ON DELETE SET NULL,
  shape             TEXT        NOT NULL CHECK (shape IN ('variants', 'simple', 'add_axis')),
  stock_mode        TEXT        NOT NULL CHECK (stock_mode IN ('move', 'discard')),
  variant_map       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  added_axis        TEXT,
  master_axis_value TEXT,
  merged_name       TEXT        NOT NULL,
  merged_slug       TEXT        NOT NULL,
  merged_sku        TEXT,
  merged_barcode    TEXT,
  stock_moved       INTEGER     NOT NULL DEFAULT 0,
  discard_qty       INTEGER     NOT NULL DEFAULT 0,
  discard_value_isk INTEGER,
  counts            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  warnings          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  lock_wait_ms      INTEGER,
  ms                INTEGER,
  merged_by         TEXT        REFERENCES users(id) ON DELETE SET NULL,
  merged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_merges_master ON product_merges (master_id, merged_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_merges_merged ON product_merges (merged_id);
CREATE INDEX IF NOT EXISTS idx_product_merges_sku ON product_merges (lower(merged_sku)) WHERE merged_sku IS NOT NULL;
