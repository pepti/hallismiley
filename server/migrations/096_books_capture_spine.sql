-- 096_books_capture_spine — reference copy of the migration in server/config/schema.js
-- A document's KIND (072) says what it is; source_kind says how much it can be TRUSTED:
-- peppol > embedded_xml > extracted > manual. All four ship now (this release produces
-- only the bottom two). The ladder may drive pre-fill and provenance — never whether a
-- human is required.
--
-- books_intake is a queue of PROPOSALS. The only way out and into the ledger is
-- expenseService.createExpense(), which needs a named person; the CHECKs make an
-- "accepted" row without an expense and a decider unwritable. No confidence score.
--
-- Invariant 14: source_kind NOT NULL DEFAULT 'manual' is exactly what the previous
-- release writes; supplier_vat_number is NULLable; books_intake is invisible to it.

ALTER TABLE books_documents
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('peppol','embedded_xml','extracted','manual'));
ALTER TABLE books_documents
  ADD COLUMN IF NOT EXISTS source_ref         TEXT,
  ADD COLUMN IF NOT EXISTS source_received_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_books_documents_source
  ON books_documents (source_kind, created_at DESC);

CREATE OR REPLACE FUNCTION books_protect_document()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Supporting documents cannot be deleted — they are the 7-year evidence trail (bokhaldslog 145/1994 gr. 20)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.file_path, NEW.checksum_sha256, NEW.byte_size, NEW.mime_type, NEW.created_by,
      NEW.source_kind, NEW.source_ref)
     IS DISTINCT FROM
     (OLD.file_path, OLD.checksum_sha256, OLD.byte_size, OLD.mime_type, OLD.created_by,
      OLD.source_kind, OLD.source_ref)
  THEN
    RAISE EXCEPTION 'The stored file behind a supporting document, and where it came from, cannot be swapped; upload a new document instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS supplier_vat_number TEXT;

CREATE TABLE IF NOT EXISTS books_intake (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source_kind         TEXT        NOT NULL CHECK (source_kind IN ('peppol','embedded_xml','extracted','manual')),
  source_ref          TEXT,
  document_id         TEXT        NOT NULL REFERENCES books_documents(id) ON DELETE RESTRICT,
  status              TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','superseded')),
  suggested           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  parse_problems      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  supplier_name       TEXT,
  supplier_kennitala  TEXT,
  supplier_invoice_no TEXT,
  document_date       DATE,
  amount_gross        BIGINT      CHECK (amount_gross IS NULL OR amount_gross > 0),
  currency            TEXT        NOT NULL DEFAULT 'ISK',
  dedupe_hash         TEXT        NOT NULL,
  expense_id          TEXT        REFERENCES expenses(id) ON DELETE RESTRICT,
  decided_by          TEXT        REFERENCES users(id) ON DELETE RESTRICT,
  decided_at          TIMESTAMPTZ,
  reject_reason       TEXT        NOT NULL DEFAULT '',
  created_by          TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT books_intake_accepted_has_expense CHECK (status <> 'accepted' OR expense_id IS NOT NULL),
  CONSTRAINT books_intake_decided_has_actor    CHECK (status = 'pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT books_intake_rejected_has_reason  CHECK (status <> 'rejected' OR reject_reason <> ''),
  CONSTRAINT books_intake_pending_is_undecided CHECK (status <> 'pending' OR (expense_id IS NULL AND decided_by IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_books_intake_pending_hash ON books_intake (dedupe_hash) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_books_intake_pending ON books_intake (created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_books_intake_expense ON books_intake (expense_id);

CREATE OR REPLACE FUNCTION books_freeze_intake_decision()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status <> 'pending' AND NEW.status = 'pending' THEN
    RAISE EXCEPTION 'A decided intake item cannot be returned to the queue; enter a correcting document instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.expense_id IS NOT NULL AND NEW.expense_id IS DISTINCT FROM OLD.expense_id THEN
    RAISE EXCEPTION 'This intake item is already linked to an expense; that link cannot be repointed (Reglugerd 505/2013 gr. 8)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'pending'
     AND (NEW.suggested, NEW.source_kind, NEW.document_id) IS DISTINCT FROM (OLD.suggested, OLD.source_kind, OLD.document_id) THEN
    RAISE EXCEPTION 'The proposal behind a decided intake item cannot be rewritten'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_books_intake_decision_frozen ON books_intake;
CREATE TRIGGER trg_books_intake_decision_frozen BEFORE UPDATE ON books_intake FOR EACH ROW EXECUTE FUNCTION books_freeze_intake_decision();
DROP TRIGGER IF EXISTS trg_books_intake_updated_at ON books_intake;
CREATE TRIGGER trg_books_intake_updated_at BEFORE UPDATE ON books_intake FOR EACH ROW EXECUTE FUNCTION set_updated_at();
