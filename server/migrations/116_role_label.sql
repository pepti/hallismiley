-- 116_role_label — reference copy; the authoritative entry is in
-- server/config/schema.js.
--
-- A display name for admin roles (harvest 2 lane 3, the pattern of
-- icelandicstore #421). roles.name stays the primary key and FK target and is
-- never renamed; roles.label is what people read, and the server derives the
-- slug of a new role from it (server/utils/roleName.js). Unique ignoring case
-- where set. Backfill only WHERE label = '': the text before " — " in the
-- role's own description, else the title-cased name; a taken candidate is
-- skipped. Expand-only. Rollback: DROP INDEX roles_label_lower_uniq; DROP COLUMN
-- label once no release reads it.
ALTER TABLE roles ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS roles_label_lower_uniq
  ON roles (lower(label)) WHERE label <> '';
DO $$
DECLARE r RECORD; cand TEXT;
BEGIN
  FOR r IN SELECT name, description FROM roles WHERE label = '' ORDER BY is_system DESC, name LOOP
    cand := '';
    IF position(' — ' IN r.description) > 0 THEN
      cand := btrim(split_part(r.description, ' — ', 1));
    END IF;
    IF char_length(cand) < 2 OR char_length(cand) > 30 THEN
      cand := left(initcap(btrim(regexp_replace(r.name, '[_-]+', ' ', 'g'))), 30);
    END IF;
    IF char_length(cand) >= 2
       AND NOT EXISTS (SELECT 1 FROM roles WHERE lower(label) = lower(cand)) THEN
      UPDATE roles SET label = cand WHERE name = r.name AND label = '';
    END IF;
  END LOOP;
END $$;
