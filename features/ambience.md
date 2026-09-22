---
id: ambience
name: {is: "Veður og birta", en: Ambience}
domain: 4
owner: engine
status: live
flag: null
paths:
  - server/routes/ambienceRoutes.js
  - server/controllers/ambienceController.js
  - server/services/icelandAmbience.js
  - public/js/scenes/AmbienceEngine.js
  - public/js/scenes/aurora.js
  - public/js/scenes/particles.js
  - public/js/scenes/sun.js
  - public/js/scenes/sound.js
  - public/js/services/ambiencePrefs.js
  - tests/integration/ambience.test.js
migrations: []
since: 2026-08-21
origin: null
history: [scene-engine]
---

Live weather over the scenes: `/api/v1/ambience` proxies Open-Meteo with a 10-minute cache; the client computes sun position, runs weather particles and a WebGL aurora on dark themes at real night, and optional sound. Toggles are the ThemeSwitcher keys `ws_ambience` / `ws_ambience_sound`.

**Rules**
- `/api/v1/ambience` ALWAYS answers 200 (`{available:false}` on failure).
- Sound is OFF by default; everything obeys `utils/motion.js` and pauses off-screen.
- Full rules: [../docs/ARCHITECTURE.md#4-themes-scenes-ambience](../docs/ARCHITECTURE.md#4-themes-scenes-ambience).
