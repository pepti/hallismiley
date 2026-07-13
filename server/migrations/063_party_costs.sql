-- Migration: 063_party_costs
-- Cost tracking for the party planner. Logistics rows get a numeric quantity
-- + integer unit_price (whole ISK) so a line cost (qty × price) can be
-- computed and summed into the admin page's Cost overview; todos get an
-- optional integer cost. quantity was free text ("2 kassar", "6-pack"); the
-- leading number is parsed into the numeric column and any remaining text is
-- preserved in quantity_note so no data is lost. The conversion block only
-- runs while quantity is still text, so re-runs and fresh installs (where 042
-- just created it as TEXT) are both safe.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application.

ALTER TABLE party_logistics_items ADD COLUMN IF NOT EXISTS quantity_note TEXT;
ALTER TABLE party_logistics_items ADD COLUMN IF NOT EXISTS unit_price INTEGER;
ALTER TABLE party_todos ADD COLUMN IF NOT EXISTS cost INTEGER;

-- Convert free-text quantity to NUMERIC(12,2), non-destructively:
--   "2 kassar" -> 2   + note "kassar"
--   "2,5 kg"   -> 2.5 + note "kg"      (comma decimal normalized)
--   "6-pack"   -> 6   + note "-pack"
--   "handfylli"-> NULL + note "handfylli"  (nothing is ever lost)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'party_logistics_items'
       AND column_name = 'quantity' AND data_type = 'text'
  ) THEN
    UPDATE party_logistics_items
       SET quantity_note = NULLIF(btrim(regexp_replace(btrim(quantity), '^[0-9]+([.,][0-9]+)?[[:space:]]*', '')), '')
     WHERE quantity IS NOT NULL
       AND quantity_note IS NULL;
    ALTER TABLE party_logistics_items
      ALTER COLUMN quantity TYPE NUMERIC(12,2)
      USING NULLIF(replace(substring(btrim(quantity) from '^([0-9]+(?:[.,][0-9]+)?)'), ',', '.'), '')::numeric;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'party_logistics_qty_nonneg_chk') THEN
    ALTER TABLE party_logistics_items
      ADD CONSTRAINT party_logistics_qty_nonneg_chk CHECK (quantity IS NULL OR quantity >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'party_logistics_price_nonneg_chk') THEN
    ALTER TABLE party_logistics_items
      ADD CONSTRAINT party_logistics_price_nonneg_chk CHECK (unit_price IS NULL OR unit_price >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'party_todos_cost_nonneg_chk') THEN
    ALTER TABLE party_todos
      ADD CONSTRAINT party_todos_cost_nonneg_chk CHECK (cost IS NULL OR cost >= 0);
  END IF;
END $$;
