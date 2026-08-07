-- Migration: 076_books_payroll
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
--   Amounts are whole ISK (BIGINT); rates are basis points (31.49% = 3149).
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application. It is GENERATED from that array — do
-- not hand-edit it, and if the two ever disagree, schema.js wins.

CREATE TABLE IF NOT EXISTS payroll_tax_years (
        year                    INT         PRIMARY KEY CHECK (year BETWEEN 2020 AND 2100),

        -- Persónuafsláttur, monthly. Deducted from the computed TAX, not from income.
        personal_credit_monthly BIGINT      NOT NULL CHECK (personal_credit_monthly >= 0),

        -- Tryggingagjald: the employer's contribution on gross pay. An EXPENSE of the
        -- business and a liability to Skatturinn — never a deduction from the employee.
        social_security_bp      INT         NOT NULL CHECK (social_security_bp BETWEEN 0 AND 5000),

        -- Mandatory pension. Both sides are statutory minima that a collective
        -- agreement can raise, which is why they are per-year data and per-employee
        -- overridable rather than constants.
        pension_employee_bp     INT         NOT NULL CHECK (pension_employee_bp BETWEEN 0 AND 3000),
        pension_employer_bp     INT         NOT NULL CHECK (pension_employer_bp BETWEEN 0 AND 3000),

        -- Viðbótarsparnaður caps: the employee may contribute up to the first and the
        -- employer must match up to the second. Above the cap it is not tax-deferred.
        extra_pension_employee_cap_bp INT   NOT NULL DEFAULT 400
                                            CHECK (extra_pension_employee_cap_bp BETWEEN 0 AND 3000),
        extra_pension_employer_cap_bp INT   NOT NULL DEFAULT 200
                                            CHECK (extra_pension_employer_cap_bp BETWEEN 0 AND 3000),

        -- NULL until a person has checked these figures against Skatturinn's published
        -- rates for the year. Nothing can be run against an unconfirmed year.
        confirmed_at            TIMESTAMPTZ,
        confirmed_by            TEXT        REFERENCES users(id) ON DELETE RESTRICT,
        -- WHERE the figures came from. "Checked against skatturinn.is on 2027-01-04" is
        -- the difference between a number someone verified and a number someone typed.
        source_note             TEXT        NOT NULL DEFAULT '',
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT payroll_year_confirmed_together
          CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL))
      );

CREATE TABLE IF NOT EXISTS payroll_tax_brackets (
        id           TEXT    PRIMARY KEY DEFAULT gen_random_uuid()::text,
        year         INT     NOT NULL REFERENCES payroll_tax_years(year) ON DELETE CASCADE,
        sort         INT     NOT NULL,
        income_from  BIGINT  NOT NULL CHECK (income_from >= 0),
        rate_bp      INT     NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
        UNIQUE (year, sort),
        UNIQUE (year, income_from)
      );

CREATE INDEX IF NOT EXISTS idx_payroll_brackets_year
         ON payroll_tax_brackets (year, income_from);

CREATE TABLE IF NOT EXISTS payroll_imputed_minimums (
        id            TEXT    PRIMARY KEY DEFAULT gen_random_uuid()::text,
        year          INT     NOT NULL REFERENCES payroll_tax_years(year) ON DELETE CASCADE,
        -- RSK's own category code (e.g. 'A-1', 'B-2'), stored as published so it can be
        -- checked against the source document without translation.
        category      TEXT    NOT NULL,
        description   TEXT    NOT NULL DEFAULT '',
        monthly_min   BIGINT  NOT NULL CHECK (monthly_min >= 0),
        UNIQUE (year, category)
      );

CREATE TABLE IF NOT EXISTS employees (
        id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        -- Not a users row: an employee is a legal person on a payslip, and most
        -- employees never have a login. The link is offered, not required.
        user_id           TEXT        REFERENCES users(id) ON DELETE SET NULL,
        name              TEXT        NOT NULL,
        kennitala         TEXT        NOT NULL,
        email             TEXT        NOT NULL DEFAULT '',
        address           TEXT        NOT NULL DEFAULT '',
        bank_account      TEXT        NOT NULL DEFAULT '',

        -- 'owner' triggers the reiknað endurgjald check; 'employee' does not.
        employment_type   TEXT        NOT NULL DEFAULT 'employee'
                                      CHECK (employment_type IN ('employee','owner','contractor')),
        imputed_category  TEXT,

        monthly_salary    BIGINT      NOT NULL DEFAULT 0 CHECK (monthly_salary >= 0),

        -- Tax card usage, in basis points of the personal credit. Someone with two jobs
        -- splits it; a spouse may transfer part of theirs, so above 10000 is legitimate.
        personal_credit_bp INT        NOT NULL DEFAULT 10000
                                      CHECK (personal_credit_bp BETWEEN 0 AND 20000),

        pension_fund      TEXT        NOT NULL DEFAULT '',
        -- NULL means "use the statutory rate for the year". A number here is a
        -- collective-agreement rate that differs from the minimum.
        pension_employee_bp INT       CHECK (pension_employee_bp BETWEEN 0 AND 3000),
        pension_employer_bp INT       CHECK (pension_employer_bp BETWEEN 0 AND 3000),
        extra_pension_employee_bp INT NOT NULL DEFAULT 0
                                      CHECK (extra_pension_employee_bp BETWEEN 0 AND 3000),

        union_name        TEXT        NOT NULL DEFAULT '',
        union_dues_bp     INT         NOT NULL DEFAULT 0 CHECK (union_dues_bp BETWEEN 0 AND 2000),

        started_on        DATE,
        ended_on          DATE,
        is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
        note              TEXT        NOT NULL DEFAULT '',
        created_by        TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT employees_dates_ordered
          CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on),
        -- An owner with no category cannot be checked against the minimum, which is the
        -- one thing an owner most needs checked.
        CONSTRAINT employees_owner_has_category
          CHECK (employment_type <> 'owner' OR imputed_category IS NOT NULL)
      );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_employees_kennitala ON employees (kennitala);

