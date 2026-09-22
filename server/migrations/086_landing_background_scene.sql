-- 086_landing_background_scene — reference copy of the migration in
-- server/config/schema.js
--
-- The Iceland scene becomes the default hero (Halli, 2026-08-21). Flips only
-- the stored old default ('gradient'); deliberate photo/video/plain choices
-- are left alone. The previous release treats the unknown 'scene' mode as its
-- own default, so the swap window degrades gracefully (invariant 14).

UPDATE site_content
   SET value = jsonb_set(value, '{mode}', '"scene"'::jsonb)
 WHERE key = 'landing_background'
   AND value->>'mode' = 'gradient';
