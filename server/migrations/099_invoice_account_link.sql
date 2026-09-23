-- 099_invoice_account_link — reference copy of the migration in server/config/schema.js
-- Review fix (2026-09-07): a service invoice knew which customer account it was
-- for only through commission_events, so an `overage` invoice (no commission
-- row) had no link at all, the billed month lived only inside a description
-- string, and — worst — nothing could express "this account already has a build
-- deposit". A double-click on "Gefa út reikning" issued two immutable revenue
-- invoices and two commission rows; under Reglugerð 505/2013 neither can be
-- deleted, only credited.
--
-- Pure expand (invariant 14): three nullable columns on `invoices` and two
-- partial unique indexes. The previous release writes none of them, so its rows
-- carry NULL and the partial indexes ignore them entirely.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS account_id     INTEGER REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS service_kind   TEXT,
  ADD COLUMN IF NOT EXISTS service_period DATE;

CREATE INDEX IF NOT EXISTS idx_invoices_account ON invoices (account_id, issued_at DESC)
  WHERE account_id IS NOT NULL;

-- One build instalment per half, per account. A cancelled invoice frees the
-- slot so a mistake can be redone; a CREDITED one does not, because the credit
-- note is the correction and re-issuing would double the revenue.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoices_account_build
  ON invoices (account_id, service_kind)
  WHERE account_id IS NOT NULL
    AND service_kind IN ('build_deposit', 'build_final')
    AND status <> 'cancelled';

-- One contract invoice per account per month.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoices_account_period
  ON invoices (account_id, service_period)
  WHERE account_id IS NOT NULL
    AND service_kind = 'recurring'
    AND service_period IS NOT NULL
    AND status <> 'cancelled';

-- Overage is deliberately unguarded: several overage invoices in one month are
-- legitimate (different batches of verkeiningar).
