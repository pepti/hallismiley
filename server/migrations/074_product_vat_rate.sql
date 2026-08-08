-- Migration: 074_product_vat_rate
-- A per-product VAT rate, so the 11% band (books, printed matter) is
-- charged correctly rather than everything defaulting to 24%.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application. It is GENERATED from that array — do
-- not hand-edit it, and if the two ever disagree, schema.js wins.

ALTER TABLE products
         ADD COLUMN IF NOT EXISTS vat_rate SMALLINT NOT NULL DEFAULT 24;

DO $$ BEGIN
         ALTER TABLE products
           ADD CONSTRAINT products_vat_rate_check CHECK (vat_rate IN (0, 11, 24));
       EXCEPTION WHEN duplicate_object THEN NULL; END $$;
