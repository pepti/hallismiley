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
  - public/js/utils/features.js
  - public/js/utils/identity.js
  - e2e/lib/identity.js
  - tests/unit/clientConfig.test.js
  - tests/unit/identityConfig.test.js
  - tests/integration/identityDownstream.test.js
migrations: []
since: 2026-08-10
origin: null
history: [self-update, identity-seam-2026-09-22]
---

The per-instance seam: schema defaults in `clientConfig.js` < committed `config/client.json` (product-owned, never synced) < `CLIENT_CONFIG_*` env vars, deep-frozen at boot and logged in full; `features.js` is its client shim for module flags. Every feature `flag` in this registry is a key path here. Since 2026-09-22 the same seam carries the **product identity** (`identity.*`: brand + title suffix, visitor-default locale, theme trio, hero clip, hidden public routes and admin views, the Organization record) — what a downstream would otherwise fork out of engine files. `server/config/identity.js` is the server reader plus the pure head helpers; ssrMeta hands the resolved record to the browser as `<html data-*-theme>` (for the pre-paint `theme-boot.js`) and `<script id="identity">`, which `public/js/utils/identity.js` parses once for every other client reader.

**Rules**
- NO SECRETS in the config; unknown keys warn and are ignored; a corrupt file falls back to the defaults.
- The `identity` defaults ARE Orange Smiley's current values, pinned once in `identityConfig.test.js`; an engine with no block behaves exactly as before. Engine code and engine tests read `identity.*` — never a brand literal.
- A leaf is a schema node with both `type` and `default` (a section may have a child called `default`, as `identity.theme` does).
- The theme trio is validated together: a picker without its default or root is rejected as a whole.
- Full rules: [../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting](../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting).
