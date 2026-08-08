-- Migration: 073_books_expenses
-- Expenses — the input-VAT side. Adds the protections (append-only,
-- duplicate detection, document integrity) on the expense tables 072 laid down.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application. It is GENERATED from that array — do
-- not hand-edit it, and if the two ever disagree, schema.js wins.

CREATE OR REPLACE FUNCTION books_protect_expense()
       RETURNS TRIGGER AS $$
       BEGIN
         IF TG_OP = 'DELETE' THEN
           RAISE EXCEPTION 'Expense % cannot be deleted; it is posted to the ledger (Reglugerd 505/2013 gr. 9). Reverse its journal entry instead', OLD.id
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF (NEW.supplier_name, NEW.supplier_kennitala, NEW.supplier_country,
             NEW.supplier_invoice_no, NEW.expense_date,
             NEW.amount_net, NEW.amount_vat, NEW.amount_gross,
             NEW.vat_code, NEW.vat_deductible, NEW.account_id,
             NEW.original_currency, NEW.original_amount_gross, NEW.fx_rate,
             NEW.created_by)
            IS DISTINCT FROM
            (OLD.supplier_name, OLD.supplier_kennitala, OLD.supplier_country,
             OLD.supplier_invoice_no, OLD.expense_date,
             OLD.amount_net, OLD.amount_vat, OLD.amount_gross,
             OLD.vat_code, OLD.vat_deductible, OLD.account_id,
             OLD.original_currency, OLD.original_amount_gross, OLD.fx_rate,
             OLD.created_by)
         THEN
           RAISE EXCEPTION 'Expense % is posted; its financial content cannot be altered (Reglugerd 505/2013 gr. 9). Only the attached document and description may change.', OLD.id
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expenses_immutable ON expenses;

CREATE TRIGGER trg_expenses_immutable
         BEFORE UPDATE OR DELETE ON expenses
         FOR EACH ROW EXECUTE FUNCTION books_protect_expense();

CREATE OR REPLACE FUNCTION books_protect_document()
       RETURNS TRIGGER AS $$
       BEGIN
         IF TG_OP = 'DELETE' THEN
           RAISE EXCEPTION 'Supporting documents cannot be deleted — they are the 7-year evidence trail (bokhaldslog 145/1994 gr. 20)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF (NEW.file_path, NEW.checksum_sha256, NEW.byte_size, NEW.mime_type, NEW.created_by)
            IS DISTINCT FROM
            (OLD.file_path, OLD.checksum_sha256, OLD.byte_size, OLD.mime_type, OLD.created_by)
         THEN
           RAISE EXCEPTION 'The stored file behind a supporting document cannot be swapped; upload a new document instead'
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_books_documents_immutable ON books_documents;

CREATE TRIGGER trg_books_documents_immutable
         BEFORE UPDATE OR DELETE ON books_documents
         FOR EACH ROW EXECUTE FUNCTION books_protect_document();

CREATE INDEX IF NOT EXISTS idx_books_documents_checksum
         ON books_documents (checksum_sha256);

CREATE INDEX IF NOT EXISTS idx_expenses_supplier
         ON expenses (LOWER(supplier_name), expense_date DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_customer_key
         ON invoices (COALESCE(user_id, LOWER(customer_email)))
         WHERE status IN ('issued','credited');
