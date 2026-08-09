-- Migration: 079_books_pos_idempotency
-- Counter-sale idempotency: a partial unique index on client-supplied POS
-- tokens, so a double-tap or retried sale returns the first receipt.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application. It is GENERATED from that array — do
-- not hand-edit it, and if the two ever disagree, schema.js wins.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_client_key
         ON payments (idempotency_key) WHERE idempotency_key LIKE 'client:%';
