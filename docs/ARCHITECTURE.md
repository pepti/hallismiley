# Architecture — where things are, per domain

The map a feature request starts from. Each domain below lists its files, the
**rules that must hold** (each linking to the `docs/HISTORY.md` entry that
explains why), and its history entries. `tests/unit/architectureIndex.test.js`
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
docs/                     API, ARCHITECTURE (this), HISTORY, BOOKKEEPING-SYSTEM, SELF-UPDATE, mcp, SALES-STAFF, TESTING, DEPLOYMENT, SLO…
company/                  gitignored: plans, decisions, logs, market-research staging
.claude/                  gitignored: agents, commands, rules (stack-invariants.md), hooks, worktrees
```

## Global facts

- **Mounts** are all in `server/app.js`. Every `/api/v1/admin/<x>` router mounts
  before the generic `/api/v1/admin` catch-all except `mcp-tokens` and `events`,
  which mount after it — `docs/API.md` (Router inventory) documents the hazard
  and lists every mount with its gate.
- **Migrations**: the array in `server/config/schema.js` is the only source of
  truth (chain ends `104_sales_guides_services_page`; 006 and 007 never
  existed; the books pair 095/096 sits before 097 in numeric order). The
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

---

## 1. Auth, users, RBAC, 2FA

| | |
|---|---|
| Routes | `server/routes/authRoutes.js` → `/auth` · `server/routes/userRoutes.js` → `/api/v1/users` · `server/routes/adminRoutes.js` → `/api/v1/admin` (users list/role/disable/approve/decline/delete, `email-health`) · `server/routes/adminRolesRoutes.js` → `/api/v1/admin/roles` |
| Controllers | `server/controllers/authController.js`, `googleAuthController.js`, `facebookAuthController.js`, `userController.js`, `adminController.js`, `adminRolesController.js` |
| Models | `server/models/Role.js`, `server/models/UserRole.js` (users are written by the controllers directly) |
| Services | `server/services/mfaService.js`, `server/services/tokenCleanup.js` |
| Auth layer | `server/auth/lucia.js`, `middleware.js`, `roles.js`, `tokens.js`, `adminViews.js`, `requireView.js`, `google.js`, `facebook.js`, `oauthHelpers.js`; `server/utils/adminRole.js`, `server/utils/totp.js` |
| Middleware | `server/middleware/softAuth.js`, `server/middleware/csrf.js` |
| Views | `public/js/views/SignupView.js`, `ProfileView.js`, `ForgotPasswordView.js`, `ResetPasswordView.js`, `VerifyEmailView.js`, `AdminUsersView.js`, `AdminRolesView.js` |
| Components | `public/js/components/LoginModal.js`, `totpFailure.js` |
| Client | `public/js/services/auth.js`, `sessionGuard.js`, `adminRoles.js`; `public/js/utils/passwordToggle.js`, `safeReturnTo.js`, `avatar.js` |
| CSS | `public/css/user-system.css`, `admin-roles.css` |
| Jest | `tests/integration/auth.test.js`, `auth.google.test.js`, `auth.facebook.test.js`, `auth.socialKillSwitch.test.js`, `users.test.js`, `adminRoles.test.js`, `adminTotp.test.js`, `security.test.js`; `tests/unit/totp.test.js`, `totpFailure.client.test.js`, `mfaProtected.test.js`, `mfaProtectedClient.test.js`, `oauthHelpers.test.js`, `csrf.test.js`, `safeReturnTo.client.test.js`, `rateLimit.test.js`, `rateLimitDecide.test.js`, `rateLimitGuard.client.test.js` |
| e2e | `e2e/auth.spec.js`, `signup-flow.spec.js`, `profile.spec.js` |
| Migrations | 002, 003, 009, 012, 020, 021, 041, 056, 060, 061, 065, 082 (admin TOTP), 083/084 (per-account theme) |
| Feature doc | `docs/API.md` (Authentication) |

**Rules that must hold**
- Lucia v3 owns sessions; there is no JWT layer (invariant 3).
- The 2FA gate is mirrored: server `mfaService.protectedRole` (admin or
  `accounts` holder) and client `auth.isMfaProtected()` must widen together;
  `tests/unit/mfaProtectedClient.test.js` pins them, and enrolment eligibility
  asks the same predicate the gate does ([ui-kit](HISTORY.md#ui-kit), [review-099](HISTORY.md#review-099)).
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

**History**: [base-sync](HISTORY.md#base-sync) · [review-099](HISTORY.md#review-099) · [ui-kit](HISTORY.md#ui-kit)

## 2. Admin shell — sidebar, dashboard, surface hiding, UI kit

| | |
|---|---|
| Routes | `server/routes/adminNavRoutes.js` → `/api/v1/admin/nav-config` |
| Models | `server/models/AdminNavConfig.js` |
| Views | `public/js/views/AdminView.js` (the company overview at `/admin`), `AdminProjectsView.js` (unlisted `/admin/projects` board) |
| Components | `public/js/components/AdminSidebar.js` (`ADMIN_NAV`), `adminNavLayout.js`, `adminSurface.js` (`HIDDEN_ADMIN_VIEWS`), `adminTable.js`, `adminPager.js`, `FilterBar.js`, `Toast.js`, `ToastLog.js`, `Lightbox.js`, `ChangesList.js` |
| Client | `public/js/services/adminNav.js`, `toastLog.js`, `buildInfo.js`; `public/js/utils/listState.js`, `localPref.js`, `debounce.js`, `format.js`, `pageTitle.js`, `downloadCsv.js`, `csv.js`, `escHtml.js`, `api.js` |
| CSS | `public/css/admin-shell.css`, `admin-dashboard.css`, `admin-kit.css`, `layout.css`, `components.css`, `variables.css`, `reset.css` |
| Jest | `tests/integration/adminNavConfig.test.js`, `admin.test.js`; `tests/unit/admin-surface-parity.test.js`, `admin-views-parity.test.js`, `adminTableKit.test.js`, `kitFormatters.test.js`, `pageTitle.test.js`, `debounce.test.js`, `csvClientParity.test.js` |
| e2e | `e2e/admin.spec.js`, `admin-surface.spec.js`, `admin-list-kit.spec.js`, `admin-sidebar-scroll.spec.js`, `admin-nav-colors.spec.js` |
| Migrations | 053 (nav config) |
| Feature doc | — (this section) |

**Rules that must hold**
- `HIDDEN_ADMIN_VIEWS` applies only to accounts holding `'*'`; a role granted
  `orders` alone still sees it. Routes stay live and ids stay grantable. The
  eye toggle writes `revealedItems` into the layout blob; Reset re-hides; an
  all-hidden group renders no header ([admin-reshape](HISTORY.md#admin-reshape)).
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

**History**: [r1](HISTORY.md#r1) · [admin-reshape](HISTORY.md#admin-reshape) · [ui-kit](HISTORY.md#ui-kit)

## 3. Public site — home, /thjonusta, /um-okkur, /hafa-samband, SSR meta, sitemap, SEO

| | |
|---|---|
| Routes | `server/routes/contactRoutes.js` → `/api/v1/contact` · `server/routes/sitemapRoutes.js` (robots, sitemap) |
| Controllers | `server/controllers/contactController.js` |
| Services | `server/services/indexNow.js`, `server/services/outboundAllowlist.js` |
| Config / middleware | `server/config/publicSurface.js`, `clientConfig.js`, `appEnv.js`, `version.js`, `paths.js`; `server/middleware/ssrMeta.js` (`ROUTE_META`, `DEFAULT_META`, `SERVICE_OFFERINGS`, JSON-LD) |
| Views | `public/js/views/HomeView.js`, `ThjonustaView.js`, `UmOkkurView.js`, `ContactView.js`, `PrivacyView.js`, `TermsView.js`, `NotFoundView.js`; `HalliView.js` serves the hidden `/about`/`/halli` (`AboutView.js` is dead — see Ownership notes) |
| Components | `public/js/components/NavBar.js` |
| Client | `public/js/router.js`, `navigate.js`, `main.js`; `public/js/utils/reveal.js`, `motion.js`, `productSite.js`, `sanitizeHtml.js`, `slug.js`, `features.js` |
| CSS | `public/css/home.css`, `business-pages.css`, `contact.css`, `video-section.css`, `fonts.css` |
| Jest | `tests/integration/contact.test.js`, `sitemap.test.js`, `ssrMeta.test.js`; `tests/unit/clientConfig.test.js`, `appEnv.test.js`, `slug.test.js`, `slug.client.test.js`, `outboundAllowlist.test.js`, `version.test.js`, `buildManifest.test.js` |
| e2e | `e2e/business-routes.spec.js`, `contact.spec.js`, `navigation.spec.js`, `responsive.spec.js`, `responsive-screenshots.spec.js`, `editable-homepage.spec.js` |
| Migrations | 005, 017, 091, 092 (seeded company copy) |
| Feature doc | `docs/API.md` (Contact); `docs/SALES-STAFF.md` for what a submission becomes |

**Rules that must hold**
- Public IA is `/`, `/thjonusta`, `/um-okkur`, `/hafa-samband`, `/personuvernd`;
  everything else is in `publicSurface.js` — hidden, still served.
- **No product tiers or prices on the company site**; they live on
  rekstrarkerfi.is only. `SERVICE_OFFERINGS` in `ssrMeta.js` mirrors the locale
  service names — change them together; no `price` in structured data;
  `public/js/utils/productSite.js` is the one place that builds the product-site
  URL ([services-page](HISTORY.md#services-page)).
- Homepage = the hallismiley composition: dark video hero, light site below;
  the media-hero surfaces are fixed dark on EVERY theme (`home.css`), which is
  how invariant 15 is met. A new hero clip gets a NEW filename (the `public/`
  mount caches 1 h); re-derive from the ORIGINAL, never from v2; under reduced
  motion / Save-Data the hero renders without `autoplay`, with `preload="none"`,
  showing `hero-dc7df-v2-poster.jpg` (v2's first frame — regenerate it with a
  new clip), and `_initHeroVideo` follows a live OS-setting change both ways;
  `/halli` keeps the waterfall on purpose; `e2e/navigation.spec.js` pins the
  filename [homepage](HISTORY.md#homepage).
- `pageTitle.js` mirrors `ssrMeta.js`; the parity test parses the server file
  and guards that its own parser still matches, so a refactor cannot make it
  assert nothing. Business-route titles suffix "— Orange Smiley"; `og:site_name`,
  the static head and the PWA name carry the company; the nav lockup is ORANGE
  SMILEY + `nav.brandTagline`. Hidden portfolio routes (`/verkefni`,
  `/projects`) keep "Halli Smiley" in SSR on purpose [ui-kit](HISTORY.md#ui-kit), [r1](HISTORY.md#r1).
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
- `.ice-scene--band` is `min-height`, never `height` ([services-page](HISTORY.md#services-page)).
- Canonical host derives from `APP_URL` (still hallismiley.is until the domain
  cutover — intentional, tracked in `PLAN.md`).

**History**: [homepage](HISTORY.md#homepage) · [r1](HISTORY.md#r1) · [services-page](HISTORY.md#services-page) · [ui-kit](HISTORY.md#ui-kit)

## 4. Themes, scenes, ambience

| | |
|---|---|
| Routes | `server/routes/ambienceRoutes.js` → `/api/v1/ambience` |
| Controllers | `server/controllers/ambienceController.js` |
| Services | `server/services/icelandAmbience.js` |
| Config | `server/config/themes.js`, `server/config/sceneManifest.json` |
| Components | `public/js/components/ThemeSwitcher.js` |
| Scenes | `public/js/scenes/SceneStage.js`, `AmbienceEngine.js`, `sceneDefs.js`, `sceneHeader.js`, `manifest.js`, `aurora.js`, `particles.js`, `sun.js`, `sound.js` |
| Client | `public/js/theme-boot.js`, `public/js/services/themePrefs.js`, `ambiencePrefs.js`; `public/js/utils/chartTheme.js`, `motion.js` |
| CSS | `public/css/themes.css`, `theme-switcher.css`, `iceland-scene.css`, `test-env.css` |
| Scripts | `scripts/build-iceland-scenes.js`, `scripts/audit-text-contrast.js`, `scripts/self-host-fonts.js`, `scripts/recompress-images.js` |
| Jest | `tests/integration/ambience.test.js`; `tests/unit/themePrefsAccount.client.test.js`, `themePrefsEnv.client.test.js` |
| e2e | `e2e/iceland-scene.spec.js` |
| Migrations | 083, 084 (user theme), 086, 089 (landing background scene/video), 094 (three-theme set) |
| Feature doc | `CLAUDE.md` Design rules; `public/assets/iceland/CREDITS.md` |

**Rules that must hold**
- Three themes: `ember`/Glóð (default, `DEFAULT_THEME` in `themePrefs.js` AND
  `theme-boot.js` — keep in sync), `classic`/Bjart (owns `:root`),
  `midnight`/Miðnætti. `light`/`mono` are retired ids (094). Every new UI must
  survive a theme switch (invariant 15); canvases read `chartTheme.js` at draw time.
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
  admin. No place chip: the images are not real places. `ssrMeta.js`
  `ROUTE_SCENE_IMAGES` follows every reassignment ([iceland-v2](HISTORY.md#iceland-v2)).
- `/api/v1/ambience` proxies Open-Meteo with a 10-minute server cache and
  ALWAYS answers 200 (`{available:false}` on failure, static scenes); sun
  position is client-side; weather particles + WebGL aurora run on dark themes
  at real night with a CSS fallback; sound is OFF by default; toggles are the
  ThemeSwitcher keys `ws_ambience` / `ws_ambience_sound`; everything obeys
  `utils/motion.js` and pauses off-screen [scene-engine](HISTORY.md#scene-engine).
- The three themes grade the same photos via `--scene-*` tokens (Miðnætti is
  the hardest cut, for contrast) [scene-engine](HISTORY.md#scene-engine).
- `landing_background` mode `video` is the hero default (089 reverted 086).

**History**: [scene-engine](HISTORY.md#scene-engine) · [base-sync](HISTORY.md#base-sync) (6C theme) · [iceland-v2](HISTORY.md#iceland-v2)

## 5. i18n

| | |
|---|---|
| Server | `server/config/i18n.js`, `server/i18n/index.js`, `server/i18n/en.json`, `server/i18n/is.json`; `server/middleware/locale.js` |
| Services | `server/services/translator.js`, `autoTranslateFields.js`, `siteContentTranslate.js` |
| Client | `public/js/i18n/i18n.js`, `public/js/i18n/en.json`, `public/js/i18n/is.json` |
| Scripts | `scripts/check-i18n-keys.js` (`npm run check:i18n`), `scripts/backfill-is-translations.js`, `scripts/retranslate-party-en.js` |
| Jest | `tests/integration/i18n.test.js`, `content.translate.test.js`, `news.translate.test.js`, `party.translate.test.js`; `tests/unit/translator.test.js`, `autoTranslateFields.test.js`, `localeLock.test.js`, `localeLockClient.test.js` |
| Migrations | 028–038 (eleven consecutive i18n migrations) |
| Feature doc | — |

**Rules that must hold**
- IS is the visitor default (`PUBLIC_DEFAULT_LOCALE`); `DEFAULT_LOCALE='en'`
  stays the content/storage dimension (the party module depends on it); the
  switcher choice lives in the `locale_choice` cookie.
- `check:i18n` also scans every `t('literal')`/`labelKey` in `public/js`
  against `public/js/i18n/en.json` — a missing key fails CI ([harvest-2](HISTORY.md#harvest-2)).
- `loadLocale()` dispatches `localechange` for components mounted outside
  `#app` ([harvest-2](HISTORY.md#harvest-2)).
