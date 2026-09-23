---
id: admin-2fa
name: {is: "Tvíþætt auðkenning", en: "Admin 2FA (TOTP)"}
domain: 1
owner: engine
status: live
flag: null
paths:
  - server/services/mfaService.js
  - server/auth/mfaPolicy.js
  - server/utils/totp.js
  - server/utils/secretBox.js
  - server/scripts/reset-admin-totp.js
  - public/js/components/totpFailure.js
  - docs/ADMIN-2FA.md
  - tests/integration/adminTotp.test.js
  - tests/integration/adminTotpEnforcement.test.js
  - tests/unit/totp.test.js
  - tests/unit/totpFailure.client.test.js
  - tests/unit/mfaPolicy.test.js
  - tests/unit/mfaProtected.test.js
  - tests/unit/mfaProtectedClient.test.js
  - e2e/admin-totp-enrolment.spec.js
migrations: [082_admin_totp, 107_totp_secret_enc]
since: 2026-08-19
origin: null
history: [base-sync, ui-kit, review-099, harvest-rk-totp-2026-09-23]
---

TOTP enrolment and the login-time second step for protected roles. `mfaService.protectedRole` decides who must enrol (admins, `accounts` holders, published sellers) and the client mirrors it in `auth.isMfaProtected()`.

Since 2026-09-23 enrolment is **mandatory** and the secret is **sealed at rest** — both harvested from rekstrarkerfid (its `admin-totp-enforcement`, 2026-09-18) and widened to the engine's gate. `auth/mfaPolicy.js` runs from `attachRoles` on every session read: an unenrolled admin has `admin` withheld from its role set, an unenrolled `accounts` holder has the view withheld in `requireView`, and the session payload says `mfa_enrolment_required` so the SPA walks the person to the profile panel. `utils/secretBox.js` seals `users.totp_secret` into `totp_secret_enc` (107, expand phase: both columns written, the sealed one read first, a pre-107 account sealed at its next sign-in) under `TOTP_ENC_KEY`; without the key nothing changes. `ADMIN_TOTP_EXEMPT` exempts test accounts and is ignored in production. `reset-admin-totp.js` is the break-glass. Runbook: `docs/ADMIN-2FA.md`.

**Rules**
- The 2FA gate is mirrored: server `protectedRole` and client `isMfaProtected()` widen together; `mfaProtectedClient.test.js` pins them.
- Enrolment eligibility asks the same predicate the gate does — and an account that already owes enrolment is always eligible.
- The enrolment rule lives in `mfaPolicy.js` and nowhere else; guards never re-implement it (`forbiddenMessage` only makes the 403 say why).
- Expand/contract (invariant 14): `totp_secret` is still written and read as a fallback until a later release stops writing it (N+1) and drops it (N+2).
- Full rules: [../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa](../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa).
