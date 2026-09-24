---
id: auth-sessions
name: {is: "Innskráning og lotur", en: "Auth and sessions"}
domain: 1
owner: engine
status: live
flag: null
paths:
  - server/routes/authRoutes.js
  - server/controllers/authController.js
  - server/auth/lucia.js
  - server/auth/middleware.js
  - server/auth/tokens.js
  - server/services/tokenCleanup.js
  - server/middleware/softAuth.js
  - public/js/views/ProfileView.js
  - public/js/views/ForgotPasswordView.js
  - public/js/views/ResetPasswordView.js
  - public/js/views/VerifyEmailView.js
  - public/js/components/LoginModal.js
  - public/js/services/auth.js
  - public/js/services/sessionGuard.js
  - public/js/utils/passwordToggle.js
  - public/js/utils/safeReturnTo.js
  - public/js/utils/avatar.js
  - public/css/user-system.css
  - tests/integration/auth.test.js
  - tests/unit/safeReturnTo.client.test.js
  - e2e/auth.spec.js
  - e2e/profile.spec.js
migrations: [002_auth_users, 012_backfill_auth_columns, 041_users_username_lower_unique]
since: 2026-08-09
origin: null
history: [base-sync, ui-kit]
---

Lucia v3 sessions over Postgres: signup, email verification, login (with the 2FA step from `admin-2fa`), password reset, the profile page and the login modal. `/auth` is the only auth mount; `softAuth` attaches the user when a session cookie is present without demanding one. Expired tokens are swept by `tokenCleanup` from `server.js`.

**Rules**
- Lucia v3 owns sessions; there is no JWT layer (invariant 3).
- Every rate limit is x5 the base's since 2026-09-02 (login 50, signup 75, reset 25).
- `LoginModal` must not leak its document keydown listener across mounts.
- Full rules: [../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa](../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa).
