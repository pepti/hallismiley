-- Migration: 075_books_reconciliation
-- Bank and card reconciliation: attribution on a Stripe sync, the
-- matched-invoice link, and the guard that freezes a settled link.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application. It is GENERATED from that array — do
-- not hand-edit it, and if the two ever disagree, schema.js wins.

ALTER TABLE stripe_transactions
         ADD COLUMN IF NOT EXISTS synced_by TEXT REFERENCES users(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION books_freeze_settled_link()
       RETURNS TRIGGER AS $$
       BEGIN
         IF OLD.journal_entry_id IS NOT NULL
            AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id THEN
           RAISE EXCEPTION 'This row is already linked to a journal entry; that link cannot be repointed (Reglugerd 505/2013 gr. 8)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stripe_link_frozen ON stripe_transactions;

CREATE TRIGGER trg_stripe_link_frozen
         BEFORE UPDATE ON stripe_transactions
         FOR EACH ROW EXECUTE FUNCTION books_freeze_settled_link();

ALTER TABLE bank_transactions
         ADD COLUMN IF NOT EXISTS matched_invoice_id TEXT
           REFERENCES invoices(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_open
         ON bank_transactions (account_code, booked_on DESC)
         WHERE match_state = 'unmatched';

CREATE INDEX IF NOT EXISTS idx_stripe_transactions_payout
         ON stripe_transactions (payout_id) WHERE payout_id IS NOT NULL;
