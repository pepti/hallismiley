---
id: admin-2fa
name: {is: "Tvíþætt auðkenning", en: "Admin 2FA (TOTP)"}
domain: 1
owner: engine
status: live
flag: null
paths:
  - server/services/mfaService.js
  - server/utils/totp.js
  - public/js/components/totpFailure.js
  - tests/integration/adminTotp.test.js
  - tests/unit/totp.test.js
  - tests/unit/totpFailure.client.test.js
  - tests/unit/mfaProtected.test.js
  - tests/unit/mfaProtectedClient.test.js
migrations: [082_admin_totp]
since: 2026-08-19
origin: null
history: [base-sync, ui-kit, review-099]
---

TOTP enrolment and the login-time second step for protected roles. `mfaService.protectedRole` decides who must enrol (admins, `accounts` holders, published sellers) and the client mirrors it in `auth.isMfaProtected()`.

**Rules**
- The 2FA gate is mirrored: server `protectedRole` and client `isMfaProtected()` widen together; `mfaProtectedClient.test.js` pins them.
- Enrolment eligibility asks the same predicate the gate does.
- Full rules: [../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa](../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa).
