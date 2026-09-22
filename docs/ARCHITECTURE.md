# Architecture — where things are, per domain

The map a feature request starts from. Each domain below lists its files, the
**rules that must hold** (linking the `docs/HISTORY.md` entry that explains
the rule where an incident produced it), and the feature doc if one exists.
`tests/unit/architectureIndex.test.js` keeps this file honest: every path here
must exist, every file in the source directories must be listed here, the
migrations cited must be exactly the ones `schema.js` applies, and every link
must resolve. Global stack rules live in `CLAUDE.md`; this file is the
per-domain layer under them.

This is the HalliProjects **base**: hallismiley.is is the personal portfolio
site, so news, projects, the party page, the bio and the shop are LIVE public
surfaces here. Repos scaffolded by site-factory inherit this file verbatim
(and the test), then hide or add domains in their own copy.

Written 2026-09-22 from the tree at that date. When you add a router, view,
model, service or migration, add it here in the same change — the test fails
otherwise, and its message names the missing row.

## Directory tree

```
server/
  app.js                  Express app: middleware stack, every router mount (~541–575), SPA catch-all (/{*splat})
  server.js               boot: migrations, timers
  logger.js               pino root logger
  routes/                 one router per mount (see the domain tables)
  controllers/            request handlers
  models/                 SQL per table (pg, parameterised); no ORM
  services/               cross-request logic; bookkeeping/ is the books module
  middleware/             csrf, sanitize, validate, upload, ssrMeta, locale, softAuth, requireTestEnv, mcpAuth, forwardedFor, booksLimiters, errorHandler
  auth/                   Lucia session, roles, requireView, adminViews (view ids), tokens, OAuth (google, facebook)
  config/                 schema.js (THE migration list), database, clientConfig, i18n, paths, stripe, shipping, themes, version
  migrations/             NNN_name.sql reference copies of a subset of schema.js entries
  observability/          logger, metrics, httpMetrics, circuitBreaker, alerts, memoryUsage, securityLogger
  scripts/                migrate, bootstrap, setup-admin, seeds, importers, books tooling
  utils/                  small pure helpers (totp, qr, vat, csv, fx, semver, youtube, canonicalHost…)
  i18n/                   server-side EN/IS strings (emails, SSR)
  mcp/                    MCP transport + tool registry
public/
  index.html              the single page; loads css/main.css and js/theme-boot.js
  js/router.js            client routes → views (imports every view eagerly)
  js/views/               one class per screen; admin screens are Admin*View.js; aron13-* is the birthday game
  js/components/          NavBar, AdminSidebar, LoginModal, ThemeSwitcher, admin kit (adminTable/adminPager)
  js/services/            client API wrappers + auth/session/theme state
  js/api/                 projectApi, rateLimitDecide, rateLimitGuard
  js/utils/               pure helpers (money, format, listState, pageTitle, csv…)
  js/i18n/                client EN/IS dictionaries
  js/vendor/              chart.umd.js (analytics + sales), html2canvas.min.js (change-request screenshots)
  css/                    main.css @imports every sheet; themes.css last
  assets/                 baked media: avatars/, projects/, party/, videos/, icons/
  fonts/                  self-hosted webfonts
tests/unit/               node-only Jest (no jsdom); read-the-source parity tests live here
tests/integration/        Jest against real Postgres (maxWorkers 1, one DB — TEST_DATABASE_URL, must end _test)
e2e/                      Playwright specs + lib/dbUrl.js
scripts/                  repo tooling (check-i18n-keys, build-manifest, check-manifest, generate-version…)
docs/                     API, ARCHITECTURE (this), HISTORY, BOOKKEEPING-SYSTEM, ACCOUNTANT-QUESTIONS, DEPLOYMENT, SELF-UPDATE, SHOP_REDESIGN, mcp
```

## Global facts

- **Mounts** are all in `server/app.js`. Every `/api/v1/admin/<x>` router
  mounts before the generic `/api/v1/admin` catch-all, including `mcp-tokens`
  and `events` (a later block, still above it in effect). Two things are not
  routers: the Stripe webhook `POST /api/v1/shop/webhook` (raw body,
  registered before `express.json()`) and `sitemapRoutes`, mounted at `/`
  before `express.static`. `docs/API.md` lists every mount with its gate.
- **Body limits**: global 100 kb; `/api/v1/change-requests` 5 mb;
  `/api/v1/admin/shop/products/import` 4 mb.
- **Rate limits**: global 400 / 15 min; the write limiter (90 / 15 min) covers
  `/api/v1/projects`, `/api/v1/party` (except `POST /photos`),
  `/api/v1/admin/shop`, `/api/v1/admin/bins`, `/api/v1/admin/bookkeeping`.
  GET/HEAD under `/assets|js|css|fonts/` are exempt and the catch-all 404s
  misses under them.
