-- Migration: 078_books_payroll_integrity
-- Payroll integrity hardening: reparent-proof payslip guard, full figure
-- freeze on posted runs, provenance freeze on used tax years, and the séreign totals.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application. It is GENERATED from that array — do
-- not hand-edit it, and if the two ever disagree, schema.js wins.

ALTER TABLE payroll_runs
         ADD COLUMN IF NOT EXISTS extra_pension_employee_total BIGINT NOT NULL DEFAULT 0
           CHECK (extra_pension_employee_total >= 0);

ALTER TABLE payroll_runs
         ADD COLUMN IF NOT EXISTS extra_pension_employer_total BIGINT NOT NULL DEFAULT 0
           CHECK (extra_pension_employer_total >= 0);

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
         -- Once out of draft, only status (posted->settled->reversed), note (reverseRun
         -- appends to it) and updated_at may change. Every figure, the attribution and
         -- the preflight are frozen.
         IF OLD.status <> 'draft' AND (
              NEW.period <> OLD.period OR NEW.pay_date <> OLD.pay_date
              OR NEW.tax_year <> OLD.tax_year
              OR NEW.gross_total <> OLD.gross_total
              OR NEW.withholding_total <> OLD.withholding_total
              OR NEW.pension_employee_total <> OLD.pension_employee_total
              OR NEW.pension_employer_total <> OLD.pension_employer_total
              OR NEW.extra_pension_employee_total <> OLD.extra_pension_employee_total
              OR NEW.extra_pension_employer_total <> OLD.extra_pension_employer_total
              OR NEW.social_security_total <> OLD.social_security_total
              OR NEW.union_total <> OLD.union_total
              OR NEW.net_total <> OLD.net_total
              OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
              OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
              OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
              OR NEW.created_by IS DISTINCT FROM OLD.created_by
              OR NEW.preflight::text <> OLD.preflight::text) THEN
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
       DECLARE v_old_status TEXT; v_new_status TEXT;
       BEGIN
         IF TG_OP = 'DELETE' THEN
           SELECT status INTO v_old_status FROM payroll_runs WHERE id = OLD.run_id;
           -- A parent that no longer exists means its own DELETE was permitted, so it
           -- was a draft; let the cascade through.
           IF v_old_status IS NULL OR v_old_status = 'draft' THEN
             RETURN OLD;
           END IF;
           RAISE EXCEPTION 'Payslips on a posted payroll run are final (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;

         SELECT status INTO v_old_status FROM payroll_runs WHERE id = OLD.run_id;
         SELECT status INTO v_new_status FROM payroll_runs WHERE id = NEW.run_id;

         -- Reparenting is refused outright: a payslip cannot move between runs. Moving
         -- it OFF a posted run (onto a draft, then deleting the draft) was the way the
         -- posted-run guard got sidestepped.
         IF NEW.run_id <> OLD.run_id THEN
           RAISE EXCEPTION 'A payslip cannot be moved to another payroll run (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;

         -- Both parents are the same run now. If it is a draft, the payslip is editable.
         IF v_old_status IS NULL OR v_old_status = 'draft' THEN
           RETURN NEW;
         END IF;

         -- Posted run: the ONLY permitted change is attaching the PDF for the first
         -- time. Every figure and the snapshotted identity must be byte-identical.
         IF NEW.employee_id = OLD.employee_id
            AND NEW.employee_name = OLD.employee_name
            AND NEW.employee_kennitala = OLD.employee_kennitala
            AND NEW.gross = OLD.gross AND NEW.taxable_base = OLD.taxable_base
            AND NEW.computed_tax = OLD.computed_tax
            AND NEW.allowance_used = OLD.allowance_used
            AND NEW.withholding = OLD.withholding AND NEW.net_pay = OLD.net_pay
            AND NEW.pension_employee = OLD.pension_employee
            AND NEW.pension_employer = OLD.pension_employer
            AND NEW.extra_pension_employee = OLD.extra_pension_employee
            AND NEW.extra_pension_employer = OLD.extra_pension_employer
            AND NEW.social_security = OLD.social_security
            AND NEW.union_dues = OLD.union_dues
            AND NEW.breakdown::text = OLD.breakdown::text
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
              OR NEW.municipal_rate <> OLD.municipal_rate
              OR NEW.social_security <> OLD.social_security
              OR NEW.pension_employee <> OLD.pension_employee
              OR NEW.pension_employer <> OLD.pension_employer
              OR NEW.source_note <> OLD.source_note
              OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
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
