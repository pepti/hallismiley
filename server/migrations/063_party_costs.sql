-- Migration: 063_party_costs
-- Cost tracking for the party planner. Logistics rows get a numeric quantity
-- + integer unit_price (whole ISK) so a line cost (qty × price) can be
-- computed and summed into the admin page's Cost overview; todos get an
-- optional integer cost.
--
-- quantity was free text ("2 kassar", "6-pack", "1.234 stk"). Conversion
-- rules (Icelandic-first — "." and space are thousands separators, "," is
-- the decimal comma; "." with 1-2 digits also accepted as a decimal):
--   thousands-grouped  "1.234 stk" / "1 000"      -> 1234 / 1000  + note
--   simple number      "100" / "2,5 kg" / "6-pack" -> 100 / 2.5 / 6 + note
--   anything ambiguous, oversized (> 10 integer digits would overflow
--   NUMERIC(12,2) and abort the migration at container startup), or
--   non-numeric ("handfylli", "1,2345", "12345678901") -> quantity NULL and
--   the FULL original text preserved in quantity_note — never corrupted,
--   never lost, and startup can never fail on weird prod data.
--
-- The conversion computes note+number in ONE pass (temp numeric column,
-- shared CASE conditions), then swaps the columns. The DO block only runs
-- while quantity is still text, so re-runs and fresh installs (where 042
-- just created it as TEXT) are both safe.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application.

ALTER TABLE party_logistics_items ADD COLUMN IF NOT EXISTS quantity_note TEXT;
ALTER TABLE party_logistics_items ADD COLUMN IF NOT EXISTS unit_price INTEGER;
ALTER TABLE party_todos ADD COLUMN IF NOT EXISTS cost INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'party_logistics_items'
       AND column_name = 'quantity' AND data_type = 'text'
  ) THEN
    ALTER TABLE party_logistics_items ADD COLUMN quantity_num NUMERIC(12,2);
    UPDATE party_logistics_items p
       SET quantity_num  = s.qnum,
           quantity_note = s.qnote
      FROM (
        SELECT id,
               CASE
                 WHEN tt IS NOT NULL AND length(regexp_replace(tt, '[. ]', '', 'g')) <= 10
                   THEN regexp_replace(tt, '[. ]', '', 'g')::numeric
                 WHEN st IS NOT NULL
                   THEN replace(st, ',', '.')::numeric
                 ELSE NULL
               END AS qnum,
               CASE
                 WHEN tt IS NOT NULL AND length(regexp_replace(tt, '[. ]', '', 'g')) <= 10
                   THEN NULLIF(btrim(substr(trimmed, length(tt) + 1)), '')
                 WHEN st IS NOT NULL
                   THEN NULLIF(btrim(substr(trimmed, length(st) + 1)), '')
                 ELSE NULLIF(trimmed, '')
               END AS qnote
          FROM (
            SELECT id,
                   btrim(quantity) AS trimmed,
                   substring(btrim(quantity) from '^([0-9]{1,3}([. ][0-9]{3})+)($|[^0-9])')     AS tt,
                   substring(btrim(quantity) from '^([0-9]{1,9}([.,][0-9]{1,2})?)($|[^0-9.,])') AS st
              FROM party_logistics_items
             WHERE quantity IS NOT NULL
          ) x
      ) s
     WHERE p.id = s.id;
    ALTER TABLE party_logistics_items DROP COLUMN quantity;
    ALTER TABLE party_logistics_items RENAME COLUMN quantity_num TO quantity;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'party_logistics_qty_nonneg_chk'
                    AND conrelid = 'public.party_logistics_items'::regclass) THEN
    ALTER TABLE party_logistics_items
      ADD CONSTRAINT party_logistics_qty_nonneg_chk CHECK (quantity IS NULL OR quantity >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'party_logistics_price_nonneg_chk'
                    AND conrelid = 'public.party_logistics_items'::regclass) THEN
    ALTER TABLE party_logistics_items
      ADD CONSTRAINT party_logistics_price_nonneg_chk CHECK (unit_price IS NULL OR unit_price >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'party_todos_cost_nonneg_chk'
                    AND conrelid = 'public.party_todos'::regclass) THEN
    ALTER TABLE party_todos
      ADD CONSTRAINT party_todos_cost_nonneg_chk CHECK (cost IS NULL OR cost >= 0);
  END IF;
END $$;
