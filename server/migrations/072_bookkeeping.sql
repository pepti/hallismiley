-- Migration: 072_bookkeeping
-- Bokhald — the real books. Design is driven by Icelandic law:
--   Reglugerd 505/2013 gr. 8  -> who/when/source-document on every entry
--   Reglugerd 505/2013 gr. 9  -> posted entries are append-only (triggers below)
--   Reglugerd 505/2013 gr. 16 -> gapless number series per document type
--   Bokhaldslog 145/1994 gr. 10a -> books kept in ISK (BIGINT minor units)
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application. It is GENERATED from that array — do
-- not hand-edit it, and if the two ever disagree, schema.js wins.

CREATE TABLE IF NOT EXISTS ledger_accounts (
        id                 TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        code               TEXT        NOT NULL UNIQUE,
        name               TEXT        NOT NULL,
        name_en            TEXT        NOT NULL,
        type               TEXT        NOT NULL
                                       CHECK (type IN ('asset','liability','equity','revenue','expense')),
        vat_code           TEXT        NOT NULL DEFAULT 'none'
                                       CHECK (vat_code IN ('none','output_24','output_11','output_0','input_24','input_11','exempt')),
        input_vat_blocked  BOOLEAN     NOT NULL DEFAULT FALSE,
        description        TEXT        NOT NULL DEFAULT '',
        is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
        sort               INTEGER     NOT NULL DEFAULT 0,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_type ON ledger_accounts (type, sort);

DROP TRIGGER IF EXISTS trg_ledger_accounts_updated_at ON ledger_accounts;

CREATE TRIGGER trg_ledger_accounts_updated_at
         BEFORE UPDATE ON ledger_accounts
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS bookkeeping_counters (
        name        TEXT        PRIMARY KEY,
        next_value  BIGINT      NOT NULL CHECK (next_value > 0),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

CREATE TABLE IF NOT EXISTS fiscal_periods (
        period      TEXT        PRIMARY KEY,
        starts_on   DATE        NOT NULL,
        ends_on     DATE        NOT NULL,
        status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked')),
        locked_at   TIMESTAMPTZ,
        locked_by   TEXT        REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fiscal_periods_range CHECK (ends_on >= starts_on),
        CONSTRAINT fiscal_periods_locked_meta
          CHECK ((status = 'locked') = (locked_at IS NOT NULL))
      );

CREATE INDEX IF NOT EXISTS idx_fiscal_periods_range ON fiscal_periods (starts_on, ends_on);

CREATE TABLE IF NOT EXISTS fx_rates (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        rate_date   DATE        NOT NULL,
        currency    TEXT        NOT NULL CHECK (currency IN ('EUR','USD','GBP','DKK')),
        rate        NUMERIC(14,6) NOT NULL CHECK (rate > 0),
        source      TEXT        NOT NULL CHECK (source IN ('cbi','manual')),
        created_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (rate_date, currency)
      );

CREATE TABLE IF NOT EXISTS books_documents (
        id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        kind             TEXT        NOT NULL DEFAULT 'receipt'
                                     CHECK (kind IN ('receipt','supplier_invoice','bank_statement','contract','other')),
        original_name    TEXT        NOT NULL,
        file_path        TEXT        NOT NULL,
        mime_type        TEXT        NOT NULL,
        byte_size        BIGINT      NOT NULL CHECK (byte_size > 0),
        checksum_sha256  TEXT        NOT NULL,
        note             TEXT        NOT NULL DEFAULT '',
        created_by       TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

CREATE INDEX IF NOT EXISTS idx_books_documents_created ON books_documents (created_at DESC);

CREATE TABLE IF NOT EXISTS invoices (
        id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        series                TEXT        NOT NULL DEFAULT 'invoice'
                                          CHECK (series IN ('invoice','receipt')),
        invoice_number        BIGINT      NOT NULL CHECK (invoice_number > 0),
        order_id              TEXT        REFERENCES orders(id) ON DELETE RESTRICT,
        user_id               TEXT        REFERENCES users(id) ON DELETE SET NULL,
        seller_name           TEXT        NOT NULL,
        seller_kennitala      TEXT        NOT NULL,
        seller_vat_number     TEXT        NOT NULL,
        seller_address        TEXT        NOT NULL DEFAULT '',
        customer_name         TEXT        NOT NULL,
        customer_kennitala    TEXT,
        customer_email        TEXT,
        customer_address      TEXT        NOT NULL DEFAULT '',
        customer_country      TEXT        NOT NULL DEFAULT 'IS',
        issued_at             TIMESTAMPTZ NOT NULL,
        due_at                TIMESTAMPTZ NOT NULL,
        terms_days            INTEGER     NOT NULL DEFAULT 14 CHECK (terms_days >= 0),
        currency              TEXT        NOT NULL DEFAULT 'ISK' CHECK (currency = 'ISK'),
        original_currency     TEXT        NOT NULL DEFAULT 'ISK'
                                          CHECK (original_currency IN ('ISK','EUR')),
        original_total_gross  BIGINT      CHECK (original_total_gross IS NULL OR original_total_gross >= 0),
        fx_rate               NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (fx_rate > 0),
        subtotal_net          BIGINT      NOT NULL CHECK (subtotal_net >= 0),
        vat_total             BIGINT      NOT NULL CHECK (vat_total >= 0),
        total_gross           BIGINT      NOT NULL CHECK (total_gross >= 0),
        discount_total        BIGINT      NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
        shipping_gross        BIGINT      NOT NULL DEFAULT 0 CHECK (shipping_gross >= 0),
        amount_paid           BIGINT      NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
        amount_credited       BIGINT      NOT NULL DEFAULT 0 CHECK (amount_credited >= 0),
        -- Money returned to the customer. A refund is TWO separate facts and needs
        -- two counters: the credit note reverses the SALE (amount_credited), and
        -- the disbursement records the CASH leaving (amount_refunded). Collapsing
        -- them makes a paid-then-refunded invoice unrepresentable.
        amount_refunded       BIGINT      NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
        zero_rate_reason      TEXT,
        note                  TEXT        NOT NULL DEFAULT '',
        status                TEXT        NOT NULL DEFAULT 'issued'
                                          CHECK (status IN ('draft','issued','credited','cancelled')),
        created_by            TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT invoices_totals_consistent
          CHECK (subtotal_net + vat_total = total_gross),
        -- Each counter is bounded by its own meaning rather than by a combined sum.
        -- The obvious-looking "paid + credited <= total" is
        -- WRONG: a fully paid invoice that is then fully refunded legitimately has
        -- both at the full amount, and that constraint made the entire refund flow
        -- impossible (the credit note wrote its rows, then the invoice UPDATE
        -- violated the CHECK and rolled the whole transaction back).
        CONSTRAINT invoices_paid_within_total    CHECK (amount_paid <= total_gross),
        CONSTRAINT invoices_credited_within_total CHECK (amount_credited <= total_gross),
        CONSTRAINT invoices_refund_within_paid   CHECK (amount_refunded <= amount_paid),
        CONSTRAINT invoices_fx_audit
          CHECK ((original_currency = 'ISK') = (original_total_gross IS NULL)),
        CONSTRAINT invoices_due_after_issue CHECK (due_at >= issued_at)
      );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoices_series_number
         ON invoices (series, invoice_number);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoices_order_id
         ON invoices (order_id) WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_issued_at ON invoices (issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_customer_email ON invoices (customer_email);

CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices (user_id);

CREATE INDEX IF NOT EXISTS idx_invoices_open
         ON invoices (due_at) WHERE status = 'issued';

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;

CREATE TRIGGER trg_invoices_updated_at
         BEFORE UPDATE ON invoices
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS invoice_lines (
        id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        invoice_id        TEXT        NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
        product_id        TEXT        REFERENCES products(id) ON DELETE SET NULL,
        sku               TEXT,
        description       TEXT        NOT NULL,
        quantity          NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
        unit_price_gross  BIGINT      NOT NULL CHECK (unit_price_gross >= 0),
        vat_rate          SMALLINT    NOT NULL DEFAULT 24 CHECK (vat_rate IN (0,11,24)),
        -- An order-level discount is ALLOCATED across the lines it applies to, but
        -- the allocated amount is kept visible rather than quietly folded into
        -- unit_price_gross. Reglugerð 50/1993 requires the invoice to state
        -- quantity and unit price, and a customer who was shown 9.900 kr. must not
        -- receive a document claiming the item cost 8.910 kr.
        gross_before_discount BIGINT  NOT NULL CHECK (gross_before_discount >= 0),
        discount_gross    BIGINT      NOT NULL DEFAULT 0 CHECK (discount_gross >= 0),
        line_net          BIGINT      NOT NULL CHECK (line_net >= 0),
        line_vat          BIGINT      NOT NULL CHECK (line_vat >= 0),
        line_gross        BIGINT      NOT NULL CHECK (line_gross >= 0),
        revenue_account   TEXT        NOT NULL,
        sort_order        INTEGER     NOT NULL DEFAULT 0,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT invoice_lines_totals_consistent
          CHECK (line_net + line_vat = line_gross),
        CONSTRAINT invoice_lines_discount_consistent
          CHECK (gross_before_discount - discount_gross = line_gross),
        CONSTRAINT invoice_lines_zero_rate_has_no_vat
          CHECK (vat_rate <> 0 OR line_vat = 0)
      );

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines (invoice_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_vat_rate ON invoice_lines (invoice_id, vat_rate);

CREATE TABLE IF NOT EXISTS payments (
        id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        invoice_id       TEXT        NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
        -- 'in'  = money received from the customer
        -- 'out' = money returned to them (a refund disbursement)
        -- One settlement ledger with a direction, rather than a second table:
        -- both sides share the same idempotency, immutability and audit machinery,
        -- and the amount stays positive so the CHECK still means what it says.
        direction        TEXT        NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
        amount           BIGINT      NOT NULL CHECK (amount > 0),
        method           TEXT        NOT NULL
                                     CHECK (method IN ('bank_transfer','cash','card','stripe','other')),
        received_at      TIMESTAMPTZ NOT NULL,
        reference        TEXT        NOT NULL DEFAULT '',
        idempotency_key  TEXT        NOT NULL,
        created_by       TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_invoice_idempotency
         ON payments (invoice_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id, received_at);

CREATE TABLE IF NOT EXISTS credit_notes (
        id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        credit_note_number  BIGINT      NOT NULL UNIQUE CHECK (credit_note_number > 0),
        invoice_id          TEXT        NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
        amount_net          BIGINT      NOT NULL CHECK (amount_net >= 0),
        amount_vat          BIGINT      NOT NULL CHECK (amount_vat >= 0),
        amount_gross        BIGINT      NOT NULL CHECK (amount_gross > 0),
        reason              TEXT        NOT NULL,
        issued_at           TIMESTAMPTZ NOT NULL,
        stripe_refund_id    TEXT        UNIQUE,
        created_by          TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT credit_notes_totals_consistent
          CHECK (amount_net + amount_vat = amount_gross)
      );

CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes (invoice_id);

CREATE TABLE IF NOT EXISTS journal_entries (
        id                 TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        entry_number       BIGINT      UNIQUE CHECK (entry_number > 0),
        entry_date         DATE        NOT NULL,
        memo               TEXT        NOT NULL,
        source_type        TEXT        NOT NULL
                                       CHECK (source_type IN ('invoice','payment','credit_note','expense',
                                                              'payroll','vat_settlement','opening','manual',
                                                              'reversal','stripe','bank')),
        source_id          TEXT,
        document_id        TEXT        REFERENCES books_documents(id) ON DELETE SET NULL,
        reverses_entry_id  TEXT        REFERENCES journal_entries(id) ON DELETE RESTRICT,
        is_correction      BOOLEAN     NOT NULL DEFAULT FALSE,
        posted_at          TIMESTAMPTZ,
        created_by         TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT journal_entries_posted_has_number
          CHECK ((posted_at IS NULL) = (entry_number IS NULL))
      );

CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries (entry_date, id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_posted
         ON journal_entries (entry_date) WHERE posted_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_journal_reversal
         ON journal_entries (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS journal_lines (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        entry_id    TEXT        NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        account_id  TEXT        NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
        debit       BIGINT      NOT NULL DEFAULT 0 CHECK (debit >= 0),
        credit      BIGINT      NOT NULL DEFAULT 0 CHECK (credit >= 0),
        memo        TEXT        NOT NULL DEFAULT '',
        vat_rate    SMALLINT    CHECK (vat_rate IS NULL OR vat_rate IN (0,11,24)),
        sort_order  INTEGER     NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT journal_lines_one_side CHECK ((debit = 0) <> (credit = 0))
      );

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines (entry_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines (account_id);

CREATE TABLE IF NOT EXISTS expenses (
        id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        supplier_name         TEXT        NOT NULL,
        supplier_kennitala    TEXT,
        supplier_country      TEXT        NOT NULL DEFAULT 'IS',
        supplier_invoice_no   TEXT,
        expense_date          DATE        NOT NULL,
        description           TEXT        NOT NULL DEFAULT '',
        amount_net            BIGINT      NOT NULL CHECK (amount_net >= 0),
        amount_vat            BIGINT      NOT NULL CHECK (amount_vat >= 0),
        amount_gross          BIGINT      NOT NULL CHECK (amount_gross > 0),
        vat_code              TEXT        NOT NULL DEFAULT 'input_24'
                                          CHECK (vat_code IN ('input_24','input_11','exempt','none','reverse_charge_24')),
        vat_deductible        BOOLEAN     NOT NULL DEFAULT TRUE,
        non_deductible_reason TEXT,
        account_id            TEXT        NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
        document_id           TEXT        REFERENCES books_documents(id) ON DELETE SET NULL,
        original_currency     TEXT        NOT NULL DEFAULT 'ISK',
        original_amount_gross BIGINT,
        fx_rate               NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (fx_rate > 0),
        created_by            TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT expenses_totals_consistent
          CHECK (amount_net + amount_vat = amount_gross),
        CONSTRAINT expenses_non_deductible_has_reason
          CHECK (vat_deductible OR non_deductible_reason IS NOT NULL)
      );

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_missing_document
         ON expenses (expense_date) WHERE document_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_duplicate_probe
         ON expenses (supplier_kennitala, supplier_invoice_no);

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON expenses;

CREATE TRIGGER trg_expenses_updated_at
         BEFORE UPDATE ON expenses
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS vat_returns (
        id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        period          TEXT        NOT NULL UNIQUE REFERENCES fiscal_periods(period) ON DELETE RESTRICT,
        box_a_net_24    BIGINT      NOT NULL,
        box_b_net_11    BIGINT      NOT NULL,
        box_c_net_zero  BIGINT      NOT NULL,
        box_d_output    BIGINT      NOT NULL,
        box_e_input     BIGINT      NOT NULL,
        box_f_payable   BIGINT      NOT NULL,
        detail          JSONB       NOT NULL DEFAULT '{}'::jsonb,
        preflight       JSONB       NOT NULL DEFAULT '{}'::jsonb,
        filed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        filed_by        TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        note            TEXT        NOT NULL DEFAULT '',
        CONSTRAINT vat_returns_net_consistent
          CHECK (box_f_payable = box_d_output - box_e_input)
      );

CREATE TABLE IF NOT EXISTS stripe_transactions (
        id                 TEXT        PRIMARY KEY,
        type               TEXT        NOT NULL,
        currency           TEXT        NOT NULL,
        amount_minor       BIGINT      NOT NULL,
        fee_minor          BIGINT      NOT NULL DEFAULT 0,
        net_minor          BIGINT      NOT NULL,
        available_on       DATE,
        created_on         TIMESTAMPTZ NOT NULL,
        payout_id          TEXT,
        charge_id          TEXT,
        payment_intent_id  TEXT,
        refund_id          TEXT,
        order_id           TEXT        REFERENCES orders(id) ON DELETE SET NULL,
        raw                JSONB       NOT NULL DEFAULT '{}'::jsonb,
        journal_entry_id   TEXT        REFERENCES journal_entries(id) ON DELETE SET NULL,
        synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

CREATE INDEX IF NOT EXISTS idx_stripe_transactions_payout ON stripe_transactions (payout_id);

CREATE INDEX IF NOT EXISTS idx_stripe_transactions_created ON stripe_transactions (created_on DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_transactions_unposted
         ON stripe_transactions (created_on) WHERE journal_entry_id IS NULL;

CREATE TABLE IF NOT EXISTS bank_transactions (
        id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        account_code      TEXT        NOT NULL,
        booked_on         DATE        NOT NULL,
        value_on          DATE,
        description       TEXT        NOT NULL,
        counterparty      TEXT,
        reference         TEXT,
        amount            BIGINT      NOT NULL,
        balance_after     BIGINT,
        import_batch      TEXT        NOT NULL,
        dedupe_hash       TEXT        NOT NULL UNIQUE,
        match_state       TEXT        NOT NULL DEFAULT 'unmatched'
                                      CHECK (match_state IN ('unmatched','matched','explained','ignored')),
        matched_entry_id  TEXT        REFERENCES journal_entries(id) ON DELETE SET NULL,
        matched_payment_id TEXT       REFERENCES payments(id) ON DELETE SET NULL,
        note              TEXT        NOT NULL DEFAULT '',
        created_by        TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

CREATE INDEX IF NOT EXISTS idx_bank_transactions_booked ON bank_transactions (booked_on DESC);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_unmatched
         ON bank_transactions (booked_on) WHERE match_state = 'unmatched';

DROP TRIGGER IF EXISTS trg_bank_transactions_updated_at ON bank_transactions;

CREATE TRIGGER trg_bank_transactions_updated_at
         BEFORE UPDATE ON bank_transactions
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS payroll_rates (
        id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tax_year            SMALLINT    NOT NULL UNIQUE CHECK (tax_year BETWEEN 2020 AND 2100),
        bands               JSONB       NOT NULL,
        personal_allowance  BIGINT      NOT NULL CHECK (personal_allowance >= 0),
        municipal_rate      NUMERIC(6,4) NOT NULL CHECK (municipal_rate >= 0),
        social_security     NUMERIC(6,4) NOT NULL CHECK (social_security >= 0),
        pension_employee    NUMERIC(6,4) NOT NULL CHECK (pension_employee >= 0),
        pension_employer    NUMERIC(6,4) NOT NULL CHECK (pension_employer >= 0),
        source_note         TEXT        NOT NULL DEFAULT '',
        confirmed_at        TIMESTAMPTZ,
        confirmed_by        TEXT        REFERENCES users(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

DROP TRIGGER IF EXISTS trg_payroll_rates_updated_at ON payroll_rates;

CREATE TRIGGER trg_payroll_rates_updated_at
         BEFORE UPDATE ON payroll_rates
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS employees (
        id                       TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id                  TEXT        REFERENCES users(id) ON DELETE SET NULL,
        full_name                TEXT        NOT NULL,
        kennitala                TEXT        NOT NULL UNIQUE,
        email                    TEXT,
        bank_account             TEXT,
        pension_fund             TEXT        NOT NULL DEFAULT '',
        union_name               TEXT,
        union_rate               NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (union_rate >= 0),
        extra_pension_employee   NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (extra_pension_employee >= 0),
        extra_pension_employer   NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (extra_pension_employer >= 0),
        allowance_factor         NUMERIC(5,4) NOT NULL DEFAULT 1 CHECK (allowance_factor BETWEEN 0 AND 1),
        monthly_salary           BIGINT      NOT NULL DEFAULT 0 CHECK (monthly_salary >= 0),
        reference_wage_category  TEXT,
        reference_wage_amount    BIGINT      CHECK (reference_wage_amount IS NULL OR reference_wage_amount >= 0),
        reference_wage_confirmed_at DATE,
        reference_wage_confirmed_note TEXT,
        is_active                BOOLEAN     NOT NULL DEFAULT TRUE,
        created_by               TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

DROP TRIGGER IF EXISTS trg_employees_updated_at ON employees;

CREATE TRIGGER trg_employees_updated_at
         BEFORE UPDATE ON employees
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS payroll_runs (
        id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        period            TEXT        NOT NULL UNIQUE CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
        pay_date          DATE        NOT NULL,
        tax_year          SMALLINT    NOT NULL,
        gross_total       BIGINT      NOT NULL CHECK (gross_total >= 0),
        withholding_total BIGINT      NOT NULL CHECK (withholding_total >= 0),
        pension_employee_total BIGINT NOT NULL CHECK (pension_employee_total >= 0),
        pension_employer_total BIGINT NOT NULL CHECK (pension_employer_total >= 0),
        social_security_total  BIGINT NOT NULL CHECK (social_security_total >= 0),
        union_total       BIGINT      NOT NULL DEFAULT 0 CHECK (union_total >= 0),
        net_total         BIGINT      NOT NULL CHECK (net_total >= 0),
        status            TEXT        NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','settled')),
        created_by        TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

CREATE TABLE IF NOT EXISTS payslips (
        id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        run_id            TEXT        NOT NULL REFERENCES payroll_runs(id) ON DELETE RESTRICT,
        employee_id       TEXT        NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
        gross             BIGINT      NOT NULL CHECK (gross >= 0),
        pension_employee  BIGINT      NOT NULL CHECK (pension_employee >= 0),
        taxable_base      BIGINT      NOT NULL CHECK (taxable_base >= 0),
        computed_tax      BIGINT      NOT NULL CHECK (computed_tax >= 0),
        allowance_used    BIGINT      NOT NULL CHECK (allowance_used >= 0),
        withholding       BIGINT      NOT NULL CHECK (withholding >= 0),
        union_dues        BIGINT      NOT NULL DEFAULT 0 CHECK (union_dues >= 0),
        extra_pension_employee BIGINT NOT NULL DEFAULT 0 CHECK (extra_pension_employee >= 0),
        net_pay           BIGINT      NOT NULL CHECK (net_pay >= 0),
        pension_employer  BIGINT      NOT NULL CHECK (pension_employer >= 0),
        extra_pension_employer BIGINT NOT NULL DEFAULT 0 CHECK (extra_pension_employer >= 0),
        social_security   BIGINT      NOT NULL CHECK (social_security >= 0),
        breakdown         JSONB       NOT NULL DEFAULT '{}'::jsonb,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (run_id, employee_id)
      );

CREATE TABLE IF NOT EXISTS books_audit_log (
        id           BIGSERIAL   PRIMARY KEY,
        actor_id     TEXT        REFERENCES users(id) ON DELETE SET NULL,
        action       TEXT        NOT NULL,
        entity_type  TEXT        NOT NULL,
        entity_id    TEXT,
        summary      JSONB       NOT NULL DEFAULT '{}'::jsonb,
        request_id   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

CREATE INDEX IF NOT EXISTS idx_books_audit_entity
         ON books_audit_log (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_books_audit_created ON books_audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS tax_deadlines (
        id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        kind         TEXT        NOT NULL
                                 CHECK (kind IN ('vsk','payroll','annual_return','annual_accounts','rates_review','other')),
        period       TEXT,
        due_on       DATE        NOT NULL,
        label_is     TEXT        NOT NULL,
        label_en     TEXT        NOT NULL,
        note         TEXT        NOT NULL DEFAULT '',
        completed_at TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (kind, period, due_on)
      );

CREATE INDEX IF NOT EXISTS idx_tax_deadlines_due
         ON tax_deadlines (due_on) WHERE completed_at IS NULL;

CREATE OR REPLACE FUNCTION books_forbid_posted_entry_mutation()
       RETURNS TRIGGER AS $$
       BEGIN
         IF TG_OP = 'DELETE' THEN
           IF OLD.posted_at IS NOT NULL THEN
             RAISE EXCEPTION 'Posted journal entry % cannot be deleted (Reglugerd 505/2013 gr. 9); post a reversing entry instead', OLD.id
               USING ERRCODE = 'restrict_violation';
           END IF;
           RETURN OLD;
         END IF;
         IF OLD.posted_at IS NOT NULL THEN
           RAISE EXCEPTION 'Posted journal entry % cannot be altered (Reglugerd 505/2013 gr. 9); post a reversing entry instead', OLD.id
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entries_append_only ON journal_entries;

CREATE TRIGGER trg_journal_entries_append_only
         BEFORE UPDATE OR DELETE ON journal_entries
         FOR EACH ROW EXECUTE FUNCTION books_forbid_posted_entry_mutation();

CREATE OR REPLACE FUNCTION books_forbid_posted_line_mutation()
       RETURNS TRIGGER AS $$
       DECLARE v_posted TIMESTAMPTZ;
       BEGIN
         IF TG_OP = 'UPDATE' AND NEW.entry_id IS DISTINCT FROM OLD.entry_id THEN
           RAISE EXCEPTION 'A journal line cannot be moved between entries (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         SELECT posted_at INTO v_posted FROM journal_entries
           WHERE id = OLD.entry_id;
         IF v_posted IS NOT NULL THEN
           RAISE EXCEPTION 'Lines of a posted journal entry cannot be altered or deleted (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF TG_OP = 'UPDATE' THEN
           SELECT posted_at INTO v_posted FROM journal_entries WHERE id = NEW.entry_id;
           IF v_posted IS NOT NULL THEN
             RAISE EXCEPTION 'A journal line cannot be attached to a posted entry (Reglugerd 505/2013 gr. 9)'
               USING ERRCODE = 'restrict_violation';
           END IF;
           RETURN NEW;
         END IF;
         RETURN OLD;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_lines_append_only ON journal_lines;

CREATE TRIGGER trg_journal_lines_append_only
         BEFORE UPDATE OR DELETE ON journal_lines
         FOR EACH ROW EXECUTE FUNCTION books_forbid_posted_line_mutation();

CREATE OR REPLACE FUNCTION books_forbid_line_insert_into_posted()
       RETURNS TRIGGER AS $$
       DECLARE v_posted TIMESTAMPTZ;
       BEGIN
         SELECT posted_at INTO v_posted FROM journal_entries WHERE id = NEW.entry_id;
         IF v_posted IS NOT NULL THEN
           RAISE EXCEPTION 'Lines cannot be added to a posted journal entry (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_lines_no_insert_posted ON journal_lines;

CREATE TRIGGER trg_journal_lines_no_insert_posted
         BEFORE INSERT ON journal_lines
         FOR EACH ROW EXECUTE FUNCTION books_forbid_line_insert_into_posted();

CREATE OR REPLACE FUNCTION books_assert_entry_balanced()
       RETURNS TRIGGER AS $$
       DECLARE
         v_entry  TEXT;
         v_posted TIMESTAMPTZ;
         v_debit  BIGINT;
         v_credit BIGINT;
       BEGIN
         v_entry := COALESCE(NEW.entry_id, OLD.entry_id);
         SELECT posted_at INTO v_posted FROM journal_entries WHERE id = v_entry;
         -- No row: the draft was deleted in this transaction. Drafts may be
         -- unbalanced while they are being built; only posted entries must balance.
         IF v_posted IS NULL THEN RETURN NULL; END IF;
         SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
           INTO v_debit, v_credit FROM journal_lines WHERE entry_id = v_entry;
         IF v_debit <> v_credit THEN
           RAISE EXCEPTION 'Journal entry % is unbalanced: debit % <> credit %', v_entry, v_debit, v_credit
             USING ERRCODE = 'check_violation';
         END IF;
         RETURN NULL;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_lines_balanced ON journal_lines;

CREATE CONSTRAINT TRIGGER trg_journal_lines_balanced
         AFTER INSERT OR UPDATE OR DELETE ON journal_lines
         DEFERRABLE INITIALLY DEFERRED
         FOR EACH ROW EXECUTE FUNCTION books_assert_entry_balanced();

CREATE OR REPLACE FUNCTION books_assert_posted_entry_balanced()
       RETURNS TRIGGER AS $$
       DECLARE v_debit BIGINT; v_credit BIGINT;
       BEGIN
         IF NEW.posted_at IS NULL THEN RETURN NULL; END IF;
         SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
           INTO v_debit, v_credit FROM journal_lines WHERE entry_id = NEW.id;
         IF v_debit = 0 AND v_credit = 0 THEN
           RAISE EXCEPTION 'Journal entry % has no lines and cannot be posted', NEW.id
             USING ERRCODE = 'check_violation';
         END IF;
         IF v_debit <> v_credit THEN
           RAISE EXCEPTION 'Journal entry % is unbalanced: debit % <> credit %', NEW.id, v_debit, v_credit
             USING ERRCODE = 'check_violation';
         END IF;
         RETURN NULL;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entries_balanced ON journal_entries;

CREATE CONSTRAINT TRIGGER trg_journal_entries_balanced
         AFTER INSERT OR UPDATE ON journal_entries
         DEFERRABLE INITIALLY DEFERRED
         FOR EACH ROW EXECUTE FUNCTION books_assert_posted_entry_balanced();

CREATE OR REPLACE FUNCTION books_assert_period_open()
       RETURNS TRIGGER AS $$
       BEGIN
         IF NEW.posted_at IS NULL THEN RETURN NEW; END IF;
         -- "Is ANY covering period locked", not "what is the status of the
         -- covering period". SELECT ... INTO takes the first of however many rows
         -- match and discards the rest, so with two overlapping rows the lock
         -- check silently depended on row order.
         IF EXISTS (SELECT 1 FROM fiscal_periods
                     WHERE NEW.entry_date BETWEEN starts_on AND ends_on
                       AND status = 'locked') THEN
           RAISE EXCEPTION 'Accounting period covering % is locked; post the correction into the open period instead', NEW.entry_date
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entries_period_open ON journal_entries;

CREATE TRIGGER trg_journal_entries_period_open
         BEFORE INSERT OR UPDATE ON journal_entries
         FOR EACH ROW EXECUTE FUNCTION books_assert_period_open();

CREATE OR REPLACE FUNCTION books_protect_issued_invoice()
       RETURNS TRIGGER AS $$
       BEGIN
         IF TG_OP = 'DELETE' THEN
           IF OLD.status <> 'draft' THEN
             RAISE EXCEPTION 'Invoice % has been issued and cannot be deleted (Reglugerd 505/2013 gr. 9); issue a credit note instead', OLD.invoice_number
               USING ERRCODE = 'restrict_violation';
           END IF;
           RETURN OLD;
         END IF;
         IF OLD.status = 'draft' THEN
           -- The only way out of 'draft' is issuance. Anything else is a typo.
           IF NEW.status NOT IN ('draft', 'issued', 'cancelled') THEN
             RAISE EXCEPTION 'A draft invoice can only become issued or cancelled, not %', NEW.status
               USING ERRCODE = 'restrict_violation';
           END IF;
           RETURN NEW;
         END IF;
         -- Issued: status may only move FORWARD. Without a transition whitelist an
         -- invoice could be laundered back to 'draft', edited freely, and re-issued
         -- — three statements that defeat everything below.
         IF NEW.status NOT IN ('issued', 'credited', 'cancelled') THEN
           RAISE EXCEPTION 'Invoice % cannot return to %; it has been issued (Reglugerd 505/2013 gr. 9)', OLD.invoice_number, NEW.status
             USING ERRCODE = 'restrict_violation';
         END IF;
         -- Issued: only settlement and status may move.
         IF (NEW.series, NEW.invoice_number, NEW.order_id, NEW.user_id,
             NEW.seller_name, NEW.seller_kennitala, NEW.seller_vat_number, NEW.seller_address,
             NEW.customer_name, NEW.customer_kennitala, NEW.customer_email, NEW.customer_address,
             NEW.customer_country, NEW.issued_at, NEW.due_at, NEW.terms_days,
             NEW.currency, NEW.original_currency, NEW.original_total_gross, NEW.fx_rate,
             NEW.zero_rate_reason,
             NEW.subtotal_net, NEW.vat_total, NEW.total_gross, NEW.discount_total,
             NEW.shipping_gross, NEW.note, NEW.created_by)
            IS DISTINCT FROM
            (OLD.series, OLD.invoice_number, OLD.order_id, OLD.user_id,
             OLD.seller_name, OLD.seller_kennitala, OLD.seller_vat_number, OLD.seller_address,
             OLD.customer_name, OLD.customer_kennitala, OLD.customer_email, OLD.customer_address,
             OLD.customer_country, OLD.issued_at, OLD.due_at, OLD.terms_days,
             OLD.currency, OLD.original_currency, OLD.original_total_gross, OLD.fx_rate,
             OLD.zero_rate_reason,
             OLD.subtotal_net, OLD.vat_total, OLD.total_gross, OLD.discount_total,
             OLD.shipping_gross, OLD.note, OLD.created_by)
         THEN
           RAISE EXCEPTION 'Invoice % has been issued; its content cannot be altered (Reglugerd 505/2013 gr. 9). Only payment, credit and status may change.', OLD.invoice_number
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_issued_immutable ON invoices;

CREATE TRIGGER trg_invoices_issued_immutable
         BEFORE UPDATE OR DELETE ON invoices
         FOR EACH ROW EXECUTE FUNCTION books_protect_issued_invoice();

CREATE OR REPLACE FUNCTION books_protect_issued_invoice_line()
       RETURNS TRIGGER AS $$
       DECLARE v_status TEXT; v_number BIGINT;
       BEGIN
         IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
           RAISE EXCEPTION 'An invoice line cannot be moved between invoices (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         SELECT status, invoice_number INTO v_status, v_number FROM invoices
           WHERE id = OLD.invoice_id;
         -- No row: the parent draft is being deleted in this transaction.
         IF v_status IS NOT NULL AND v_status <> 'draft' THEN
           RAISE EXCEPTION 'Lines of issued invoice % cannot be altered or deleted (Reglugerd 505/2013 gr. 9)', v_number
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_lines_immutable ON invoice_lines;

CREATE TRIGGER trg_invoice_lines_immutable
         BEFORE UPDATE OR DELETE ON invoice_lines
         FOR EACH ROW EXECUTE FUNCTION books_protect_issued_invoice_line();

CREATE OR REPLACE FUNCTION books_forbid_invoice_line_insert_into_issued()
       RETURNS TRIGGER AS $$
       DECLARE v_status TEXT; v_number BIGINT;
       BEGIN
         SELECT status, invoice_number INTO v_status, v_number FROM invoices
           WHERE id = NEW.invoice_id;
         IF v_status IS NOT NULL AND v_status <> 'draft' THEN
           RAISE EXCEPTION 'Lines cannot be added to issued invoice % (Reglugerd 505/2013 gr. 9)', v_number
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_lines_no_insert_issued ON invoice_lines;

CREATE TRIGGER trg_invoice_lines_no_insert_issued
         BEFORE INSERT ON invoice_lines
         FOR EACH ROW EXECUTE FUNCTION books_forbid_invoice_line_insert_into_issued();

CREATE OR REPLACE FUNCTION books_forbid_any_mutation()
       RETURNS TRIGGER AS $$
       BEGIN
         RAISE EXCEPTION '% rows are append-only and cannot be altered or deleted', TG_TABLE_NAME
           USING ERRCODE = 'restrict_violation';
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_immutable ON payments;

CREATE TRIGGER trg_payments_immutable
         BEFORE UPDATE OR DELETE ON payments
         FOR EACH ROW EXECUTE FUNCTION books_forbid_any_mutation();

DROP TRIGGER IF EXISTS trg_credit_notes_immutable ON credit_notes;

CREATE TRIGGER trg_credit_notes_immutable
         BEFORE UPDATE OR DELETE ON credit_notes
         FOR EACH ROW EXECUTE FUNCTION books_forbid_any_mutation();

DROP TRIGGER IF EXISTS trg_vat_returns_immutable ON vat_returns;

CREATE TRIGGER trg_vat_returns_immutable
         BEFORE UPDATE OR DELETE ON vat_returns
         FOR EACH ROW EXECUTE FUNCTION books_forbid_any_mutation();

DROP TRIGGER IF EXISTS trg_books_audit_log_immutable ON books_audit_log;

CREATE TRIGGER trg_books_audit_log_immutable
         BEFORE UPDATE OR DELETE ON books_audit_log
         FOR EACH ROW EXECUTE FUNCTION books_forbid_any_mutation();

INSERT INTO ledger_accounts (code, name, name_en, type, vat_code, input_vat_blocked, sort, description) VALUES
         ('1100','Viðskiptakröfur','Accounts receivable','asset','none',FALSE,100,'Safnreikningur útgefinna reikninga'),
         ('1200','Vörubirgðir','Inventory','asset','none',FALSE,110,''),
         ('1310','Innskattur','Input VAT','asset','none',FALSE,120,'Krafa á Skattinn — endurgreiðanlegur innskattur'),
         ('1400','Kortagreiðslur í vinnslu','Card settlement clearing','asset','none',FALSE,130,'Stripe-staða áður en útborgun berst í banka'),
         ('1900','Bankainnstæða','Bank account','asset','none',FALSE,140,''),
         ('1910','Sjóður','Cash on hand','asset','none',FALSE,150,'Reiðufé í posa/kassa'),
         ('1990','Óvissureikningur','Suspense','asset','none',FALSE,190,'Færslur sem bíða skýringar — á að vera 0 við uppgjör'),
         ('2100','Viðskiptaskuldir','Accounts payable','liability','none',FALSE,200,''),
         ('2200','Útskattur 24%','Output VAT 24%','liability','output_24',FALSE,210,''),
         ('2210','Útskattur 11%','Output VAT 11%','liability','output_11',FALSE,220,''),
         ('2290','Virðisaukaskattur til greiðslu','VAT settlement','liability','none',FALSE,230,'Uppgjörsreikningur VSK-skila'),
         ('2300','Staðgreiðsla launa','Withholding tax payable','liability','none',FALSE,240,''),
         ('2310','Tryggingagjald','Social security payable','liability','none',FALSE,250,''),
         ('2320','Lífeyrissjóður','Pension payable','liability','none',FALSE,260,''),
         ('2330','Séreignarsparnaður','Supplementary pension payable','liability','none',FALSE,270,''),
         ('2340','Félagsgjöld stéttarfélags','Union dues payable','liability','none',FALSE,280,''),
         ('2350','Ógreidd laun','Net wages payable','liability','none',FALSE,290,''),
         ('3100','Hlutafé','Share capital','equity','none',FALSE,300,''),
         ('3200','Óráðstafað eigið fé','Retained earnings','equity','none',FALSE,310,''),
         ('4100','Sala vöru 24%','Goods sales 24%','revenue','output_24',FALSE,400,''),
         ('4110','Sala þjónustu 24%','Service sales 24%','revenue','output_24',FALSE,410,'Smíði, uppsetning, hugbúnaðarvinna'),
         ('4200','Sala 11%','Sales 11%','revenue','output_11',FALSE,420,'Lækkað þrep — t.d. bækur'),
         ('4300','Sala til útlanda (0%)','Export sales (0%)','revenue','output_0',FALSE,430,'Núllskattlagt — krefst útflutningsgagna'),
         ('4900','Afslættir veittir','Discounts given','revenue','output_24',FALSE,490,''),
         ('5100','Kostnaðarverð sölu','Cost of goods sold','expense','none',FALSE,500,''),
         ('5200','Efni og aðföng','Materials and supplies','expense','input_24',FALSE,510,''),
         ('6100','Laun','Wages','expense','none',FALSE,600,''),
         ('6110','Tryggingagjald','Social security expense','expense','none',FALSE,610,''),
         ('6120','Lífeyrisframlag atvinnurekanda','Employer pension','expense','none',FALSE,620,''),
         ('6200','Húsnæðiskostnaður','Premises','expense','input_24',FALSE,630,''),
         ('6300','Tölvu- og hugbúnaðarkostnaður','Software and IT','expense','input_24',FALSE,640,'Oft frá útlöndum — athugið veltuskatt (reverse charge)'),
         ('6400','Sími og internet','Telecoms','expense','input_24',FALSE,650,''),
         ('6500','Bankakostnaður og greiðslugjöld','Bank and payment fees','expense','exempt',FALSE,660,'Stripe-gjöld — meðferð VSK óstaðfest, sjá bókhaldsskjal'),
         ('6600','Bifreiðakostnaður','Vehicle costs','expense','input_24',FALSE,670,'Innskattur er EKKI frádráttarbær af fólksbifreið undir 5.000 kg'),
         ('6700','Sérfræðiþjónusta','Professional services','expense','input_24',FALSE,680,'Bókhald, lögfræði'),
         ('6800','Annar rekstrarkostnaður','Other operating costs','expense','input_24',FALSE,690,''),
         ('6900','Risna og gjafir','Entertainment and gifts','expense','none',TRUE,700,'Innskattur ekki frádráttarbær (risna)'),
         ('6910','Fæði starfsmanna','Staff meals','expense','none',TRUE,710,'Innskattur ekki frádráttarbær (mötuneyti/fæði)'),
         ('7100','Afskriftir','Depreciation','expense','none',FALSE,720,''),
         ('7900','Tekjuskattur','Corporate income tax','expense','none',FALSE,790,'20% hjá ehf.'),
         ('8100','Gengismunur','FX gain/loss','expense','none',FALSE,810,''),
         ('8200','Vaxtagjöld','Interest expense','expense','none',FALSE,820,''),
         ('8900','Sléttun','Rounding differences','expense','none',FALSE,890,'')
       ON CONFLICT (code) DO NOTHING;

INSERT INTO bookkeeping_counters (name, next_value) VALUES
         ('invoice', 1001), ('receipt', 1), ('credit_note', 1), ('journal_entry', 1)
       ON CONFLICT (name) DO NOTHING;

INSERT INTO fiscal_periods (period, starts_on, ends_on) VALUES
         ('2026-P1','2026-01-01','2026-02-28'), ('2026-P2','2026-03-01','2026-04-30'),
         ('2026-P3','2026-05-01','2026-06-30'), ('2026-P4','2026-07-01','2026-08-31'),
         ('2026-P5','2026-09-01','2026-10-31'), ('2026-P6','2026-11-01','2026-12-31'),
         ('2027-P1','2027-01-01','2027-02-28'), ('2027-P2','2027-03-01','2027-04-30'),
         ('2027-P3','2027-05-01','2027-06-30'), ('2027-P4','2027-07-01','2027-08-31'),
         ('2027-P5','2027-09-01','2027-10-31'), ('2027-P6','2027-11-01','2027-12-31')
       ON CONFLICT (period) DO NOTHING;

INSERT INTO payroll_rates
         (tax_year, bands, personal_allowance, municipal_rate, social_security,
          pension_employee, pension_employer, source_note)
       VALUES (2026,
         '[{"upTo":498122,"rate":0.3149},{"upTo":1398450,"rate":0.3799},{"upTo":null,"rate":0.4629}]'::jsonb,
         72492, 0.1494, 0.0635, 0.04, 0.115,
         'Skatturinn: Key rates and amounts 2026. Bond rates include average municipal tax 14.94% — replace municipal_rate with the registered municipality rate. Tryggingagjald 6.35%. Pension 4% + 11.5%.')
       ON CONFLICT (tax_year) DO NOTHING;

INSERT INTO tax_deadlines (kind, period, due_on, label_is, label_en, note) VALUES
         ('vsk','2026-P1','2026-04-07','VSK-skil jan–feb','VAT return Jan–Feb',''),
         ('vsk','2026-P2','2026-06-02','VSK-skil mar–apr','VAT return Mar–Apr',''),
         ('vsk','2026-P3','2026-08-05','VSK-skil maí–jún','VAT return May–Jun',''),
         ('vsk','2026-P4','2026-10-05','VSK-skil júl–ágú','VAT return Jul–Aug',''),
         ('vsk','2026-P5','2026-12-07','VSK-skil sep–okt','VAT return Sep–Oct',''),
         ('vsk','2026-P6','2027-02-05','VSK-skil nóv–des','VAT return Nov–Dec',''),
         ('annual_return','2026','2026-05-31','Skattframtal lögaðila','Entity tax return',''),
         ('annual_accounts','2025','2026-08-31','Ársreikningur til ársreikningaskrár','Annual accounts filing','Sekt 600.000 kr. við vanskil'),
         ('rates_review','2027','2027-01-05','Yfirfara skatthlutföll og persónuafslátt 2027','Re-verify 2027 payroll rates','Staðfesta á skatturinn.is áður en laun eru reiknuð')
       ON CONFLICT (kind, period, due_on) DO NOTHING;
