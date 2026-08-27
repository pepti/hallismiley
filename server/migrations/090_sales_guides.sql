-- 090_sales_guides — reference copy of the migration in server/config/schema.js
-- Sales-staff handbook ("Handbók sölufólks", Halli 2026-08-27): internal,
-- admin-editable guides for the sales team behind the `handbok` admin view.
-- Locale convention is INVERTED relative to news_articles: guides are
-- Icelandic-canonical (title/summary/body ARE the IS copy) with optional
-- `_en` siblings. Read endpoints resolve `en → COALESCE(x_en, x)`.

CREATE TABLE IF NOT EXISTS sales_guides (
  id           SERIAL PRIMARY KEY,
  slug         VARCHAR(120) NOT NULL UNIQUE,
  section      VARCHAR(20)  NOT NULL DEFAULT 'grunnur'
               CHECK (section IN ('grunnur','sala','thjonusta','vara')),
  title        TEXT NOT NULL,
  title_en     TEXT,
  summary      TEXT,
  summary_en   TEXT,
  body         TEXT NOT NULL,
  body_en      TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  published    BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_guides_section
  ON sales_guides (section, sort_order);

DROP TRIGGER IF EXISTS trg_sales_guides_updated_at ON sales_guides;
CREATE TRIGGER trg_sales_guides_updated_at BEFORE UPDATE ON sales_guides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed the sales-staff role (non-system so Halli can edit its grants in
-- /admin/roles; idempotent so an accidental delete is re-created at boot).
INSERT INTO roles (name, description, view_access, is_system) VALUES
  ('solufolk', 'Sölufólk — aðgangur að handbók sölufólks',
   '["handbok"]'::jsonb, FALSE)
ON CONFLICT (name) DO NOTHING;
