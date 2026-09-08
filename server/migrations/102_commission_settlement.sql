-- 102_commission_settlement — reference copy of the migration in server/config/schema.js
--
-- Sölustjóri's design; D-019 (2026-09-08, amending D-003) is the decision behind
-- it. 098 built the commission ACCRUAL ledger — one row per commissionable
-- invoice — but nothing recorded that Halli had actually paid a seller. Run the
-- report twice and it said the same thing.
--
-- The unit of settlement is the seller-MONTH STATEMENT over a RUNNING BALANCE,
-- not a set of pinned events. Payability is derived, not stored: an event that
-- is payable in month M can stop being payable in M+2 when a credit note lands,
-- so pinning events would need un-pinning, which is the clawback problem again
-- one level down. The balance identity, at any instant:
--
--   balance = Σ payable_now(event) + Σ adjustments − Σ payouts
--
-- Clawback is not a separate mechanism. It is this equation going DOWN when a
-- sale is credited, and per D-019 it is netted against future statements only,
-- for 12 months; the company never invoices a seller for cash. That is why
-- there is no receivable table here and no status on commission_events.
--
-- commission_events keeps its UNIQUE(invoice_id) UNCHANGED and deliberately:
-- it is the only thing stopping a re-issue path writing two commission rows for
-- one invoice. If a later release genuinely needs several rows per invoice, the
-- expand path is (N) add `reversal_of` + a partial unique index over
-- invoice_id WHERE reversal_of IS NULL, then (N+1) drop the total constraint —
-- never a bare DROP CONSTRAINT, which keeps old code RUNNING while silently
-- removing a guarantee it relies on.
--
-- Pure expand (invariant 14): three nullable columns on users and four new
-- tables. Nothing existing is altered or dropped.

-- 1. Who the payee is, for the verktakamiði and for the payroll fork.
--    NULL reads as 'contractor' everywhere: D-004 is the default engagement.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payee_kind       TEXT,
  ADD COLUMN IF NOT EXISTS payee_kennitala  TEXT,
  ADD COLUMN IF NOT EXISTS payee_vat_number TEXT;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_payee_kind_valid;
