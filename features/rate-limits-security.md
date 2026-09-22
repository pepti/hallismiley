---
id: rate-limits-security
name: {is: "Öryggislag", en: "Security layer"}
domain: 20
owner: engine
status: live
flag: null
paths:
  - server/middleware/csrf.js
  - server/middleware/forwardedFor.js
  - server/utils/staticAsset.js
  - public/js/api/rateLimitDecide.js
  - public/js/api/rateLimitGuard.js
  - tests/integration/security.test.js
  - tests/unit/csrf.test.js
  - tests/unit/forwardedFor.test.js
  - tests/unit/rateLimit.test.js
  - tests/unit/rateLimitDecide.test.js
  - tests/unit/rateLimitGuard.client.test.js
migrations: []
since: 2026-08-09
origin: null
history: [harvest-2, go-live]
---

The request-security posture: helmet/CSP and hpp (configured in `app.js`), csrf-csrf on state-changing routes, the express-rate-limit tiers with the static-asset exemption, `normalizeForwardedFor` ahead of every limiter, and the client's rate-limit guard/toast.

**Rules**
- Tighten, never loosen; exemptions need an inline comment + reason (invariant 7).
- Static-asset exemption is by LOCATION only, never by extension; `normalizeForwardedFor` runs right after `trust proxy`.
- Full rules: [../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting](../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting).
