-- 100_customer_account_party — reference copy of the migration in server/config/schema.js
--
-- 098 gave the company a customer of record; 095 gave an invoice a structured
-- party block. Nothing connected the two: customer_accounts has no address, so
-- createServiceInvoice wrote customer_address = '' and customer_country = 'IS'
-- as literals. Two consequences, and only one of them was the reported bug:
--
--   1. No service invoice can be emitted as Peppol BIS Billing 3.0. BR-11 wants
--      the buyer country, BR-07 the registration name, and PEPPOL-EN16931-R010
--      the buyer's electronic address (BT-49) — none of which exist.
--   2. The PDF of every service invoice prints NO BUYER ADDRESS AT ALL.
--      bookkeepingPdf.js prints splitLines(invoice.customer_address), and that
--      string is empty. That is a defect in the STATUTORY document, not merely
--      in the machine-readable one, and it is the more serious of the two.
--
-- The account holds the CURRENT value; the invoice keeps the value AS AT ISSUE
-- in the 095 columns. Reglugerð 505/2013 gr. 9 is the whole reason for the
-- split: an address corrected in 2027 must not change what a 2026 document
-- says, and invoice_ubl_exports must never be able to hold two different
-- documents both claiming to be invoice N.
--
-- Pure expand (invariant 14): eight nullable columns, no defaults, no NOT NULL,
-- and every CHECK admits NULL — the previous release's code writes none of them
-- and reads none of them, so it keeps working unchanged for the length of a
-- slot swap. Statement 3 only WIDENS an existing refusal.

ALTER TABLE customer_accounts
  ADD COLUMN IF NOT EXISTS street          TEXT,
  ADD COLUMN IF NOT EXISTS city            TEXT,
  ADD COLUMN IF NOT EXISTS postal_zone     TEXT,
  ADD COLUMN IF NOT EXISTS country         TEXT
    CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  -- Free of a shape CHECK on purpose: a foreign buyer's VAT identifier is not
  -- 5-6 digits, and the domestic rule lives in the app layer where it can be
  -- country-aware. Length is bounded by the request validator.
  ADD COLUMN IF NOT EXISTS vat_number      TEXT,
  -- ISO 6523 ICD / Peppol EAS. 0196 = kennitala; four digits or nothing.
  -- There is no "IS:KT" code in BIS Billing 3.0 — that was the pre-2019 scheme
  -- NAME; a 3.0 document carries the numeric value in @schemeID.
  ADD COLUMN IF NOT EXISTS endpoint_scheme TEXT
    CHECK (endpoint_scheme IS NULL OR endpoint_scheme ~ '^[0-9]{4}$'),
  ADD COLUMN IF NOT EXISTS endpoint_id     TEXT;

-- BT-48, snapshotted like the rest of the party block. Nothing emits it for a
-- domestic sale (a 24% invoice is category S and needs no buyer VAT id), but an
-- issued invoice can never be amended, so the column has to exist BEFORE the
-- first reverse-charge invoice rather than after it (ACCOUNTANT-QUESTIONS §2).
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_vat_number TEXT;

-- Statement 3: close the immutability hole this migration would otherwise widen.
--
-- The 072 trigger freezes an explicit TUPLE of columns on an issued invoice, and
-- the 095/099/100 columns are outside it — so the party block we are about to
-- snapshot could be rewritten by any UPDATE, which makes the snapshot argument
-- above only half true. Adding them is still expand-safe: the trigger fires on
-- UPDATE/DELETE only, INSERT is untouched, and the previous release updates
-- nothing on an issued invoice but status, amount_paid, amount_credited and
-- amount_refunded — all of which stay outside the frozen tuple.
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
    IF NEW.status NOT IN ('draft', 'issued', 'cancelled') THEN
      RAISE EXCEPTION 'A draft invoice can only become issued or cancelled, not %', NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('issued', 'credited', 'cancelled') THEN
    RAISE EXCEPTION 'Invoice % cannot return to %; it has been issued (Reglugerd 505/2013 gr. 9)', OLD.invoice_number, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.series, NEW.invoice_number, NEW.order_id, NEW.user_id,
      NEW.seller_name, NEW.seller_kennitala, NEW.seller_vat_number, NEW.seller_address,
      NEW.customer_name, NEW.customer_kennitala, NEW.customer_email, NEW.customer_address,
      NEW.customer_country, NEW.issued_at, NEW.due_at, NEW.terms_days,
      NEW.currency, NEW.original_currency, NEW.original_total_gross, NEW.fx_rate,
      NEW.zero_rate_reason,
      NEW.subtotal_net, NEW.vat_total, NEW.total_gross, NEW.discount_total,
      NEW.shipping_gross, NEW.note, NEW.created_by,
      -- 095/099/100: the structured party block, the account link and the billed
      -- period are statutory content too. They were left out of the original
      -- tuple only because they did not exist when it was written.
      NEW.seller_street, NEW.seller_city, NEW.seller_postal_zone, NEW.seller_country,
      NEW.customer_street, NEW.customer_city, NEW.customer_postal_zone,
      NEW.customer_endpoint_scheme, NEW.customer_endpoint_id, NEW.customer_vat_number,
      NEW.account_id, NEW.service_kind, NEW.service_period)
     IS DISTINCT FROM
     (OLD.series, OLD.invoice_number, OLD.order_id, OLD.user_id,
      OLD.seller_name, OLD.seller_kennitala, OLD.seller_vat_number, OLD.seller_address,
      OLD.customer_name, OLD.customer_kennitala, OLD.customer_email, OLD.customer_address,
      OLD.customer_country, OLD.issued_at, OLD.due_at, OLD.terms_days,
      OLD.currency, OLD.original_currency, OLD.original_total_gross, OLD.fx_rate,
      OLD.zero_rate_reason,
      OLD.subtotal_net, OLD.vat_total, OLD.total_gross, OLD.discount_total,
      OLD.shipping_gross, OLD.note, OLD.created_by,
      OLD.seller_street, OLD.seller_city, OLD.seller_postal_zone, OLD.seller_country,
      OLD.customer_street, OLD.customer_city, OLD.customer_postal_zone,
      OLD.customer_endpoint_scheme, OLD.customer_endpoint_id, OLD.customer_vat_number,
      OLD.account_id, OLD.service_kind, OLD.service_period)
  THEN
    RAISE EXCEPTION 'Invoice % has been issued; its content cannot be altered (Reglugerd 505/2013 gr. 9). Only payment, credit and status may change.', OLD.invoice_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
