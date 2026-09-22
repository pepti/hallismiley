---
id: social-login
name: {is: "Innskráning með Google/Facebook", en: "Social login"}
domain: 1
owner: engine
status: dormant
flag: null
paths:
  - server/controllers/googleAuthController.js
  - server/controllers/facebookAuthController.js
  - server/auth/google.js
  - server/auth/facebook.js
  - server/auth/oauthHelpers.js
  - tests/integration/auth.google.test.js
  - tests/integration/auth.facebook.test.js
  - tests/integration/auth.socialKillSwitch.test.js
  - tests/unit/oauthHelpers.test.js
migrations: [020_oauth_google, 021_oauth_facebook]
since: 2026-08-09
origin: null
history: [base-sync, harvest-1]
---

Google and Facebook OAuth sign-in (arctic + Lucia). Dormant here: no OAuth app is configured, so the kill switch keeps the buttons off; the code and tests stay so a downstream can switch it on by setting the client ids.

**Rules**
- Facebook auto-link refuses an account takeover; OAuth accounts are refused admin.
- Full rules: [../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa](../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa).