CREATE TABLE IF NOT EXISTS payroll_runs (
        id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        period          TEXT        NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
        pay_date        DATE        NOT NULL,
        status          TEXT        NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft','posted','reversed')),

        -- Snapshot totals, so a posted run reports what it posted even after an
        -- employee record is edited.
        total_gross     BIGINT      NOT NULL DEFAULT 0 CHECK (total_gross >= 0),
        total_withholding BIGINT    NOT NULL DEFAULT 0 CHECK (total_withholding >= 0),
        total_pension_employee BIGINT NOT NULL DEFAULT 0 CHECK (total_pension_employee >= 0),
        total_pension_employer BIGINT NOT NULL DEFAULT 0 CHECK (total_pension_employer >= 0),
        total_union     BIGINT      NOT NULL DEFAULT 0 CHECK (total_union >= 0),
        total_social_security BIGINT NOT NULL DEFAULT 0 CHECK (total_social_security >= 0),
        total_net       BIGINT      NOT NULL DEFAULT 0 CHECK (total_net >= 0),

        -- Which tax year's figures were used, and the preflight as it stood at posting.
        tax_year        INT         NOT NULL REFERENCES payroll_tax_years(year) ON DELETE RESTRICT,
        preflight       JSONB       NOT NULL DEFAULT '{}'::jsonb,

        journal_entry_id TEXT       REFERENCES journal_entries(id) ON DELETE RESTRICT,
        posted_at       TIMESTAMPTZ,
        posted_by       TEXT        REFERENCES users(id) ON DELETE RESTRICT,
        note            TEXT        NOT NULL DEFAULT '',
        created_by      TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT payroll_posted_has_entry
          CHECK (status <> 'posted' OR (journal_entry_id IS NOT NULL AND posted_at IS NOT NULL))
      );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payroll_posted_period
         ON payroll_runs (period) WHERE status = 'posted';

CREATE TABLE IF NOT EXISTS payslips (
        id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        run_id            TEXT        NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        employee_id       TEXT        NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,

        -- Identity as it stood on the day, because a payslip is a document, not a view.
        employee_name     TEXT        NOT NULL,
        employee_kennitala TEXT       NOT NULL,

        gross             BIGINT      NOT NULL CHECK (gross >= 0),
        -- Gross less the employee's pension: pension is deducted BEFORE tax, so the
        -- taxable base is not the gross. Getting that backwards over-withholds.
        taxable           BIGINT      NOT NULL CHECK (taxable >= 0),
        computed_tax      BIGINT      NOT NULL CHECK (computed_tax >= 0),
        personal_credit_used BIGINT   NOT NULL CHECK (personal_credit_used >= 0),
        withholding       BIGINT      NOT NULL CHECK (withholding >= 0),
        pension_employee  BIGINT      NOT NULL CHECK (pension_employee >= 0),
        pension_employer  BIGINT      NOT NULL CHECK (pension_employer >= 0),
        extra_pension_employee BIGINT NOT NULL DEFAULT 0 CHECK (extra_pension_employee >= 0),
        extra_pension_employer BIGINT NOT NULL DEFAULT 0 CHECK (extra_pension_employer >= 0),
        union_dues        BIGINT      NOT NULL DEFAULT 0 CHECK (union_dues >= 0),
        social_security   BIGINT      NOT NULL CHECK (social_security >= 0),
        net               BIGINT      NOT NULL CHECK (net >= 0),

        -- The whole derivation: which bands applied, at what rate, to how much. A
        -- payslip nobody can explain is a payslip nobody can dispute.
        detail            JSONB       NOT NULL DEFAULT '{}'::jsonb,
        document_id       TEXT        REFERENCES books_documents(id) ON DELETE RESTRICT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        UNIQUE (run_id, employee_id),
        -- Withholding can never exceed the tax computed before the credit is applied.
        CONSTRAINT payslip_withholding_within_tax CHECK (withholding <= computed_tax),
        -- The identity that makes the payslip arithmetic checkable at rest. If a future
        -- deduction type is added, this constraint must be extended with it — which is
        -- the point: a deduction the net does not account for cannot be stored.
        CONSTRAINT payslip_net_adds_up
          CHECK (net = gross - withholding - pension_employee - extra_pension_employee - union_dues)
      );