- **Migrations**: the array in `server/config/schema.js` is the only source of
  truth; 006 and 007 never existed. The `.sql` files under `server/migrations/`
  are reference copies of a subset. **Never edit an applied migration** — add a
  new one ([edited-applied-migration](HISTORY.md#edited-applied-migration)).
- **RBAC view ids**: `server/auth/adminViews.js` `ADMIN_VIEW_IDS` must stay
  1:1 with `ADMIN_NAV` in `public/js/components/AdminSidebar.js`
  (`tests/unit/admin-views-parity.test.js`). `GRANTABLE_VIEW_IDS` = all except
  `roles`. Sidebar groups: overview · shop · books · site · settings.
- **Locale**: routes are locale-prefixed (`/en/…`, `/is/…`); root redirects by
  the `locale_choice` cookie → Accept-Language → `en`. Party pages are
  IS-locked (`forcedLocaleFor` in `server/config/i18n.js`); `/api/v1/party/*`
  is deliberately not locked.
- **CSS**: `public/index.html` loads `css/main.css`, which `@import`s every
  other sheet; `admin-kit.css` comes after the per-screen sheets and
  `themes.css` last.
- **Client shape**: views repaint `innerHTML` wholesale; kit modules are pure
  string functions plus one `bind*()` with a single delegated listener on a
  container that outlives the repaint (node-testable, no jsdom).

---

## 1. Auth, users, RBAC, 2FA

| | |
|---|---|
| Routes | `server/routes/authRoutes.js` → `/auth` (public + auth limiters; `requireAuth` on account endpoints) · `server/routes/userRoutes.js` → `/api/v1/users` (`requireAuth`: `/me`, avatar, password, sessions) · `server/routes/adminRoutes.js` → `/api/v1/admin` (`requireAuth`; `GET /users` `requireView('users')`; role/disable/party-access/approve/decline/delete `requireRole('admin')`; `email-health` admin/moderator) · `server/routes/adminRolesRoutes.js` → `/api/v1/admin/roles` (`requireRole('admin')`) |
| Controllers | `server/controllers/authController.js`, `googleAuthController.js`, `facebookAuthController.js`, `userController.js`, `adminController.js`, `adminRolesController.js` |
| Models | `server/models/Role.js`, `server/models/UserRole.js` |
| Services | `server/services/mfaService.js`, `server/services/tokenCleanup.js` |
| Auth layer | `server/auth/lucia.js`, `middleware.js`, `roles.js`, `tokens.js`, `adminViews.js`, `requireView.js`, `google.js`, `facebook.js`, `oauthHelpers.js`; `server/utils/adminRole.js`, `server/utils/totp.js`, `server/utils/qr.js` (TOTP enrolment QR) |
| Middleware | `server/middleware/softAuth.js`, `server/middleware/csrf.js` |
| Views | `public/js/views/SignupView.js`, `ProfileView.js`, `ForgotPasswordView.js`, `ResetPasswordView.js`, `VerifyEmailView.js`, `AdminUsersView.js`, `AdminRolesView.js` |
| Components | `public/js/components/LoginModal.js`, `totpFailure.js` |
| Client | `public/js/services/auth.js`, `sessionGuard.js`, `adminRoles.js`; `public/js/utils/passwordToggle.js`, `safeReturnTo.js`, `avatar.js`, `features.js` (social-login flag); `public/js/api/rateLimitDecide.js`, `rateLimitGuard.js` |
| Assets | `public/assets/avatars/`, `public/assets/icons/` |
| Scripts | `server/scripts/setup-admin.js`, `scripts/gen-fb-icon.js` |
| CSS | `public/css/user-system.css`, `admin-roles.css` |
| Jest | `tests/integration/auth.test.js`, `auth.google.test.js`, `auth.facebook.test.js`, `auth.socialKillSwitch.test.js`, `users.test.js`, `adminRoles.test.js`, `adminTotp.test.js`, `security.test.js`; `tests/unit/totp.test.js`, `totpFailure.client.test.js`, `qr.test.js`, `oauthHelpers.test.js`, `csrf.test.js`, `safeReturnTo.client.test.js`, `rateLimit.test.js`, `rateLimitDecide.test.js` |
| e2e | `e2e/auth.spec.js`, `signup-flow.spec.js`, `profile.spec.js` |
| Migrations | 002, 003, 012, 020, 021, 041, 056, 061, 065, 080 (admin TOTP) |
| Feature doc | `docs/API.md` (Authentication) |

**Rules that must hold**
- Lucia v3 owns sessions; there is no JWT layer (invariant 3).
- Social login (Google + Facebook) is LIVE here: `features.js` defaults the
  flag to true and the kill switch is two-step (`auth.socialKillSwitch.test.js`).
- Admin credentials live in `users` (scrypt); create or reset with
  `server/scripts/setup-admin.js` or `npm run bootstrap`. There is no
  `ADMIN_PASSWORD_HASH`.
- `/admin/roles` is admin-only on both layers; `roles` is not grantable.
- Admin TOTP (080) enrols from the profile; the gate is
  `mfaService.protectedRole`, mirrored on the client — widen both together.

## 2. Admin shell — sidebar, dashboard, UI kit

| | |
|---|---|
| Routes | `server/routes/adminNavRoutes.js` → `/api/v1/admin/nav-config` (`requireRole('admin')`) |
| Models | `server/models/AdminNavConfig.js` |
| Views | `public/js/views/AdminView.js` (`/admin`, any authenticated user) |
| Components | `public/js/components/AdminSidebar.js` (`ADMIN_NAV`), `adminNavLayout.js`, `adminTable.js`, `adminPager.js`, `FilterBar.js`, `Toast.js`, `ToastLog.js` |
| Client | `public/js/services/adminNav.js`, `toastLog.js`, `buildInfo.js`; `public/js/utils/listState.js`, `localPref.js`, `debounce.js`, `format.js`, `downloadCsv.js`, `csv.js`, `escHtml.js`, `api.js` |
| CSS | `public/css/admin-shell.css`, `admin-kit.css`, `layout.css`, `components.css`, `variables.css`, `reset.css`, `main.css` |
| Jest | `tests/integration/admin.test.js`, `adminNavConfig.test.js`; `tests/unit/admin-views-parity.test.js`, `adminTableKit.test.js`, `kitFormatters.test.js`, `debounce.test.js`, `csvClientParity.test.js` |
| e2e | `e2e/admin.spec.js`, `admin-nav-colors.spec.js` |
| Migrations | 053 (nav config) |
| Feature doc | — (this section) |

**Rules that must hold**
- Sidebar row tints (12 colours), labels and section order are a per-admin
  layout blob in `admin_nav_config` (053); no migration for tint changes.
- Every sidebar line is live here (there is no `HIDDEN_ADMIN_VIEWS`; instances
  add that themselves).
- Kit contract: `listState` uses `replaceState` only, never `pushState`; page
  size is NOT in the URL; `sortableTh` emits a real `<button>` inside the
  `<th>` with `aria-sort` on the `th`; `admin-kit.css` carries zero colour
  literals.
- `buildInfo.js` is the sidebar release stamp: one admin-gated request per page
  load, and 401/403 renders nothing.

## 3. Public site — home, contact, legal, SSR meta, sitemap, SEO

| | |
|---|---|
| Routes | `server/routes/contactRoutes.js` → `/api/v1/contact` (public, own limiter) · `server/routes/sitemapRoutes.js` → `/` (`GET /sitemap.xml`, dynamic, before `express.static`); the IndexNow key file, `/api/v1/csrf-token` and the SPA catch-all are inline in `server/app.js` |
| Controllers | `server/controllers/contactController.js` |
| Services | `server/services/indexNow.js` (called from shop, content, news, project controllers) |
| Config / middleware | `server/middleware/ssrMeta.js`; `server/utils/canonicalHost.js` (`APP_URL` → canonical host redirect) |
| Views | `public/js/views/HomeView.js`, `ContactView.js`, `PrivacyView.js`, `TermsView.js`, `NotFoundView.js` |
| Components | `public/js/components/NavBar.js` |
| Client | `public/js/router.js`, `navigate.js`, `main.js`; `public/js/utils/pageTitle.js` |
| Static | `public/index.html`, `public/robots.txt`, `public/BingSiteAuth.xml`, `public/manifest.json`, `public/og-image.jpg`, `public/favicon.svg`; `public/assets/videos/` (waterfall hero clips) |
| CSS | `public/css/home.css`, `contact.css`, `video-section.css`, `fonts.css` |
| Jest | `tests/integration/contact.test.js`, `sitemap.test.js`, `ssrMeta.test.js`; `tests/unit/pageTitle.test.js`, `canonicalHost.test.js` |
| e2e | `e2e/contact.spec.js`, `navigation.spec.js`, `responsive.spec.js`, `responsive-screenshots.spec.js` |
| Migrations | 005 (site content), 017 (home stats) |
| Feature doc | `docs/API.md` (Contact) |

**Rules that must hold**
- Public IA, all live: `/`, `/projects`, `/projects/:id`, `/news`,
  `/news/:slug`, `/halli` (= `/about`), `/contact`, `/privacy`, `/terms`,
  `/party`, `/shop…`, `/cart`, `/checkout…`, `/orders`, `/signup`, `/profile`.
  `/aron13ara` is unlisted (no nav, no sitemap, IS-only, noindexed).
- In production the canonical host comes from `APP_URL` via `canonicalHost.js`;
  HTTP→HTTPS and host redirects go to it in one hop; `/health` and `/ready`
  are exempt.
- The catch-all is `'/{*splat}'`. Keep the braces: they make it match `/`
  itself, which the root locale redirect needs (Express 5).
- `pageTitle.js` mirrors `ssrMeta.js`; `tests/unit/pageTitle.test.js` parses
  the server file, so a title change must touch both.

## 4. Themes

| | |
|---|---|
| Config | `server/config/themes.js` (`THEMES`) |
| Components | `public/js/components/ThemeSwitcher.js` |
| Client | `public/js/theme-boot.js`, `public/js/services/themePrefs.js`; `public/js/utils/chartTheme.js` |
| Static | `public/fonts/` (self-hosted) |
| CSS | `public/css/themes.css`, `theme-switcher.css` |
| Scripts | `scripts/self-host-fonts.js`, `scripts/recompress-images.js` |
| Jest | `tests/unit/themePrefsAccount.client.test.js`, `themePrefsEnv.client.test.js` |
| Migrations | 081 (`users.theme`, CHECK constraint) |
| Feature doc | — |

**Rules that must hold**
- Six themes: `classic` (default, owns `:root`), `glacier`, `moss`, `lava`,
  `aurora`, `black-sand`. The list must match in `themes.css`,
  `themePrefs.js` + `theme-boot.js`, and `server/config/themes.js` + the 081
  CHECK. Adding a theme needs a migration (expand/contract, invariant 14).
- `users.theme` is nullable with no default; NULL means "never picked" and is
  distinct from `classic`.
- Every new UI must survive a theme switch (invariant 15); canvases read
  `chartTheme.js` at draw time.
- `themePrefs.getEffectiveEnv()` decides the TEST chrome (domain 11).

## 5. i18n

| | |
|---|---|
| Server | `server/config/i18n.js` (`SUPPORTED_LOCALES`, `forcedLocaleFor`), `server/i18n/index.js`, `server/i18n/en.json`, `server/i18n/is.json`; `server/middleware/locale.js` |
| Services | `server/services/translator.js`, `autoTranslateFields.js`, `siteContentTranslate.js` |
| Client | `public/js/i18n/i18n.js`, `public/js/i18n/en.json`, `public/js/i18n/is.json` |
| Scripts | `scripts/check-i18n-keys.js` (`npm run check:i18n`), `scripts/backfill-is-translations.js`, `scripts/retranslate-party-en.js` |
| Jest | `tests/integration/i18n.test.js`, `content.translate.test.js`, `news.translate.test.js`, `party.translate.test.js`; `tests/unit/translator.test.js`, `autoTranslateFields.test.js`, `localeLock.test.js`, `localeLockClient.test.js` |
| Migrations | 028–038 (eleven consecutive i18n migrations) |
| Feature doc | — |

**Rules that must hold**
- EN and IS locale JSON stay in sync; `npm run check:i18n` before pushing a
  translation change (invariant 10).
- The root redirect falls back to `en`; the switcher choice lives in the
  `locale_choice` cookie.
- Party is IS-primary and auto-translates IS → EN. The page routes are
  IS-locked; the API's `?locale=` is an authoring dimension and is not locked.

## 6. Shop — storefront, cart, checkout, orders, products, collections, bins, discounts, customers, sales

| | |
|---|---|
| Routes | `server/routes/shopRoutes.js` → `/api/v1/shop` (public + `softAuth`; order history `requireAuth`; the webhook is inline in `app.js`) · `adminShopRoutes.js` → `/api/v1/admin/shop` (`requireAuth`; `/products` `products`, `/orders` `orders`, `/collections` `collections`, `/reports` `sales`) · `adminDiscountRoutes.js` → `/api/v1/admin/discounts` (`discounts`) · `adminBinsRoutes.js` → `/api/v1/admin/bins` (`bins`) · `adminCustomerRoutes.js` → `/api/v1/admin/customers` (reads `customers`, writes admin) · `adminCustomerNotesRoutes.js` → `/api/v1/admin/customer-notes` (`customers`) |
| Controllers | `server/controllers/shopController.js`, `adminShopController.js`, `adminDiscountController.js`, `adminBinsController.js`, `adminCustomerController.js`, `adminCustomerNoteController.js` |
| Models | `server/models/Product.js`, `ProductVariant.js`, `Collection.js`, `Order.js`, `Discount.js`, `Bin.js`, `Customer.js`, `CustomerNote.js` |
| Services | `server/services/stripeService.js`, `discountEngine.js`, `pdfService.js` (order delivery note); `server/config/stripe.js`, `shipping.js` |
| Views | `public/js/views/ShopView.js`, `ProductView.js`, `CartView.js`, `CheckoutView.js`, `CheckoutSuccessView.js`, `CheckoutCancelView.js`, `OrderHistoryView.js`, `AdminProductsView.js`, `AdminOrdersView.js`, `AdminOrderDetailView.js`, `AdminCollectionsView.js`, `AdminDiscountsView.js`, `AdminBinsView.js`, `AdminCustomersView.js`, `AdminSalesView.js` |
| Components | `public/js/components/ProductCard.js`, `ShopFilters.js`, `CartIcon.js`, `CurrencySelector.js`, `BarcodeScanner.js`, `CustomerNotes.js` |
| Client | `public/js/services/cart.js`, `adminProducts.js`, `adminOrders.js`, `adminCollections.js`, `adminDiscounts.js`, `adminBins.js`, `adminCustomers.js`, `adminCustomerNotes.js`; `public/js/utils/productCsv.js`; `public/js/vendor/chart.umd.js` (sales chart, shared with analytics) |
| Scripts | `server/scripts/seed-shop.js`, `import-products-csv.js`; `server/scripts/seed-assets/` |
| CSS | `public/css/shop.css`, `admin-products.css`, `admin-orders.css`, `admin-collections.css`, `admin-discounts.css`, `admin-bins.css`, `admin-customers.css`, `admin-sales.css`, `barcode-scanner.css` |
| Jest | `tests/integration/shop.test.js`, `discounts.test.js`, `adminOrderBulk.test.js`, `adminProductImportExport.test.js`, `adminCustomers.test.js`, `adminCustomerNotes.test.js`; `tests/unit/discountEngine.test.js`, `shopFilters.test.js`, `bins-grid.test.js` |
| e2e | — (no checkout or shop spec at base) |
| Migrations | 022, 023, 024, 025, 045, 048, 049, 050, 054, 055, 057, 064 (customer notes), 074 (product VAT rate; shared with books) |
| Feature doc | `docs/SHOP_REDESIGN.md` (multi-section storefront) |

**Rules that must hold**
- The shop is LIVE here. Section sub-routes must precede `/shop/:slug` in
  `router.js`.
- The Stripe webhook is raw-body, registered before `express.json()`, and
  exempt from CSRF and `sanitizeBody`; its signature is verified (invariant 7).
- `Customer` is a B2C view of `users` with order aggregates. Admin-created
  customers are passwordless (role hardwired `user`) and are invited through
  the reset-token flow.
- There is no e2e coverage of checkout, and green `main` deploys: a PR
  touching checkout is verified by hand before merge.

## 7. News, projects, party, bio, Aron13

| | |
|---|---|
| Routes | `server/routes/newsRoutes.js` → `/api/v1/news` (public reads; writes admin/moderator) · `projectRoutes.js` → `/api/v1/projects` (public reads; writes admin/moderator) · `partyRoutes.js` → `/api/v1/party` (`requireAuth` + `requirePartyAccess` for guests; admin/moderator and admin for management; `POST /photos` deliberately unauthenticated, behind `partyUploadLimiter` + CSRF) |
| Controllers | `server/controllers/newsController.js`, `projectController.js`, `partyController.js` |
| Models | `server/models/Project.js` |
| Services | `server/services/partyApproval.js`, `partyInfo.js`; `server/utils/youtube.js` |
| Views | `public/js/views/NewsView.js`, `ArticleView.js`, `ProjectsView.js`, `ProjectDetailView.js`, `HalliView.js` (`/halli` + `/about`), `PartyView.js`, `PartyAdminView.js`, `PartyMagicLoginView.js`, `PartyApproveView.js`, `Aron13View.js`, `aron13-font.js`, `aron13-fx.js`, `aron13-sprites.js`; `public/js/views/aron13-games/` |
| Components | `public/js/components/ProjectCard.js`, `ProjectForm.js`, `ProjectModal.js`, `PartyAdminStatModal.js`, `Lightbox.js` (party + project detail) |
| Client | `public/js/api/projectApi.js` |
| Assets | `public/assets/projects/`, `public/assets/party/`, `public/assets/waterfall-cover.jpg` |
| Scripts | `server/scripts/seed.js` (sample projects), `seed-news.js`, `seed-arnarhraun.js`, `seed-stofan-bakhus.js`, `update-portfolio-project.js`, `cleanup-duplicates.js` (duplicate projects), `capture-site-screenshots.js` (portfolio project media) |
| CSS | `public/css/news.css`, `party.css`, `gallery.css`, `project-edit.css`, `halli-bio.css`, `aron13.css` |
| Jest | `tests/integration/news.test.js`, `newsMedia.test.js`, `projects.test.js`, `sections.test.js`, `media.test.js`, `videos.test.js`, `party.test.js`, `content.partyRsvpForm.test.js`; `tests/unit/partyRsvpStatus.test.js`, `partyNotifyRecipients.test.js`, `partyTimingBucket.test.js` |
| e2e | `e2e/gallery.spec.js`, `project-edit.spec.js`, `news-editor.spec.js`, `aron13.spec.js` |
| Migrations | 004, 008, 009, 010, 011, 013, 014, 015, 016, 018, 019, 026, 027, 039, 040, 042, 044, 058, 059, 060, 062, 063, 066, 067, 068, 069, 070, 071 |
| Feature doc | — |

**Rules that must hold**
- These are LIVE public surfaces (nav + sitemap); only `/aron13ara` is unlisted.
- The party album is fully public by owner decision (2026-07-26): no auth on
  `POST /photos`, and it is exempt from the write limiter in `app.js`.
  `DELETE /photos/:id` keeps `requireAuth` and the write limiter.
- Party page routes are IS-locked (domain 5).
- The news editor overlay is `position:fixed`; it must not live under a
  transformed `.view` (`e2e/news-editor.spec.js`).

## 8. Monitoring — event logs, metrics, analytics, health

| | |
|---|---|
| Routes | `server/routes/eventRoutes.js` → `/api/v1/events` (`POST /collect`, `collectLimiter` + `softAuth` + CSRF) · `adminEventRoutes.js` → `/api/v1/admin/events` (`requireRole('admin')`) · `analyticsRoutes.js` → `/api/v1/analytics` (public beacon) · `analyticsAdminRoutes.js` → `/api/v1/admin/analytics` (`analytics`); `/health`, `/ready` and `/metrics` inline in `server/app.js` |
| Controllers | `server/controllers/eventLogController.js`, `analyticsController.js` |
| Models | `server/models/EventLog.js`, `Analytics.js` |
| Services | `server/services/eventLogCleanup.js`, `analyticsSalt.js` |
| Observability | `server/observability/logger.js`, `metrics.js`, `httpMetrics.js`, `circuitBreaker.js`, `alerts.js`, `memoryUsage.js`, `securityLogger.js`; `server/logger.js` |
| Views | `public/js/views/AdminMonitoringView.js` (client-gated `isAdmin`), `AdminAnalyticsView.js` |
| Client | `public/js/services/adminEvents.js`, `errorReporter.js`, `usage.js`; `public/js/analytics.js`, `public/js/consent.js`; `public/js/vendor/chart.umd.js` |
| CSS | `public/css/admin-monitoring.css`, `analytics-admin.css` |
| Jest | `tests/integration/eventLog.test.js`, `analytics.test.js`, `observability.test.js`; `tests/unit/analyticsSalt.test.js`, `loggerScrub.test.js` |
| e2e | — |
| Migrations | 046 (analytics), 083 (event logs) |
| Feature doc | `RUNBOOK.md` |

**Rules that must hold**
- The DB circuit breaker is applied to `/auth` and `/api/v1`; `/health` is
  liveness without the DB, `/ready` includes DB + breaker + memory.
- `usage.js` is a first-party, cookieless page-view beacon; the server derives
  an anonymous daily token from IP + UA (`analyticsSalt`).
- Logs scrub secrets (`loggerScrub.test.js`); pino only, never `console.log`.

## 9. Self-update

| | |
|---|---|
| Routes | `server/routes/systemRoutes.js` → `/api/v1/system` (whole router 404 unless `selfUpdateSettings.isEnabled()`; then `requireAuth`; `/version` and `/updates` need view `updates`; `PATCH /settings` and apply/rollback are admin + `updateLimiter` 10 / 15 min) |
| Models | `server/models/SystemUpdate.js` |
| Services | `server/services/updateChecker.js`, `updateApplier.js`, `selfUpdateSettings.js`, `changelogRender.js`, `outboundAllowlist.js` (update-manifest host allowlist); `server/utils/semver.js`, `server/utils/maintenanceWindow.js` |
| Config | `server/config/version.js`, `server/config/clientConfig.js` (per-instance module config, deep-frozen at boot) |
| Views | `public/js/views/AdminUpdatesView.js` |
| Scripts | `scripts/build-manifest.js`, `check-manifest.js`, `generate-version.js` |
| CSS | `public/css/admin-updates.css` |
| Jest | `tests/integration/systemUpdatesApi.test.js`, `systemUpdatesRoutes.test.js`, `systemVersion.test.js`, `updateApplier.test.js`, `updateChecker.test.js`, `selfUpdateSettings.test.js`, `selfUpdateDisabled.test.js`; `tests/unit/changelogRender.test.js`, `semver.test.js`, `buildManifest.test.js`, `version.test.js`, `outboundAllowlist.test.js`, `maintenanceWindow.test.js` |
| e2e | `e2e/admin-updates.spec.js` |
| Migrations | 082 (system updates) |
| Feature doc | `docs/SELF-UPDATE.md`, `docs/DEPLOYMENT.md` (promote.yml) |

**Rules that must hold**
- Ships OFF; a switched-off module answers 404, not 403.
- Migrations are expand/contract across releases (invariant 14): during an
  image swap the OLD container still serves against the NEW schema. An update
  is never applied from inside boot migrations; post-boot verification closes
  the loop.
- A maintenance window must be non-zero-length with a valid IANA tz
  (`validateWindow`).
- `CHANGELOG.md` is parsed by `build-manifest.js`; keep its version headings.

## 10. MCP connector

| | |
|---|---|
| Routes | `server/routes/mcpRoutes.js` → `/api/v1/mcp` (404 unless `MCP_ENABLED=true`; 403 on non-HTTPS in prod; `preAuthLimiter` → `mcpAuth` bearer → `tokenLimiter`) · `mcpAdminRoutes.js` → `/api/v1/admin/mcp-tokens` (`requireRole('admin')`) |
| Controllers | `server/controllers/mcpAdminController.js` |
| Models | `server/models/McpToken.js` |
| Middleware / core | `server/middleware/mcpAuth.js`; `server/mcp/transport.js`, `registry.js`, `envTag.js`; `server/mcp/tools/system.js` |
| Views | `public/js/views/AdminMcpSettingsView.js` (`/admin/mcp`, client `isAdmin`) |
| Client | `public/js/services/adminMcp.js` |
| Jest | `tests/integration/mcp.test.js` |
| Migrations | 084 (MCP tokens) |
| Feature doc | `docs/mcp.md` |

**Rules that must hold**
- Ships dark. `mcpAuth` reads no cookies, which is the documented reason the
  router omits `csrfProtect`; MCP traffic still passes `sanitizeBody` and the
  global limiter (invariant 7 — moving the mount would exempt it from both).

## 11. Change requests — in-app feedback

| | |
|---|---|
| Routes | `server/routes/changeRequestRoutes.js` → `/api/v1/change-requests` (5 mb body; `POST /` = `requireTestEnv` → `submitLimiter` → `softAuth` → CSRF) · `adminChangeRequestRoutes.js` → `/api/v1/admin/change-requests` (`requireView('feedback')`) |
| Controllers | `server/controllers/changeRequestController.js` |
| Models | `server/models/ChangeRequest.js` |
| Middleware | `server/middleware/requireTestEnv.js` |
| Views | `public/js/views/AdminChangeRequestsView.js` (`/admin/feedback`) |
| Components | `public/js/components/ChangeRequestWidget.js` (lazy-imported by `main.js` when `getEffectiveEnv() === 'test'`) |
| Client | `public/js/vendor/html2canvas.min.js` |
| CSS | `public/css/admin-change-requests.css`, `test-env.css` (TEST chrome) |
| Jest | — (no change-request test at base) |
| e2e | — |
| Migrations | 052 |
| Feature doc | — |

**Rules that must hold**
- Submission is 404 in production (`APP_ENV` wins over `NODE_ENV`; unset =
  production), so production reveals nothing. The TEST chrome is a one-way
  clamp: a test build can never look like production.

## 12. Content, settings, background

| | |
|---|---|
| Routes | `server/routes/contentRoutes.js` → `/api/v1/content` (`GET /:key` public; `PUT /:key` and `POST /:key/image` admin/moderator) · `adminGeneralSettingsRoutes.js` → `/api/v1/admin/general-settings` (`general`) · `adminBackgroundRoutes.js` → `/api/v1/admin/background` (`background`) |
| Controllers | `server/controllers/contentController.js`, `adminGeneralSettingsController.js`, `adminBackgroundController.js` |
| Models | `server/models/Setting.js`, `BackgroundLibrary.js` |
| Views | `public/js/views/AdminGeneralSettingsView.js`, `AdminBackgroundView.js` |
| Client | `public/js/services/adminGeneralSettings.js` |
| CSS | `public/css/admin-general-settings.css`, `admin-background.css` |
| Jest | `tests/integration/content.uploadImage.test.js` |
| e2e | `e2e/editable-homepage.spec.js` |
| Migrations | 047 (app settings), 051 (background media) |
| Feature doc | — |

**Rules that must hold**
- Seeded `site_content` rows (005, 017) shadow the JS fallbacks: a copy change
  must move the DB row too, and `contentController` stamps `updated_by` so a
  data migration can guard on `updated_by IS NULL` and leave admin edits alone.

## 13. Uploads and media

| | |
|---|---|
| Mounts | static `/assets/{news,party,projects,avatars,products,content}` from `UPLOAD_ROOT` (immutable, 365 d) and `/assets/brand` (CORP `cross-origin` for email) in `server/app.js`; baked `public/` after it (1 h) |
| Middleware | `server/middleware/upload.js`, `sanitize.js`, `validate.js` |
| Config | `server/config/paths.js` (`UPLOAD_ROOT`) |
| Jest | `tests/unit/uploadPaths.test.js`, `uploadRoot.test.js`, `sanitize.test.js`, `validate.test.js`; exercised by `tests/integration/media.test.js`, `newsMedia.test.js`, `content.uploadImage.test.js` |
| Migrations | 004, 016, 051 |
| Feature doc | `SECURE_SDLC.md` |

**Rules that must hold**
- Uploaded file names embed a timestamp + random suffix, which is why the long
  immutable cache is safe; a replaced asset gets a NEW name.
- `UPLOAD_ROOT` is guarded at boot; in production it is the Azure Files mount
  `/app/uploads`. Upload paths are allowlisted; uploaded avatars are
  owner-scoped.

## 14. Email

| | |
|---|---|
| Services | `server/services/emailService.js` (used by the admin, customer, auth, contact, party and shop controllers); templates use `server/i18n/` |
| Routes | `GET /api/v1/admin/email-health` in `server/routes/adminRoutes.js` (admin/moderator) |
| Jest | exercised by `tests/integration/auth.test.js`, `party.test.js`, `contact.test.js` |
| Migrations | 062 (party welcome email) |
| Feature doc | `RUNBOOK.md`, `docs/DEPLOYMENT.md` (env) |

**Rules that must hold**
- Sender is `EMAIL_FROM`; mail failures are loud; `EMAIL_ALLOWLIST` limits
  recipients outside prod; `emailShell` escapes its `<title>`.

## 15. Bookkeeping — invoices, expenses, AR, VSK, bank, ledger, payroll, POS

| | |
|---|---|
| Routes | `server/routes/adminBookkeepingRoutes.js` → `/api/v1/admin/bookkeeping` (`requireAuth`; per-endpoint `requireView` books/invoices/expenses/ar/vat/bank/ledger/payroll/pos; writes `requireRole('admin')`; write limiter in `app.js`) |
| Controllers | `server/controllers/adminBookkeepingController.js` |
| Models | `server/models/Invoice.js`, `Expense.js`, `FxRate.js` |
| Services | `server/services/bookkeeping/invoiceService.js`, `expenseService.js`, `ledgerService.js`, `vatService.js`, `payrollService.js`, `posService.js`, `documentService.js`, `reconciliationService.js`, `reportService.js`, `auditLog.js`; `server/services/bookkeepingPdf.js` |
| Middleware / utils | `server/middleware/booksLimiters.js`; `server/utils/vat.js`, `vatPeriod.js`, `booksDate.js`, `fx.js`, `csv.js` (shared with `adminShopController`) |
| Views | `public/js/views/AdminBooksView.js`, `AdminBooksSettingsView.js` (rides `books`), `AdminInvoicesView.js`, `AdminInvoiceDetailView.js`, `AdminExpensesView.js`, `AdminARView.js`, `AdminStatementView.js` (`/admin/books/ar/:customerKey`), `AdminVatView.js`, `AdminBankView.js`, `AdminLedgerView.js`, `AdminPayrollView.js`, `AdminPosView.js`, `booksShared.js` |
| Client | `public/js/services/adminBookkeeping.js`; `public/js/utils/money.js` |
| Scripts | `server/scripts/books-archive-export.js`, `books-backfill-orders.js`, `books-fetch-fx.js`, `seed-books-demo.js` |
| CSS | `public/css/admin-bookkeeping.css` |
| Jest | `tests/integration/adminBookkeeping.test.js`, `booksInvoice.test.js`, `booksExpenses.test.js`, `booksLedger.test.js`, `booksVatReturn.test.js`, `booksPos.test.js`, `booksPayroll.test.js`, `booksReconciliation.test.js`, `booksReports.test.js`, `booksBackfill.test.js`; `tests/unit/booksVat.test.js`, `booksVatPeriod.test.js`, `booksCsv.test.js`, `booksDate.test.js`, `booksFx.test.js`, `booksPdf.test.js`, `booksPayroll.test.js`, `booksControllerParse.test.js`, `booksRouteOrder.test.js` |
| e2e | — |
| Migrations | 072, 073, 074, 075, 076, 077, 078, 079, 085 (vehicle accounts) |
| Feature doc | `docs/BOOKKEEPING-SYSTEM.md` (read before touching `/admin/books`), `docs/ACCOUNTANT-QUESTIONS.md` |

**Rules that must hold** (invariants 7–8 in `CLAUDE.md`)
- Double-entry; the ledger is the only source of totals. Every figure derives
  from posted `journal_lines`, balanced entries are trigger-enforced, and every
  INSERT into `journal_lines` must carry `vat_rate`
  ([vat-rate-never-written](HISTORY.md#vat-rate-never-written)).
- Posted history is append-only (505/2013 gr. 9); corrections are reversals
  or credit notes, enforced by triggers.
- A books migration that touches a table an earlier migration created must
  ALTER it, never re-declare it with `IF NOT EXISTS`
  ([create-if-not-exists-noop](HISTORY.md#create-if-not-exists-noop)); and an
  applied migration is never edited
  ([edited-applied-migration](HISTORY.md#edited-applied-migration)).
- Payroll tax bands are loaded through `normaliseBands()`, which accepts upper
  or lower bounds and refuses a shape that states neither
  ([payroll-bands-bounds](HISTORY.md#payroll-bands-bounds)).
- `docLimiter` (60 / 15 min) bounds the streaming/PDF/CSV endpoints;
  `booksRouteOrder.test.js` pins the middleware order.
- 6600 atvinnubifreiðar deductible, 6610 fólksbifreiðar blocked (085).

## 16. Infrastructure and cross-cutting

| | |
|---|---|
| App | `server/app.js`, `server/server.js`, `server/config/database.js`, `server/middleware/errorHandler.js`, `server/middleware/forwardedFor.js` (App Service `ip:port` → ip; before any limiter) |
| Migrations tooling | `server/config/schema.js`, `server/scripts/migrate.js`, `bootstrap.js`; reference SQL under `server/migrations/` |
| Tests infra | `tests/env.js`, `tests/globalSetup.js` (drops/creates `TEST_DATABASE_URL`, must end `_test`), `tests/globalTeardown.js`, `tests/helpers.js`; `e2e/global-setup.js`, `e2e/helpers.js`, `e2e/lib/dbUrl.js` |
| Jest | `tests/unit/schema-integrity.test.js`, `clientConfig.test.js`, `forwardedFor.test.js`, `architectureIndex.test.js` (this index); `tests/integration/migrateRunner.test.js` |
| CI / deploy | `.github/workflows/ci.yml`, `deploy.yml` (`workflow_run` on green CI on `main` + `workflow_dispatch`), `promote.yml`, `trivy.yml`; `.github/dependabot.yml`; `Dockerfile`; `jest.config.js` (`maxWorkers: 1`), `playwright.config.js`, `eslint.config.js`, `babel.config.js` |
| Migrations | 001 (initial), 043 (strip stale railway references — housekeeping) |
| Feature doc | `RUNBOOK.md`, `SECURE_SDLC.md`, `README.md`, `docs/DEPLOYMENT.md` |

**Rules that must hold**
- **Any push to `main` deploys** (no paths filter): CI green → `Deploy to
  Azure` via `workflow_run` → ACR → App Service restart. Migrations run at
  container start. A docs-only merge deploys too.
- Jest runs one worker against one database, so every session needs a private
  `TEST_DATABASE_URL` ([shared-test-db](HISTORY.md#shared-test-db)); verify a
  PR's checks against the commit's check-runs, not the PR, and require
  `total_count > 0` ([stale-pr-checks](HISTORY.md#stale-pr-checks)).
- The migration runner is one transaction per migration and advisory-locked;
  `UPLOAD_ROOT` and `DB_SSL` are declared at boot.
- Node major pinned in THREE places (`Dockerfile` digest, ci.yml, promote.yml);
  Express 5 catch-alls keep the braces.
- **This repo is the scaffold source.** site-factory's `DEFAULT_BASE` copies
  this working tree, every markdown file and all of `tests/`, so work landing
  only in an instance reaches no future scaffold; cross-cutting improvements
  come here as PRs. The scaffolder copies the CHECKED-OUT tree, so land on
  `main` and check `main` out before scaffolding.

---

## Ownership notes

- **`public/js/views/AboutView.js` is dead code**: `router.js` does not import
  it; `/about` is served by `HalliView.js`. Listed so the coverage check
  passes; removing it is an owner decision.
- `server/services/pdfService.js` is the shop's order delivery note (pdfkit);
  books PDFs are `bookkeepingPdf.js`.
- `server/services/outboundAllowlist.js` is consumed only by self-update
  (`updateChecker` / `updateApplier`), not email.
- `server/utils/csv.js` is shared by books (owner) and the shop product export.
- `server/utils/qr.js` exists only for TOTP enrolment (domain 1).
- `server/config/clientConfig.js` is the per-instance module seam read by
  `selfUpdateSettings` (domain 9); its test sits with infrastructure.
- `public/js/vendor/chart.umd.js` is shared by `AdminAnalyticsView` and
  `AdminSalesView`.
- `public/js/api/rateLimitDecide.js` / `rateLimitGuard.js` are client files
  used everywhere; listed with auth beside their tests.
- Migration 074 (`product_vat_rate`) belongs to both shop and books.
- `public/css/test-env.css` is the TEST chrome (domain 11), not a theme.
