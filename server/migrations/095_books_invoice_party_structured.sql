-- 095_books_invoice_party_structured — reference copy of the migration in server/config/schema.js
-- 072 snapshotted the seller and buyer as free text: right for the PDF (Reglugerð
-- 50/1993 asks for a printed address), wrong for a machine-readable invoice. EN 16931
-- BG-5/BG-8 want the parts — street, city, postal zone, ISO 3166-1 alpha-2 country.
-- The parts exist upstream in orders.shipping_address; pickCustomer() used to \n-join
-- them away. This gives them somewhere to land without touching the free-text column.
--
-- Invariant 14 (expand/contract): every column NULLable, no default, no CHECK. The
-- previous release neither writes nor reads them. Historical rows stay NULL and the
-- UBL preflight refuses them by name rather than parsing a free-text address into a
-- statutory document. invoice_ubl_exports records exactly what was emitted, with its
-- checksum, append-only — the conformance test ties a verdict to exact bytes.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS seller_street        TEXT,
  ADD COLUMN IF NOT EXISTS seller_city          TEXT,
  ADD COLUMN IF NOT EXISTS seller_postal_zone   TEXT,
  ADD COLUMN IF NOT EXISTS seller_country       TEXT,
  ADD COLUMN IF NOT EXISTS customer_street      TEXT,
  ADD COLUMN IF NOT EXISTS customer_city        TEXT,
  ADD COLUMN IF NOT EXISTS customer_postal_zone TEXT;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_endpoint_scheme TEXT,
  ADD COLUMN IF NOT EXISTS customer_endpoint_id     TEXT;

CREATE TABLE IF NOT EXISTS invoice_ubl_exports (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id       TEXT        NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  profile          TEXT        NOT NULL DEFAULT 'peppol-bis-billing-3.0'
                               CHECK (profile IN ('peppol-bis-billing-3.0')),
  customization_id TEXT        NOT NULL,
  byte_size        BIGINT      NOT NULL CHECK (byte_size > 0),
  checksum_sha256  TEXT        NOT NULL,
  xml              TEXT        NOT NULL,
  created_by       TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_ubl_exports_invoice
  ON invoice_ubl_exports (invoice_id, created_at DESC);

CREATE OR REPLACE FUNCTION books_protect_ubl_export()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'An emitted UBL document is a record of what was sent and cannot be changed or removed'
    USING ERRCODE = 'restrict_violation';
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_invoice_ubl_exports_immutable ON invoice_ubl_exports;
CREATE TRIGGER trg_invoice_ubl_exports_immutable
  BEFORE UPDATE OR DELETE ON invoice_ubl_exports
  FOR EACH ROW EXECUTE FUNCTION books_protect_ubl_export();
