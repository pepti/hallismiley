# Architecture — where things are, per domain

The map a feature request starts from. Each domain below lists its files, the
**rules that must hold** (each linking to the history entry that explains
why — a `docs/history.d/` fragment since 2026-09-26, the frozen archive
`docs/HISTORY.md` before that), and its history entries. `tests/unit/architectureIndex.test.js`
keeps this file honest: every path here must exist, every routes/controller/
model/view file in the tree must be listed here, and every history link must
resolve. Global stack rules live in `CLAUDE.md` and
`.claude/rules/stack-invariants.md`; this file is the per-domain layer under them.

Written 2026-09-17 from the tree at that date. When you add a router, view,
model or migration, add it here in the same change.

## Directory tree

```
server/
  app.js                  Express app: middleware stack, every router mount (~612–656), catch-all
  server.js               boot: migrations, timers (token/lead/event cleanup, memory watch)
  routes/                 one router per mount (see the domain tables)
  controllers/            request handlers; models and services do the work
  models/                 SQL per table (pg, parameterised); no ORM
  services/               cross-request logic; bookkeeping/ is the books module, bookkeeping/peppol/ the UBL emitter
  middleware/             csrf, sanitize, validate, upload, verifyImageBytes, ssrMeta, locale, gates
  auth/                   Lucia session, roles, requireView, adminViews (view ids), scopes, OAuth
  config/                 schema.js (THE migration list), database, publicSurface, themes, stripe, paths
  migrations/             NNN_name.sql reference copies of a subset of schema.js entries
  scripts/                migrate, bootstrap, seeds, importers, books tooling
  utils/                  small pure helpers (slug, totp, vat, csv, staticAsset, adminRole…)
  i18n/                   server-side EN/IS strings (emails, SSR)
  mcp/                    MCP transport + tool registry
public/
  index.html              the single page; loads css/fonts.css + css/main.css and js/theme-boot.js
  js/router.js            client routes → views (imports every view eagerly — ENHANCEMENTS #6)
  js/views/               one class per screen; admin screens are Admin*View.js
  js/components/          NavBar, AdminSidebar, LoginModal, ThemeSwitcher, the admin kit (adminTable/adminPager)
  js/services/            client API wrappers + auth/session/theme state
  js/utils/               pure helpers (money, format, listState, pageTitle, slug, motion…)
  js/scenes/              the Iceland scene + ambience engine
  js/i18n/                client EN/IS dictionaries
  css/                    main.css @imports every sheet; themes.css holds the three token sets
tests/unit/               node-only Jest (no jsdom); read-the-source parity tests live here
tests/integration/        Jest against real Postgres (4 workers, one DB each — tests/workerDb.js)
e2e/                      Playwright specs + lib/ helpers (isolated per-branch DB)
scripts/                  repo tooling (check-i18n-keys, build-iceland-scenes, build-manifest…)
docs/                     API, ARCHITECTURE (this), HISTORY (archive), history.d/ (one write-up per branch), BOOKKEEPING-SYSTEM, SELF-UPDATE, mcp, SALES-STAFF, TESTING, DEPLOYMENT, SLO…
company/                  gitignored: plans, decisions, logs, market-research staging
.claude/                  gitignored: agents, commands, rules (stack-invariants.md), hooks, worktrees
```

## Global facts

- **Mounts** are all in `server/app.js`. Every `/api/v1/admin/<x>` router mounts
  before the generic `/api/v1/admin` catch-all except `mcp-tokens` and `events`,
  which mount after it — `docs/API.md` (Router inventory) documents the hazard
  and lists every mount with its gate.
