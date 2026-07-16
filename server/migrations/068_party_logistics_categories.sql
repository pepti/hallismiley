-- Migration: 068_party_logistics_categories
-- Logistics categories become data instead of a hardcoded triple. 058 fixed the
-- set to ('food','drinks','other') via a CHECK constraint; the planner needs to
-- add their own sections ("Skreytingar", "Salur") without a deploy, so the
-- CHECK is replaced by a registry table + foreign key.
--
-- label is NULL for the three built-ins — their names are i18n keys resolved at
-- render time (party.admin.logisticsCatFood etc.), so they stay translated when
-- the admin flips EN/IS. Custom categories carry a literal label typed by the
-- planner in whichever locale they used.
--
-- is_builtin guards deletion: dropping 'other' would break the DEFAULT that
-- ON DELETE SET DEFAULT depends on, and dropping food/drinks would orphan i18n
-- keys. The controller enforces it; the column is the record.
--
-- The FK carries ON DELETE SET DEFAULT so deleting a custom section sweeps its
-- items into 'other' rather than deleting them. Existing rows are guaranteed
-- FK-clean because 058's CHECK admitted only the three seeded keys.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application.

CREATE TABLE IF NOT EXISTS party_logistics_categories (
  id          SERIAL      PRIMARY KEY,
  key         TEXT        NOT NULL UNIQUE,
  label       TEXT,
  icon        TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_builtin  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO party_logistics_categories (key, label, icon, sort_order, is_builtin)
VALUES ('food', NULL, '🍽️', 1, TRUE),
       ('drinks', NULL, '🥤', 2, TRUE),
       ('other', NULL, '📦', 3, TRUE)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE party_logistics_items DROP CONSTRAINT IF EXISTS party_logistics_category_chk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'party_logistics_category_fk'
  ) THEN
    ALTER TABLE party_logistics_items
      ADD CONSTRAINT party_logistics_category_fk
      FOREIGN KEY (category) REFERENCES party_logistics_categories (key)
      ON UPDATE CASCADE ON DELETE SET DEFAULT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_party_logistics_categories_sort
  ON party_logistics_categories (sort_order, id);
