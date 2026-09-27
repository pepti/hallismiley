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
  - tests/unit/themeTokenDefined.test.js
  - tests/themeTokens.js
  - tests/unit/themeTokenContrast.test.js
migrations: [083_user_theme, 084_user_theme_widen, 094_theme_set_three, 106_user_theme_check_drop]
since: 2026-08-09
origin: null
history: [base-sync, scene-engine, identity-seam-2026-09-22, identity-seam-3-2026-09-23, harvest-ice-b-2026-09-24, harvest2-lane4a-2026-09-26]
---

The multi-theme engine: token sets per `html[data-theme]` in `themes.css`, the render-blocking `theme-boot.js`, `themePrefs` (local + per-account preference, 083/084) and the picker. The theme SET is the product's — `identity.theme` (`default`, `root`, `picker`) in `config/client.json`, engine default Glóð/`ember` first, `classic` owns `:root`, `midnight`; 106 drops the old CHECK so a downstream can add its own ids. `chartTheme.js` feeds canvases at draw time; `motion.js` is the one reduced-motion answer.

`tests/unit/themeTokenDefined.test.js` (icelandicstore #410, 2026-09-24) fails on any `var(--x)` nothing defines; radios, checkboxes and selects keep a `:focus-visible` ring.

`tests/unit/themeTokenContrast.test.js` (icelandicstore #313/#324, [harvest 2 lane 4a](../docs/history.d/2026-09-26-harvest2-lane4a-uikit.md#harvest2-lane4a-2026-09-26), 2026-09-26) measures WCAG contrast of the engine's token pairs on every picker theme (the reader is `tests/themeTokens.js`). Its first run re-hued Glóð `--text-muted` to #A3927E, and moved `.btn--primary:hover` onto `--accent-hover`.

**Rules**
- Token pairs clear 4.5:1 for text and 3:1 for focus rings and state borders on every theme. A failure is fixed in the token value, or in the rule when CLAUDE.md pins the value; a threshold is never lowered.
- The theme trio comes from the identity seam, never a literal: `server/config/themes.js` and `themePrefs.js` read it; `theme-boot.js` reads the same values off `<html data-default-theme / data-theme-picker / data-root-theme>` because it runs pre-paint (invariant 13). Its literal fallbacks are the engine defaults for a shell that never passed through SSR. Every picker id still needs a token set in `themes.css` (product-owned hue values).
- Picker swatches: `identity.theme.swatches` (`{ id: { bg, fg } }`, identity-seam-3) wins in `swatchFor`, then the engine's `THEME_SWATCHES`, then the neutral token fill — a product with its own ids paints its own swatches from config, `theme-boot.js` untouched.
- Every new UI must survive a theme switch; no colour literals in component CSS (invariant 15).
- Re-skin by re-hueing token values; never delete the boot script or hardcode one palette.
- Every `var(--token)` in `public/css` names a defined token (JS-set properties are listed in the test).
- Full rules: [../docs/ARCHITECTURE.md#4-themes-scenes-ambience](../docs/ARCHITECTURE.md#4-themes-scenes-ambience).
