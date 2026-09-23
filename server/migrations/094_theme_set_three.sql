-- 094_theme_set_three — reference copy of the migration in server/config/schema.js
-- The theme set was cut from five to three (Halli, 2026-09-02): 'light'
-- (Pappír) and 'mono' (Svart & hvítt) no longer ship a token set. An account
-- that had picked one would boot into classic anyway (the client normalises
-- an unknown value to the default); this moves the stored choice so the
-- account and the screen agree, and so a later narrowing of the CHECK
-- constraint has nothing left to reject.
--
-- DATA ONLY, per invariant 14 (expand/contract). users_theme_check keeps
-- admitting the retired ids on purpose: during a release swap the previous
-- container may still write them, and a narrowed CHECK would turn that PATCH
-- into a 500 for the length of the swap. The contract step — DROP + ADD with
-- ('classic', 'ember', 'midnight') — belongs to a later release, after no
-- running container can write the old ids (084_user_theme_widen is the shape).
--
-- Idempotent: the WHERE matches nothing on a second run.

UPDATE users SET theme = 'classic' WHERE theme IN ('light', 'mono');
