-- Migration: 076_books_payroll_lifecycle
-- Payroll. The design principle here is refusal:
--
--   Icelandic withholding is three bands of tekjuskattur + utsvar, less a monthly
--   personal credit (personafslattur), on top of a mandatory pension deduction, an
--   employer contribution, tryggingagjald, and optionally union dues and
--   vidbotarsparnadur. Every figure is set annually and published by Skatturinn.
--
--   So the rates are DATA, not code, and a year is unusable until a person has
--   confirmed it against the published table. A run computed from last year's bands
--   looks plausible and under-remits withholding tax, which is the employer's
--   liability. Refusing is the correct behaviour, so this migration seeds NO rates.
--
--   Reglugerd 505/2013 gr. 9 -> a posted run and its payslips are append-only
--   Amounts are whole ISK (BIGINT); rates are stored as NUMERIC decimals (0.3149),
--   and converted to integer basis points in payrollService only for the arithmetic.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application. It is GENERATED from that array — do
-- not hand-edit it, and if the two ever disagree, schema.js wins.

ALTER TABLE employees
         ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'employee';

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_employment_type_check;

ALTER TABLE employees
         ADD CONSTRAINT employees_employment_type_check
         CHECK (employment_type IN ('employee','owner','contractor'));

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_owner_has_category;

ALTER TABLE employees
         ADD CONSTRAINT employees_owner_has_category
         CHECK (employment_type <> 'owner' OR reference_wage_category IS NOT NULL);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS started_on DATE;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS ended_on DATE;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_dates_ordered;

ALTER TABLE employees
         ADD CONSTRAINT employees_dates_ordered
         CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

ALTER TABLE employees
         ADD COLUMN IF NOT EXISTS pension_employee_rate NUMERIC(6,4);

ALTER TABLE employees
         ADD COLUMN IF NOT EXISTS pension_employer_rate NUMERIC(6,4);

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_pension_rates_sane;

ALTER TABLE employees
         ADD CONSTRAINT employees_pension_rates_sane
         CHECK ((pension_employee_rate IS NULL OR pension_employee_rate BETWEEN 0 AND 0.5)
            AND (pension_employer_rate IS NULL OR pension_employer_rate BETWEEN 0 AND 0.5));

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_allowance_factor_check;

ALTER TABLE employees
         ADD CONSTRAINT employees_allowance_factor_check
         CHECK (allowance_factor BETWEEN 0 AND 2);

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_status_check;

ALTER TABLE payroll_runs
         ADD CONSTRAINT payroll_runs_status_check
         CHECK (status IN ('draft','posted','settled','reversed'));

ALTER TABLE payroll_runs ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_period_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payroll_posted_period
         ON payroll_runs (period) WHERE status IN ('posted','settled');

ALTER TABLE payroll_runs
         ADD COLUMN IF NOT EXISTS journal_entry_id TEXT
           REFERENCES journal_entries(id) ON DELETE RESTRICT;

ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

ALTER TABLE payroll_runs
         ADD COLUMN IF NOT EXISTS posted_by TEXT REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE payroll_runs
         ADD COLUMN IF NOT EXISTS preflight JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

ALTER TABLE payroll_runs
         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_payroll_runs_updated_at ON payroll_runs;

CREATE TRIGGER trg_payroll_runs_updated_at
         BEFORE UPDATE ON payroll_runs
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_posted_has_entry;

ALTER TABLE payroll_runs
         ADD CONSTRAINT payroll_posted_has_entry
         CHECK (status = 'draft' OR (journal_entry_id IS NOT NULL AND posted_at IS NOT NULL));

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employee_name TEXT;

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employee_kennitala TEXT;

