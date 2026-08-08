-- Migration: 077_books_pos
-- Counter sales. This adds almost nothing, and that is the design: migration 072
-- already has invoices.series ('invoice','receipt') and a gapless 'receipt' counter,
-- so a till sale is a receipt-series row in the SAME sales ledger. A separate
-- pos_sales table would give the business two sales ledgers to add together, and the
-- VSK return would have to read both — one of them would eventually be forgotten.
--
-- A counter sale does NOT pass through receivables: at a till the sale and the money
-- are one event, so the entry debits cash (or the card clearing account) directly.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application. It is GENERATED from that array — do
-- not hand-edit it, and if the two ever disagree, schema.js wins.

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE journal_entries
         ADD CONSTRAINT journal_entries_source_type_check
         CHECK (source_type IN ('invoice','payment','credit_note','expense',
                                'payroll','vat_settlement','opening','manual',
                                'reversal','stripe','bank','pos'));

CREATE INDEX IF NOT EXISTS idx_invoices_receipts
         ON invoices (issued_at DESC, invoice_number DESC)
         WHERE series = 'receipt';