- Two column conventions coexist: news bodies are `_is` siblings, sales guides
  are IS-canonical with `_en` siblings ([sales-staff](HISTORY.md#sales-staff)).

**History**: [harvest-2](HISTORY.md#harvest-2)

## 6. Leads — Fyrirspurnir

| | |
|---|---|
| Routes | `server/routes/leadsRoutes.js` → `/api/v1/admin/leads` (`requireView('leads')`; DELETE + `/export.csv` admin) |
| Controllers | `server/controllers/leadsController.js` (`validateLeadUpdate`, `csvCell`) |
| Models | `server/models/Lead.js` |
| Services | `server/services/leadsCleanup.js` (`LEAD_RETENTION_DAYS`, default 730) |
| Views | `public/js/views/AdminLeadsView.js` |
| Client | `public/js/services/leads.js` |
| CSS | `public/css/admin-leads.css` |
| Jest | `tests/integration/leads.test.js`; `tests/unit/leadsRetention.test.js`, `leadRateLimit.test.js` |
| e2e | `e2e/leads.spec.js`, `e2e/sales-handbook.spec.js` (sidebar count) |
| Migrations | 097 |
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

**History**: [leads](HISTORY.md#leads) · [review-099](HISTORY.md#review-099)

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
| Client | `public/js/services/adminBookkeeping.js`; `public/js/utils/money.js` |
| Scripts | `server/scripts/books-replay.js`, `books-archive-export.js`, `books-backfill-orders.js`, `books-fetch-fx.js`, `seed-books-demo.js` |
| CSS | `public/css/admin-bookkeeping.css` |
| Jest | `tests/integration/adminBookkeeping.test.js`, `booksInvoice.test.js`, `booksExpenses.test.js`, `booksLedger.test.js`, `booksVatReturn.test.js`, `booksPeppolUbl.test.js`, `booksIntake.test.js`, `booksPos.test.js`, `booksPayroll.test.js`, `booksReconciliation.test.js`, `booksReports.test.js`, `booksReplay.test.js`, `booksBackfill.test.js`, `booksDeferredRevenue.test.js`; `tests/unit/booksVat.test.js`, `booksVatPeriod.test.js`, `booksCsv.test.js`, `booksDate.test.js`, `booksFx.test.js`, `booksPdf.test.js`, `booksPayroll.test.js`, `booksReplay.test.js`, `booksIntakeShape.test.js`, `booksControllerParse.test.js`, `ublInvoice.test.js`, `money.client.test.js` |
| Migrations | 072–079, 095, 096, 099, 101, 103 |
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

**History**: [accounts-commission](HISTORY.md#accounts-commission) · [review-099](HISTORY.md#review-099) · [migrations-100-102](HISTORY.md#migrations-100-102) · `PLAN.md` Status (own books programme)

## 10. Sales handbook — Handbók sölufólks

| | |
|---|---|
| Routes | `server/routes/salesGuidesRoutes.js` → `/api/v1/admin/handbok` (`handbok` view; edit admin/moderator; delete admin) |
| Controllers | `server/controllers/salesGuidesController.js` |
| Views | `public/js/views/AdminHandbookView.js` |
| Client | `public/js/services/salesGuides.js` |
| Scripts | `server/scripts/seed-sales-guides.js` |
| CSS | `public/css/admin-handbok.css` |
| Jest | `tests/integration/salesGuides.test.js`, `salesGuidesServicesPage.test.js` |
| e2e | `e2e/sales-handbook.spec.js` (+ `e2e/lib/salesUser.js`) |
| Migrations | 090, 104 |
| Feature doc | `docs/SALES-STAFF.md` |

**Rules that must hold**
- IS-canonical columns with `_en` siblings (the inverse of news); `body_is`/
  `body_en` are RICH_TEXT_FIELDS; every response `no-store`; nothing public
  ([sales-staff](HISTORY.md#sales-staff)).
- Seeded guides are DRAFTS; sales staff see nothing until Halli publishes;
  prices inside carry DRÖG. Migration 104 rewrote two seeded guides guarded on
  `updated_by IS NULL` ([services-page](HISTORY.md#services-page)).
- Onboarding a hire is no code: `/admin/customers` → `solufolk` in `/admin/roles`.

**History**: [sales-staff](HISTORY.md#sales-staff) · [services-page](HISTORY.md#services-page)

## 11. Shop — cart, checkout, orders, products, collections, bins, discounts (hidden surface)

| | |
|---|---|
| Routes | `server/routes/shopRoutes.js` → `/api/v1/shop` · `adminShopRoutes.js` → `/api/v1/admin/shop` · `adminDiscountRoutes.js` → `/api/v1/admin/discounts` · `adminBinsRoutes.js` → `/api/v1/admin/bins` |
| Controllers | `server/controllers/shopController.js`, `adminShopController.js`, `adminDiscountController.js`, `adminBinsController.js` |
| Models | `server/models/Product.js`, `ProductVariant.js`, `Collection.js`, `Order.js`, `Discount.js`, `Bin.js` |
| Services | `server/services/stripeService.js`, `discountEngine.js`; `server/config/stripe.js`, `shipping.js`; `server/utils/qr.js` |
| Views | `public/js/views/ShopView.js`, `ProductView.js`, `CartView.js`, `CheckoutView.js`, `CheckoutSuccessView.js`, `CheckoutCancelView.js`, `OrderHistoryView.js`, `AdminProductsView.js`, `AdminOrdersView.js`, `AdminOrderDetailView.js`, `AdminCollectionsView.js`, `AdminDiscountsView.js`, `AdminBinsView.js`, `AdminSalesView.js` |
| Components | `public/js/components/ProductCard.js`, `ShopFilters.js`, `CartIcon.js`, `CurrencySelector.js`, `BarcodeScanner.js` |
| Client | `public/js/services/cart.js`, `adminProducts.js`, `adminOrders.js`, `adminCollections.js`, `adminDiscounts.js`, `adminBins.js`; `public/js/utils/productCsv.js` |
| Scripts | `server/scripts/seed-shop.js`, `import-products-csv.js` |
| CSS | `public/css/shop.css`, `admin-products.css`, `admin-orders.css`, `admin-collections.css`, `admin-discounts.css`, `admin-bins.css`, `admin-sales.css`, `barcode-scanner.css` |
| Jest | `tests/integration/shop.test.js`, `discounts.test.js`, `adminOrderBulk.test.js`, `adminProductImportExport.test.js`, `sections.test.js`; `tests/unit/discountEngine.test.js`, `shopFilters.test.js`, `bins-grid.test.js`, `qr.test.js` |
| e2e | `e2e/admin-product-group.spec.js` |
| Migrations | 022–025, 045, 048, 049, 050, 054, 055, 057, 074 |
| Feature doc | — (retail is hidden here; ENHANCEMENTS #22–#26 hold the ice harvest backlog) |

**Rules that must hold**
- Hidden, never deleted: `/shop` in `publicSurface.js`, every admin line in
  `HIDDEN_ADMIN_VIEWS`; routes live, Stripe inert without keys.
- `stock <= 0` is sold out (negative counts as sold out) ([harvest-2](HISTORY.md#harvest-2)).
- Checkout `required` must be re-applied after `syncShipping()`; a sold-out
  cart line currently goes straight to Stripe (ENHANCEMENTS #25) ([ui-kit](HISTORY.md#ui-kit)).
- Product-schema `brand` still names Rekstrarkerfið on every SKU — a known
  post-R1 note, not a rule.

**History**: [harvest-2](HISTORY.md#harvest-2) · [ui-kit](HISTORY.md#ui-kit)

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
| e2e | `e2e/gallery.spec.js`, `project-edit.spec.js` |
| Migrations | 004, 008, 010, 011, 013–016, 018, 019, 026, 027, 039, 040, 042, 044, 058–063, 066–071 |
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
| Views | `public/js/views/AdminMonitoringView.js`, `AdminAnalyticsView.js` |
| Client | `public/js/services/adminEvents.js`, `errorReporter.js`, `usage.js`; `public/js/analytics.js`, `public/js/consent.js`; `public/js/api/rateLimitDecide.js`, `rateLimitGuard.js` |
| CSS | `public/css/admin-monitoring.css`, `analytics-admin.css` |
| Jest | `tests/integration/eventLog.test.js`, `analytics.test.js`, `observability.test.js`, `uploadVolumeAlert.test.js`; `tests/unit/analyticsSalt.test.js`, `httpMetrics.test.js`, `loggerScrub.test.js`, `maintenanceWindow.test.js` |
| e2e | `e2e/admin-monitoring.spec.js` |
| Migrations | 046 (analytics), 087 (event logs) |
| Feature doc | `RUNBOOK.md` (Analytics, Health), `docs/SLO.md` |

**Rules that must hold**
- `query()` feeds the DB circuit breaker (connectivity errors only) and
  `db_query_duration_seconds`; httpMetrics feeds the error-rate alert; the
  client rate-limit toast ignores the error beacon and stays silent before the
  dictionary loads [harvest-2](HISTORY.md#harvest-2).
- Big uploads always complete: detect and alert (`uploadVolumeAlert`), never
  rate-limit (Halli 2026-09-01).
- Logs scrub secrets and the `q` param; `app.js` scrubs request URLs in its
  own lines ([review-099](HISTORY.md#review-099)).
- `checkMemory` runs once a minute from `server.js` (base-sync 2026-09-13).
- The staff audit log is read on `/admin/monitoring` (domain 8 owns the writes).

**History**: [harvest-1](HISTORY.md#harvest-1) · [harvest-2](HISTORY.md#harvest-2)

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
| Jest | `tests/integration/systemUpdatesApi.test.js`, `systemUpdatesRoutes.test.js`, `systemChanges.test.js`, `systemChangesGate.test.js`, `systemVersion.test.js`, `updateApplier.test.js`, `updateChecker.test.js`, `selfUpdateSettings.test.js`, `selfUpdateDisabled.test.js`; `tests/unit/changelogRender.test.js`, `generateChanges.test.js`, `semver.test.js` |
| e2e | `e2e/admin-updates.spec.js` |
| Migrations | 081 |
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

**History**: [self-update](HISTORY.md#self-update) · [harvest-2](HISTORY.md#harvest-2)

## 15. MCP connector

| | |
|---|---|
| Routes | `server/routes/mcpRoutes.js` → `/api/v1/mcp` (`MCP_ENABLED` + bearer) · `mcpAdminRoutes.js` → `/api/v1/admin/mcp-tokens` (admin) |
| Controllers | `server/controllers/mcpAdminController.js` |
| Models | `server/models/McpToken.js` |
| Middleware / core | `server/middleware/mcpAuth.js`; `server/mcp/transport.js`, `registry.js`, `envTag.js`, `server/mcp/tools/system.js` |
| Views | `public/js/views/AdminMcpSettingsView.js` |
| Client | `public/js/services/adminMcp.js` |
| Jest | `tests/integration/mcp.test.js` |
| Migrations | 088 |
| Feature doc | `docs/mcp.md` |

**Rules that must hold**
- Ships dark behind `MCP_ENABLED`; the realm and connector name say
  `orangesmiley`.
- MCP arguments pass through `sanitizeBody` and the global IP limit on purpose
  (moving the mount would exempt it from two global protections — invariant 7);
  the router mounts AFTER the generic admin router (see Global facts).
- No leads tool without a separate sign-off ([leads](HISTORY.md#leads)).

**History**: [harvest-1](HISTORY.md#harvest-1)

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

**History**: [harvest-2](HISTORY.md#harvest-2) · [admin-reshape](HISTORY.md#admin-reshape) · [test-chrome-admin](HISTORY.md#test-chrome-admin)

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
| Services | `server/services/uploadVolumeAlert.js` |
| Config | `server/config/paths.js` |
| Jest | `tests/integration/media.test.js`, `uploadImageBytes.test.js`, `newsMedia.test.js`, `uploadVolumeAlert.test.js`; `tests/unit/uploadPaths.test.js`, `uploadRoot.test.js`, `imageType.test.js`, `verifyImageBytes.test.js`, `sanitize.test.js`, `validate.test.js` |
| Migrations | 004, 016, 051 |
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

**History**: [base-sync](HISTORY.md#base-sync) · [harvest-2](HISTORY.md#harvest-2)

## 19. Email

| | |
|---|---|
| Services | `server/services/emailService.js` (`emailShell`), `outboundAllowlist.js`; templates use `server/i18n/` |
| Routes | `GET /api/v1/admin/email-health` in `server/routes/adminRoutes.js` |
| Jest | `tests/unit/outboundAllowlist.test.js`, `emailReplyTo.test.js`; exercised by `tests/integration/auth.test.js`, `party.test.js`, `contact.test.js` |
| Migrations | 062 |
| Feature doc | `RUNBOOK.md`, `docs/DEPLOYMENT.md` (env) |

**Rules that must hold**
- Sender is `EMAIL_FROM`; never the base's address. Production sends from the
  fleet domain (`orangesmiley@mail.orangesmiley.is`, D-015) with
  `EMAIL_REPLY_TO` pointing at a real mailbox, added to every message that
  sets no replyTo of its own ([go-live](HISTORY.md#go-live)). Mail failures are loud; `EMAIL_ALLOWLIST` limits recipients outside
  prod ([harvest-1](HISTORY.md#harvest-1)).
- The 7 server email strings carry the company brand ([r1](HISTORY.md#r1));
  `emailShell` escapes its `<title>` (base-sync 2026-09-13).

**History**: [harvest-1](HISTORY.md#harvest-1) · [r1](HISTORY.md#r1) · [go-live](HISTORY.md#go-live)

## 20. Infrastructure and cross-cutting

| | |
|---|---|
| App | `server/app.js`, `server/server.js`, `server/config/database.js`, `server/middleware/errorHandler.js` |
| Migrations tooling | `server/config/schema.js`, `server/scripts/migrate.js`, `bootstrap.js`, `setup-admin.js`, `seed.js`, `cleanup-duplicates.js`, `capture-site-screenshots.js` |
| Tests infra | `tests/workerDb.js`, `e2e/global-setup.js`, `e2e/helpers.js`, `e2e/lib/dbUrl.js`; `scripts/drop-test-dbs.js` |
| Jest | `tests/unit/schema-integrity.test.js`, `database.test.js`, `workerDb.test.js`; `tests/integration/migrateRunner.test.js` |
| CI / deploy | `.github/workflows/ci.yml`, `deploy.yml` (dispatch-only, by digest, production only), `promote.yml`; `Dockerfile` |
| Migrations | 001, 043 (housekeeping) |
| Feature doc | `RUNBOOK.md`, `SECURE_SDLC.md`, `docs/TESTING.md`, `docs/DEPLOYMENT.md` |

**Rules that must hold**
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
- `deploy.yml` is dispatch-only; its targets are `production`-environment vars
  and it pins the web app to an image DIGEST, never a tag, after Trivy on that
  digest and before a `/ready` check that only believes a process younger than
  the swap. There is no TEST stack, so dispatch only a sha with green CI; no
  deploy without Halli ([go-live](HISTORY.md#go-live)).
- The canonical origin is `APP_URL` (fallback `https://www.orangesmiley.is`).
  `public/index.html` is baked with that origin and `ssrMeta.js` swaps it for
  `APP_URL` on load — change the two together ([go-live](HISTORY.md#go-live)).
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

**History**: [build-status](HISTORY.md#build-status) · [base-sync](HISTORY.md#base-sync) · [harvest-1](HISTORY.md#harvest-1) · [harvest-2](HISTORY.md#harvest-2) · [go-live](HISTORY.md#go-live)

## 21. Seller area — the published copy on the public instance

| | |
|---|---|
| Routes | `server/routes/sellerPublishRoutes.js` → `/api/v1/seller-publish` (signed ingest; public role + secret, else 404) · `server/routes/sellerRoutes.js` → `/api/v1/seller` (GET only; public role, published seller, 2FA) |
| Services | `server/services/sellerPublish/snapshot.js` (ops: build), `signature.js` (HMAC), `ingest.js` (public: `shape` + `apply`) |
| Auth / config | `server/auth/publishedSeller.js`; `server/config/instanceRole.js` (`INSTANCE_ROLE` = `ops` default / `public`) |
| Views | `public/js/views/SellerAreaView.js` (`/solusvaedi`) |
| Client | `public/js/services/seller.js`; `isSeller()` in `public/js/services/auth.js`; the menu item in `public/js/components/NavBar.js` |
| Scripts | `server/scripts/publish-sellers.js` (`npm run publish:sellers`, ops only) |
| CSS | `public/css/seller-area.css` |
| Jest | `tests/integration/sellerArea.test.js` |
| Migrations | 105 |
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
  `mfaService.protectedRole`, enrolment is allowed, and every seller route
  except `/me` needs `totp_enabled`. Client mirror: `isMfaProtected()`
  includes `isSeller()`.
- Statement status is ONE function (`commissionStatements.statementStatus`)
  for the admin list and the snapshot.

**History**: [seller-area](HISTORY.md#seller-area)

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
