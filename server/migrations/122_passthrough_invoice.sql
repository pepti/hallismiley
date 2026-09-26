-- 122_passthrough_invoice — reference copy; the authoritative entry is in
-- server/config/schema.js.
--
-- The pass-through service invoice (D-022, 2026-09-26): hosting beyond the
-- tier's pattern at Azure cost + markup and AI above the monthly allowance at
-- cost + markup, billed with NO seller commission as service_kind
-- 'passthrough'. One per account per period (the monthly AI allowance must not
-- be granted twice); a fully credited or cancelled one frees the slot so a
-- corrected invoice can be issued. The CHECK names the service_kind vocabulary,
-- NOT VALID so existing rows are not scanned (it still binds any later UPDATE of
-- an old row, so a downstream must hold only these values). Expand-only
-- (invariant 14).
-- Rollback: DROP INDEX uniq_invoices_account_passthrough_period;
-- ALTER TABLE invoices DROP CONSTRAINT invoices_service_kind_check.
SET LOCAL lock_timeout = '5s';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoices_account_passthrough_period
  ON invoices (account_id, service_period)
  WHERE account_id IS NOT NULL
    AND service_kind = 'passthrough'
    AND service_period IS NOT NULL
    AND status NOT IN ('cancelled', 'credited');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'invoices_service_kind_check'
                    AND conrelid = 'invoices'::regclass) THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_service_kind_check
      CHECK (service_kind IS NULL OR service_kind IN
        ('build_deposit', 'build_final', 'recurring', 'overage', 'passthrough'))
      NOT VALID;
  END IF;
END $$;
