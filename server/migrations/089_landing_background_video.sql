-- 089_landing_background_video — reference copy; the authoritative entry is
-- the '089_landing_background_video' element in server/config/schema.js.
--
-- Homepage revert to the hallismiley composition (Halli, 2026-08-22): the
-- scene-band cutovers didn't work, so the waterfall video is the landing
-- default again. Flip the mode only when it still holds the previous default
-- ('scene', set by 086), so an explicit admin choice of another mode survives.

UPDATE site_content
   SET value = jsonb_set(value, '{mode}', '"video"'::jsonb)
 WHERE key = 'landing_background'
   AND value->>'mode' = 'scene';
