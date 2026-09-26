-- os_005_sales_guides_persona_hraunbaun — reference copy; the runner applies the entry in
-- server/config/product-migrations/os.js (OS_005_EDITS there). The demo persona
-- "Kaffibrennslan Glóð" is a real company (Halli, 2026-09-26); the fictional one is
-- Kaffibrennslan Hraunbaun. One passage in "kerfid-i-stuttu-mali"; rows nobody saved
-- only (updated_by IS NULL); idempotent; pure data, no DDL. DRÖG.

UPDATE sales_guides SET body = replace(body, 'Kaffibrennsluna Glóð', 'Kaffibrennsluna Hraunbaun')
WHERE slug = 'kerfid-i-stuttu-mali' AND updated_by IS NULL
  AND position('Kaffibrennsluna Glóð' in body) > 0 AND position('Kaffibrennsluna Hraunbaun' in body) = 0;
