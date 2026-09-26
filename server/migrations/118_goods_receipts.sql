-- 118_goods_receipts — reference copy; the authoritative entry is in
-- server/config/schema.js.
--
-- Goods receiving (harvest2-lane6a-2026-09-26; ported from icelandicstore #23,
-- ice's 080_goods_receipts, whose column names these mirror): a receipt, its
-- expected lines, an append-only scan log, and a batch handle on stock
-- movements — every row of one Inventory.applyBatch call shares batch_id, and
-- a receipt's finalise rows carry goods_receipt_id. On ice's databases the
-- CREATEs are no-ops and only sku + the two inventory_adjustments columns are
-- added. Additive (invariant 14).
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS goods_receipts (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  supplier_name        TEXT        NOT NULL,
  reference            TEXT,
  status               TEXT        NOT NULL DEFAULT 'draft'
                                   CHECK (status IN ('draft', 'finalized', 'cancelled')),
  currency             TEXT        NOT NULL DEFAULT 'ISK',
  note                 TEXT,
  created_by           TEXT        REFERENCES users(id) ON DELETE SET NULL,
  finalized_by         TEXT        REFERENCES users(id) ON DELETE SET NULL,
  finalized_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_created ON goods_receipts (created_at DESC);
DROP TRIGGER IF EXISTS trg_goods_receipts_updated_at ON goods_receipts;
CREATE TRIGGER trg_goods_receipts_updated_at
  BEFORE UPDATE ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  receipt_id           TEXT        NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  supplier_description TEXT,
  supplier_ref         TEXT,
  barcode              TEXT,
  expected_qty         INTEGER     NOT NULL DEFAULT 0,
  received_qty         INTEGER     NOT NULL DEFAULT 0,
  unit_cost            INTEGER,
  product_id           TEXT        REFERENCES products(id) ON DELETE SET NULL,
  variant_id           TEXT        REFERENCES product_variants(id) ON DELETE SET NULL,
  match_status         TEXT        NOT NULL DEFAULT 'unmatched'
                                   CHECK (match_status IN ('matched','unmatched','manual','skipped','new_product')),
  sort_order           INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE goods_receipt_lines ADD COLUMN IF NOT EXISTS sku TEXT;
CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_receipt ON goods_receipt_lines (receipt_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_product ON goods_receipt_lines (product_id);

CREATE TABLE IF NOT EXISTS goods_receipt_scans (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  receipt_id      TEXT        NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  receipt_line_id TEXT        REFERENCES goods_receipt_lines(id) ON DELETE SET NULL,
  product_id      TEXT        REFERENCES products(id) ON DELETE SET NULL,
  variant_id      TEXT        REFERENCES product_variants(id) ON DELETE SET NULL,
  scanned_code    TEXT        NOT NULL,
  qty             INTEGER     NOT NULL DEFAULT 1,
  scanned_by      TEXT        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_scans_receipt ON goods_receipt_scans (receipt_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_scans_line ON goods_receipt_scans (receipt_line_id) WHERE receipt_line_id IS NOT NULL;

ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS batch_id TEXT;
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS goods_receipt_id TEXT REFERENCES goods_receipts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_batch
  ON inventory_adjustments (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_receipt
  ON inventory_adjustments (goods_receipt_id) WHERE goods_receipt_id IS NOT NULL;
