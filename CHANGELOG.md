# Changelog

All notable changes to the Orange Smiley company site (`orangesmiley`) are
documented here, newest first, written from the merge commits on `master`.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). The heading
of a version section is load-bearing: `scripts/build-manifest.js` extracts the
`## [<package.json version>]` section as the release notes the self-update
channel publishes (`docs/SELF-UPDATE.md`), so the current version must always
have a section, even while unreleased. `package.json` is `0.1.0`.

This repo was scaffolded 2026-08-09 from the HalliProjects base at `562c637`;
the base's own history (its `[1.0.0]` of 2026-03-30 — hallismiley.is, the
portfolio site) lives in the `hallismiley` repo, not here.

---

## [0.1.0] — Unreleased (2026-08-09 → 2026-09-12)

No instance of this repo has been deployed; every entry below is on `master`.

### 2026-09-24

- MCP write tools (roadmap R5b): Claude can change the update channel, mode
  and maintenance window, switch a module off and back on (within the
  instance's contract), and file a feature request into the change-request
  inbox. Write tools exist only where a stack allows `write`. The same module
  switches are a card on `/admin/general`.
- MCP connector over OAuth 2.1 (roadmap R5a): claude.ai and Claude Desktop
  add `<origin>/api/v1/mcp` as a custom connector with no token to paste; an
  admin approves the connection on `/tengja/<id>`. Discovery, dynamic client
  registration, PKCE, rotated refresh tokens, revocation; migration 110.
  Tokens now stop working the moment their owner stops being an admin.
- Module switches (roadmap R4, ENHANCEMENTS #5): `modules.preset` (`all` ·
  `vefur` (core + news) · `verslun` · `rekstur`) and `modules.<id>.enabled` for shop, pos,
  books, news, projects, party, bio and salesOps in `config/client.json`. A
  module that is off is absent: its APIs and uploads 404 before auth, its
  pages 404 with noindex, and it leaves the nav, sitemap, admin sidebar and
  role editor. This instance keeps `all`. No migration.

### 2026-09-21

- Seller area (D-020): `INSTANCE_ROLE` (`ops` default / `public`); migration
  105 `published_*` tables; `npm run publish:sellers` signs a snapshot on ops
  and posts it to `/api/v1/seller-publish` on the public instance; sellers
  read their leads, own accounts and commission statements at `/solusvaedi`,
  read-only, behind 2FA. Built and tested, not deployed.

### 2026-09-12

- Follow-ups to the docs sync: the production canonical-host 301 derives from
  `APP_URL` (was the literal `www.hallismiley.is`); `promote.yml` on Node 24;
  `setup.ps1` no longer generates unused RSA keys or suggests `/strip-base`;
  the MCP panel's connector name and the bearer realm say `orangesmiley`;
  `GET /documents/:id` rate-limits before the view check; `railway.toml` and
  the unused `nodemailer` dependency removed; the CI e2e job waits for the
  runner's background `apt-get` instead of failing on its lock.

### 2026-09-11

- Docs sync (PR #4): every tracked markdown file checked against the code;
  README, docs/DEPLOYMENT.md and CHANGELOG.md rewritten for this repo;
  docs/SHOP_REDESIGN.md deleted; the inherited audits and SELF-UPDATE-PLAN
  frozen with banners; a lockfile-only `npm audit fix` (multer, nodemailer,
  sharp, qs).

### 2026-09-08

- Commission statements, payouts and clawback — migration 102 (D-019: netting
  against future statements for 12 months, no cash demand). Also narrows the
  commission scope so a hand-granted `allaccounts` no longer widens which
  earnings a seller can read (`server/auth/commissionScope.js`).
- The build deposit is a prepayment, not revenue — migration 101 (`2150
  Fyrirframinnheimtar tekjur`, released on the final build half; VSK untouched,
  box A still sees the deposit in its period).
- The buyer party block — migration 100: service invoices can be
  Peppol-exported and their PDFs print a buyer address for the first time;
  BT-49 was absent from every UBL document emitted before, so the order path
  is now refused by name.
- Commission payability nets credit notes proportionally (`PAYABLE_NOW_ISK`):
  a fully credited and refunded invoice, and an unpaid fully credited one, both
  read as paid in full before.
- Admin UI kit (ENHANCEMENTS #21, partial): `debounce`, `localPref`,
  `pageTitle` + router hook, `listState`, `adminTable`, `adminPager`,
  `admin-kit.css`, `formatRelative`; `AdminUsersView` converted as the reference.
  Eight defects fixed alongside: unscannable 2FA QR on Glóð, sellers pushed to
  enrol in 2FA with no panel, inert `required` at checkout (plus the one-way
  `syncShipping()` bug), a leaked `LoginModal` keydown listener, hardcoded
  English country labels, the 2 MB avatar hint against a 5 MB limit, client CSV
  drift from the server's plain-number exemption, `en-GB` dates in
  `OrderHistoryView`. Upstreamed as base PR #153.
- Profile: the 2FA section comment corrected (accounts holders are protected
  too, not admins only).

### 2026-09-07

- Review pass on the day's admin work (PR #3) — six security/money defects
  fixed with regression tests, migration 099 (`invoices.account_id`,
  `service_kind`, `service_period`; partial unique indexes so a service invoice
  cannot be double-issued).
- Customer accounts, staff roles and staff audit log (ENHANCEMENTS #17) —
  migration 098: `customer_accounts`, `staff_audit_log`, `commission_events`,
  `users.github_login`, seeded roles `solumadur` and `verktaki`, row scoping in
  both layers, 2FA widened to `accounts` holders. Service-contract invoices +
  commission ledger (#18): `createServiceInvoice`, `/admin/commission`.
- Markaður prospect list (#16) — `/admin/markadur` over the 093 research tables
  with the shortlist hand-off; no migration.
- Leads inbox (#2) — migration 097 `leads`, `/admin/leads`, `leads` view
  appended to `solufolk`, daily prune at `LEAD_RETENTION_DAYS` (730),
  `/personuvernd` §3 + §6 rewritten (DRAFT).
- Admin console re-shaped for the business: retail screens hidden by policy
  (`adminSurface.js`), Sölustarf and Þjónusta groups, `/admin` as the company
  overview, the projects board at unlisted `/admin/projects`.
- Orange Smiley's own books into the product — `/admin/books/settings`,
  `npm run books:replay`, migration 095 (structured party block,
  `invoice_ubl_exports`, Peppol BIS Billing 3.0 emitter at
  `GET /invoices/:id/ubl.xml`), migration 096 (capture spine: `source_kind`
  ladder + `books_intake`); the expense form's minor-units bug fixed.
- Books: the accountant pack's reports and `Invoice.findDetail()` read
  sequentially on one pg client (fan-out over a single client only queued the
  queries and warned on every run).
- User dropdown: Veislustjóri and Mínar pantanir removed (surfaces hidden, not
  deleted).

### 2026-09-03

- PR #2: change-request gate decides on the role set; `server/config/appEnv.js` as the
  single environment predicate; Docker hardening (un-cacheable `apk upgrade`
  layer, npm removed from the runtime image); shared role helpers.
- Per-branch Jest test databases — parallel worktrees stop trampling each other
  (`tests/workerDb.js`).
- Home discipline tiles show the product (web page, orders, invoices, a change
  request), two more tiles from the product site, content-hashed tile filenames.
- `/verkefni` hidden from the public IA (still functional at its URL).
- GitHub Actions enabled on the repo (it had been disabled at repo level — CI
  had never run).

### 2026-09-02

- Earth palette, three themes, Glóð as the default — migration 094 (accounts
  on the retired `light`/`mono` ids moved to `classic`); orange kept on the
  emblem only. Inner-page headers set on the photograph, no frost plate.
- Company identity on the public pages + `/personuvernd` rewritten to match
  the business (PR #1).
- Harvest 2 from icelandicstore `601b2f2`, five chunks: circuit breaker fed by
  `query()`, query histogram and error-rate alert · parallel Jest with a DB per
  worker + the `main`→`master` CI trigger fix · i18n used-key scan,
  `localechange`, change-request PROD switch, scrolling admin sidebar · rate
  limits ×5, static-asset exemption module, image magic-byte verification,
  Icelandic slug folding · Latest-updates card on Monitoring +
  `admin-monitoring.css`.
- `npm audit fix`: browserslist (high) + sanitize-html 2.17.7.

### 2026-09-01

- Market-research tables + importer, Markaðsstjóri program — migration 093
  (`market_companies`, `market_financials`, `market_stats`; `npm run
  market:import`).
- R1 company-site content pass, five chunks: company brand on every identity
  surface · homepage introduces the company and names its product · `/thjonusta`
  becomes the products page · legacy Halli Smiley brand retired (contact
  defaults, footer, email strings, Terms) · Vörustýring admin group. Migrations
  091/092 move the seeded `home_*`/`contact_*` rows (guarded on `updated_by IS
  NULL`). Carpentry cleared from the public pages.
- Uploads are never throttled — rate-limit carve-out + volume alerting in
  Monitoring; static-asset rate-limit exemption ported from base `2b6842c`.

### 2026-08-27 → 08-28

- Sales-handbook program, four chunks: migration 090 `sales_guides` + the
  `solufolk` role and `handbok` view · reader UX · overlay editor, hardening
  and proposals #14/#15 · 14 seeded Icelandic guides as drafts. Sanitizer fix:
  `body_is`/`body_en` joined the rich-text fields.
- Books archive-verifier flake fix (one failure shape, regression-tested).
- SECURE_SDLC v1.1: §5 cadence owned by Öryggisvörður.

### 2026-08-24

- Tiered test suites: `test:unit` (~8 s, no DB), `test:smoke` (~28 s),
  `test:hotfix`, `test:related`; `docs/TESTING.md`.

### 2026-08-22

- Company/product split strategy docs; homepage reverted to the hallismiley
  composition (dark video hero, light site).
- Harvest 1 from icelandicstore, four merges: Tier-1 fixes (cached user,
  memory alert, loud mail + `EMAIL_ALLOWLIST`, nav-saver races, role-SET
  2FA/OAuth gates) · isolated per-branch e2e database · status tokens, chart
  theming, docs truth · Monitoring (migration 087 `event_logs`, beacon,
  `/admin/monitoring`) and the MCP connector (migration 088 `mcp_tokens`,
  `/admin/mcp`, dark behind `MCP_ENABLED` — ENHANCEMENTS #13).

### 2026-08-20 → 08-21

- Iceland scene engine, three chunks: photographic home with licensed Commons
  photos (migration 086) · inner-page landscapes + View Transitions · live
  ambience (`/api/v1/ambience`, sun position, weather, aurora, sound).
- Rekstrarkerfið UI: light default, gradient hero, five themes; nav tints onto
  the right surfaces; post-program review fixes (lock timeout, theme fast path,
  CSP scrub, ProfileView, vacuous tests).

### 2026-08-19

- Base-sync waves 6A–6D from HalliProjects: security set (transactional locked
  migrations, `UPLOAD_ROOT` guard, upload-path allowlists, PG TLS default-on,
  log scrubbing, admin TOTP — migration 082, social-login kill switch) · Node 24
  + Express 5 · per-account theme (migration 083) · nav tints + CI hardening
  (and the sidebar `display:none` fix the same day).
- Deploy workflow neutralised (ENHANCEMENTS #1): `workflow_dispatch` only,
  every target read from repo variables, guard step fails fast — the repo is
  push-safe.
- `company/` docs moved into the repo (gitignored); ENHANCEMENTS #13 filed; the
  40 avatar SVGs regenerated from `scripts/generate-avatars.js`.

### 2026-08-10 → 08-11

- Self-update module, all six phases: build identity, update checker against a
  published channel, apply/verify/rollback, `/admin/updates`, `promote.yml`;
  migration 081 `system_updates`; `config/client.json` seam (phase 0).
- Background editor in Profile + background library; emblem eyes as gradient
  bars; two-theme picker (Ash dark + light).

### 2026-08-09 — scaffold and jobs 1–3

- Scaffolded from the HalliProjects base at `562c637` (no `/strip-base` — every
  module kept). Job 1: env fixes, `orangesmiley_test`, CLAUDE/PLAN rewrite.
- Job 2 in seven chunks: Icelandic as the visitor default · orange brand ·
  business IA (`/thjonusta`, `/um-okkur`, `/hafa-samband`, `/personuvernd`) ·
  portfolio surfaces hidden via `publicSurface.js` · lead capture (5/hour
  limiter) · SEO/JSON-LD + a11y · business-routes e2e. 2012 Jest + 109
  Playwright green at the time.
- Job 3: `ENHANCEMENTS.md` with 12 proposals, stopped for Halli's approval.
- Re-theme: dark orange + emblem, Ash as the default theme.
