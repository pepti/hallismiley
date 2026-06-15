-- Migration: 053_order_payment_fulfillment_tags
-- Split the single order `status` enum into independent payment + fulfillment
-- statuses (Shopify-style), plus a free-form tags array. The legacy `status`
-- column is kept and derived from the two (Order.deriveStatus) so existing
-- queries, the sales report, and the Stripe webhook keep working unchanged.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status     TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfilled_at       TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tags               JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_status_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
      CHECK (payment_status IN ('pending','paid','refunded','partially_refunded','voided'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_status_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_status_check
      CHECK (fulfillment_status IN ('unfulfilled','fulfilled','partial','delivered'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_payment_status     ON orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders (fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_orders_tags               ON orders USING GIN (tags);

-- Backfill from the legacy status (guarded so it only touches still-default rows).
UPDATE orders SET payment_status = 'paid'   WHERE status = 'paid'     AND payment_status = 'pending';
UPDATE orders SET payment_status = 'paid', fulfillment_status = 'fulfilled'
  WHERE status = 'shipped' AND payment_status = 'pending';
UPDATE orders SET payment_status = 'refunded' WHERE status = 'refunded' AND payment_status = 'pending';
UPDATE orders SET payment_status = 'voided'   WHERE status IN ('cancelled','failed') AND payment_status = 'pending';
