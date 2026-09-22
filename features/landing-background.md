---
id: landing-background
name: {is: "Bakgrunnur forsíðu", en: "Landing background"}
domain: 17
owner: engine
status: hidden
flag: null
paths:
  - server/routes/adminBackgroundRoutes.js
  - server/controllers/adminBackgroundController.js
  - server/models/BackgroundLibrary.js
  - public/js/views/AdminBackgroundView.js
  - public/js/components/BackgroundLibraryAdmin.js
  - public/js/components/LandingBackgroundAdmin.js
  - public/js/services/backgroundLibrary.js
  - public/css/admin-background.css
  - public/css/background-library.css
  - e2e/profile-background.spec.js
migrations: [051_background_media, 080_background_sections, 085_landing_background_gradient, 086_landing_background_scene, 089_landing_background_video]
since: 2026-08-09
origin: null
history: [scene-engine, admin-reshape]
---

The background library (051) and the landing background chooser: video / scene / gradient / photo / plain (080–089). The `background` admin line is hidden here (Vefur group); `video` is the default mode.

**Rules**
- Full rules: [../docs/ARCHITECTURE.md#17-content-settings-background](../docs/ARCHITECTURE.md#17-content-settings-background).
