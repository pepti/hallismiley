-- 064_customer_notes
-- Human-reference duplicate of the authoritative migration in
-- server/config/schema.js. Staff-authored, categorized note LOG about a
-- customer. Per-note visibility: 'admin' = admins only, 'staff' = anyone
-- holding the grantable 'customers' view. author_name is a snapshot so a note
-- survives its author being deleted.

CREATE TABLE IF NOT EXISTS customer_notes (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    TEXT        NOT NULL DEFAULT 'general'
                          CHECK (category IN ('order_prefs','ordering','special_needs','general')),
  body        TEXT        NOT NULL,
  visibility  TEXT        NOT NULL DEFAULT 'admin' CHECK (visibility IN ('admin','staff')),
  author_id   TEXT        REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_user   ON customer_notes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_notes_author ON customer_notes (author_id);

DROP TRIGGER IF EXISTS trg_customer_notes_updated_at ON customer_notes;
CREATE TRIGGER trg_customer_notes_updated_at
  BEFORE UPDATE ON customer_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