- **Migrations**: the engine array in `server/config/schema.js` plus this
  product's array in `server/config/product-migrations/os.js` (091, 092 and
  104 — the company's seeded copy), composed by `server/config/migrationSet.js`
  (engine chain ends `106_user_theme_check_drop`; 006 and 007 never existed;
  the books pair 095/096 sits before 097 in numeric order). The
  `.sql` files under `server/migrations/` are reference copies of a subset.
  Never adopt the base's numbering for the same feature
  ([base-sync](HISTORY.md#base-sync)).
- **Hidden surfaces**: `server/config/publicSurface.js` (public routes hidden
  from nav, sitemap, search, SSR-noindexed, still served) and
  `public/js/components/adminSurface.js` `HIDDEN_ADMIN_VIEWS` (admin lines
  hidden for `'*'` holders only). Hide, never delete — module disposition is
  Halli's via `ENHANCEMENTS.md`.
- **RBAC view ids**: `server/auth/adminViews.js` `ADMIN_VIEW_IDS` must stay
  1:1 with `ADMIN_NAV` in `public/js/components/AdminSidebar.js`
  (`tests/unit/admin-views-parity.test.js`); `PERMISSION_VIEW_IDS`
  (`allaccounts`) are grantable without a sidebar line.
- **CSS**: `public/index.html` loads `css/fonts.css` + `css/main.css`; every
  other sheet is `@import`ed by `main.css`. `admin-kit.css` loads after the
  per-screen sheets and before `themes.css`.
- **Client shape**: views repaint `innerHTML` wholesale; kit modules are pure
  string functions plus one `bind*()` with a single delegated listener on a
  container that outlives the repaint (node-testable, no jsdom)
  ([ui-kit](HISTORY.md#ui-kit)).
- **Feature registry**: `features/<id>.md` is the wiki of what this engine
  ships, cut finer than the domains here — one file per feature with a YAML
  frontmatter naming its files (`paths`), migrations, gate (`flag`), status
  and history anchors. Each domain below lists its features in a
  `| Features |` row; product features live under `features/<product>/`
  (this repo: `features/os/`) and downstream overrides in
  `features/local.json`. `scripts/features-index.js` generates
  `features/README.md`, `.engine-paths` (the product-owned paths a sync
  from the engine never overwrites) and `.gitattributes` from it;
  `tests/unit/featureRegistry.test.js` fails when a source file is claimed by
  no feature or by two, a migration is unowned, or the generated files drift.

---

## 1. Auth, users, RBAC, 2FA

| | |
|---|---|
| Routes | `server/routes/authRoutes.js` → `/auth` · `server/routes/userRoutes.js` → `/api/v1/users` · `server/routes/adminRoutes.js` → `/api/v1/admin` (users list/role/disable/approve/decline/delete, `totp/reset`, `new-password`, `email-health`) · `server/routes/adminRolesRoutes.js` → `/api/v1/admin/roles` |
| Controllers | `server/controllers/authController.js`, `googleAuthController.js`, `facebookAuthController.js`, `userController.js`, `adminController.js`, `adminRolesController.js` |
| Models | `server/models/Role.js`, `server/models/UserRole.js` (users are written by the controllers directly) |
| Services | `server/services/mfaService.js`, `server/services/tokenCleanup.js`; `server/utils/generatePassword.js`, `server/utils/username.js`, `server/utils/placeholderEmail.js` (name-only logins) |
| Auth layer | `server/auth/lucia.js`, `middleware.js`, `roles.js`, `tokens.js`, `adminViews.js`, `requireView.js`, `mfaPolicy.js`, `google.js`, `facebook.js`, `oauthHelpers.js`; `server/utils/adminRole.js`, `server/utils/totp.js`, `server/utils/secretBox.js`; break-glass `server/scripts/reset-admin-totp.js` |
| Middleware | `server/middleware/softAuth.js`, `server/middleware/csrf.js` |
| Views | `public/js/views/SignupView.js`, `ProfileView.js`, `ForgotPasswordView.js`, `ResetPasswordView.js`, `VerifyEmailView.js`, `AdminUsersView.js`, `AdminRolesView.js` |
| Components | `public/js/components/LoginModal.js`, `totpFailure.js`, `mfaReminder.js` (the two-step reminder, mounted by `AdminSidebar.renderAdminShell` and `SellerAreaView`), `OneTimeCredentials.js` (the shown-once username + password) |
| Client | `public/js/services/auth.js`, `sessionGuard.js`, `adminRoles.js`; `public/js/utils/passwordToggle.js`, `safeReturnTo.js`, `avatar.js`, `placeholderEmail.js` |
| CSS | `public/css/user-system.css`, `admin-roles.css`, `mfa-reminder.css` |
| Jest | `tests/integration/auth.test.js`, `auth.google.test.js`, `auth.facebook.test.js`, `auth.socialKillSwitch.test.js`, `users.test.js`, `adminRoles.test.js`, `adminTotp.test.js`, `adminTotpEnforcement.test.js`, `mfaReminder.test.js`, `security.test.js`, `adminOuterGuard.test.js`, `adminNameOnlyLogin.test.js`; `tests/unit/totp.test.js`, `totpFailure.client.test.js`, `mfaPolicy.test.js`, `mfaProtected.test.js`, `mfaProtectedClient.test.js`, `oauthHelpers.test.js`, `csrf.test.js`, `safeReturnTo.client.test.js`, `rateLimit.test.js`, `rateLimitDecide.test.js`, `rateLimitGuard.client.test.js`, `nameOnlyHelpers.test.js`, `generatePassword.test.js` |
| e2e | `e2e/auth.spec.js`, `signup-flow.spec.js`, `profile.spec.js`, `admin-totp-enrolment.spec.js` (on the second, `required` e2e server), `mfa-reminder.spec.js` |
| Migrations | 002, 003, 009, 012, 020, 021, 041, 056, 060, 061, 065, 082 (admin TOTP), 083/084 (per-account theme), 107 (TOTP secret sealed at rest, expand phase), 109 (`users.mfa_reminder_dismissed_at`, the two-step reminder's "don't show again") |
| Features | [admin-2fa](../features/admin-2fa.md), [auth-sessions](../features/auth-sessions.md), [rbac-roles](../features/rbac-roles.md), [signup](../features/signup.md), [social-login](../features/social-login.md), [users-admin](../features/users-admin.md) |
| Feature doc | `docs/API.md` (Authentication), `docs/ADMIN-2FA.md` (mandatory enrolment, the secret at rest, break-glass) |

**Rules that must hold**
- **Public signup is a module; signing in is not** ([signup-switch-2026-09-24](HISTORY.md#signup-switch-2026-09-24)):
  `modules.signup.enabled` (R4 catalogue, Verslun/Rekstur) owns `/signup`,
  `/auth/signup` and the availability checks; off, they are absent and a
  first-time Google/Facebook sign-in is refused (`signup_closed`) — existing
  accounts still sign in, and admins still create accounts. The nav's
  "Innskrá" is `identity.surface.navSignIn`; `/login` always opens the login
  modal, and a signed-out `/admin` or `/admin/*` URL goes there (the staff
  door, whatever the nav shows). Engine suites that exercise signup switch it on for their own file
  (`CLIENT_CONFIG_MODULES_SIGNUP_ENABLED`, removed after); e2e sign-in goes
  through `helpers.openSignIn`, which follows the SERVED identity.
- Emails are validated with `isEmail()` (length ≤ 254 BEFORE the regex; `EMAIL_RE`
  alone backtracks quadratically on anonymous input) ([ready-and-import-order](HISTORY.md#ready-and-import-order-2026-09-23)).
- Lucia v3 owns sessions; there is no JWT layer (invariant 3).
- The 2FA gate is mirrored: server `mfaService.protectedRole` (admin or
  `accounts` holder) and client `auth.isMfaProtected()` must widen together;
  `tests/unit/mfaProtectedClient.test.js` pins them, and enrolment eligibility
  asks the same predicate the gate does ([ui-kit](HISTORY.md#ui-kit), [review-099](HISTORY.md#review-099)).
- Two-factor ENROLMENT is a per-instance switch, `security.mfa.enrolment`
  (`config/client.json`, env `CLIENT_CONFIG_SECURITY_MFA_ENROLMENT`), and it
  defaults to `optional`: `mfaPolicy.mustEnrol()` is false unless the instance
  says `required`, so nothing is withheld and `mfa_enrolment_required` is
  always false, while an account that HAS enrolled is challenged at every
  sign-in in both modes (the challenge is `mfaService`'s, untouched by the
  switch). The policy re-reads the env var per call so a suite can flip it; a
  test of the mandatory path sets `required` for itself
  ([mfa-optional-2026-09-23](HISTORY.md#mfa-optional-2026-09-23)). The seller
  area's own `totp_enabled` demand (`sellerRoutes.js` rule 4) follows the
  switch too — `required` only ([mfa-reminder-2026-09-23](HISTORY.md#mfa-reminder-2026-09-23)).
- Under `optional` a protected account without TOTP that has not dismissed it
  gets the two-step REMINDER: `mfaPolicy.reminderCandidate` is the predicate
  (never under `required`), `authController.roleFields` reads the enrolment
  and `users.mfa_reminder_dismissed_at` (109) from the row and puts
  `mfa_reminder` on every session payload; the SPA mounts
  `components/mfaReminder.js` in the admin shell and the seller area, never
  elsewhere. ✕ hides it for the page load; the checkbox saves at once through
  `POST /auth/mfa-reminder/dismiss` (session, CSRF, own limiter, body ignored —
  only the caller's row, idempotent). It is a preference, never a gate
  ([mfa-reminder-2026-09-23](HISTORY.md#mfa-reminder-2026-09-23)).
- The e2e suite runs TWO servers on one database: the main one under the
  `optional` default, a second on `E2E_PORT + 1` under `required` for
  `admin-totp-enrolment.spec.js` (`test.use({ baseURL })`). The mode is per
  instance; there is no per-request switch, and none may be added
  ([mfa-reminder-2026-09-23](HISTORY.md#mfa-reminder-2026-09-23)).
- Under `required`, enrolment is mandatory for every protected account, and the rule lives in
  `auth/mfaPolicy.js` and nowhere else: `attachRoles` (the one session reader
  every middleware shares) withholds `admin` from an unenrolled admin's role
  set and `requireView` withholds the `accounts` view from an unenrolled
  holder; guards never re-implement it, `forbiddenMessage` only makes the 403
  say why. Session payloads carry the same downgrade plus
  `mfa_enrolment_required`; the SPA's `mfaEnrolmentRequired()` is UX. An
  account that owes enrolment is always enrolment-eligible. `ADMIN_TOTP_EXEMPT`
  is ignored under `NODE_ENV=production`; the break-glass is
  `server/scripts/reset-admin-totp.js` ([harvest-rk-totp-2026-09-23](HISTORY.md#harvest-rk-totp-2026-09-23)).
- The TOTP secret is sealed at rest (`utils/secretBox.js`, AES-256-GCM under
  `TOTP_ENC_KEY`, user id as associated data) in the EXPAND phase of migration
  107: both `totp_secret` and `totp_secret_enc` are written, the sealed copy is
  read first with a plaintext fallback, a pre-107 account is sealed at its next
  sign-in, and without the key nothing changes. Stop writing the plaintext in a
  later release (N+1), drop it in N+2 — invariant 14
  ([harvest-rk-totp-2026-09-23](HISTORY.md#harvest-rk-totp-2026-09-23)).
- Social login is OFF here (no OAuth app configured); OAuth accounts are refused
  admin; the role-SET path carries the 2FA/OAuth gates via `utils/adminRole.js`
  ([base-sync](HISTORY.md#base-sync), [harvest-1](HISTORY.md#harvest-1)).
- Every rate limit is ×5 the base's since 2026-09-02, auth included (global
  2000/15 min, writes 450, login 50, signup 75, reset 25, checkout 50, beacons
  100/300). Deliberately UNTOUCHED: the `/hafa-samband` lead limit, MCP, party,
  self-update and discount limiters [harvest-2](HISTORY.md#harvest-2).
- Facebook auto-link refuses an account takeover; OAuth accounts are refused
  admin [base-sync](HISTORY.md#base-sync).
- Seeded roles and their view sets: `solufolk` (handbok, leads), `solumadur`
  (handbok, leads, accounts, commission), `verktaki` (handbok, accounts,
  allaccounts); `users.github_login` exists since 098 [accounts-commission](HISTORY.md#accounts-commission).
- Per-account UI theme (083/084) is the Appearance section of the profile
  [base-sync](HISTORY.md#base-sync).
- `role.updated` is a staff-audit event; role grant/revoke, invitation and
  disable/enable log best-effort ([review-099](HISTORY.md#review-099)).
- `LoginModal` must not leak its document keydown listener across mounts
  ([ui-kit](HISTORY.md#ui-kit)).
- **One outer door on `/api/v1/admin`**: `app.use('/api/v1/admin', requireAuth,
  requireStaff)` runs after `moduleGate` and before EVERY admin mount (the
  `mcp-tokens`/`events` ones further down included). `requireStaff` admits
  admin, moderator or any role whose resolved, MFA-withheld view set is
  non-empty — never narrow it to admin/moderator (sellers and custom roles
  hold views). It is a floor: every admin router keeps its own guard. A
  customer-facing route never goes under `/api/v1/admin` ([harvest-ice-a](HISTORY.md#harvest-ice-a-2026-09-24)).
- **Admin 2FA reset** (`POST /admin/users/:id/totp/reset`): never your own
  account; a staff target (admin, moderator, any view holder) needs the
  ACTING admin's password through `mfaService.verifyPassword`, the check the
  self-service turn-off shares; the target's sessions end ([harvest-ice-a](HISTORY.md#harvest-ice-a-2026-09-24)).
- **Logins without email**: a reserved `<username>@noemail.invalid`
  (`utils/placeholderEmail.js`) is never an address — every path that would
  mail, show, search, reset or export `users.email` asks `isPlaceholderEmail`
  / `realEmailSql` / `realEmailExpr` first, and `emailService.deliver()`
  drops it before the allowlist. The one-time password is answered once
  (`no-store`), never logged or audited; `new-password` works only for a
  placeholder address on a non-staff account — the address decides, never the
  role ([harvest-ice-a](HISTORY.md#harvest-ice-a-2026-09-24)).
- **MCP tokens follow the admin role**: demote, disable, or removal from the
  admin role revokes the user's live tokens (`McpToken.revokeAllForUser`) on
  top of the per-call owner check ([harvest-ice-a](HISTORY.md#harvest-ice-a-2026-09-24)).

**History**: [base-sync](HISTORY.md#base-sync) · [review-099](HISTORY.md#review-099) · [ui-kit](HISTORY.md#ui-kit) · [harvest-rk-totp-2026-09-23](HISTORY.md#harvest-rk-totp-2026-09-23) · [mfa-optional-2026-09-23](HISTORY.md#mfa-optional-2026-09-23) · [ready-and-import-order](HISTORY.md#ready-and-import-order-2026-09-23) · [mfa-reminder-2026-09-23](HISTORY.md#mfa-reminder-2026-09-23) · [harvest-ice-a-2026-09-24](HISTORY.md#harvest-ice-a-2026-09-24) · [signup-switch-2026-09-24](HISTORY.md#signup-switch-2026-09-24)

## 2. Admin shell — sidebar, dashboard, surface hiding, UI kit

| | |
|---|---|
| Routes | `server/routes/adminNavRoutes.js` → `/api/v1/admin/nav-config` · `server/routes/userRoutes.js` → `PUT /api/v1/users/me/{page-width, page-width-motion, aside-width}` (the layout preferences) |
| Models | `server/models/AdminNavConfig.js` |
| Views | `public/js/views/AdminView.js` (the company overview at `/admin`), `AdminProjectsView.js` (unlisted `/admin/projects` board) |
| Components | `public/js/components/AdminSidebar.js` (`ADMIN_NAV`), `adminNavLayout.js`, `adminSurface.js` (`HIDDEN_ADMIN_VIEWS`), `adminTable.js`, `adminPager.js`, `FilterBar.js`, `Toast.js`, `ToastLog.js`, `ErrorDialog.js` (every error toast), `Combobox.js` (searchable free-text input), `Lightbox.js`, `ChangesList.js`, `PageWidthControl.js`, `AsideWidthControl.js`, `widthMenu.js` |
| Client | `public/js/services/adminNav.js`, `toastLog.js`, `buildInfo.js`, `pageWidth.js`; `public/js/utils/stickyHScroll.js`, `dragFiles.js`, `listState.js`, `localPref.js`, `debounce.js`, `format.js`, `pageTitle.js`, `downloadCsv.js`, `csv.js`, `escHtml.js`, `api.js` |
| CSS | `public/css/admin-shell.css`, `admin-dashboard.css`, `admin-kit.css`, `layout.css`, `components.css`, `variables.css`, `reset.css` |
| Jest | `tests/integration/adminNavConfig.test.js`, `admin.test.js`; `tests/unit/admin-surface-parity.test.js`, `admin-views-parity.test.js`, `adminTableKit.test.js`, `kitFormatters.test.js`, `pageTitle.test.js`, `debounce.test.js`, `csvClientParity.test.js`, `pageWidth.client.test.js`, `combobox.client.test.js`, `stickyHScroll.client.test.js`, `dragFiles.client.test.js`, `adminPageTitle.client.test.js`; `tests/integration/pageWidth.test.js` |
| e2e | `e2e/admin.spec.js`, `admin-surface.spec.js`, `admin-list-kit.spec.js`, `admin-sidebar-scroll.spec.js`, `admin-nav-colors.spec.js`, `admin-page-width.spec.js` |
| Migrations | 053 (nav config), 111 (per-account page width, Mjúk hreyfing, side-column width, cookie choice) |
| Features | [admin-shell](../features/admin-shell.md), [admin-ui-kit](../features/admin-ui-kit.md) |
| Feature doc | — (this section) |

**Rules that must hold**
- **Layout preferences live on the account** ([harvest-ice-b](HISTORY.md#harvest-ice-b-2026-09-24)): `users.page_widths` /
  `aside_widths` (`{ '<page key>' | '*': width }`) and `page_width_motion`
  (111) ride on every session payload like `theme`; a page's key is the
  router's matched pattern (`setPageRoute`), else one derived from the URL
  with ids folded to `:id`. The client value lists (`services/pageWidth.js`
  `WIDTHS`/`ASIDE_WIDTHS`/`ALL_KEY`) and the server's (`userController`)
  move together. A pick is one atomic jsonb UPDATE, never a read-modify-write;
  the inherited width is never saved as a choice (it clears it). Venjuleg
  (1280px) is every admin page's default.
- **Every `showToast(…, 'error')` is the centred `ErrorDialog`**, never a
  corner toast; it is still logged. A flow that expects an error must
  acknowledge the dialog (OK/Enter) before the page is clickable again ([harvest-ice-b](HISTORY.md#harvest-ice-b-2026-09-24)).
- `HIDDEN_ADMIN_VIEWS` applies only to accounts holding `'*'`; a role granted
  `orders` alone still sees it. Routes stay live and ids stay grantable. The
  eye toggle writes `revealedItems` into the layout blob; Reset re-hides; an
  all-hidden group renders no header ([admin-reshape](HISTORY.md#admin-reshape)).
  The SET is the product's — `identity.surface.hiddenAdminViews` in
  `config/client.json`, read through `public/js/utils/identity.js`; never a
  literal in `adminSurface.js`. `admin-surface-parity.test.js` checks the engine
  defaults and this instance's resolved list against `ADMIN_VIEW_IDS`
  ([identity-seam](HISTORY.md#identity-seam-2026-09-22)).
- Sidebar IA (`ADMIN_NAV`): Yfirlit · Sölustarf · Bókhald · Þjónusta ·
  Vörustýring · Vefur · Stillingar · Verslun LAST (every line hidden). Group
  keys are stable; saved per-admin layouts keep their old placement until Reset
  [r1](HISTORY.md#r1), [admin-reshape](HISTORY.md#admin-reshape). The 12-tint row colours ride the
  existing `admin_nav_config` JSONB — no migration [base-sync](HISTORY.md#base-sync).
- `AdminProjectsView` at unlisted `/admin/projects` is gated on the `dashboard`
  view OR editor [admin-reshape](HISTORY.md#admin-reshape).
- Every admin view carries `destroy()` and a stale-paint sequence guard;
  unmapped enum values print themselves rather than a confidently wrong label
  [review-099](HISTORY.md#review-099).
- The client CSV writer tracks the server's `PLAIN_NUMBER` exemption
  (`tests/unit/csvClientParity.test.js`) [ui-kit](HISTORY.md#ui-kit).
- Dashboard cards sit over EXISTING endpoints, each gated on the view its
  endpoint demands; dashboard-less users are forwarded to their first visible
  view ([admin-reshape](HISTORY.md#admin-reshape), [sales-staff](HISTORY.md#sales-staff)).
- Kit contract: `listState` uses `replaceState` only, never `pushState`; page
  size is NOT in the URL; `adminPager.PAGE_SIZES` tops out at 200 because
  `leadsController` clamps `limit` to [1,200]; `sortableTh` emits a real
  `<button>` inside the `<th>` with `aria-sort` on the `th`; `admin-kit.css`
  carries zero colour literals ([ui-kit](HISTORY.md#ui-kit)).
- `AdminUsersView` is the converted reference; `AdminLeadsView` and
  `AdminMarketView` are not converted yet ([ui-kit](HISTORY.md#ui-kit)).
- The sidebar is a capped scroll container (`--nav-h`); the tint popover flips
  above near the bottom ([harvest-2](HISTORY.md#harvest-2)).
- Neutral status chips use `--text-secondary`; `--overlay` is a per-theme token
  ([review-099](HISTORY.md#review-099)).

**History**: [r1](HISTORY.md#r1) · [admin-reshape](HISTORY.md#admin-reshape) · [ui-kit](HISTORY.md#ui-kit) · [harvest-ice-b-2026-09-24](HISTORY.md#harvest-ice-b-2026-09-24)

## 3. Public site — home, /thjonusta, /um-okkur, /hafa-samband, SSR meta, sitemap, SEO

| | |
|---|---|
| Routes | `server/routes/contactRoutes.js` → `/api/v1/contact` · `server/routes/sitemapRoutes.js` (`/sitemap.xml` with `<lastmod>`, `/llms.txt`) · `server/routes/manifestRoutes.js` (`/manifest.json`, named after the identity) · `server/routes/robotsRoutes.js` (`/robots.txt`, Disallow lines from `hiddenRoutes`; `public/robots.txt` is the engine default it replaces) |
| Controllers | `server/controllers/contactController.js` |
| Services | `server/services/indexNow.js`, `server/services/outboundAllowlist.js` |
| Config / middleware | `server/config/publicSurface.js`, `clientConfig.js`, `identity.js` (the resolved `identity.*` + the head helpers), `appEnv.js`, `version.js`, `paths.js`; `server/middleware/ssrMeta.js` (`ROUTE_META`, `DEFAULT_META` page parts, `SERVICE_OFFERINGS`, JSON-LD incl. the Organization) |
| Views | `public/js/views/HomeView.js`, `ThjonustaView.js`, `UmOkkurView.js`, `ContactView.js`, `PrivacyView.js`, `TermsView.js`, `NotFoundView.js`; `HalliView.js` serves the hidden `/about`/`/halli` (`AboutView.js` is dead — see Ownership notes) |
| Components | `public/js/components/NavBar.js` |
| Client | `public/js/router.js` (lazy `VIEWS` table + `make()`), `routePatterns.json` (the route list the server 404s against; `server/utils/spaRoutes.js` reads it), `navigate.js`, `main.js`, `consent.js`; `public/js/utils/identity.js` (the client half of the identity seam), `reveal.js`, `motion.js`, `productSite.js`, `sanitizeHtml.js`, `slug.js`, `features.js` |
| CSS | `public/css/home.css`, `business-pages.css`, `contact.css`, `video-section.css`, `fonts.css` |
| Jest | `tests/integration/contact.test.js`, `contactContentOs002.test.js`, `sitemap.test.js`, `llms.test.js`, `ssrMeta.test.js`, `identityDownstream.test.js`, `spaStatus.test.js`; `tests/unit/routePatterns.test.js`, `routerLazyViews.test.js`; `tests/unit/clientConfig.test.js`, `identityConfig.test.js`, `appEnv.test.js`, `slug.test.js`, `slug.client.test.js`, `outboundAllowlist.test.js`, `version.test.js`, `buildManifest.test.js` |
| e2e | `e2e/business-routes.spec.js`, `lazy-views.spec.js`, `contact.spec.js`, `navigation.spec.js`, `responsive.spec.js`, `responsive-screenshots.spec.js`, `editable-homepage.spec.js` |
| Migrations | 005, 017, 091, 092, os_002 (seeded company copy) |
| Features | [public-site](../features/public-site.md), [company-content](../features/os/company-content.md) (os) |
| Feature doc | `docs/API.md` (Contact); `docs/SALES-STAFF.md` for what a submission becomes |

**Rules that must hold**
- **Unknown paths answer 404** ([harvest-ice-e](HISTORY.md#harvest-ice-e-2026-09-24)): the shell (same body, `noindex`)
  with status 404 for a path no SPA route matches (`public/js/routePatterns.json`
  via `server/utils/spaRoutes.js`, or a product route in `ROUTE_META`) and for a
  detail slug (article, product, project) with no live row — never cached. A
  FAILED detail lookup (pool timeout) stays 200 `no-store` (`ssrMeta.lookups`
  is the test seam). Add a route to `router.js` AND `routePatterns.json`
  (`routePatterns.test.js`; a product route may live in `identity.routes`
  instead). `/favicon.ico` 301s to `/favicon.svg`. The shell is `public,
  no-cache` (it names its release in `<meta name="app-build">`).
- **Views load when visited** ([harvest-ice-e](HISTORY.md#harvest-ice-e-2026-09-24)): `router.js` imports only
  `HomeView` and `NotFoundView`; every other route factory is `async` and
  builds its view through `make('<Name>', …)` from the `VIEWS` loader table.
  A new view = a `VIEWS` entry + `make()` in its route; a static view import
  in the router, or a view pulled into main.js's graph, fails
  `routerLazyViews.test.js`. A module that cannot load goes to
  `recoverFromAssetFailure()` (reload onto a new release, else one reload,
  then `errors.pageLoadFailed`). `pageTitle` and module switches (R4) are unchanged.
- **A legal page names the site it is on** ([legal-pages-site-host-2026-09-25](HISTORY.md#legal-pages-site-host-2026-09-25)):
  `TermsView`/`PrivacyView` write `{siteHost}` and fill it from
  `utils/identity.js` `siteHost()` (the canonical origin, APP_URL) — never a
  host literal, since every product serves these views. The fill is a
  replacer function (`replaceAll('{siteHost}', () => host)`), per the
  replacement-pattern rule.
- **The public IA is the product's** ([identity-seam-2](HISTORY.md#identity-seam-2-2026-09-23)):
  `/`, then `identity.surface.nav` (ordered `{ route, labelKey }` entries;
  `/thjonusta`, `/um-okkur`, `/hafa-samband` here), then the legal pages —
  each minus `identity.surface.hiddenRoutes` (hidden wins when a route is in
  both). `publicSurface.js` derives `PUBLIC_NAV` / `LEGAL_ROUTES` server-side,
  `utils/identity.js` `publicNav()` / `isHiddenRoute()` client-side, and the
  NavBar, both footers (HomeView, ContactView), the sitemap and the
  robots/noindex rule all read those — no route literal in an engine surface.
  The home products card renders only while `/thjonusta` is public; the
  footer mail icon is `identity.organization.email`. Everything else is
  hidden, still served.
- **No product tiers or prices on the company site**; they live on
  rekstrarkerfi.is only. `SERVICE_OFFERINGS` in `ssrMeta.js` mirrors the locale
  service names — change them together; no `price` in structured data;
  `public/js/utils/productSite.js` is the one place that builds the product-site
  URL ([services-page](HISTORY.md#services-page)).
- **The company site names no software it replaces, and does not describe
  the product's stack** ([contact-page-company-2026-09-26](HISTORY.md#contact-page-company-2026-09-26)):
  categories ("vefverslunarkerfi", "bókhaldskerfi"), not products, in copy
  and in the contact form's platform select (`KNOWN_PLATFORMS` still accepts
  the old product values). A contact-copy change ships with a product
  migration for the seeded rows; `contactContentOs002.test.js` checks the
  ContactView defaults and os_002 agree.
- Homepage = the hallismiley composition: dark video hero, light site below;
  the media-hero surfaces are fixed dark on EVERY theme (`home.css`), which is
  how invariant 15 is met. A new hero clip gets a NEW filename (the `public/`
  mount caches 1 h); re-derive from the ORIGINAL, never from v2; under reduced
  motion / Save-Data the hero renders without `autoplay`, with `preload="none"`,
  showing `hero-dc7df-v2-poster.jpg` (v2's first frame — regenerate it with a
  new clip), and `_initHeroVideo` follows a live OS-setting change both ways;
  `/halli` keeps the waterfall on purpose; `e2e/navigation.spec.js` pins the
  filename [homepage](HISTORY.md#homepage).
- **Every `html.replace` in `ssrMeta.js` takes a replacer function**, never a
  template string, when the replacement holds content, config or request text
  ([ssr-replace-literal](HISTORY.md#ssr-replace-literal-2026-09-23)). In a
  replacement string `$&`, `` $` ``, `$'` and `$$` are patterns: admin copy
  carrying them pasted the whole `<head>` into the body or a `</script>` into
  the JSON-LD. `esc()` does not help — `$` is not an HTML character.
  `tests/integration/ssrMeta.test.js` ("replacement patterns") pins it through
  the `<head>`, the JSON-LD and the crawler mirror.
- **Identity comes from the seam, never a literal**
  ([identity-seam](HISTORY.md#identity-seam-2026-09-22)): brand name and legal
  name, the title suffix, `og:site_name`, `<meta author>`, the Organization +
  WebSite JSON-LD, the hero clip + poster, the hidden-route list and the
  visitor-default locale all read `identity.*` — `server/config/identity.js`
  server-side (from `clientConfig`), `public/js/utils/identity.js` client-side
  (from the `<script id="identity">` ssrMeta injects). `ssrMeta.js` and
  `pageTitle.js` hold page PARTS as i18n KEYS (`meta.<key>.title` /
  `meta.<key>.description`, engine tables + `product.<locale>.json` overlay —
  [identity-seam-2](HISTORY.md#identity-seam-2-2026-09-23)); the document title is the translated part +
  `brand.titleSuffix`, or the part with `{brand}` substituted (home), or the
  part as written for `titleMode: 'bare'` (the portfolio surfaces keep "Halli
  Smiley" on purpose). A description names the company as `{legalName}`.
  `/manifest.json` is served by `manifestRoutes.js` from the identity over the
  static engine default; the Product-schema `brand` is `identity.brand.name`;
  the Organization `@type` stays `Organization` for every product (schema.org
  is fine with it for a personal site; a downstream does not fork it). `loadTemplate()` drops the baked Organization from
  `index.html` and the server emits it from the identity on every page, on the
  `${APP_URL}/#organization` id everything references. Its `description` is
  a literal as written or, when it looks like an i18n key (`org.description`),
  resolved per locale through the overlay; the og:image card every page falls
  back to is `identity.organization.ogImage` ([identity-seam-3](HISTORY.md#identity-seam-3-2026-09-23)).
- **A product's own routes are config, never a hook**
  ([identity-seam-3](HISTORY.md#identity-seam-3-2026-09-23)): `identity.routes`
  (`{ "/console": { titleKey, descriptionKey?, titleMode?, noindex?, locale? } }`)
  is merged over `ROUTE_META` / `DEFAULT_META` in `ssrMeta.js` (a
  `product:<route>` key; the entry replaces the engine row for that route
  whole — no `site_content` override, no shop section; merged AFTER the literal
  tables so the parity test's parser still reads them) and over the client
  table in `pageTitle.js` (`routeMeta()` from the hand-off, in `titleForRoute`).
  `noindex` → `publicSurface.js` `NOINDEX_ROUTES` / `isDeindexedRoute()`: the
  `<meta robots>`, a robots.txt Disallow block and the sitemap filter read it
  (exact routes — a noindex route may still sit in `surface.nav`; hidden routes
  stay prefix-matched). `locale` → the lock (domain 5). `/manifest.json`
  describes itself from `routes['/'].descriptionKey` when the landing is
  re-described. The Service catalogue JSON-LD and the company click-throughs in
  the suites run only while `/thjonusta` is public (`testServices`,
  `testCompany`).
- `pageTitle.js` mirrors `ssrMeta.js`; the parity test parses the server file
  (parts + `titleMode`) and guards that its own parser still matches, so a
  refactor cannot make it assert nothing; `composeTitle` on both sides is held
  equal by the same test. The nav lockup and the home footer show
  `identity.brand.name` [ui-kit](HISTORY.md#ui-kit), [r1](HISTORY.md#r1),
  [identity-seam](HISTORY.md#identity-seam-2026-09-22).
- `HomeView._tiers()` / `_steps()` stay dormant with their i18n — do not delete
  [r1](HISTORY.md#r1).
- The commercial model on `/thjonusta`: fixed price for the build, never
  hourly; one monthly fee after. The rekstrarkerfi.is link opens in a new tab,
  locale-matched `/is/` or `/en/`, with `common.opensNewTab` as the shared
  screen-reader note; the OfferCatalog lists the six services then
  Rekstrarkerfið as one offer with its product-site `url` [services-page](HISTORY.md#services-page).
- SPA navigation uses View Transitions where supported (`router.js`); the
  `.view` fadeIn is reduced-motion-gated and suppressed during a transition
  [scene-engine](HISTORY.md#scene-engine).
- Seeded `site_content` rows shadow the JS fallbacks (`home_skills`,
  `home_stats`, `contact_*`): a copy change must move the DB row too, guarded
  on `updated_by IS NULL` so admin edits survive ([r1](HISTORY.md#r1)).
- All copy is DRAFT until Halli approves; draft natively in Icelandic.
- `.ice-scene--band` is `min-height`, never `height` ([services-page](HISTORY.md#services-page));
  `.ice-band-panel .legal-title` floors at `0.95rem` with `overflow-wrap:
  normal; hyphens: manual` — a legal heading may break at a space, never
  inside a word, down to 320px (`iceland-scene.spec.js`;
  [rk-feed](HISTORY.md#rk-feed-2026-09-23)).
- **The sitemap's `<lastmod>` is truthful or absent** ([rk-feed](HISTORY.md#rk-feed-2026-09-23)):
  the newest `site_content.updated_at` among the rows a page renders (either
  locale, as a date) — engine routes from `ssrMeta.contentKeysForRoute()`,
  a product route from `identity.routes[*].contentKeys`; never a deploy
  timestamp. One query, cached for the response's 10 minutes; a content save
  drops the cache (`invalidateLastmodCache`). **`/llms.txt` is every
  product's** and is built only from the seam and `ssrMeta.metaForRoute()`
  (brand H1, Organization description, legal name + place, every advertised
  page per locale — a locked route under its lock only — with the title's
  PART and the description); product content beyond that (rk's pricing) has
  no engine slot yet.
- Canonical host derives from `APP_URL` (still hallismiley.is until the domain
  cutover — intentional, tracked in `PLAN.md`).

**History**: [homepage](HISTORY.md#homepage) · [r1](HISTORY.md#r1) · [services-page](HISTORY.md#services-page) · [ui-kit](HISTORY.md#ui-kit) · [identity-seam-2](HISTORY.md#identity-seam-2-2026-09-23) · [identity-seam-3](HISTORY.md#identity-seam-3-2026-09-23) · [rk-feed](HISTORY.md#rk-feed-2026-09-23) · [harvest-ice-e](HISTORY.md#harvest-ice-e-2026-09-24)

## 4. Themes, scenes, ambience

| | |
|---|---|
| Routes | `server/routes/ambienceRoutes.js` → `/api/v1/ambience` |
| Controllers | `server/controllers/ambienceController.js` |
| Services | `server/services/icelandAmbience.js` |
| Config | `server/config/themes.js`, `server/config/sceneManifest.json`, `server/config/sceneRoutes.js` (route → scene image, shared by ssrMeta's preload and `e2e/iceland-scene.spec.js`) |
| Components | `public/js/components/ThemeSwitcher.js` |
| Scenes | `public/js/scenes/SceneStage.js`, `AmbienceEngine.js`, `sceneDefs.js`, `sceneHeader.js`, `manifest.js`, `aurora.js`, `particles.js`, `sun.js`, `sound.js` |
| Client | `public/js/theme-boot.js`, `public/js/services/themePrefs.js`, `ambiencePrefs.js`; `public/js/utils/chartTheme.js`, `motion.js` |
| CSS | `public/css/themes.css`, `theme-switcher.css`, `iceland-scene.css`, `test-env.css` |
| Scripts | `scripts/build-iceland-scenes.js`, `scripts/audit-text-contrast.js`, `scripts/self-host-fonts.js`, `scripts/recompress-images.js` |
| Jest | `tests/integration/ambience.test.js`; `tests/unit/themePrefsAccount.client.test.js`, `themePrefsEnv.client.test.js`, `themeTokenDefined.test.js` (every `var(--x)` names a defined token), `themeTokenContrast.test.js` (WCAG pairs on every theme; reader in `tests/themeTokens.js`) |
| e2e | `e2e/iceland-scene.spec.js` |
| Migrations | 083, 084 (user theme), 086, 089 (landing background scene/video), 094 (three-theme set), 106 (theme CHECK dropped so a product may add ids) |
| Features | [ambience](../features/ambience.md), [scene-engine](../features/scene-engine.md), [themes](../features/themes.md) |
| Feature doc | `CLAUDE.md` Design rules; `public/assets/iceland/CREDITS.md` |

**Rules that must hold**
- **Every `var(--token)` in `public/css` names a token something defines**
  (`tests/unit/themeTokenDefined.test.js`, [harvest-ice-b](HISTORY.md#harvest-ice-b-2026-09-24)): an undefined token with a
  literal fallback is frozen on one theme, and one without makes the whole
  declaration invalid. A custom property set from JS goes on the test's
  `JS_INJECTED` list with the view that writes it. Radios, checkboxes and
  selects keep a `:focus-visible` ring (`components.css`).
- Three themes here: `ember`/Glóð (default), `classic`/Bjart (owns `:root`),
  `midnight`/Miðnætti. The trio is the PRODUCT's — `identity.theme`
  (`default`, `root`, `picker`) in `config/client.json`, validated together;
  `server/config/themes.js` and `themePrefs.js` read it, `theme-boot.js` reads
  the same values off `<html data-default-theme / data-theme-picker /
  data-root-theme>` that ssrMeta writes (it runs pre-paint, so its literals are
  only the engine fallback for a shell that never passed through SSR). Never a
  theme literal elsewhere ([identity-seam](HISTORY.md#identity-seam-2026-09-22)).
  Every picker id needs a token set in `themes.css`; `swatchFor()` gives an
  unknown id a neutral swatch. `light`/`mono` are retired ids (094). Every new
  UI must survive a theme switch (invariant 15); canvases read `chartTheme.js`
  at draw time.
- The images are Halli's own AI generations (since [iceland-v2](HISTORY.md#iceland-v2);
  the Commons set before them is retired), credited to Orange Smiley ehf. in the
  generated `CREDITS.md` (footer-linked); never other people's photos or
  Facebook saves. Originals live in gitignored `assets-src/iceland/`;
  `build-iceland-scenes.js` regenerates everything, ships a small source at its
  own width, and FAILS if the largest ≤1600w AVIF exceeds 250 KB
  ([scene-engine](HISTORY.md#scene-engine)).
- Scene assignments carry meaning (`sceneDefs.js` header): every
  visitor-facing page has one — bands via `mountSceneHeader`, the card pages
  (signup, forgot/reset password, verify email) a one-viewport backdrop via
  `mountSceneBackdrop`. Not on the homepage (video), the hidden surfaces or
  admin. No place chip: the images are not real places.
  `server/config/sceneRoutes.js` `ROUTE_SCENE_IMAGES` (ssrMeta's preload and
  `e2e/iceland-scene.spec.js` read it) follows every reassignment
  ([iceland-v2](HISTORY.md#iceland-v2), [identity-seam-2](HISTORY.md#identity-seam-2-2026-09-23)).
- `/api/v1/ambience` proxies Open-Meteo with a 10-minute server cache and
  ALWAYS answers 200 (`{available:false}` on failure, static scenes); sun
  position is client-side; weather particles + WebGL aurora run on dark themes
  at real night with a CSS fallback; sound is OFF by default; toggles are the
  ThemeSwitcher keys `ws_ambience` / `ws_ambience_sound`; everything obeys
  `utils/motion.js` and pauses off-screen [scene-engine](HISTORY.md#scene-engine).
- The three themes grade the same photos via `--scene-*` tokens (Miðnætti is
  the hardest cut, for contrast) [scene-engine](HISTORY.md#scene-engine).
- `landing_background` mode `video` is the hero default (089 reverted 086).

**History**: [scene-engine](HISTORY.md#scene-engine) · [base-sync](HISTORY.md#base-sync) (6C theme) · [iceland-v2](HISTORY.md#iceland-v2) · [harvest-ice-b-2026-09-24](HISTORY.md#harvest-ice-b-2026-09-24)

## 5. i18n

| | |
|---|---|
| Server | `server/config/i18n.js`, `server/i18n/index.js`, `server/i18n/en.json`, `server/i18n/is.json`; `server/middleware/locale.js` |
| Services | `server/services/translator.js`, `autoTranslateFields.js`, `siteContentTranslate.js`; `server/services/anthropicAuth.js` (how every Claude call authenticates: workload identity or the key; boot self-check) |
| Client | `public/js/i18n/i18n.js`, `public/js/i18n/en.json`, `public/js/i18n/is.json` |
| Scripts | `scripts/check-i18n-keys.js` (`npm run check:i18n`), `scripts/backfill-is-translations.js`, `scripts/retranslate-party-en.js` |
| Jest | `tests/integration/i18n.test.js`, `content.translate.test.js`, `news.translate.test.js`, `party.translate.test.js`; `tests/unit/translator.test.js`, `autoTranslateFields.test.js`, `localeLock.test.js`, `localeLockClient.test.js`, `i18nIdentity.test.js`, `plural.client.test.js`, `i18nLoadFailure.client.test.js`, `formatMoney.client.test.js`, `formatDate.client.test.js`; `tests/unit/anthropicAuth.test.js`, `anthropicWifWiring.test.js` |
| Migrations | 028–038 (eleven consecutive i18n migrations) |
| Features | [i18n](../features/i18n.md) |
| Feature doc | — |

**Rules that must hold**
- **Counted strings use `plural(n, 'x.one', 'x.many')`** ([harvest-ice-e](HISTORY.md#harvest-ice-e-2026-09-24)): the
  Icelandic rule is the last digit (1, 21, 101 singular; 11, 111 plural);
  both keys exist in both tables with the count as `{n}`, and
  `check:i18n` reads both literals.
- **Icelandic money, numbers and dates are built by hand** in
  `public/js/utils/format.js` ([harvest-ice-e](HISTORY.md#harvest-ice-e-2026-09-24)): Chrome ships no `is` ICU data, so
  `Intl` answered "ISK 8,400" / "14 Sept 2026"; the output equals a full-ICU
  runtime's ("8.400 kr.", "14. sep. 2026"). `formatRelative` still uses
  `Intl.RelativeTimeFormat` (same gap, open item).
- Locale tables are fetched through `utils/assetBase.js` `jsUrl()` (the
  release-stamped tree); a failed engine table keeps the current strings and
  raises `app:asset-load-failed` for the build guard.
- **The page meta is i18n** ([identity-seam-2](HISTORY.md#identity-seam-2-2026-09-23)): `meta.<key>.title`
  (both tables) and `meta.<key>.description` (server table) carry the text
  `ssrMeta.js` / `pageTitle.js` used to hold as literals; a product overrides
  them in `product.<locale>.json` on BOTH sides. `t()` also injects
  `{legalName}`; `has(locale, key)` tells an absent optional string from text.
  `tests/unit/pageTitle.test.js` holds the client and server tables to the
  same text for every title key.
- **`t()` inserts a `{param}` value literally** ([ssr-replace-literal](HISTORY.md#ssr-replace-literal-2026-09-23)):
  both interpolations (`server/i18n/index.js`, `public/js/i18n/i18n.js`)
  pass a replacer function, so `$&`, `$'` and `$$` in a name or a config
  string are never expanded as replacement patterns.
- **Tests assert the visitor default, not Icelandic** ([identity-seam-2](HISTORY.md#identity-seam-2-2026-09-23)):
  `tests/lib/locale.js` (`PUBLIC_DEFAULT_LOCALE`, `tx()`, `tClient()`,
  `localePrefix()`; `e2e/lib/locale.js` re-exports it) is where an engine
  suite gets an expected API string or redirect target — the exact translated
  string, never a literal and never weakened. Only the party route's `/is/`
  stays literal (it is locale-locked).
- **A locale lock has two sources, one reader**
  ([identity-seam-3](HISTORY.md#identity-seam-3-2026-09-23)):
  `server/config/i18n.js` `forcedLocaleFor(path)` answers the engine's party
  lock first, then `identity.routes[*].locale` (prefix-aware like the party
  lock; `/` locks the landing alone; a locale outside `SUPPORTED_LOCALES` is
  ignored, never redirected into a loop). Every consumer — the `app.js` 301,
  the SSR `<head>`, the locale middleware, the sitemap (`onlyLocale`) — asks
  it; `public/js/i18n/i18n.js` mirrors it off the hand-off
  (`utils/identity.js` `routeLockFor`), so the Router guard, `href()` and the
  NavBar switcher follow. Suites ask `forcedLocaleFor(route)` before building
  a path (`forcedLocaleFor(route) || LC`; `e2e/lib/identity.js` exports it):
  a locked route 301s under the visitor-default prefix and is listed under
  its own locale only.
- IS is the visitor default here (`PUBLIC_DEFAULT_LOCALE`), and it comes from
  the identity seam — `identity.locale.publicDefault`, the env var still
  winning — on both sides (`server/config/i18n.js`; `public/js/i18n/i18n.js`
  and `consent.js` via the hand-off), never a literal
  ([identity-seam](HISTORY.md#identity-seam-2026-09-22)). `DEFAULT_LOCALE='en'`
  stays the content/storage dimension (the party module depends on it); the
  switcher choice lives in the `locale_choice` cookie.
- The server tables carry no brand: `t()` injects `{siteName}`
  (`identity.brand.name`) and `{siteHost}` (APP_URL's host without `www.`) on
  every call, explicit params win; product wording goes in
  `product.<locale>.json` ([identity-seam](HISTORY.md#identity-seam-2026-09-22)).
- `check:i18n` also scans every `t('literal')`/`labelKey` in `public/js`
  against `public/js/i18n/en.json` — a missing key fails CI ([harvest-2](HISTORY.md#harvest-2)).
- `loadLocale()` dispatches `localechange` for components mounted outside
  `#app` ([harvest-2](HISTORY.md#harvest-2)).
- Two column conventions coexist: news bodies are `_is` siblings, sales guides
  are IS-canonical with `_en` siblings ([sales-staff](HISTORY.md#sales-staff)).

**History**: [harvest-2](HISTORY.md#harvest-2) · [identity-seam-2](HISTORY.md#identity-seam-2-2026-09-23) · [identity-seam-3](HISTORY.md#identity-seam-3-2026-09-23) · [harvest-ice-a-2026-09-24](HISTORY.md#harvest-ice-a-2026-09-24) · [harvest-ice-e](HISTORY.md#harvest-ice-e-2026-09-24)

## 6. Leads — Fyrirspurnir

| | |
|---|---|
| Routes | `server/routes/leadsRoutes.js` → `/api/v1/admin/leads` (`requireView('leads')`; DELETE + `/export.csv` admin) |
| Controllers | `server/controllers/leadsController.js` (`validateLeadUpdate`, `csvCell`) |
| Models | `server/models/Lead.js` |
| Services | `server/services/leadsCleanup.js` (`LEAD_RETENTION_DAYS`, default 730), `server/services/contactBudget.js` (the process-wide notification send budget) |
| Scripts | `server/scripts/leads-export.js` (`npm run leads:export`, on the capturing instance) · `server/scripts/leads-import.js` (`npm run leads:import`, on ops) |
| Views | `public/js/views/AdminLeadsView.js` |
| Client | `public/js/services/leads.js` |
| CSS | `public/css/admin-leads.css` |
| Jest | `tests/integration/leads.test.js`, `leadsTransfer.test.js`; `tests/unit/leadsRetention.test.js`, `leadRateLimit.test.js`, `leadId.test.js`, `contactBudget.test.js` |
| e2e | `e2e/leads.spec.js`, `e2e/sales-handbook.spec.js` (sidebar count) |
| Migrations | 097, 108 |
| Features | [leads](../features/leads.md) |
| Feature doc | `docs/SALES-STAFF.md` (Working the lead inbox) |

**Rules that must hold**
- `Lead.create()` NEVER throws — `contactController` fires it alongside the
  email; a DB failure logs the submission id only ([leads](HISTORY.md#leads)).
- Submission fields are immutable; PATCH whitelists `status`/`note`/`owner`
  only. `contacted_at`/`contacted_by` = FIRST human touch, never restamped.
- Retention 730 days = the 24 months `/personuvernd` §6 promises — change the
  number and §6 together; all statuses prune alike.
- Every response is `no-store`; DELETE (erasure) and the CSV (bulk PII,
  formula-neutralised, paged to the end) are admin-only ([review-099](HISTORY.md#review-099)).
- `leads` is on the seeded `solufolk` role (append-only, `@>` guarded).
- No MCP leads tool and no automatic per-seller routing — separate sign-offs.
- Cross-instance transfer (D-020 step 4) is one way, by file, insert-only:
  `leads:export` carries the submission fields + `created_at` and NEVER the
  workflow columns; `leads:import` validates the whole file to the contact
  form's limits, writes in one transaction, `ON CONFLICT (submission_id) DO
  NOTHING` — an ops row is the seller's work product and is never updated;
  `source` = `--source` or the file's `instance`; the file lives under
  gitignored `data/` and is deleted after import (`/personuvernd` §3/§6)
  ([leads-transfer-2026-09-22](HISTORY.md#leads-transfer-2026-09-22)).
- **A lead id is a string end to end** ([rk-feed](HISTORY.md#rk-feed-2026-09-23)):
  `parseLeadId()` accepts a positive integer or a uuid and returns the text
  it was given (a product whose table predates 097 holds TEXT uuids); the
  model compares `id::text`; the inbox view never coerces `dataset.id`.
- **The notification outcome lives on the row** (migration 108,
  [rk-feed](HISTORY.md#rk-feed-2026-09-23)): `contactController` records
  `Lead.recordNotification(submissionId, error)` once the insert and the send
  have both settled (`sendLeadNotification` → `true` / `false` = no transport
  / throws); it never throws and never touches the visitor's 200. The inbox
  marks a row with `notify_error` "ekki sent" with the reason on hover; the
  export carries neither column.
- **A process-wide send budget** bounds the notifications
  (`services/contactBudget.js`, 30/h and 200/day, `CONTACT_*_BUDGET`): over it
  the visitor still gets a 200 and the lead is stored, `notify_error` says
  "over send budget", Admin → Monitoring gets a warn row without PII. The lead
  mail opens with the provenance line ([harvest-ice-a](HISTORY.md#harvest-ice-a-2026-09-24)).

**History**: [leads](HISTORY.md#leads) · [review-099](HISTORY.md#review-099) · [leads-transfer-2026-09-22](HISTORY.md#leads-transfer-2026-09-22) · [rk-feed](HISTORY.md#rk-feed-2026-09-23) · [harvest-ice-a-2026-09-24](HISTORY.md#harvest-ice-a-2026-09-24)

## 7. Markaður — market research and the prospect list

| | |
|---|---|
| Routes | `server/routes/marketRoutes.js` → `/api/v1/admin/markadur` (`requireView('markadur')`; status PATCH admin/moderator) |
| Controllers | `server/controllers/marketController.js` (`validateMarketStatus`) |
| Views | `public/js/views/AdminMarketView.js` |
| Client | `public/js/services/market.js` |
| Scripts | `server/scripts/market-import.js` (`npm run market:import`) |
| CSS | `public/css/admin-markadur.css` |
| Jest | `tests/integration/market.test.js`, `marketImport.test.js` |
| e2e | `e2e/markadur.spec.js` |
| Migrations | 093 (`market_companies`, `market_financials` with generated `admin_cost_ratio`, `market_stats` — no screen yet) |
| Features | [markadur](../features/markadur.md), [market-import](../features/market-import.md) |
| Feature doc | — (this section; agent charter in `Projects\agents\markadsstjori.md`) |

**Rules that must hold**
- Named companies never go into a git-tracked file; contact persons are never
  recorded anywhere; staging and PDFs live in gitignored `company/markadur/`
  ([market-research](HISTORY.md#market-research)).
- `report_path` renders as `<code>` text, never a link; scraped `website` and
  `sources[].url` pass a `https?:` check before any `href` ([markadur](HISTORY.md#markadur), [review-099](HISTORY.md#review-099)).
- Two doors onto `market_companies`, both shortlist-only. (a) `PATCH /:id/status`
  to `handed_to_sales`/`rejected` — admin/moderator, `UPDATE … WHERE
  status='shortlist'` (race-safe, else 409), audited as pino info
  `{companyId, from, to, userId}` plus the 093 `updated_at` trigger
  (`researched_by` is the importer's field, not reused). (b) The account
  hand-off (`CustomerAccount.create`, the `accounts` path) requires `shortlist`
  under `FOR UPDATE` and answers 404 when not eligible so ids cannot be
  enumerated [markadur](HISTORY.md#markadur), [review-099](HISTORY.md#review-099).
- UI: hand-off buttons render for editors only and enable only on a
  shortlisted row; the drawer is `role=dialog` with ESC / backdrop dismissal
  and focus returning to the row; headers carry `aria-sort` [markadur](HISTORY.md#markadur).
- Halli's research decisions: free/public sources only (Skatturinn
  ársreikningaskrá, Keldan public figures first); the size band is DATA-DRIVEN
  and he confirms it before it filters; every download batch is listed to him
  before it runs; two lists (smb best-fit ~100 / 25 deep / 10 with reports +
  large watchlist), sectors 47 / 46 / 41–43 / þjónusta+ferðaþjónusta
  [market-research](HISTORY.md#market-research).
- Importer: one transaction per file; idempotent upserts by kennitala /
  (company, year) / stats key [market-research](HISTORY.md#market-research).
- Sorts come from a fixed map, anything else 400; every response `no-store`.
- `markadur` is NOT seeded onto `solufolk`; Halli grants it by hand
  (`e2e/markadur.spec.js` asserts the bounce — flip it when he does).
- Importer: a JSON row carrying `status` overwrites a hand-off on re-import;
  export without it.

**History**: [market-research](HISTORY.md#market-research) · [markadur](HISTORY.md#markadur)

## 8. Customer accounts, commission, staff audit

| | |
|---|---|
| Routes | `server/routes/adminAccountRoutes.js` → `/api/v1/admin/accounts` · `adminCommissionRoutes.js` → `/api/v1/admin/commission` · `adminAuditRoutes.js` → `/api/v1/admin/audit` · `adminCustomerRoutes.js` → `/api/v1/admin/customers` · `adminCustomerNotesRoutes.js` → `/api/v1/admin/customer-notes` |
| Controllers | `server/controllers/accountsController.js` (`stripRateFields`), `adminCustomerController.js`, `adminCustomerNoteController.js` |
| Models | `server/models/CustomerAccount.js` (`TRANSITIONS`), `Commission.js` (`PAYABLE_NOW_ISK`), `Customer.js`, `CustomerNote.js` |
| Services | `server/services/commissionStatements.js`, `server/services/staffAudit.js` |
| Auth | `server/auth/accountScope.js`, `server/auth/commissionScope.js` |
| Views | `public/js/views/AdminAccountsView.js`, `AdminAccountDetailView.js`, `AdminCommissionView.js`, `AdminStatementView.js`, `AdminCustomersView.js` |
| Components | `public/js/components/CommissionStatement.js`, `CustomerNotes.js` |
| Client | `public/js/services/accounts.js`, `commission.js`, `adminCustomers.js`, `adminCustomerNotes.js` |
| CSS | `public/css/admin-accounts.css`, `admin-customers.css` |
| Jest | `tests/integration/accounts.test.js`, `commission.test.js`, `commissionStatements.test.js`, `adminCustomers.test.js`, `adminCustomerNotes.test.js`, `staffAudit.test.js` |
| e2e | `e2e/accounts.spec.js` (+ `e2e/lib/accounts.js`) |
| Migrations | 064 (customer notes), 098, 099, 100, 102 |
| Features | [commission](../features/commission.md), [customer-accounts](../features/customer-accounts.md), [customers-crm](../features/customers-crm.md), [staff-audit](../features/staff-audit.md) |
| Feature doc | `docs/SALES-STAFF.md`; decisions D-003/D-005/D-019 in `company/DECISIONS.md` |

**Rules that must hold**
- Scope in both layers: `accountScope` after `requireView` → `{all:true}` for
  `'*'` or `allaccounts`, else `{ownerId}`; every `CustomerAccount` method takes
  `scope` as a REQUIRED argument and throws without one; a foreign id is 404,
  never 403 ([accounts-commission](HISTORY.md#accounts-commission)).
- `commissionScope` honours only a true admin — `allaccounts` + `commission`
  must not read every seller's earnings; account commission needs BOTH views
  ([migrations-100-102](HISTORY.md#migrations-100-102), [review-099](HISTORY.md#review-099)).
- Rate fields (`build_rate_bp`/`recurring_rate_bp`) are stripped for anyone but
  an admin, silently ([review-099](HISTORY.md#review-099)).
- Lifecycle = `TRANSITIONS`; a skip is 409; every write lands in
  `staff_audit_log` on the SAME client; the log is immutable.
- Commission: 15% build / 10% recurring, overage earns none (D-003); seller +
  rate snapshotted per invoice (`UNIQUE(invoice_id)`);
  payable is an AMOUNT (`PAYABLE_NOW_ISK`) netting credits and refunds with a
  `surviving gross > 0` guard; statements are set differences over a running
  balance (global unique indexes on `adjustment_id` and `payout_id` are what
  make them set differences), never reopened, arithmetic enforced by CHECK;
  statements, lines, payouts and adjustments are append-only and only
  `amount_paid_isk` moves, being a counter; clawback nets against future
  statements for 12 months, never invoiced (D-019); `payee_kind` forks the
  payout — contractor against their own invoice, employee through payroll (a
  `bank_transfer` is refused 409), internal = unpayable; every statement/payout
  write is hard admin [migrations-100-102](HISTORY.md#migrations-100-102).
- The 6-month tail (contract 4.3) has no code — owner change moves future
  commission immediately; use a `manual_credit` adjustment until built.
- `accounts` holders are 2FA-protected like admins (see domain 1).

**History**: [accounts-commission](HISTORY.md#accounts-commission) · [review-099](HISTORY.md#review-099) · [migrations-100-102](HISTORY.md#migrations-100-102)

## 9. Bookkeeping — invoices, VSK, Peppol, intake, settings, replay, payroll

| | |
|---|---|
| Routes | `server/routes/adminBookkeepingRoutes.js` → `/api/v1/admin/bookkeeping` (books/invoices/expenses/ar/vat/bank/ledger/payroll/pos views; issuing admin) |
| Controllers | `server/controllers/adminBookkeepingController.js` |
| Models | `server/models/Invoice.js`, `Expense.js`, `FxRate.js` |
| Services | `server/services/bookkeeping/invoiceService.js`, `expenseService.js`, `ledgerService.js`, `vatService.js`, `payrollService.js`, `posService.js`, `intakeService.js`, `intakeShape.js`, `documentService.js`, `reconciliationService.js`, `reportService.js`, `replay.js`, `replayCase.js`, `auditLog.js`; `server/services/bookkeeping/peppol/index.js`, `ublInvoice.js`, `party.js`, `identifiers.js`, `vatCategory.js`, `xml.js`, `conformance.js`; `server/services/bookkeepingPdf.js`, `pdfService.js` |
| Middleware / utils | `server/middleware/booksLimiters.js`; `server/utils/vat.js`, `vatPeriod.js`, `booksDate.js`, `fx.js`, `csv.js` |
| Views | `public/js/views/AdminBooksView.js`, `AdminBooksSettingsView.js`, `AdminInvoicesView.js`, `AdminInvoiceDetailView.js`, `AdminExpensesView.js`, `AdminARView.js`, `AdminVatView.js`, `AdminBankView.js`, `AdminLedgerView.js`, `AdminPayrollView.js`, `AdminPosView.js`, `booksShared.js` |
| Client | `public/js/services/adminBookkeeping.js`; `public/js/utils/money.js`; `public/js/components/ScanInput.js` (the till's USB barcode scanner, harvested from icelandicstore) + `public/css/scan.css` |
| Scripts | `server/scripts/books-replay.js`, `books-archive-export.js`, `books-backfill-orders.js`, `books-fetch-fx.js`, `seed-books-demo.js` |
| CSS | `public/css/admin-bookkeeping.css` |
| Jest | `tests/integration/adminBookkeeping.test.js`, `booksInvoice.test.js`, `booksExpenses.test.js`, `booksLedger.test.js`, `booksVatReturn.test.js`, `booksPeppolUbl.test.js`, `booksIntake.test.js`, `booksPos.test.js`, `booksPayroll.test.js`, `booksReconciliation.test.js`, `booksReports.test.js`, `booksReplay.test.js`, `booksBackfill.test.js`, `booksDeferredRevenue.test.js`; `tests/unit/booksVat.test.js`, `booksVatPeriod.test.js`, `booksCsv.test.js`, `booksDate.test.js`, `booksFx.test.js`, `booksPdf.test.js`, `booksPayroll.test.js`, `booksReplay.test.js`, `booksIntakeShape.test.js`, `booksControllerParse.test.js`, `ublInvoice.test.js`, `money.client.test.js` |
| Migrations | 072–079, 095, 096, 099, 101, 103 |
| Features | [bookkeeping-core](../features/bookkeeping-core.md), [books-intake](../features/books-intake.md), [books-replay](../features/books-replay.md), [books-settings](../features/books-settings.md), [invoices](../features/invoices.md), [payroll](../features/payroll.md), [peppol-outbound](../features/peppol-outbound.md), [pos](../features/pos.md), [vsk](../features/vsk.md) |
| Feature doc | `docs/BOOKKEEPING-SYSTEM.md`, `docs/BOOKS-PARALLEL-RUN.md`, `docs/ACCOUNTANT-QUESTIONS.md` |

**Rules that must hold**
- Statutory documents are never deleted, only credited (505/2013); service
  invoices are deduplicated by partial unique indexes (one build half per
  account, one recurring per account per month; cancelled rows excluded;
  overage deliberately NOT deduplicated — it is metered), 23505 → 409; the
  client disables the submit button too, but the index is the guarantee
  [review-099](HISTORY.md#review-099).
- `createServiceInvoice`: build 50%/50% (D-005), recurring month with a
  pro-rating override, overage; ex VSK + 24%; the same counter/lines/journal/
  books-audit path as orders, with the account row locked [accounts-commission](HISTORY.md#accounts-commission).
- The invoice keeps the buyer party AS AT ISSUE; the account holds the CURRENT
  value; `invoice_ready` (a kennitala) gates issuing, `peppol_complete` gates
  only the export; `peppol/party.js` is ONE rule with two callers; an
  order-path invoice cannot be UBL-exported (no BT-49) ([migrations-100-102](HISTORY.md#migrations-100-102)).
- Build deposit = prepayment on 2150 with `vat_code = output_24`;
  `vatService.ADVANCE_TURNOVER_ACCOUNTS` counts it in reitur A so VSK does not
  move; **2150 never goes debit**; release posts on the final build half;
  crediting a RELEASED deposit goes against `recognised_into_account`, never
  2150 [migrations-100-102](HISTORY.md#migrations-100-102).
- Client money is minor units at the API boundary (`money.js`): the expense
  form once sent major units where the API takes minor, so USD 20.00 typed as
  `20` booked as USD 0.20.
- On books THIS repo is upstream of icelandicstore (its module is a reporting
  veneer); ice leads on the shop floor only [ui-kit](HISTORY.md#ui-kit).
- Books rows are append-only under `books_forbid_any_mutation`; 095/099/100
  columns sit inside the 072 immutability trigger's frozen tuple.
- Replay target DB must end `_replay`; the 2026-P4 parallel run is the live
  proof (`company/runbooks/`).
- 6600 atvinnubifreiðar deductible, 6610 fólksbifreiðar blocked (103).
- Owed: an "issue invoice from order" button (`issueInvoiceForOrder` has no
  caller — blocker for 2026-P5) and Peppol inbound.
- The till scans (`components/ScanInput.js`, `GET /pos/lookup`, variant first,
  one unit per scan; sounds a per-device switch). A till sale still does NOT
  move stock — the engine's POS never did; that is a separate decision
  ([harvest-ice-c-2026-09-24](HISTORY.md#harvest-ice-c-2026-09-24)).

**History**: [accounts-commission](HISTORY.md#accounts-commission) · [review-099](HISTORY.md#review-099) · [migrations-100-102](HISTORY.md#migrations-100-102) · [harvest-ice-c-2026-09-24](HISTORY.md#harvest-ice-c-2026-09-24) · `PLAN.md` Status (own books programme)

## 10. Sales handbook — Handbók sölufólks

| | |
|---|---|
| Routes | `server/routes/salesGuidesRoutes.js` → `/api/v1/admin/handbok` (`handbok` view; edit admin/moderator; delete admin) |
| Controllers | `server/controllers/salesGuidesController.js` |
| Views | `public/js/views/AdminHandbookView.js` |
| Client | `public/js/services/salesGuides.js` |
| Scripts | `server/scripts/seed-sales-guides.js` |
| CSS | `public/css/admin-handbok.css` |
| Jest | `tests/integration/salesGuides.test.js`, `salesGuidesServicesPage.test.js`, `salesGuidesD001.test.js` |
| e2e | `e2e/sales-handbook.spec.js` (+ `e2e/lib/salesUser.js`) |
| Migrations | 090, 104, os_001 |
| Features | [sales-handbook](../features/sales-handbook.md) |
| Feature doc | `docs/SALES-STAFF.md` |

**Rules that must hold**
- IS-canonical columns with `_en` siblings (the inverse of news); `body_is`/
  `body_en` are RICH_TEXT_FIELDS; every response `no-store`; nothing public
  ([sales-staff](HISTORY.md#sales-staff)).
- Seeded guides are DRAFTS; sales staff see nothing until Halli publishes;
  prices inside carry DRÖG. Migration 104 rewrote two seeded guides guarded on
  `updated_by IS NULL` ([services-page](HISTORY.md#services-page)).
- A text change in `seed-sales-guides.js` ships with a product migration that
  makes the same change to seeded rows (the seed is `ON CONFLICT DO NOTHING`);
  os_001 moved the guides to D-001 pricing and the demo instance, and
  `salesGuidesD001.test.js` checks seed and migration agree
  ([handbook-d001-2026-09-22](HISTORY.md#handbook-d001-2026-09-22)).
- Guide prices follow D-001 (build fee + service contract + verkeiningar) and
  carry DRÖG; demos go to `demo.rekstrarkerfi.is`, never this site
  ([handbook-d001-2026-09-22](HISTORY.md#handbook-d001-2026-09-22)).
- Onboarding a hire is no code: `/admin/customers` → `solufolk` in `/admin/roles`.

**History**: [sales-staff](HISTORY.md#sales-staff) · [services-page](HISTORY.md#services-page) · [handbook-d001-2026-09-22](HISTORY.md#handbook-d001-2026-09-22)

## 11. Shop — cart, checkout, orders, products, collections, bins, discounts (hidden surface)

| | |
|---|---|
| Routes | `server/routes/shopRoutes.js` → `/api/v1/shop` · `adminShopRoutes.js` → `/api/v1/admin/shop` · `adminDiscountRoutes.js` → `/api/v1/admin/discounts` · `adminBinsRoutes.js` → `/api/v1/admin/bins` |
| Controllers | `server/controllers/shopController.js`, `adminShopController.js`, `adminDiscountController.js`, `adminBinsController.js` |
| Models | `server/models/Product.js`, `ProductVariant.js`, `Collection.js`, `Order.js`, `Discount.js`, `Bin.js`, `Inventory.js` (On hand / Committed / Available, the one audited stock writer, the lock order) |
| Services | `server/services/stripeService.js`, `discountEngine.js`, `orderExport.js` (the orders list as .xlsx); `server/services/productImport/parseFile.js`, `headerMap.js`, `parseXlsx.js`, `parsePdf.js`, `headerHints.js`, `tradeLabels.js`, `variantCell.js`, `variantGroups.js` (the one reader for every product file, harvested from icelandicstore); `server/config/stripe.js`, `shipping.js`; `server/utils/qr.js`, `variantAxis.js` |
| Views | `public/js/views/ShopView.js`, `ProductView.js`, `CartView.js`, `CheckoutView.js`, `CheckoutSuccessView.js`, `CheckoutCancelView.js`, `OrderHistoryView.js`, `AdminProductsView.js`, `AdminOrdersView.js`, `AdminOrderDetailView.js`, `AdminCollectionsView.js`, `AdminDiscountsView.js`, `AdminBinsView.js`, `AdminSalesView.js` |
| Components | `public/js/components/ProductCard.js`, `ShopFilters.js`, `CartIcon.js`, `CurrencySelector.js`, `BarcodeScanner.js` |
| Client | `public/js/services/cart.js`, `adminProducts.js`, `adminOrders.js`, `adminCollections.js`, `adminDiscounts.js`, `adminBins.js`; `public/js/utils/availability.js` (the basket's sold-out gate), `imageUrl.js` (the `.thumb.webp` URL) |
| Scripts | `server/scripts/seed-shop.js`, `import-products-csv.js` |
| CSS | `public/css/shop.css`, `admin-products.css`, `admin-orders.css`, `admin-collections.css`, `admin-discounts.css`, `admin-bins.css`, `admin-sales.css`, `barcode-scanner.css` |
| Jest | `tests/integration/shop.test.js`, `discounts.test.js`, `adminOrderBulk.test.js`, `adminProductImportExport.test.js`, `sections.test.js`, `inventoryThreeNumbers.test.js`, `adminProductImportFile.test.js`, `adminOrderExport.test.js`; `tests/unit/discountEngine.test.js`, `shopFilters.test.js`, `bins-grid.test.js`, `qr.test.js`, `availability.client.test.js`, `productImportParseFile.test.js`, `productImportVariantCell.test.js`, `productImportVariantGroups.test.js`, `parsePdfWorker.test.js`, `imageUrl.test.js` (fixture `tests/fixtures/pdfFixture.js`) |
| e2e | `e2e/admin-product-group.spec.js`, `cart-sold-out.spec.js` |
| Migrations | 022–025, 045, 048, 049, 050, 054, 055, 057, 074, 112, 113 |
| Features | [cart-checkout](../features/cart-checkout.md), [discounts](../features/discounts.md), [orders](../features/orders.md), [shop-catalog](../features/shop-catalog.md) |
| Feature doc | — (retail is hidden here; ENHANCEMENTS #22, #23, #25 landed by the 2026-09-24 ice harvest, #24 in part; #26 remains) |

**Rules that must hold**
- Hidden, never deleted: `/shop` in `publicSurface.js`, every admin line in
  `HIDDEN_ADMIN_VIEWS`; routes live, Stripe inert without keys.
- **Three numbers, one writer** ([harvest-ice-c-2026-09-24](HISTORY.md#harvest-ice-c-2026-09-24)):
  `stock` is On hand; Committed is DERIVED from PAID orders whose stock has
  not moved (`orders.stock_deducted_at IS NULL`; pending, cancelled, failed and
  refunded commit nothing; bookable services at product level never count);
  Available = On hand − Committed. On hand moves ONCE per order, at
  fulfilment, in `Order.setOrderStatuses` (un-fulfil restores); the Stripe
  webhook never decrements — it re-checks Available under the row locks and
  refunds a payment that would oversell. The engine keeps `CHECK (stock >= 0)`:
  a fulfilment the shelf cannot cover is a 409 `INSUFFICIENT_STOCK`, never a
  negative count. Every change of on hand goes through `models/Inventory.js`
  (`applyLines` / `setAbsolute` / `recordOpening`) and leaves an
  `inventory_adjustments` row with the actor, the reason and the order — the
  product editor, the variant grid, the import, MCP `set_stock`, fulfilment.
  `stock` is not a plain column in `Product.update` / `ProductVariant.update`.
- **Lock order**: orders row → parent products (FOR KEY SHARE) → variants →
  products, each sorted by id (`applyLines`, `lockReferences` before order
  line inserts, `lockForWrite` before bulk writes); a status-less 40P01 becomes
  a retryable 409 `{ reason: 'BUSY' }` in `errorHandler.js` ([harvest-ice-c-2026-09-24](HISTORY.md#harvest-ice-c-2026-09-24)).
- **The public catalogue sends `available` only**, never on hand or committed;
  `available <= 0` is sold out. The cart and the checkout flag a line
  Available cannot cover and block checkout (`utils/availability.js`); the
  checkout API answers 409 for it (ENHANCEMENTS #25).
- Checkout `required` must be re-applied after `syncShipping()` ([ui-kit](HISTORY.md#ui-kit)).
- The shop search box toggles its buttons with `[hidden]` and never repaints
  under the typist (`ShopFilters._syncSearchControls`).
- Bulk product edit (`POST /products/bulk`) sets type, subcategory, VAT rate,
  status and bin only — never name, price or stock.
- **One reader for every product file** ([harvest-ice-d-2026-09-24](HISTORY.md#harvest-ice-d-2026-09-24)): `POST /products/import/parse-file`
  (multipart, memory-only, 10 MB, CSRF) reads the export's own CSV (csv-parse —
  a quoted line break survives), a supplier .xlsx (exceljs) or a generated PDF
  (pdf-parse; labels such as "Your material number" win over column guessing)
  against `PRODUCT_CSV_COLUMNS` + the supplier synonyms in `headerMap.js`, and
  hands the rows to the unchanged preview → apply. The browser parses nothing
  (`utils/productCsv.js` is gone). pdf.js's worker is preloaded synchronously
  (`parsePdf.ensurePdfWorker`) so a parse cannot fail on pdf.js's memoised
  dynamic import.
- **Match keys**: SKU (variant-first), then Barcode — products' own and, since
  113, a variant's own. A barcode on two catalogue rows (`ambiguousBarcode`), a
  SKU or barcode twice in one file (`duplicateSku` / `duplicateBarcode`) are
  refused, never guessed; the index is deliberately NOT unique. An ORDER
  quantity (Magn, Qty, Order Quantity …) is never read as stock — it is
  reported as skipped; only a real Stock/Birgðir column writes stock, and that
  write is audited (reason `import`).
- **Creating from a file needs `create: true`** and only ever creates a product
  WITH variants: rows with a Variant cell group by Slug, else name, into one
  Draft product (Active only when every row says so), created whole or not at
  all in one transaction (`Product.createWithVariants`, opening stock audited);
  every variant row needs both prices; an existing name/slug or a taken barcode
  refuses the group. A row without a Variant cell that matches nothing stays
  unmatched.
- **The orders list exports a real .xlsx** (`GET /orders/export.xlsx`, same
  filter as the list, typed cells, frozen auto-filtered header); past
  `orderExport.limits.maxRows` it is a 413, never truncated.
- Product-schema `brand` still names Rekstrarkerfið on every SKU — a known
  post-R1 note, not a rule.
- The 4 MB product-import body is parsed inside `adminShopRoutes.js`, after
  `requireAuth`, `requireView('products')`, the limiters and (apply) CSRF, with
  `sanitizeBody` re-applied; `app.js` skips its global parser for that path.
  Never mount a large parser for an admin path at app level again ([ready-and-import-order](HISTORY.md#ready-and-import-order-2026-09-23)).

**History**: [harvest-2](HISTORY.md#harvest-2) · [ui-kit](HISTORY.md#ui-kit) · [ready-and-import-order](HISTORY.md#ready-and-import-order-2026-09-23) · [harvest-ice-c-2026-09-24](HISTORY.md#harvest-ice-c-2026-09-24) · [harvest-ice-d-2026-09-24](HISTORY.md#harvest-ice-d-2026-09-24)

## 12. News, projects, party, bio (hidden portfolio)

| | |
|---|---|
| Routes | `server/routes/newsRoutes.js` → `/api/v1/news` · `projectRoutes.js` → `/api/v1/projects` · `partyRoutes.js` → `/api/v1/party` |
| Controllers | `server/controllers/newsController.js`, `projectController.js`, `partyController.js` |
| Models | `server/models/Project.js` |
| Services | `server/services/partyApproval.js`, `partyInfo.js`; `server/utils/youtube.js` |
| Views | `public/js/views/NewsView.js`, `ArticleView.js`, `ProjectsView.js`, `ProjectDetailView.js`, `HalliView.js`, `PartyView.js`, `PartyAdminView.js`, `PartyMagicLoginView.js`, `PartyApproveView.js` |
| Components | `public/js/components/ProjectCard.js`, `ProjectForm.js`, `ProjectModal.js`, `PartyAdminStatModal.js` |
| Client | `public/js/api/projectApi.js` |
| Scripts | `server/scripts/seed-news.js`, `update-portfolio-project.js`, `seed-arnarhraun.js`, `seed-stofan-bakhus.js`; `scripts/generate-avatars.js`, `scripts/gen-fb-icon.js` |
| CSS | `public/css/news.css`, `party.css`, `gallery.css`, `project-edit.css`, `halli-bio.css` |
| Jest | `tests/integration/news.test.js`, `newsMedia.test.js`, `projects.test.js`, `party.test.js`, `content.partyRsvpForm.test.js`, `videos.test.js`; `tests/unit/partyRsvpStatus.test.js`, `partyNotifyRecipients.test.js`, `partyTimingBucket.test.js` |
| e2e (news) | `e2e/news-editor.spec.js` — the editor overlay covers the viewport and scrolls to its footer (from hallismiley, [identity-seam-2](HISTORY.md#identity-seam-2-2026-09-23)) |
| e2e | `e2e/gallery.spec.js`, `project-edit.spec.js` |
| Migrations | 004, 008, 010, 011, 013–016, 018, 019, 026, 027, 039, 040, 042, 044, 058–063, 066–071 |
| Features | [bio](../features/bio.md), [news](../features/news.md), [party](../features/party.md), [projects](../features/projects.md) |
| Feature doc | — |

**Rules that must hold**
- Hidden from nav/SSR/sitemap (`publicSurface.js`), fully functional at their
  URLs; `/verkefni` hidden since 2026-09-03. Hidden routes keep "Halli Smiley"
  SSR titles on purpose ([r1](HISTORY.md#r1)).
- News wants a public `/frettir` home (the home links were removed, not
  re-homed) — open item in `PLAN.md`.
- Slug folding (ð/þ/æ/ö, `server/utils/slug.js` and its ESM twin
  `public/js/utils/slug.js`) applies on GENERATION only; stored slugs never change
  ([harvest-2](HISTORY.md#harvest-2)).

**History**: [r1](HISTORY.md#r1) · [harvest-2](HISTORY.md#harvest-2)

## 13. Monitoring — event logs, metrics, analytics

| | |
|---|---|
| Routes | `server/routes/eventRoutes.js` → `/api/v1/events` (public beacon) · `adminEventRoutes.js` → `/api/v1/admin/events` · `analyticsRoutes.js` → `/api/v1/analytics` · `analyticsAdminRoutes.js` → `/api/v1/admin/analytics`; root `/health`, `/ready`, `/metrics`, `/csp-report` in `server/app.js` |
| Controllers | `server/controllers/eventLogController.js`, `analyticsController.js` |
| Models | `server/models/EventLog.js`, `Analytics.js` |
| Services | `server/services/eventLogCleanup.js`, `analyticsSalt.js`, `uploadVolumeAlert.js`; `server/utils/maintenanceWindow.js` |
| Observability | `server/observability/appInsights.js` (SDK start, dark without a connection string), `aiClient.js`, `aiLogStream.js` (pino warn+ → traces/exceptions), `trackedFetch.js` (outbound fetch → dependencies); `server/middleware/eventLogOn5xx.js` (every 5xx → `event_logs`) |
| Views | `public/js/views/AdminMonitoringView.js`, `AdminAnalyticsView.js` |
| Client | `public/js/services/adminEvents.js`, `errorReporter.js`, `usage.js`; `public/js/analytics.js`, `public/js/consent.js`, `public/js/services/cookieConsent.js` (the banner's account side); `public/js/api/rateLimitDecide.js`, `rateLimitGuard.js` |
| CSS | `public/css/admin-monitoring.css`, `analytics-admin.css` |
| Jest | `tests/integration/eventLog.test.js`, `analytics.test.js`, `observability.test.js`, `uploadVolumeAlert.test.js`; `tests/unit/analyticsSalt.test.js`, `httpMetrics.test.js`, `loggerScrub.test.js`, `maintenanceWindow.test.js`, `aiLogStream.test.js`, `trackedFetch.test.js`, `cookieConsent.client.test.js`; `tests/integration/cookieConsent.test.js` |
| e2e | `e2e/admin-monitoring.spec.js`, `cookie-consent-account.spec.js` |
| Migrations | 046 (analytics), 087 (event logs), 111 (`users.cookie_consent`) |
| Features | [analytics](../features/analytics.md), [monitoring](../features/monitoring.md) |
| Feature doc | `RUNBOOK.md` (Analytics, Health), `docs/SLO.md` |

**Rules that must hold**
- **The cookie choice follows the account** ([harvest-ice-b](HISTORY.md#harvest-ice-b-2026-09-24)): a signed-in answer is
  `users.cookie_consent` (111, `PUT /api/v1/users/me/cookie-consent`);
  `consent.js` shows the banner only after `consent:ready` (fired by
  `initCookieConsent` after the session restore; 4 s backstop), and
  "declined" wins — an account "accepted" never overrides a browser that
  declined. The banner's colours are theme tokens, never literals.
- `query()` feeds the DB circuit breaker (connectivity errors only) and
  `db_query_duration_seconds`; httpMetrics feeds the error-rate alert; the
  client rate-limit toast ignores the error beacon and stays silent before the
  dictionary loads [harvest-2](HISTORY.md#harvest-2).
- Big uploads always complete: detect and alert (`uploadVolumeAlert`), never
  rate-limit (Halli 2026-09-01).
- Logs scrub secrets and the `q` param; `app.js` scrubs request URLs in its
  own lines ([review-099](HISTORY.md#review-099)).
- `checkMemory` runs once a minute from `server.js` (base-sync 2026-09-13).
- `/metrics` and the `checks` detail of `/ready` share ONE access rule,
  `internalsDenied()` in `server/app.js` (bearer `METRICS_TOKEN`, else
  localhost in production). Anonymous `/ready` keeps `status`, `uptime` and
  `timestamp` — `deploy.yml` reads `uptime` to prove the swap happened, so
  never remove it from the public body. Both read `server/observability/readiness.js`;
  Admin → Monitoring gets the full report from `GET /api/v1/admin/events/health`
  (admin only, `no-store`) ([ready-and-import-order](HISTORY.md#ready-and-import-order-2026-09-23)).
- The staff audit log is read on `/admin/monitoring` (domain 8 owns the writes).
- **Every 5xx is an `event_logs` row** ([harvest-ice-f](HISTORY.md#harvest-ice-f-2026-09-24)): `eventLogOn5xx` is the
  FIRST middleware in `app.js` and records on `finish`/`close` whatever did not
  go through `errorHandler` (which sets `res.locals.eventLogRecorded` so a
  failure is stored once). 503 = `warn` (the server said "not available"),
  500/502/504 = `error`; a route may set `res.locals.errorMessage` /
  `errorContext`. Nothing is written while the DB circuit breaker is open.
  `EventLog.record` tracks its in-flight writes: `EventLog.flush()` runs
  before `pool.end()` on shutdown and before the test helpers TRUNCATE.
- **Telemetry ships dark** ([harvest-ice-f](HISTORY.md#harvest-ice-f-2026-09-24)): nothing loads `applicationinsights`
  unless `APPLICATIONINSIGHTS_CONNECTION_STRING` is set; `appInsights.start()`
  runs FIRST in `server.js` (before pg/http/express). pino forwards warn+
  lines in-process (a multistream, never a worker transport, so the request
  correlation survives); pino-http logs 5xx completions at `error`.
- **No `console.*` and no bare `fetch` under `server/`** (ESLint, [harvest-ice-f](HISTORY.md#harvest-ice-f-2026-09-24)):
  outbound calls go through `trackedFetch(name, url, init, { data })` /
  `fetchNamed(name)` — the recorded URL drops the query string, and a caller
  whose PATH carries a secret (a webhook) passes `data` = origin only.
  `server/scripts/` is exempt except `migrate.js`, which runs at every boot;
  its `--plan` report is written to stdout directly.

**History**: [harvest-1](HISTORY.md#harvest-1) · [harvest-2](HISTORY.md#harvest-2) · [ready-and-import-order](HISTORY.md#ready-and-import-order-2026-09-23) · [harvest-ice-b-2026-09-24](HISTORY.md#harvest-ice-b-2026-09-24) · [harvest-ice-f](HISTORY.md#harvest-ice-f-2026-09-24)

## 14. Self-update

| | |
|---|---|
| Routes | `server/routes/systemRoutes.js` → `/api/v1/system` (`/changes` admin above the module gate; `/version`, `/updates`, apply/rollback behind `modules.selfUpdate.enabled`) |
| Models | `server/models/SystemUpdate.js` |
| Services | `server/services/updateChecker.js`, `updateApplier.js`, `selfUpdateSettings.js`, `changelogRender.js`; `server/utils/semver.js` |
| Config | `server/config/version.js`, `config/client.json` (per-instance seam) |
| Views | `public/js/views/AdminUpdatesView.js` |
| Components | `public/js/components/ChangesList.js` (shared with Monitoring) |
| Scripts | `server/scripts/generate-changes.js`; `scripts/build-manifest.js`, `check-manifest.js`, `generate-version.js` |
| CSS | `public/css/admin-updates.css` |
| Jest | `tests/integration/systemUpdatesApi.test.js`, `systemUpdatesRoutes.test.js`, `systemChanges.test.js`, `systemChangesGate.test.js`, `systemVersion.test.js`, `updateApplier.test.js`, `updateChecker.test.js`, `selfUpdateSettings.test.js`, `selfUpdateDisabled.test.js`, `buildHeader.test.js`; `tests/unit/changelogRender.test.js`, `generateChanges.test.js`, `semver.test.js` |
| e2e | `e2e/admin-updates.spec.js` |
| Migrations | 081 |
| Features | [self-update](../features/self-update.md) |
| Feature doc | `docs/SELF-UPDATE.md`, `docs/UPSTREAM-SELF-UPDATE.md`, `docs/DEPLOYMENT.md` (promote.yml) |

**Rules that must hold**
- Migrations are expand/contract across releases (invariant 14): during an
  image swap the OLD container still serves against the NEW schema, so a drop
  in the same release takes the site down and blocks rollback. An update is
  never applied from inside boot migrations; post-boot verification closes the
  loop [self-update](HISTORY.md#self-update).
- `config/client.json` is the module-config seam (defaults < file <
  `CLIENT_CONFIG_*`); every future module flag reads from it.
- This instance is `managed` on `stable`: records updates, installs nothing,
  and has no `SELF_UPDATE_TRIGGER_URL`, so it could not install one yet.
- `generate-changes.js` stamps the last 30 non-merge commits into gitignored
  server/changes.json (gitignored) on the BUILD HOST (ci.yml docker job + deploy.yml,
  `fetch-depth: 50`); `GET /system/changes` sits ABOVE the module gate so
  instances with self-update OFF still get the card; `[internal]` /
  `Customer-visible: no` opt a commit out [harvest-2](HISTORY.md#harvest-2).
- `CHANGELOG.md` must keep a `## [0.1.0]` section — `build-manifest.js` parses it.
- **Every response names its release** ([harvest-ice-f](HISTORY.md#harvest-ice-f-2026-09-24)): `X-App-Build` =
  `publicBuildTag(gitSha)` = the first 12 hex of sha256(sha) (`version.js`
  `buildTag`; `dev`/`unknown` pass through), set with the request id. The
  commit itself stays admin-only. `deploy.yml` requires the tag of the sha it
  shipped on `/ready` (uptime rule only for an image too old to send it), and
  a `stable` promote requires it on every `vars.CANARY_URLS` origin.
  `buildHeader.test.js` pins the formula to both workflows — change one, change all.

**History**: [self-update](HISTORY.md#self-update) · [harvest-2](HISTORY.md#harvest-2) · [harvest-ice-f](HISTORY.md#harvest-ice-f-2026-09-24)

## 15. MCP connector

| | |
|---|---|
| Routes | `server/routes/mcpRoutes.js` → `/api/v1/mcp` (`MCP_ENABLED` + bearer) · `mcpAdminRoutes.js` → `/api/v1/admin/mcp-tokens` (admin) · `mcpOAuthRoutes.js` → `/.well-known/oauth-*`, `/oauth/{register,authorize,token,revoke}`, `/api/v1/oauth/requests/:id` (consent, admin) |
| Controllers | `server/controllers/mcpAdminController.js`, `mcpOAuthController.js` |
| Models | `server/models/McpToken.js`, `McpOAuth.js` (clients + authorization requests/codes) |
| Middleware / core | `server/middleware/mcpAuth.js`; `server/mcp/transport.js`, `registry.js`, `envTag.js`, `oauth.js` (the OAuth protocol rules), `owner.js` (the owner re-check), `server/mcp/tools/system.js`, `manage.js`, `products.js` (catalogue writes) |
| Views | `public/js/views/AdminMcpSettingsView.js`, `ConnectClaudeView.js` (`/tengja/:id`, the consent page) |
| Client | `public/js/services/adminMcp.js` |
| Jest | `tests/integration/mcp.test.js`, `mcpOAuth.test.js`, `mcpWriteTools.test.js`, `mcpCatalogTools.test.js`; `tests/unit/mcpOAuth.test.js` · e2e `e2e/mcp-oauth.spec.js` |
| Migrations | 088, 110 |
| Features | [mcp-connector](../features/mcp-connector.md) |
| Feature doc | `docs/mcp.md` |

**Rules that must hold**
- Ships dark behind `MCP_ENABLED`; the realm and connector name say
  `orangesmiley`.
- MCP arguments pass through `sanitizeBody` and the global IP limit on purpose
  (moving the mount would exempt it from two global protections — invariant 7);
  the router mounts AFTER the generic admin router (see Global facts).
- No leads tool without a separate sign-off ([leads](HISTORY.md#leads)).
- **OAuth 2.1 is the connector's own** ([mcp-oauth-2026-09-24](HISTORY.md#mcp-oauth-2026-09-24)):
  the instance is its own authorization server (issuer = `APP_URL`); public
  clients only, registered dynamically; PKCE S256 required; exact redirect
  URIs, https on an allowlisted host (`MCP_OAUTH_REDIRECT_HOSTS`, default
  claude.ai/claude.com) or loopback http only — never any https host (open
  redirect); revoking a refresh token ends the whole grant; errors go to a redirect URI only after
  the client and the URI are verified. Only an ADMIN turns a pending request
  into a code, on `/tengja/<id>`, which names the redirect host. Codes are
  single-use (a replay revokes the grant); refresh tokens rotate (a replay
  revokes the grant) and are never bearer credentials; access tokens live an
  hour. Every route carries its own `MCP_ENABLED` gate — the router is mounted
  at `/`. The machine endpoints read no cookies (why they omit CSRF) and
  answer RFC 6749 error bodies (a documented envelope exemption, like the
  JSON-RPC one).
- **Write tools go through the admin screen's own services** ([mcp-write-tools-2026-09-24](HISTORY.md#mcp-write-tools-2026-09-24)):
  `set_update_settings` → `selfUpdateSettings.applyAdminSettings` (the ONE
  write path — `PATCH /api/v1/system/settings` calls it too), `set_module` →
  `setModuleSwitch`, `file_feature_request` → `ChangeRequest`. Scope `write`:
  a stack on the default read-only ceiling does not list them. Tools require
  their services at load, never inside a handler (the tools must bind to the
  app that registered them). Handlers get `{ token }` and audit the write to
  its owner.
- **Catalogue write tools are switched per instance, all OFF** ([harvest-ice-c-2026-09-24](HISTORY.md#harvest-ice-c-2026-09-24)):
  `create_product` / `update_product` / `set_stock` each name a `writeFlag`
  (`mcp.write.productCreate` / `productUpdate` / `stock` in `config/client.json`,
  env `CLIENT_CONFIG_MCP_WRITE_*`, re-read per call) and the `shop` module —
  a third gate after the scope double-gate. A created product is always a
  Draft; `update_product` never takes stock; `set_stock` goes through the
  audited writer with the token owner as the actor.
- **A token is only as good as its owner**: `mcpAuth` and the token endpoint
  re-resolve the owner on every call (`server/mcp/owner.js` — role set, then
  the 2FA policy); not an admin, or disabled → 401.

**History**: [harvest-1](HISTORY.md#harvest-1) · [mcp-oauth-2026-09-24](HISTORY.md#mcp-oauth-2026-09-24) · [mcp-write-tools-2026-09-24](HISTORY.md#mcp-write-tools-2026-09-24) · [harvest-ice-c-2026-09-24](HISTORY.md#harvest-ice-c-2026-09-24)

## 16. Change requests — Breytingarbeiðnir

| | |
|---|---|
| Routes | `server/routes/changeRequestRoutes.js` → `/api/v1/change-requests` (5 MB body, `changeRequestGate`) · `adminChangeRequestRoutes.js` → `/api/v1/admin/change-requests` (`feedback` view) |
| Controllers | `server/controllers/changeRequestController.js` |
| Models | `server/models/ChangeRequest.js` |
| Middleware | `server/middleware/changeRequestGate.js` |
| Views | `public/js/views/AdminChangeRequestsView.js` |
| Components | `public/js/components/ChangeRequestWidget.js` |
| CSS | `public/css/admin-change-requests.css` |
| Jest | `tests/integration/changeRequests.test.js` |
| e2e | `e2e/admin-feedback-switch.spec.js` |
| Migrations | 052 |
| Features | [change-requests](../features/change-requests.md) |
| Feature doc | — |

**Rules that must hold**
- The gate = admin AND (non-prod app-env OR `change_requests.enabled` setting
  on); it answers **404, not 403**; in prod the widget mounts for admins
  only, without the TEST chrome ([harvest-2](HISTORY.md#harvest-2)).
- The TEST chrome (badge, nav/footer glow, widget) is **admins only on every
  stack**: a logged-out visitor or a customer on TEST sees production.
  `themePrefs.getEffectiveEnv()` is the one client answer, re-evaluated on
  `authchange` ([test-chrome-admin](HISTORY.md#test-chrome-admin)).
- Sits in the Þjónusta sidebar group as the support product ([admin-reshape](HISTORY.md#admin-reshape)).
- The 5 MB submit body is parsed in `changeRequestRoutes.js` after the submit
  limiter, the gate and CSRF, then sanitized; `app.js` skips its global parser
  for this path ([ready-and-import-order](HISTORY.md#ready-and-import-order-2026-09-23)).
- **The launcher owns the bottom-right corner while mounted**
  ([rk-feed](HISTORY.md#rk-feed-2026-09-23)): the widget sets
  `body.has-cr-widget` on mount / removes it on destroy, `test-env.css` sets
  `--cr-widget-clearance` on that class, and any page bar that is also
  `position: fixed` in that corner (the contact editor's Save/Cancel) adds
  the variable to its `bottom` — a length, so every theme reads the same.
  `contact.spec.js` proves the bar's buttons take the click with the widget
  mounted.

**History**: [harvest-2](HISTORY.md#harvest-2) · [admin-reshape](HISTORY.md#admin-reshape) · [test-chrome-admin](HISTORY.md#test-chrome-admin) · [rk-feed](HISTORY.md#rk-feed-2026-09-23) · [ready-and-import-order](HISTORY.md#ready-and-import-order-2026-09-23)

## 17. Content, settings, background

| | |
|---|---|
| Routes | `server/routes/contentRoutes.js` → `/api/v1/content` (public reads, admin writes, `/:key/image`) · `adminGeneralSettingsRoutes.js` → `/api/v1/admin/general-settings` · `adminBackgroundRoutes.js` → `/api/v1/admin/background` |
| Controllers | `server/controllers/contentController.js`, `adminGeneralSettingsController.js`, `adminBackgroundController.js` |
| Models | `server/models/Setting.js`, `BackgroundLibrary.js` |
| Views | `public/js/views/AdminGeneralSettingsView.js`, `AdminBackgroundView.js` |
| Components | `public/js/components/BackgroundLibraryAdmin.js`, `LandingBackgroundAdmin.js` |
| Client | `public/js/services/adminGeneralSettings.js`, `backgroundLibrary.js` |
| CSS | `public/css/admin-general-settings.css`, `admin-background.css`, `background-library.css` |
| Jest | `tests/integration/content.uploadImage.test.js`, `sections.test.js` |
| e2e | `e2e/editable-homepage.spec.js`, `profile-background.spec.js` |
| Migrations | 047, 051, 080, 085, 086, 089 |
| Features | [app-settings](../features/app-settings.md), [landing-background](../features/landing-background.md), [site-content](../features/site-content.md) |
| Feature doc | — |

**Rules that must hold**
- `contentController` stamps `updated_by`; seeds leave it null — that is what
  the 091/092/104 guards rely on ([r1](HISTORY.md#r1)).
- `landing_background` default is `video`; scene/gradient/photo/plain remain
  admin-selectable ([scene-engine](HISTORY.md#scene-engine)).
- `background` is a hidden admin line (Vefur group) ([admin-reshape](HISTORY.md#admin-reshape)).

**History**: [r1](HISTORY.md#r1) · [admin-reshape](HISTORY.md#admin-reshape)

## 18. Uploads and media

| | |
|---|---|
| Mounts | static `/assets/{news,party,projects,avatars,products,content,change-requests,brand,iceland}` in `server/app.js`; `UPLOAD_ROOT` boot guard |
| Middleware | `server/middleware/upload.js`, `verifyImageBytes.js`, `sanitize.js`, `validate.js`; `server/utils/imageType.js`, `staticAsset.js` |
| Services | `server/services/uploadVolumeAlert.js`, `productImages.js` (normalise on upload, lazy `.thumb.webp`) |
| Config | `server/config/paths.js` |
| Jest | `tests/integration/media.test.js`, `uploadImageBytes.test.js`, `newsMedia.test.js`, `uploadVolumeAlert.test.js`, `productImages.test.js`; `tests/unit/uploadPaths.test.js`, `uploadRoot.test.js`, `imageType.test.js`, `verifyImageBytes.test.js`, `sanitize.test.js`, `validate.test.js` |
| Migrations | 004, 016, 051 |
| Features | [uploads-media](../features/uploads-media.md) |
| Feature doc | `SECURE_SDLC.md` |

**Rules that must hold**
- `verifyImageBytes` sniffs magic bytes behind EVERY image upload (mismatch →
  file unlinked, 400); video/PDF untouched ([harvest-2](HISTORY.md#harvest-2)).
- Upload paths are allowlisted; uploaded avatars are owner-scoped ([base-sync](HISTORY.md#base-sync)).
- Static-asset rate-limit exemption is by LOCATION only, never by extension
  (`staticAsset.js`; root files `/favicon.svg`, `/manifest.json`,
  `/og-image.jpg` included); the catch-all 404 reuses its regex [harvest-2](HISTORY.md#harvest-2).
- Brand assets carry the CORP (cross-origin resource policy) exemption
  [harvest-1](HISTORY.md#harvest-1). `avatarHint` must match the enforced 5 MB avatar limit [ui-kit](HISTORY.md#ui-kit).
- Alert on volume, never block (domain 13).
- **Product images are normalised on upload** ([harvest-ice-d-2026-09-24](HISTORY.md#harvest-ice-d-2026-09-24)): EXIF auto-orient, long
  edge ≤ 2000 px, metadata stripped, same format; bytes sharp cannot decode are
  a localised 400 with nothing kept. Rewrite from a BUFFER, never a temp file
  renamed over the source (the Azure Files mount refuses a rename over a file
  libvips still holds), and no `mozjpeg` encoder option (musl libvips on alpine
  rejects it). `<original>.thumb.webp` (192 px) is made on the first request by
  the handler mounted after the products static, and served statically after;
  a derivative is never a source; deleting an image deletes its thumbnail.
  `sharp` is a runtime dependency since this.
- `sanitizeBody` strips tags with the linear `stripTags()` — byte-identical to
  `/<[^>]*>/g`, which was quadratic on runs of `<` (100 kb blocked the event
  loop 2.3 s, before any limiter). Never reintroduce a backtracking regex on
  request bodies; `/<[^<>]*>/` is NOT equivalent ([ready-and-import-order](HISTORY.md#ready-and-import-order-2026-09-23)).
- Large bodies (import 4 MB, change requests 5 MB) are parsed inside their
  routers after the gates, never by an app-level parser ahead of them ([ready-and-import-order](HISTORY.md#ready-and-import-order-2026-09-23)).

**History**: [base-sync](HISTORY.md#base-sync) · [harvest-2](HISTORY.md#harvest-2) · [ready-and-import-order](HISTORY.md#ready-and-import-order-2026-09-23)

## 19. Email

| | |
|---|---|
| Services | `server/services/emailService.js` (`emailShell`), `outboundAllowlist.js`; `server/utils/inviteSend.js` (the invite reporting contract); templates use `server/i18n/` |
| Routes | `GET /api/v1/admin/email-health` in `server/routes/adminRoutes.js` |
| Jest | `tests/unit/outboundAllowlist.test.js`, `emailReplyTo.test.js`, `emailNameOnlyRecipient.test.js`; `tests/integration/inviteFeedback.test.js`; exercised by `tests/integration/auth.test.js`, `party.test.js`, `contact.test.js` |
| Migrations | 062 |
| Features | [email](../features/email.md) |
| Feature doc | `RUNBOOK.md`, `docs/DEPLOYMENT.md` (env) |

**Rules that must hold**
- Sender is `EMAIL_FROM`; never the base's address. Production sends from the
  fleet domain (`orangesmiley@mail.orangesmiley.is`, D-015) with
  `EMAIL_REPLY_TO` pointing at a real mailbox, added to every message that
  sets no replyTo of its own ([go-live](HISTORY.md#go-live)). Mail failures are loud; `EMAIL_ALLOWLIST` limits recipients outside
  prod ([harvest-1](HISTORY.md#harvest-1)).
- The 7 server email strings carry the company brand ([r1](HISTORY.md#r1));
  `emailShell` escapes its `<title>` (base-sync 2026-09-13).
- **"Sent" means accepted for THE recipient**: the senders return the
  provider id or `false` (muted, or only placeholder recipients), never
  undefined; an invite answers through `utils/inviteSend.js` — `invited` /
  `reachedRecipient` only when accepted and not redirected by
  `EMAIL_ALLOWLIST` (`isRedirecting()`), otherwise the set-password link
  comes back (`no-store`), with `emailError` for staff eyes. `invited_at` is
  stamped only on a confirmed, un-redirected send ([harvest-ice-a](HISTORY.md#harvest-ice-a-2026-09-24)).

**History**: [harvest-1](HISTORY.md#harvest-1) · [r1](HISTORY.md#r1) · [go-live](HISTORY.md#go-live) · [harvest-ice-a-2026-09-24](HISTORY.md#harvest-ice-a-2026-09-24)

## 20. Infrastructure and cross-cutting

| | |
|---|---|
| Release delivery | `server/middleware/versionedStatic.js` (`/js/_<tag>/`, `/css/_<tag>/`, immutable a year, 404 `no-store` under another tag), `server/utils/staticCacheControl.js` (unstamped JS/CSS/JSON `no-cache`); client `public/js/services/buildGuard.js`, `public/js/utils/buildCheck.js`, `public/js/utils/assetBase.js`, `public/js/components/UpdateBanner.js`; `tests/integration/versionedShell.test.js`, `tests/unit/versionedStatic.test.js`, `staticCacheControl.test.js`, `buildCheck.client.test.js`, `noAbsoluteJsUrls.test.js` · e2e `e2e/build-reload.spec.js` |
| App | `server/app.js`, `server/server.js`, `server/config/database.js`, `server/middleware/errorHandler.js`, `server/middleware/forwardedFor.js`; `server/utils/safeEqual.js` (constant-time compare for header credentials — the `/metrics` bearer) |
| Module switches (R4) | `server/config/moduleCatalog.js` (what each switchable module owns: routes, API + upload prefixes, admin views, registry features, tiers), `server/config/modules.js` (the resolved state: the pre-auth `moduleGate`, `isDisabledRoute`, the `<script id="modules">` hand-off), `public/js/utils/modules.js` (its client half); `server/routes/adminModulesRoutes.js` → `/api/v1/admin/modules` (the admin's switches, R5b); `tests/unit/moduleCatalog.test.js`, `tests/integration/moduleFlags.test.js` · e2e `e2e/admin-modules.spec.js` |
| Migrations tooling | `server/config/schema.js`, `server/scripts/migrate.js`, `bootstrap.js`, `setup-admin.js`, `seed.js`, `cleanup-duplicates.js`, `capture-site-screenshots.js` |
| Tests infra | `tests/workerDb.js`, `tests/lib/featureGate.js` (the feature gate core), `tests/lib/locale.js` (the visitor-default helper), `tests/lib/historyAnchors.js` (archive + fragment anchors, one namespace), `e2e/global-setup.js`, `e2e/helpers.js`, `e2e/lib/dbUrl.js`, `e2e/lib/featureGate.js`, `e2e/lib/identity.js`, `e2e/lib/locale.js`; `scripts/drop-test-dbs.js` |
| Jest | `tests/unit/schema-integrity.test.js`, `database.test.js`, `workerDb.test.js`, `featureGate.test.js`, `errorHandlerDeadlock.test.js`, `migrationIdempotent.test.js`, `ciSkippedShim.test.js`, `workflowsParse.test.js`, `historyFragments.test.js`; `tests/integration/migrateRunner.test.js` |
| CI / deploy | `.github/workflows/ci.yml` (lint · 3 Jest shards · the aggregator), `ci-skipped.yml` (docs-only PR shim), `deploy.yml` (dispatch-only, by digest, production only), `promote.yml`; `scripts/merge-coverage.js`; `Dockerfile` |
| Migrations | 001, 043 (housekeeping) |
| Features | [client-config](../features/client-config.md), [platform-core](../features/platform-core.md), [rate-limits-security](../features/rate-limits-security.md), [testing-infra](../features/testing-infra.md) |
| Feature doc | `RUNBOOK.md`, `SECURE_SDLC.md`, `docs/TESTING.md`, `docs/DEPLOYMENT.md`, `docs/history.d/README.md` |

**Rules that must hold**
- **A chunk's write-up is a new file, never an append** ([harvest2-lane0](history.d/2026-09-26-harvest2-lane0-history.md#harvest2-lane0-2026-09-26)):
  `docs/history.d/YYYY-MM-DD-<branch, / as ->.md`, first line its `<a id>`
  anchor, next non-empty line `## YYYY-MM-DD — <title>`; `docs/HISTORY.md` is
  the frozen archive to 2026-09-26 and its index table covers it alone. The
  archive's and the fragments' slugs are one namespace (a `history:` entry in
  `features/*.md` is a bare slug) and must not repeat; a link names the file
  it points into (`history.d/<file>.md#slug` from `docs/`,
  `docs/history.d/<file>.md#slug` from `PLAN.md`) and must resolve there —
  checked in every doc under docs/ and features/ plus the root PLAN, README
  and CLAUDE files.
  `historyFragments.test.js` + `architectureIndex.test.js` enforce both.
- **Every chunk is reviewed before it merges** ([harvest2-lane0](history.d/2026-09-26-harvest2-lane0-history.md#harvest2-lane0-2026-09-26)):
  `/code-review` or the `invariant-reviewer` agent on the branch diff;
  findings are fixed on the branch first (CLAUDE.md, Project rules).
- **A module that is off is absent, not hidden** ([module-flags-2026-09-24](HISTORY.md#module-flags-2026-09-24)):
  `modules.preset` (`all` default · `vefur` · `verslun` · `rekstur`) plus
  `modules.<id>.enabled`; an explicit switch beats the preset. What a module
  owns is `server/config/moduleCatalog.js` only — a new module surface (an API
  mount, an SPA route, an admin view, a registry feature) is added there in
  the same change, and `moduleCatalog.test.js` fails on drift both ways. Off =
  `moduleGate` 404s its API/upload prefixes before auth (mounted before the
  raw-body routes), its pages get a 404 with the DEFAULT head (never the
  route's meta, detail row or crawler list), it leaves nav/sitemap/index, the
  role editor and `canSeeView()`. Longest prefix owns a path. Hidden
  (`identity.surface.hiddenRoutes`) is the other idea: still working at its
  URL — this instance hides its portfolio and keeps `preset: "all"`.
- **The contract is the ceiling for the admin's switches** ([mcp-write-tools-2026-09-24](HISTORY.md#mcp-write-tools-2026-09-24)):
  layer 2 (`app_settings` `modules.admin_off`) can only switch a contracted
  module off and back on — `setModuleSwitch` refuses turning on anything the
  file/env leave out (that would hand out an unbought tier), and a stored list
  naming such a module is ignored at load. Every reader asks per call
  (`isDisabledRoute`, `disabledAdminViews()`, `publicNav()`, the sitemap), so
  a switch applies at once in-process; layer 2 loads at boot after the
  migrations, so another instance of a scaled-out deployment follows at its
  next boot.
- **Engine-only pins are gated on `engine.json.role`** ([identity-seam-2](HISTORY.md#identity-seam-2-2026-09-23)):
  a test that states a fact about THIS repo (the committed `client.json`
  equals the schema defaults, `features/local.json` is empty, the product
  overlays are empty) runs only when `role === 'engine'`; a pin about the
  ENGINE (the schema defaults, the email/meta text with those defaults)
  compares `defaults()` or a temp `client.json`, never the resolved instance.
  Another product's feature folder is foreign wherever it is, and an os
  feature claims `product-migrations/os.js`, never the folder. A Features
  row in this file may link a foreign feature (the engine's own domain-3 row
  links `features/os/company-content.md`, foreign in every downstream):
  `architectureIndex.test.js` tolerates such a link — it must resolve to a
  file — but never requires it ([identity-seam-3](HISTORY.md#identity-seam-3-2026-09-23)).
- `identity.surface.nav` is a list of `{ route, labelKey }` records (schema
  type `object[]`, JSON in the env layer); `defaults()` hands out fresh
  records; the client merge takes a record list whole or not at all.
  `identity.routes` and `identity.theme.swatches` are MAPS (schema type
  `object`, JSON in the env layer, `$comment` keys dropped at any level,
  `defaults()` hands out a fresh map; `identity-seam-3`): the server
  validates every record (`validateRouteMeta`, `validateThemeSwatches`) and
  the client merge (`resolveIdentity`) copies records with scalar fields only,
  a non-object map falling back to `{}`. `server/config/identity.js`
  `productRoutes()` / `utils/identity.js` `routeMeta()` normalise an entry
  identically (`identityConfig.test.js` holds them equal).
- **The sync tool regenerates the derived files** ([identity-seam-3](HISTORY.md#identity-seam-3-2026-09-23)):
  `.engine-paths`, `.gitattributes` and `features/README.md` are written by
  `scripts/features-index.js` and differ per repo, so
  `site-factory/engine-sync.js` resolves a conflict on exactly those by running the
  generator in the downstream and staging the result — never `--theirs`, which
  would take the engine's product paths (`docs/ENGINE-SYNC.md` §6).
- **The theme set validates `default ∈ picker` only** (identity-seam-2): the
  root may sit outside the picker (a two-theme product keeps `:root` as an
  unlisted base); `identity.theme.dark` names the ids that paint a dark page
  and `themePrefs.js` `DARK_THEMES` reads it; `identity.theme.swatches`
  (`{ id: { bg, fg } }`) feeds `swatchFor` over the engine map (an id neither
  knows gets the neutral token swatch; identity-seam-3). `theme-boot.js` keeps
  reading the `<html>` attributes only. A feature whose registry `flag` resolves to `false` in the
  client config is gated `disabled` by `tests/lib/featureGate.js`.
  `/robots.txt` is served by `robotsRoutes.js` with the Disallow lines from
  `hiddenRoutes` per locale; `public/robots.txt` is the engine default.
- Jest: 4 workers, one database each (`orangesmiley_w<N>_test`, worker id
  BEFORE `_test`), one migrated template cloned per worker; never add an
  `afterAll pool.end()` ([harvest-2](HISTORY.md#harvest-2)). e2e uses an
  isolated per-branch DB ([harvest-1](HISTORY.md#harvest-1)); Playwright workers
  match the runner's CPUs (LESSONS 2026-09-13).
- Node major pinned in THREE places (Dockerfile digest, ci.yml, promote.yml);
  Express 5 catch-alls keep the braces ([base-sync](HISTORY.md#base-sync)).
- Migration runner is transactional and locked; `UPLOAD_ROOT` boot guard; PG
  TLS default-on (`DB_SSL`); CSP `frameAncestors`; the TEST chrome is a one-way
  clamp [base-sync](HISTORY.md#base-sync). The books pair 095/096 is independent of 097, so
  the array order is safe on a fresh database and on one that already has 097.
- CI: weekly cron + Jest transform cache; dependabot `rebase-strategy:
  disabled` + docker ecosystem; ice's `main-gate` job was deliberately NOT
  ported (this repo merges locally; deploy is dispatch-only) [harvest-2](HISTORY.md#harvest-2).
- **An open tab never runs two releases** ([harvest-ice-e](HISTORY.md#harvest-ice-e-2026-09-24)): the shell names its
  release (`<meta name="app-build">`); `buildGuard` compares every
  same-origin response's `X-App-Build`, probes `/health` before a navigation
  after a quiet minute, and reloads instead of switching views (refocus:
  reload unless something was typed — then `UpdateBanner`; a reload for the
  same build within a minute is not repeated, `stale_release` event). On a
  stamped build `ssrMeta` points the shell at `/js/_<tag>/` + `/css/_<tag>/`
  (imports are relative, so the graph follows); those URLs are immutable for
  a year and 404 under a foreign tag, which is what turns a deploy into a
  reload. `theme-boot.js` stays unstamped and reloads once when a stamped
  file 404s at boot. No absolute `/js/` or `/css/` URL in client code
  (`noAbsoluteJsUrls.test.js`; use `jsUrl()` or a relative import). Same
  origin, so CSP is unchanged. `dev`/`unknown` builds are never stamped and
  never trigger a reload. This supersedes rekstrarkerfid's `1b7aeff`.
- **The check "Lint + Integration tests" is an aggregator** ([harvest-ice-f](HISTORY.md#harvest-ice-f-2026-09-24)):
  `lint` + three `test-shard` jobs (`--shard=N/3`, coverage threshold off
  per shard) feed a job of that name that runs `if: always()`, is red unless
  every upstream result is `success`, and enforces `jest.config.js`'s global
  floor on the merged map (`scripts/merge-coverage.js`, fails closed on a
  missing shard). Never give a shard that name. Push runs everything; a
  docs-only PR skips ci.yml and `ci-skipped.yml` answers the three names —
  and runs the unit tier, because the engine's docs are tested content.
  The docs list must equal ci.yml's `pull_request.paths-ignore` and the
  detector's `case` (`ciSkippedShim.test.js`).
- Every workflow under `.github/workflows` must parse as YAML with a name, a trigger and jobs whose steps each run or use something (`workflowsParse.test.js`). GitHub only reports a broken workflow when it is triggered — for the dispatch-only `deploy.yml`, at the moment of shipping. Never edit a file with `String.prototype.replace` and a STRING replacement: `$'`, `$&`, `$`` and `$1` in shell text are replacement patterns (the 2026-09-24 `deploy.yml` splice). Pass a function, or splice by index.
- **A new `ADD CONSTRAINT` is re-runnable** ([harvest-ice-f](HISTORY.md#harvest-ice-f-2026-09-24)): inside a
  `pg_constraint`/`information_schema` existence check, or after a `DROP
  CONSTRAINT IF EXISTS` of the same name — `migrationIdempotent.test.js` reads
  both arrays; the two bare applied ones (070, 074) are grandfathered and the
  list may only shrink. `[migrate] Applied` logs `ms` per migration.
- `deploy.yml` is dispatch-only; its targets are `production`-environment vars
  and it pins the web app to an image DIGEST, never a tag, after Trivy on that
  digest and before a `/ready` check that only believes a process younger than
  the swap. There is no TEST stack, so dispatch only a sha with green CI; no
  deploy without Halli ([go-live](HISTORY.md#go-live)).
- `normalizeForwardedFor` runs right after `trust proxy` and before every
  limiter: App Service forwards `ip:port`, and without it every IP-keyed rate
  limit keys per TCP connection ([go-live](HISTORY.md#go-live)).
- The canonical origin is `APP_URL` (fallback `https://www.orangesmiley.is`).
  `public/index.html` is baked with that origin and `ssrMeta.js` swaps it for
  `APP_URL` on load — change the two together ([go-live](HISTORY.md#go-live)).
- **The identity seam** ([identity-seam](HISTORY.md#identity-seam-2026-09-22)):
  `identity.*` in `config/client.json` (schema + this product's defaults in
  `server/config/clientConfig.js`: brand, locale, theme, hero, surface,
  organization) is the ONE place a product says who it is. A schema leaf has
  both `type` and `default`; the theme trio is validated together. The engine
  ships Orange Smiley's values as the defaults so an engine with no block
  behaves as before, and `identityConfig.test.js` pins them ONCE — engine code
  and engine tests read `clientConfig.identity` / `utils/identity.js` /
  `e2e/lib/identity.js`, never a brand literal. `identityDownstream.test.js`
  proves a foreign identity flows through the served page.
- **The feature gate** (`tests/lib/featureGate.js`, `e2e/lib/featureGate.js`;
  `docs/TESTING.md`): a suite maps to its feature through the registry's
  `paths`; a feature `hidden`/`disabled`/`forked` in `features/local.json`, or
  another product's, skips with the note. Every engine e2e spec calls
  `gateSpec(test, __filename)`; jest suites a product may not run shadow
  `describe` with `describeForSpec(__filename)`. In the engine `features/local.json` is
  empty and nothing skips (`featureGate.test.js`); an engine spec is never
  deleted in a downstream ([identity-seam](HISTORY.md#identity-seam-2026-09-22)).
- **Upstream cross-cutting improvements.** site-factory's `DEFAULT_BASE` is
  `hallismiley`, so work landing only in an instance reaches no future scaffold
  (LedgerLink was scaffolded without the admin affordances this repo had for
  months). A shared kit, a security fix or an engine change goes to the base as
  a PR on Halli's say-so; note the base auto-deploys on green `main`
  ([ui-kit](HISTORY.md#ui-kit)).
- `hallismiley` and `icelandicstore` are read-only. The ice checkout is 141
  commits stale (parked on `fix/pos-vat-rate` with 207 dirty entries of real
  local-only work) — never check that tree out; read it with
  `git show origin/main:<path>` at `b3bb35d`. The base auto-deploys to Azure on
  green CI on `main`, unlike here, and has zero e2e coverage of checkout, so a
  base PR touching it is verified by hand first [ui-kit](HISTORY.md#ui-kit).

**History**: [build-status](HISTORY.md#build-status) · [base-sync](HISTORY.md#base-sync) · [harvest-1](HISTORY.md#harvest-1) · [harvest-2](HISTORY.md#harvest-2) · [go-live](HISTORY.md#go-live) · [module-flags-2026-09-24](HISTORY.md#module-flags-2026-09-24) · [harvest-ice-f](HISTORY.md#harvest-ice-f-2026-09-24) · [harvest-ice-e](HISTORY.md#harvest-ice-e-2026-09-24) · [harvest2-lane0](history.d/2026-09-26-harvest2-lane0-history.md#harvest2-lane0-2026-09-26)

## 21. Seller area — the published copy on the public instance

| | |
|---|---|
| Routes | `server/routes/sellerPublishRoutes.js` → `/api/v1/seller-publish` (signed ingest; public role + secret, else 404) · `server/routes/sellerRoutes.js` → `/api/v1/seller` (GET only; public role, published seller, 2FA under `security.mfa.enrolment = required`) |
| Services | `server/services/sellerPublish/snapshot.js` (ops: build), `signature.js` (HMAC), `ingest.js` (public: `shape` + `apply`) |
| Auth / config | `server/auth/publishedSeller.js`; `server/config/instanceRole.js` (`INSTANCE_ROLE` = `ops` default / `public`) |
| Views | `public/js/views/SellerAreaView.js` (`/solusvaedi`) |
| Client | `public/js/services/seller.js`; `isSeller()` in `public/js/services/auth.js`; the menu item in `public/js/components/NavBar.js` |
| Scripts | `server/scripts/publish-sellers.js` (`npm run publish:sellers`, ops only) |
| CSS | `public/css/seller-area.css` |
| Jest | `tests/integration/sellerArea.test.js` |
| Migrations | 105 |
| Features | [seller-publication](../features/seller-publication.md) |
| Feature doc | `docs/SALES-STAFF.md` (The seller area); decision D-020 in `company/DECISIONS.md` |

**Rules that must hold**
- One way only: ops READS its tables and SENDS; the public instance has no
  route that reaches back, and the seller API is GET-only over the
  `published_*` tables, which only the ingest writes ([seller-area](HISTORY.md#seller-area)).
- `INSTANCE_ROLE` defaults to `ops` and an unknown value falls back to `ops`,
  so both routes are closed unless a box is explicitly `public`; the ingest
  also needs `SELLER_PUBLISH_SECRET` (≥ 32 chars).
- Ingest = HMAC over the RAW bytes (mounted before the JSON body parser, like the
  Stripe webhook; no CSRF, no sanitizeBody — documented exemption), 5-minute
  timestamp window, every signature failure the same 401; then `shape()`
  whitelists and bounds every field; then `apply()` refuses a snapshot that is
  not newer than the last or reuses a `snapshot_id` (409), and replaces the
  whole copy in one transaction — so an erasure on ops propagates at the next
  publish ([seller-area](HISTORY.md#seller-area)).
- Ops decides who is a seller: an enabled, non-admin user whose role set
  grants `leads`, `accounts` or `commission`. The views decide what is
  published: `leads` → every lead (Halli, 2026-09-21), `accounts` → own
  accounts, `commission` → own issued statements. Never published: rate
  fields, payee kennitala, Azure/repo internals. No seller holds `leads` → no
  lead PII leaves ops.
- On the public box a seller is matched by lower-cased email, only when the
  email is proven (`email_verified` or an admin invite, `invited_at`) and the
  account is enabled; a non-seller gets 404, a foreign statement 404, an
  ungranted section 403.
- Published sellers are 2FA-protected: `seller_holder` joins
  `mfaService.protectedRole`, enrolment is allowed, and an enrolled seller is
  challenged at sign-in. Client mirror: `isMfaProtected()` includes
  `isSeller()`.
- Rule 4 follows `security.mfa.enrolment`: every seller route except `/me`
  needs `totp_enabled` only under `required` (`mfaPolicy.enrolmentRequired()`,
  per request); under the `optional` default a seller reads with a password,
  `/me` says `mfa_ready: true` ("the rest of the area answers"), and
  `SellerAreaView` shows the dismissible two-step reminder above the header
  ([mfa-reminder-2026-09-23](HISTORY.md#mfa-reminder-2026-09-23)).
- Statement status is ONE function (`commissionStatements.statementStatus`)
  for the admin list and the snapshot.

**History**: [seller-area](HISTORY.md#seller-area) · [mfa-reminder-2026-09-23](HISTORY.md#mfa-reminder-2026-09-23)

---

## Ownership notes

- `server/services/pdfService.js` is the generic PDF layer shared by books
  (`bookkeepingPdf.js`) and commission statements; listed under domain 9.
- `server/models/Customer.js` is the shop-derived customer (domain 11's
  orders); `CustomerAccount.js` is the B2B customer of record (domain 8).
  Domain 8 owns the customers screen.
- Migration 043 (`strip_stale_railway_references`) is a housekeeping data
  migration across several content tables.
- **`public/js/views/AboutView.js` is dead code**: not imported by
  `public/js/router.js`; `/about` is served by `public/js/views/HalliView.js`. Listed here so
  the coverage test passes; its removal is a module-disposition decision for
  Halli (ENHANCEMENTS), not a drive-by delete.
- `public/js/utils/features.js` is the client feature-flag shim paired with
  `server/config/clientConfig.js`.
