-- 085_landing_background_gradient — reference copy of the migration in
-- server/config/schema.js
--
-- Retires the waterfall hero (Halli, 2026-08-20). Changing the code default
-- only covers instances that never saved a landing_background row; one that
-- did keeps its stored mode, so the row has to move too.
--
-- Scoped to 'video': a deliberate 'photo' or 'plain' choice is left alone.
-- This flips the old default, not everyone's configuration.

UPDATE site_content
   SET value = jsonb_set(value, '{mode}', '"gradient"'::jsonb)
 WHERE key = 'landing_background'
   AND value->>'mode' = 'video';