CREATE INDEX IF NOT EXISTS idx_payslips_employee
         ON payslips (employee_id, created_at DESC);

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
         IF OLD.status = 'posted' AND NEW.status NOT IN ('posted','reversed') THEN
           RAISE EXCEPTION 'A posted payroll run can only be reversed, not returned to %', NEW.status
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF OLD.status = 'reversed' AND NEW.status <> 'reversed' THEN
           RAISE EXCEPTION 'A reversed payroll run is final'
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF OLD.status = 'posted' AND (
              NEW.period <> OLD.period OR NEW.pay_date <> OLD.pay_date
              OR NEW.total_gross <> OLD.total_gross
              OR NEW.total_withholding <> OLD.total_withholding
              OR NEW.total_net <> OLD.total_net
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
         IF v_status IS DISTINCT FROM 'draft' THEN
           -- Attaching the PDF afterwards is the one permitted change: the document is
           -- evidence OF the payslip, not part of its figures.
           IF TG_OP = 'UPDATE'
              AND NEW.run_id = OLD.run_id
              AND NEW.employee_id = OLD.employee_id
              AND NEW.gross = OLD.gross AND NEW.taxable = OLD.taxable
              AND NEW.withholding = OLD.withholding AND NEW.net = OLD.net
              AND NEW.pension_employee = OLD.pension_employee
              AND NEW.pension_employer = OLD.pension_employer
              AND NEW.social_security = OLD.social_security
              AND NEW.union_dues = OLD.union_dues
              AND OLD.document_id IS NULL AND NEW.document_id IS NOT NULL THEN
             RETURN NEW;
           END IF;
           RAISE EXCEPTION 'Payslips on a posted payroll run are final (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN COALESCE(NEW, OLD);
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payslip_protected ON payslips;

CREATE TRIGGER trg_payslip_protected
         BEFORE UPDATE OR DELETE ON payslips
         FOR EACH ROW EXECUTE FUNCTION books_protect_payslip();

CREATE OR REPLACE FUNCTION books_protect_tax_year()
       RETURNS TRIGGER AS $$
       DECLARE v_runs INT;
       BEGIN
         SELECT COUNT(*) INTO v_runs FROM payroll_runs
          WHERE tax_year = OLD.year AND status <> 'draft';
         IF v_runs > 0 THEN
           IF TG_OP = 'DELETE' THEN
             RAISE EXCEPTION 'Tax year % has been used by % posted payroll run(s) and cannot be deleted', OLD.year, v_runs
               USING ERRCODE = 'restrict_violation';
           END IF;
           IF NEW.confirmed_at IS NULL
              OR NEW.personal_credit_monthly <> OLD.personal_credit_monthly
              OR NEW.social_security_bp <> OLD.social_security_bp
              OR NEW.pension_employee_bp <> OLD.pension_employee_bp
              OR NEW.pension_employer_bp <> OLD.pension_employer_bp THEN
             RAISE EXCEPTION 'Tax year % has been used by % posted payroll run(s); its figures are final', OLD.year, v_runs
               USING ERRCODE = 'restrict_violation';
           END IF;
         END IF;
         RETURN COALESCE(NEW, OLD);
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tax_year_protected ON payroll_tax_years;

CREATE TRIGGER trg_tax_year_protected
         BEFORE UPDATE OR DELETE ON payroll_tax_years
         FOR EACH ROW EXECUTE FUNCTION books_protect_tax_year();

CREATE OR REPLACE FUNCTION books_protect_tax_brackets()
       RETURNS TRIGGER AS $$
       DECLARE v_runs INT; v_year INT;
       BEGIN
         v_year := COALESCE(NEW.year, OLD.year);
         SELECT COUNT(*) INTO v_runs FROM payroll_runs
          WHERE tax_year = v_year AND status <> 'draft';
         IF v_runs > 0 THEN
           RAISE EXCEPTION 'Tax year % has been used by % posted payroll run(s); its bands are final', v_year, v_runs
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN COALESCE(NEW, OLD);
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tax_brackets_protected ON payroll_tax_brackets;

CREATE TRIGGER trg_tax_brackets_protected
         BEFORE INSERT OR UPDATE OR DELETE ON payroll_tax_brackets
         FOR EACH ROW EXECUTE FUNCTION books_protect_tax_brackets();