ALTER TABLE users ADD CONSTRAINT users_payee_kind_valid
  CHECK (payee_kind IS NULL OR payee_kind IN ('contractor', 'employee', 'internal'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_payee_kennitala_shape;
ALTER TABLE users ADD CONSTRAINT users_payee_kennitala_shape
  CHECK (payee_kennitala IS NULL OR payee_kennitala ~ '^[0-9]{10}$');

-- 2. The statement: a periodic account statement over the running balance.
CREATE TABLE IF NOT EXISTS commission_statements (
  id                    BIGSERIAL   PRIMARY KEY,
  seller_user_id        TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  period                DATE        NOT NULL,
  cutoff_at             TIMESTAMPTZ NOT NULL,
  previous_statement_id BIGINT      REFERENCES commission_statements(id) ON DELETE RESTRICT,
  payee_kind            TEXT        NOT NULL DEFAULT 'contractor'
                                    CHECK (payee_kind IN ('contractor', 'employee', 'internal')),
  payee_kennitala       TEXT,
  payee_vat_number      TEXT,
  opening_balance_isk   BIGINT      NOT NULL,
  earned_isk            BIGINT      NOT NULL DEFAULT 0 CHECK (earned_isk >= 0),
  clawback_isk          BIGINT      NOT NULL DEFAULT 0 CHECK (clawback_isk >= 0),
  adjustment_isk        BIGINT      NOT NULL DEFAULT 0,
  settled_isk           BIGINT      NOT NULL DEFAULT 0 CHECK (settled_isk >= 0),
  closing_balance_isk   BIGINT      NOT NULL,
  minimum_isk           BIGINT      NOT NULL DEFAULT 25000 CHECK (minimum_isk >= 0),
  payable_isk           BIGINT      NOT NULL CHECK (payable_isk >= 0),
  carried_isk           BIGINT      NOT NULL,
  amount_paid_isk       BIGINT      NOT NULL DEFAULT 0 CHECK (amount_paid_isk >= 0),
  currency              TEXT        NOT NULL DEFAULT 'ISK' CHECK (currency = 'ISK'),
  note                  TEXT        NOT NULL DEFAULT '',
  issued_by             TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commission_statements_period_first_day
    CHECK (EXTRACT(DAY FROM period) = 1),
  -- The arithmetic is a constraint, not a convention: a composer bug becomes a
  -- failed INSERT rather than a wrong statement someone invoices against.
  CONSTRAINT commission_statements_balance
    CHECK (closing_balance_isk =
           opening_balance_isk + earned_isk - clawback_isk + adjustment_isk - settled_isk),
  CONSTRAINT commission_statements_split
    CHECK (closing_balance_isk = payable_isk + carried_isk),
  CONSTRAINT commission_statements_paid_within
    CHECK (amount_paid_isk <= payable_isk),
  -- Halli owning his own accounts is an ATTRIBUTION, never a payout.
  CONSTRAINT commission_statements_internal_never_payable
    CHECK (payee_kind <> 'internal' OR payable_isk = 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_commission_statements_seller_period
  ON commission_statements (seller_user_id, period);
-- The chain, enforced by the database rather than by a lock: two concurrent
-- runs read the same predecessor and both try to link to it; one gets 23505.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_commission_statements_chain
  ON commission_statements (previous_statement_id)
  WHERE previous_statement_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_commission_statements_genesis
  ON commission_statements (seller_user_id)
  WHERE previous_statement_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_commission_statements_seller
  ON commission_statements (seller_user_id, period DESC);

-- 3. Adjustments: the only way a balance moves other than by earning or paying.
CREATE TABLE IF NOT EXISTS commission_adjustments (
  id             BIGSERIAL   PRIMARY KEY,
  seller_user_id TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_id     INTEGER     REFERENCES customer_accounts(id) ON DELETE SET NULL,
  kind           TEXT        NOT NULL CHECK (kind IN ('writeoff', 'manual_credit', 'manual_debit')),
  amount_isk     BIGINT      NOT NULL CHECK (amount_isk <> 0),
  reason         TEXT        NOT NULL CHECK (length(btrim(reason)) >= 3),
  effective_on   DATE        NOT NULL,
  created_by     TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A writeoff FORGIVES a negative balance, so it is positive. A manual_debit
  -- reduces what the company owes, so it is negative. Encoding the sign in the
  -- CHECK stops "I'll just make it negative" from silently inverting a writeoff.
  CONSTRAINT commission_adjustments_sign CHECK (
    (kind = 'writeoff'      AND amount_isk > 0) OR
    (kind = 'manual_credit' AND amount_isk > 0) OR
    (kind = 'manual_debit'  AND amount_isk < 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_commission_adjustments_seller
  ON commission_adjustments (seller_user_id, id);

-- 4. Payouts. `seller_vat_isk` is OUTSIDE amount_isk: the commission is the
--    commission, VSK is what a registered seller adds on their own invoice, and
--    the bank transfer is the sum of the two.
CREATE TABLE IF NOT EXISTS commission_payouts (
  id                    BIGSERIAL   PRIMARY KEY,
  statement_id          BIGINT      NOT NULL REFERENCES commission_statements(id) ON DELETE RESTRICT,
  seller_user_id        TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_isk            BIGINT      NOT NULL CHECK (amount_isk > 0),
  paid_on               DATE        NOT NULL,
  method                TEXT        NOT NULL CHECK (method IN ('bank_transfer', 'payroll', 'other')),
  reference             TEXT        NOT NULL DEFAULT '',
  seller_invoice_number TEXT,
  seller_invoice_date   DATE,
  seller_vat_isk        BIGINT      NOT NULL DEFAULT 0 CHECK (seller_vat_isk >= 0),
  expense_id            TEXT        REFERENCES expenses(id) ON DELETE SET NULL,
  idempotency_key       TEXT        NOT NULL,
  note                  TEXT        NOT NULL DEFAULT '',
  created_by            TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_commission_payouts_idempotency
  ON commission_payouts (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_statement ON commission_payouts (statement_id, id);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_seller    ON commission_payouts (seller_user_id, id);

-- 5. Statement lines. The unique indexes here are the WINDOW mechanism: what a
--    statement consumes is a SET DIFFERENCE, never a date range, so a row that
--    arrives late cannot fall between two windows and vanish.
CREATE TABLE IF NOT EXISTS commission_statement_lines (
  id                  BIGSERIAL   PRIMARY KEY,
  statement_id        BIGINT      NOT NULL REFERENCES commission_statements(id) ON DELETE RESTRICT,
  line_kind           TEXT        NOT NULL CHECK (line_kind IN ('earned', 'clawback', 'adjustment', 'payout')),
  commission_event_id BIGINT      REFERENCES commission_events(id)      ON DELETE RESTRICT,
  adjustment_id       BIGINT      REFERENCES commission_adjustments(id) ON DELETE RESTRICT,
  payout_id           BIGINT      REFERENCES commission_payouts(id)     ON DELETE RESTRICT,
  account_id          INTEGER     REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  invoice_id          TEXT        REFERENCES invoices(id) ON DELETE RESTRICT,
  description         TEXT        NOT NULL DEFAULT '',
  -- The two snapshots that make a delta reproducible years later, after the
  -- underlying invoice has moved on.
  payable_before_isk  BIGINT      NOT NULL DEFAULT 0,
  payable_after_isk   BIGINT      NOT NULL DEFAULT 0,
  amount_isk          BIGINT      NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commission_statement_lines_one_source
    CHECK (num_nonnulls(commission_event_id, adjustment_id, payout_id) = 1),
  CONSTRAINT commission_statement_lines_kind_source CHECK (
    (line_kind IN ('earned', 'clawback') AND commission_event_id IS NOT NULL) OR
    (line_kind = 'adjustment'            AND adjustment_id       IS NOT NULL) OR
    (line_kind = 'payout'                AND payout_id           IS NOT NULL)
  ),
  CONSTRAINT commission_statement_lines_delta CHECK (
    line_kind NOT IN ('earned', 'clawback')
    OR amount_isk = payable_after_isk - payable_before_isk
  ),
  CONSTRAINT commission_statement_lines_sign CHECK (
    (line_kind = 'earned'     AND amount_isk > 0) OR
    (line_kind = 'clawback'   AND amount_isk < 0) OR
    (line_kind = 'payout'     AND amount_isk < 0) OR
    (line_kind = 'adjustment' AND amount_isk <> 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_commission_lines_event
  ON commission_statement_lines (statement_id, commission_event_id)
  WHERE commission_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commission_lines_event_latest
  ON commission_statement_lines (commission_event_id, statement_id DESC)
  WHERE commission_event_id IS NOT NULL;
-- GLOBAL uniqueness: an adjustment and a payout may be consumed by exactly ONE
-- statement, ever.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_commission_lines_adjustment
  ON commission_statement_lines (adjustment_id) WHERE adjustment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_commission_lines_payout
  ON commission_statement_lines (payout_id) WHERE payout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commission_lines_statement
  ON commission_statement_lines (statement_id, id);

-- 6. Immutability. Lines, adjustments and payouts are primary records — the same
--    rule and the same function as payments, credit notes and books_audit_log.
DROP TRIGGER IF EXISTS trg_commission_statement_lines_immutable ON commission_statement_lines;
CREATE TRIGGER trg_commission_statement_lines_immutable
  BEFORE UPDATE OR DELETE ON commission_statement_lines
  FOR EACH ROW EXECUTE FUNCTION books_forbid_any_mutation();

DROP TRIGGER IF EXISTS trg_commission_adjustments_immutable ON commission_adjustments;
CREATE TRIGGER trg_commission_adjustments_immutable
  BEFORE UPDATE OR DELETE ON commission_adjustments
  FOR EACH ROW EXECUTE FUNCTION books_forbid_any_mutation();

DROP TRIGGER IF EXISTS trg_commission_payouts_immutable ON commission_payouts;
CREATE TRIGGER trg_commission_payouts_immutable
  BEFORE UPDATE OR DELETE ON commission_payouts
  FOR EACH ROW EXECUTE FUNCTION books_forbid_any_mutation();

-- The statement header cannot be frozen whole: amount_paid_isk is a counter, the
-- same shape as invoices.amount_paid. So every figure that CONSTITUTES the
-- document is frozen and the counter is not.
CREATE OR REPLACE FUNCTION commission_statement_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commission_statements rows cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.seller_user_id      <> OLD.seller_user_id
     OR NEW.period              <> OLD.period
     OR NEW.cutoff_at           <> OLD.cutoff_at
     OR NEW.previous_statement_id IS DISTINCT FROM OLD.previous_statement_id
     OR NEW.payee_kind          <> OLD.payee_kind
     OR NEW.payee_kennitala     IS DISTINCT FROM OLD.payee_kennitala
     OR NEW.payee_vat_number    IS DISTINCT FROM OLD.payee_vat_number
     OR NEW.opening_balance_isk <> OLD.opening_balance_isk
     OR NEW.earned_isk          <> OLD.earned_isk
     OR NEW.clawback_isk        <> OLD.clawback_isk
     OR NEW.adjustment_isk      <> OLD.adjustment_isk
     OR NEW.settled_isk         <> OLD.settled_isk
     OR NEW.closing_balance_isk <> OLD.closing_balance_isk
     OR NEW.minimum_isk         <> OLD.minimum_isk
     OR NEW.payable_isk         <> OLD.payable_isk
     OR NEW.carried_isk         <> OLD.carried_isk
     OR NEW.issued_by           <> OLD.issued_by
     OR NEW.issued_at           <> OLD.issued_at
     OR NEW.note IS DISTINCT FROM OLD.note THEN
    RAISE EXCEPTION 'A commission statement is immutable once issued; only amount_paid_isk may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_commission_statements_guard ON commission_statements;
CREATE TRIGGER trg_commission_statements_guard
  BEFORE UPDATE OR DELETE ON commission_statements
  FOR EACH ROW EXECUTE FUNCTION commission_statement_guard();

DROP TRIGGER IF EXISTS trg_commission_statements_updated_at ON commission_statements;
CREATE TRIGGER trg_commission_statements_updated_at
  BEFORE UPDATE ON commission_statements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
