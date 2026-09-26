---
id: signup
name: {is: "Nýskráning", en: "Public sign-up"}
domain: 1
owner: engine
status: live
flag: modules.signup.enabled
paths:
  - public/js/views/SignupView.js
  - e2e/signup-flow.spec.js
  - e2e/signup-closed.spec.js
  - tests/integration/signupSwitch.test.js
  - tests/integration/signupEmailNonBlocking.test.js
migrations: []
since: 2026-09-24
origin: null
history: [signup-switch-2026-09-24]
---

Anyone may create an account: the `/signup` page, `POST /auth/signup`, the username/email availability checks, and a first social sign-in that creates an account. A switchable module (R4 catalogue, `modules.signup.enabled`; in the Verslun and Rekstur tiers): off means staff-only sign-in — the APIs 404 before auth, `/signup` is a 404, the nav's "Nýskrá" and the login modal's sign-up link are gone, and Google/Facebook sign in existing accounts only. Accounts are then created by an admin or the invite flow. rekstrarkerfi.is, the shop window, runs it off (D-020, R2b).

**Rules**
- Signup, email verification and the login itself stay in [auth-sessions](auth-sessions.md); this feature is only the door for NEW accounts.
- The nav's "Innskrá" is a separate switch (`identity.surface.navSignIn`); `/login` opens the login modal either way, and a signed-out `/admin` or `/admin/*` URL goes to `/login`.
- `POST /auth/signup` never waits on email: the verification send is detached and `.catch`-logged, since the account is committed before it (icelandicstore #199; `signupEmailNonBlocking.test.js` hangs the mailer and expects the 201).
- `signupSwitch.test.js` and `e2e/signup-closed.spec.js` test the OFF state and never call the feature gate (they must run where signup is off); `signup-flow.spec.js` tests the ON state and is gated.
- Full rules: [../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa](../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa).
