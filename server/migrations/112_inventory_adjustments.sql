-- 112_inventory_adjustments — reference copy; the authoritative entry is in
-- server/config/schema.js.
--
-- On hand / Committed / Available, with every stock movement audited
-- (harvest-ice-c-2026-09-24; ENHANCEMENTS #23). The same DDL exists in
-- icelandicstore under four names — 073_inventory_watch, 075_inventory_adjustment_variant,
-- 101_inventory_three_numbers and 121_inventory_adjustment_token — so every
-- statement is IF NOT EXISTS and this entry is a no-op on an ice database.
--
-- The engine keeps the stock >= 0 CHECKs (no overselling) and takes none of
-- ice's made_to_order / build_id / consignment pieces.
--
-- Backfill: the previous release decremented on hand at PAYMENT, so every
-- paid order (and every fulfilled one) is stamped settled; an unpaid,
-- unfulfilled order took no stock and stays NULL.
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id                 TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id         TEXT        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  previous_stock     INTEGER     NOT NULL,
  new_stock          INTEGER     NOT NULL,
  delta              INTEGER     NOT NULL,
  reason             TEXT        NOT NULL DEFAULT 'correction',
  note               TEXT,
  user_id            TEXT        REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS product_variant_id TEXT REFERENCES product_variants(id) ON DELETE CASCADE;
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS order_id TEXT REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS client_token TEXT;
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_product ON inventory_adjustments (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_variant ON inventory_adjustments (product_variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_order ON inventory_adjustments (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_adjustments_client_token
  ON inventory_adjustments (client_token) WHERE client_token IS NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_deducted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_stock_open ON orders (id) WHERE stock_deducted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id);
UPDATE orders
   SET stock_deducted_at = COALESCE(fulfilled_at, paid_at, created_at)
 WHERE stock_deducted_at IS NULL
   AND (paid_at IS NOT NULL OR fulfillment_status IN ('fulfilled', 'delivered'));
