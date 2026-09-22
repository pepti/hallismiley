---
id: client-config
name: {is: "Stillingar tilviks", en: "Instance config (module flags)"}
domain: 20
owner: engine
status: live
flag: null
paths:
  - server/config/clientConfig.js
  - public/js/utils/features.js
  - tests/unit/clientConfig.test.js
migrations: []
since: 2026-08-10
origin: null
history: [self-update]
---

The per-instance module-flag seam: schema defaults in `clientConfig.js` < committed `config/client.json` (product-owned) < `CLIENT_CONFIG_*` env vars, deep-frozen at boot and logged in full; `features.js` is its client shim. Every feature `flag` in this registry is a key path here.

**Rules**
- NO SECRETS in the config; unknown keys warn and are ignored; a corrupt file falls back to the defaults.
- Full rules: [../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting](../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting).