ALTER TABLE payslips
         ADD COLUMN IF NOT EXISTS document_id TEXT
           REFERENCES books_documents(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_payslips_employee
         ON payslips (employee_id, created_at DESC);

ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslip_net_adds_up;

ALTER TABLE payslips
         ADD CONSTRAINT payslip_net_adds_up
         CHECK (net_pay = gross - withholding - pension_employee - extra_pension_employee - union_dues);

ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslip_withholding_within_tax;

ALTER TABLE payslips
         ADD CONSTRAINT payslip_withholding_within_tax
         CHECK (withholding <= computed_tax);

ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslips_run_id_fkey;

ALTER TABLE payslips
         ADD CONSTRAINT payslips_run_id_fkey
         FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION books_protect_payroll_run()
       RETURNS TRIGGER AS $$
       BEGIN
         IF TG_OP = 'DELETE' THEN
           IF OLD.status <> 'draft' THEN
             RAISE EXCEPTION 'Payroll run % has been posted and cannot be deleted; reverse it instead (Reglugerd 505/2013 gr. 9)', OLD.period
               USING ERRCODE = 'restrict_violation';
           END IF;
           RETURN OLD;
         END IF;
         IF OLD.status IN ('posted','settled')
            AND NEW.status NOT IN ('posted','settled','reversed') THEN
           RAISE EXCEPTION 'A posted payroll run can only be settled or reversed, not returned to %', NEW.status
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF OLD.status = 'reversed' AND NEW.status <> 'reversed' THEN
           RAISE EXCEPTION 'A reversed payroll run is final'
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF OLD.status <> 'draft' AND (
              NEW.period <> OLD.period OR NEW.pay_date <> OLD.pay_date
              OR NEW.gross_total <> OLD.gross_total
              OR NEW.withholding_total <> OLD.withholding_total
              OR NEW.net_total <> OLD.net_total
              OR NEW.social_security_total <> OLD.social_security_total
              OR NEW.tax_year <> OLD.tax_year
              OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id) THEN
           RAISE EXCEPTION 'The figures on posted payroll run % are final (Reglugerd 505/2013 gr. 9)', OLD.period
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payroll_run_protected ON payroll_runs;

CREATE TRIGGER trg_payroll_run_protected
         BEFORE UPDATE OR DELETE ON payroll_runs
         FOR EACH ROW EXECUTE FUNCTION books_protect_payroll_run();

CREATE OR REPLACE FUNCTION books_protect_payslip()
       RETURNS TRIGGER AS $$
       DECLARE v_status TEXT;
       BEGIN
         SELECT status INTO v_status FROM payroll_runs
          WHERE id = COALESCE(NEW.run_id, OLD.run_id);
         -- A parent that no longer exists means its DELETE was permitted, so it was a
         -- draft; let the cascade through rather than blocking on a missing row.
         IF v_status IS NULL OR v_status = 'draft' THEN
           RETURN COALESCE(NEW, OLD);
         END IF;
         -- Attaching the PDF afterwards is the one permitted change: the document is
         -- evidence OF the payslip, not part of its figures.
         IF TG_OP = 'UPDATE'
            AND NEW.run_id = OLD.run_id
            AND NEW.employee_id = OLD.employee_id
            AND NEW.gross = OLD.gross AND NEW.taxable_base = OLD.taxable_base
            AND NEW.withholding = OLD.withholding AND NEW.net_pay = OLD.net_pay
            AND NEW.pension_employee = OLD.pension_employee
            AND NEW.pension_employer = OLD.pension_employer
            AND NEW.social_security = OLD.social_security
            AND NEW.union_dues = OLD.union_dues
            AND OLD.document_id IS NULL AND NEW.document_id IS NOT NULL THEN
           RETURN NEW;
         END IF;
         RAISE EXCEPTION 'Payslips on a posted payroll run are final (Reglugerd 505/2013 gr. 9)'
           USING ERRCODE = 'restrict_violation';
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payslip_protected ON payslips;

CREATE TRIGGER trg_payslip_protected
         BEFORE UPDATE OR DELETE ON payslips
         FOR EACH ROW EXECUTE FUNCTION books_protect_payslip();

CREATE OR REPLACE FUNCTION books_protect_payroll_rates()
       RETURNS TRIGGER AS $$
       DECLARE v_runs INT;
       BEGIN
         SELECT COUNT(*) INTO v_runs FROM payroll_runs
          WHERE tax_year = OLD.tax_year AND status <> 'draft';
         IF v_runs > 0 THEN
           IF TG_OP = 'DELETE' THEN
             RAISE EXCEPTION 'Tax year % has been used by % posted payroll run(s) and cannot be deleted', OLD.tax_year, v_runs
               USING ERRCODE = 'restrict_violation';
           END IF;
           IF NEW.confirmed_at IS NULL
              OR NEW.bands::text <> OLD.bands::text
              OR NEW.personal_allowance <> OLD.personal_allowance
              OR NEW.social_security <> OLD.social_security
              OR NEW.pension_employee <> OLD.pension_employee
              OR NEW.pension_employer <> OLD.pension_employer THEN
             RAISE EXCEPTION 'Tax year % has been used by % posted payroll run(s); its figures are final', OLD.tax_year, v_runs
               USING ERRCODE = 'restrict_violation';
           END IF;
         END IF;
         RETURN COALESCE(NEW, OLD);
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payroll_rates_protected ON payroll_rates;

CREATE TRIGGER trg_payroll_rates_protected
         BEFORE UPDATE OR DELETE ON payroll_rates
         FOR EACH ROW EXECUTE FUNCTION books_protect_payroll_rates();

CREATE TABLE IF NOT EXISTS payroll_reference_wages (
        id            TEXT     PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tax_year      SMALLINT NOT NULL REFERENCES payroll_rates(tax_year) ON DELETE CASCADE,
        category      TEXT     NOT NULL,
        description   TEXT     NOT NULL DEFAULT '',
        monthly_min   BIGINT   NOT NULL CHECK (monthly_min >= 0),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tax_year, category)
      );
