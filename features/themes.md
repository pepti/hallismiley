---
id: themes
name: {is: "Þemu", en: Themes}
domain: 4
owner: engine
status: live
flag: null
paths:
  - server/config/themes.js
  - public/js/components/ThemeSwitcher.js
  - public/js/theme-boot.js
  - public/js/services/themePrefs.js
  - public/js/utils/chartTheme.js
  - public/js/utils/motion.js
  - public/css/themes.css
  - public/css/theme-switcher.css
  - scripts/audit-text-contrast.js
  - scripts/self-host-fonts.js
  - tests/unit/themePrefsAccount.client.test.js
  - tests/unit/themePrefsEnv.client.test.js
migrations: [083_user_theme, 084_user_theme_widen, 094_theme_set_three, 106_user_theme_check_drop]
since: 2026-08-09
origin: null
history: [base-sync, scene-engine]
---

The multi-theme engine: token sets per `html[data-theme]` in `themes.css`, the render-blocking `theme-boot.js`, `themePrefs` (local + per-account preference, 083/084) and the picker. Three themes since 094 (`ember` default, `classic` owns `:root`, `midnight`); 106 drops the old CHECK so a downstream can add its own ids. `chartTheme.js` feeds canvases at draw time; `motion.js` is the one reduced-motion answer.

**Rules**
- `DEFAULT_THEME` lives in `themePrefs.js` AND `theme-boot.js` — keep them in sync (invariant 13).
- Every new UI must survive a theme switch; no colour literals in component CSS (invariant 15).
- Re-skin by re-hueing token values; never delete the boot script or hardcode one palette.
- Full rules: [../docs/ARCHITECTURE.md#4-themes-scenes-ambience](../docs/ARCHITECTURE.md#4-themes-scenes-ambience).
