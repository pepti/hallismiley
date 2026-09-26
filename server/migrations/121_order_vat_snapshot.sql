-- 121_order_vat_snapshot — reference copy; the authoritative entry is in
-- server/config/schema.js.
--
-- The order's VAT, snapshotted at checkout (harvest 2 lane 5): the rate each
-- line was sold at, and the VAT inside orders.total in the order's currency, so
-- the sales report can lead with net sales (total − vat_total). Written by
-- Order.createWithItems through utils/orderVat.js, the helper
-- bookkeeping/invoiceService.buildLines also uses.
--
-- The backfill below is APPROXIMATE: history gets the product's CURRENT rate
-- and a proportional discount split without the invoice's króna-level
-- largest-remainder allocation. A no-op on icelandicstore (its orders already
-- carry vat_total). Additive; rollback: DROP both columns once no release reads
-- them.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS vat_rate SMALLINT
  CHECK (vat_rate IS NULL OR vat_rate IN (0, 11, 24));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_total INTEGER;

UPDATE order_items oi
   SET vat_rate = CASE
         WHEN UPPER(TRIM(COALESCE(NULLIF(o.shipping_address->>'country_code', ''),
                                  NULLIF(o.shipping_address->>'country', ''), 'IS')))
              NOT IN ('IS', 'ISL', 'ICELAND', 'ÍSLAND')
          AND NOT COALESCE(p.is_bookable, FALSE) THEN 0
         ELSE COALESCE(p.vat_rate, 24) END
  FROM orders o, products p
 WHERE o.id = oi.order_id AND p.id = oi.product_id
   AND o.vat_total IS NULL AND oi.vat_rate IS NULL;

WITH base AS (
  SELECT o.id, o.total::numeric AS total,
         GREATEST(o.shipping - COALESCE(o.shipping_discount, 0), 0)::numeric AS ship,
         UPPER(TRIM(COALESCE(NULLIF(o.shipping_address->>'country_code', ''),
                             NULLIF(o.shipping_address->>'country', ''), 'IS')))
           NOT IN ('IS', 'ISL', 'ICELAND', 'ÍSLAND') AS export,
         COALESCE((SELECT SUM(oi.product_price_snapshot::numeric * oi.quantity)
                     FROM order_items oi WHERE oi.order_id = o.id), 0) AS goods
    FROM orders o
   WHERE o.vat_total IS NULL
), shares AS (
  SELECT b.id, b.ship, b.export,
         COALESCE(GREATEST(b.goods + b.ship - b.total, 0) / NULLIF(b.goods + b.ship, 0), 0) AS f
    FROM base b
), vat AS (
  SELECT s.id,
         COALESCE((SELECT SUM(ROUND(oi.product_price_snapshot::numeric * oi.quantity * (1 - s.f)
                                    * oi.vat_rate / (100 + oi.vat_rate)))
                     FROM order_items oi
                    WHERE oi.order_id = s.id AND oi.vat_rate IS NOT NULL), 0)
         + CASE WHEN s.export THEN 0 ELSE ROUND(s.ship * (1 - s.f) * 24 / 124) END AS vat
    FROM shares s
)
UPDATE orders o SET vat_total = v.vat::int
  FROM vat v
 WHERE v.id = o.id AND o.vat_total IS NULL;
