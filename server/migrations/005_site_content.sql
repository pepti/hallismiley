-- Migration 005: site_content table for admin-editable homepage text
CREATE TABLE IF NOT EXISTS site_content (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

-- Ensure the value column is TEXT — handle case where it was created as jsonb
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'site_content'
      AND column_name = 'value'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE site_content
      ALTER COLUMN value TYPE TEXT USING value::text;
  END IF;
END $$;
