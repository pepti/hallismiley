---
id: client-config
name: {is: "Stillingar tilviks", en: "Instance config (module flags + identity)"}
domain: 20
owner: engine
status: live
flag: null
paths:
  - server/config/clientConfig.js
  - server/config/identity.js
  - server/config/moduleCatalog.js
  - server/config/modules.js
  - server/routes/adminModulesRoutes.js
  - public/js/utils/features.js
  - public/js/utils/identity.js
  - public/js/utils/modules.js
  - e2e/lib/identity.js
  - tests/unit/clientConfig.test.js
  - tests/unit/identityConfig.test.js
  - tests/unit/moduleCatalog.test.js
  - tests/integration/moduleFlags.test.js
  - e2e/admin-modules.spec.js
  - tests/integration/identityDownstream.test.js
migrations: []
since: 2026-08-10
origin: null
history: [self-update, identity-seam-2026-09-22, identity-seam-2-2026-09-23, identity-seam-3-2026-09-23, module-flags-2026-09-24, mcp-write-tools-2026-09-24, signup-switch-2026-09-24, harvest2-lane2-2026-09-26]
---

The per-instance seam: schema defaults in `clientConfig.js` < committed `config/client.json` (product-owned, never synced) < `CLIENT_CONFIG_*` env vars, deep-frozen at boot and logged in full; `features.js` is its client shim for module flags. Every feature `flag` in this registry is a key path here. Since 2026-09-22 the same seam carries the **product identity** (`identity.*`: brand + title suffix, visitor-default locale, theme trio, hero clip, hidden public routes and admin views, the Organization record; since identity-seam-3 also the product's own routes' meta, `identity.routes`) — what a downstream would otherwise fork out of engine files. `server/config/identity.js` is the server reader plus the pure head helpers (`productRoutes()`, `organizationDescription()`); ssrMeta hands the resolved record to the browser as `<html data-*-theme>` (for the pre-paint `theme-boot.js`) and `<script id="identity">`, which `public/js/utils/identity.js` parses once for every other client reader (`routeMeta()`, `routeLockFor()`).

**Rules**
- NO SECRETS in the config; unknown keys warn and are ignored; a corrupt file falls back to the defaults.
- The `identity` defaults ARE Orange Smiley's current values, pinned once in `identityConfig.test.js`; an engine with no block behaves exactly as before. Engine code and engine tests read `identity.*` — never a brand literal.
- A leaf is a schema node with both `type` and `default` (a section may have a child called `default`, as `identity.theme` does).
- The theme set is validated together: a picker without its DEFAULT is rejected as a whole; the root may sit outside the picker (a two-theme product keeps `:root` as an unlisted base, identity-seam-2). `identity.theme.dark` names the ids that paint a dark page; `themePrefs.js` `DARK_THEMES` reads it.
- `identity.surface.nav` (since identity-seam-2) is a list of `{ route, labelKey }` records — schema type `object[]`, JSON in the env layer, validated per entry (bare route, i18n key, no other fields, no repeats); `defaults()` hands out fresh records. The engine-only pins in `identityConfig.test.js` compare `defaults()`, never the resolved instance, and the "committed client.json equals the defaults" case runs only when `engine.json.role` is `engine`.
- `identity.routes` (identity-seam-3) is a map of bare route (or `/`) → `{ titleKey, descriptionKey?, titleMode?: "bare"|"suffix", noindex?, locale? }` — schema type `object`, JSON in the env layer, `$comment` keys dropped at any level, validated per record (i18n-key shape, no unknown fields). An entry replaces the engine's row for that route whole. `identity.theme.swatches` is the other map (`{ id: { bg, fg } }`, CSS colour literals). `identity.organization.description` may be an i18n key resolved per locale; `identity.organization.ogImage` is the og:image card (`image` stays the entity's picture). `productRoutes()` (server) and `routeMeta()` (client) normalise an entry identically.
- `identity.email` (harvest 2 lane 2, 2026-09-26): the transactional email header — `logo` (a PNG/JPEG/GIF file NAME under `public/assets/brand/`, the CORP cross-origin directory; no path), `logoWidth` / `logoHeight` (the shown size, 16–320 px), `logoWordmark` (the image spells the name: it stands alone, alt text as fallback; false: the name is set beside it) — and `palette`, a role → `#hex` map over the palette `server/utils/emailPalette.js` derives from the first light theme (roles validated against its `ROLES`; every text colour still AA-guarded at boot). Read server-side only (`emailService.js`); the client mirror carries the defaults for the parity pin. See [../docs/history.d/2026-09-26-harvest2-lane2-email.md#harvest2-lane2-2026-09-26](../docs/history.d/2026-09-26-harvest2-lane2-email.md#harvest2-lane2-2026-09-26).
- **Module switches** (R4, 2026-09-24): `modules.preset` (`all` · `vefur` · `verslun` · `rekstur`) + `modules.<id>.enabled` for the modules `server/config/moduleCatalog.js` lists; the preset answers only the switches the file and env leave unset. `server/config/modules.js` is the runtime reader (the pre-auth `moduleGate`, `isDisabledRoute`, the `<script id="modules">` hand-off, `moduleSummary` for MCP); `public/js/utils/modules.js` its client half. A catalogued feature's registry `flag` is its module's switch, so the feature gate skips its suites where the module is off. Since R5b a second layer — the admin's switches, `app_settings` `modules.admin_off`, loaded at boot after the migrations — may switch a CONTRACTED module off and back on at run time (`setModuleSwitch`; `/admin/general` card, `/api/v1/admin/modules`, MCP `set_module`), never one the contract leaves out; the readers ask per call.
- Full rules: [../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting](../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting).
