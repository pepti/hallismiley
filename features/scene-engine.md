---
id: scene-engine
name: {is: "Landslagssviðsmyndir", en: "Scene engine"}
domain: 4
owner: engine
status: live
flag: null
paths:
  - public/js/scenes/SceneStage.js
  - public/js/scenes/sceneDefs.js
  - public/js/scenes/sceneHeader.js
  - public/js/scenes/manifest.js
  - server/config/sceneManifest.json
  - public/css/iceland-scene.css
  - public/assets/iceland/**
  - scripts/build-iceland-scenes.js
  - scripts/recompress-images.js
  - e2e/iceland-scene.spec.js
migrations: []
since: 2026-08-21
origin: null
history: [scene-engine, iceland-v2]
---

Every visitor-facing page sits inside a landscape: header pages get a band (`mountSceneHeader`), card pages a whole-page backdrop (`mountSceneBackdrop`). `sceneDefs.js` assigns an image to each route and says what it means; `build-iceland-scenes.js` renders the AVIF/JPEG ladder from gitignored originals and writes `sceneManifest.json` + `CREDITS.md`.

**Rules**
- The images are Halli's own generations, credited to Orange Smiley ehf.; never other people's photos. No place chip.
- `build-iceland-scenes.js` FAILS if the largest <=1600w AVIF exceeds 250 KB; a small source ships at its own width.
- `ssrMeta.js` `ROUTE_SCENE_IMAGES` follows every reassignment; `.ice-scene--band` is `min-height`, never `height`.
- Full rules: [../docs/ARCHITECTURE.md#4-themes-scenes-ambience](../docs/ARCHITECTURE.md#4-themes-scenes-ambience).
