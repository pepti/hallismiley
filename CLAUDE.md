# Orange Smiley — public site (orangesmiley.is)

The **public instance** of Orange Smiley ehf.: marketing site + seed of the customer portal, for the software agency / ERP-replacement business serving Icelandic SMBs. **This is NOT a customer migration** — it is the company's own site, dogfooding the site factory.

## Company/product split (Halli, 2026-08-22)

- **Orange Smiley = the company**; THIS repo/site is the **company site**: what the company does + its products (content pass = roadmap R1, done 2026-09-01). The /thjonusta tier matrix left the company site on 2026-09-13; tiers and prices live on rekstrarkerfi.is only.
- **Orange Smiley sells any software a small or medium business needs** (Halli, 2026-09-13) — custom systems, websites and stores, integrations, automation, migration, hosting. Rekstrarkerfið is ONE product it sells, not the whole offering; `/thjonusta` was rebuilt as the services page that day (section below). The "company sells ONE product" line in plan §1 carries a note saying so.
- **Rekstrarkerfið = the product** — ONE product for all: one shared core for every customer + per-customer custom features as AI-built/AI-maintained flagged modules, managed via the MCP connector (feature requests flow through the same AI workflow). Positioning: against fit-everyone standard ERP.
- **Canonical product core = sibling repo `C:\Users\Notandi\claude\Projects\rekstrarkerfid`** (scaffolded from the base 2026-08-22; serves rekstrarkerfi.is). Customers are generated from IT; HalliProjects retires as upstream after the transition (criteria in `company/REKSTRARKERFI-PLAN.md` §8).
- Strategy docs: `company/REKSTRARKERFI-PLAN.md` (product plan + roadmap R0–R8) and `company/REKSTRARKERFI-BUILD-INSTRUCTIONS.md` (product-site build brief); company plan §1/§4/§7 rewritten same day.

- **Owner**: Halli. Business plan: `company/ORANGE-SMILEY-PLAN.md` (offering/tiers §1, instance architecture §4, targets §7). Build brief: `company/CLAUDE-CODE-BUILD-INSTRUCTIONS.md`. Both live in the gitignored `company/` folder in this repo, alongside `COMPANY-LOG.md` and `ORANGE-SMILEY-WEBSITE-PLAN.md`.
- **Product name** (Halli, 2026-08-20): **Rekstrarkerfi** is the ASCII/technical form — domain `rekstrarkerfi.is` (registered, with IDN `rekstrarkerfið.is` to 301 to it), slugs, identifiers. **"Rekstrarkerfið"** (definite form) is what every human-facing surface says: nav lockup, page titles, ads. The COMPANY stays Orange Smiley ehf. — footer, legal pages, /um-okkur, Organization JSON-LD. Logo unchanged.
- **Provenance**: scaffolded 2026-08-09 from the HalliProjects base — now at `C:\Users\Notandi\claude\Projects\hallismiley` (folder renamed 2026-08-23) — at base rev **`562c637`** by site-factory.
- **Estate map**: `C:\Users\Notandi\claude\Projects\README.md` orients any session across all sibling repos (roles, remotes, shared policies).
- **Deploy target**: company Azure tenant (exists since 2026-08-12; company identity details in gitignored `company/COMPANY-LOG.md`) — **no provisioning or deploy without Halli's explicit go-ahead**. ENHANCEMENTS #1 is done (2026-08-19): `deploy.yml` is neutralized, so pushing the repo is safe.

## Instance roles and next steps (D-020, Halli 2026-09-21)

**This repo, run as a private ops instance, is where the business runs, not rekstrarkerfi.is.** The public orangesmiley.is only shows each seller or customer their own read-only part. The full decision is D-020 in `company/DECISIONS.md`; §4 of the company plan is amended to match.

- **rekstrarkerfi.is** (the product repo) is the shop window. Only Halli logs in, as staff. Its public signup is being closed. It captures website enquiries, which are copied one way into the private ops DB.
- **`demo.rekstrarkerfi.is`** (to build) is the demo sellers use, with Kaffibrennslan Glóð sample data, reset nightly. The handbook should point sellers there, not at this site.
- **Private ops** holds the books, invoices to customers, contracts, commission and the sales pipeline: one ledger, one invoice-number series. That is this repo's instance, run privately:
  - **now:** the local instance from D-017;
  - **after the 5.10 VSK filing:** `ops.orangesmiley.is`, on the stable release channel, behind Entra Easy Auth.
- **orangesmiley.is (public)** is the company site, plus a seller area where each seller sees their own leads, accounts and commission statements. Later it adds the R6 customer billing portal. Everything is read-only, published one way from ops. Customers log in on their own instance, never here.

**Next steps here, in order:**
1. **Get the VSK veflykill** (Halli's hand, urgent). 2026-P4 is due 5.10 and the D-017 parallel run is behind.
2. **After 5.10, stand up orangesmiley.is and ops** (about €39–55/month; needs Halli's go and an Entra app registration).
3. **Make the seller area live before seller #1 signs.** Commission statements are due by the 7th, and the tables already exist: `leads`, `customer_accounts`, `commission_*`, `sales_guides`, `market_*`.
4. **Import website leads from rekstrarkerfi.is**: weekly and by hand while there are 1–3 customers.
5. **Align the sales handbook** (`server/scripts/seed-sales-guides.js`) **with D-001's pricing**, and point its demo steps at the demo instance.

## ⚠ Do NOT run /strip-base

Halli's explicit instruction: **all base features and data models stay** — shop/cart/checkout/orders, admin + RBAC, bookkeeping suite, projects, news, party, user system, themes, i18n, Stripe, everything. Portfolio surfaces that don't fit the business (party, personal bio/news presentation) are *hidden from nav/SSR/sitemap but left functional* at their routes. Disposition of each module is decided via `ENHANCEMENTS.md` proposals with Halli's sign-off — never by deletion during the build.

## Stack (inherited — invariants, do not change)

- Express 5.x, CommonJS server. PostgreSQL via `pg` (dev DB `orangesmiley`; test DBs derived **per branch** from `orangesmiley_<branch-slug>_test` — one template + one per Jest worker, `…_w<N>_test`, `tests/workerDb.js`; user postgres/postgres).
- Vanilla JS SPA frontend — **no React/Vue/Svelte, no bundler**.
- Lucia v3 sessions. One auth system only. (The old "RS256 JWT" line was boilerplate — no JWT code exists; verified 2026-08-22.)
- Migrations are **entries appended to the array in `server/config/schema.js`** (applied by `npm run migrate` / at boot); the `NNN_name.sql` files under `server/migrations/` are reference copies. Never edit an applied entry (`/migration-new` to add).
- Consistent error envelope on all routes; pino (no console.log); typed errors → central middleware.
- Security: helmet, csrf-csrf, hpp, express-rate-limit, sanitize-html, RBAC role checks. Tighten, don't loosen.
- **Multi-theme engine:** `public/css/themes.css` + render-blocking `theme-boot.js`, `html[data-theme]` (`classic` owns `:root`; the visitor DEFAULT is `ember`/Glóð — `DEFAULT_THEME` in `themePrefs.js` and `theme-boot.js`, see Design rules). Re-brand = re-hue token *values*, keep the machinery.
- Tests: Jest integration (real Postgres, no pg mocks) + Playwright e2e. Adapt inherited specs, never delete them.
- i18n: EN + IS JSON locale files; `npm run check:i18n` before pushing translation changes. Icelandic is the primary/default visitor locale (job 2); EN mirrors it. Language-switcher choice lives in the **`locale_choice`** cookie.
- Transactional email sender = **`EMAIL_FROM`** in `.env` (set to placeholder `info@orangesmiley.is` — base default is halli@hallismiley.is, never use it here).

Full rules: `.claude/rules/stack-invariants.md` (auto-loaded). Two footguns worth repeating here: Express 5 catch-alls are `app.get('/{*splat}', …)` — keep the braces, `'/*splat'` stops matching `/`; and the Node major is pinned in THREE places (24 LTS today — the `Dockerfile` digest, ci.yml and promote.yml `node-version` move TOGETHER, and dependabot must not major-bump the base image on its own).

## Project rules

- Read-only references — never modify: `C:\Users\Notandi\claude\Projects\icelandicstore` (customer #1's live system) and `C:\Users\Notandi\claude\Projects\hallismiley` (the HalliProjects base; folder renamed from `HalliProjects` 2026-08-23). The base was temporarily writable for the 2026-08-19 base-upgrade program (13 PRs, ledger: site-factory/BASE-SYNC.md); that program is closed and the read-only rule is back in force — base writes need Halli's explicit say-so again.
- One feature branch + worktree per chunk; every chunk ends with lint + `check:i18n` + tests green, then merges to main (Halli reviews history post-hoc — his decision 2026-08-09).
- **Halli approves before the fact**: all copy and pricing (draft natively in Icelandic, mark `DRAFT`), anything in `ENHANCEMENTS.md` before implementation, and any deploy.
- Prices follow D-001 (`company/DECISIONS.md`): build fee 390/580/690 þ.kr. plus a service contract of 19/29/39 þ.kr./mán with 5/10/20 verkeiningar. They replaced the old flat 39–79 þ.kr./mán tiers, and they stay DRAFT until Halli confirms. Since 2026-09-13 they appear on the product site rekstrarkerfi.is only — never put tiers or prices back on the company site (Halli). The sales handbook still quotes the old flat tiers, which is a known gap (D-020).
- `APP_URL`/canonical host still references hallismiley.is in places — intentional until orangesmiley.is is registered; tracked in PLAN.md.
- Log surprises in `LESSONS.md` (tagged factory/base/project) so `/retro` can harvest them.

## Design rules (Halli, 2026-08-09 — binding for all UI work)

- **Banned defaults.** Fonts: Inter, Roboto, Open Sans, Arial, system-ui, Space Grotesk — not even in fallback stacks (use bare `serif`/`sans-serif`/`monospace` tails behind the self-hosted faces). Colors: purple/indigo/violet gradients, timid evenly-spread palettes, default Tailwind blue. Layout: centered hero + dual CTAs + three identical feature cards — the cookie-cutter SaaS shell.
- **Palette discipline.** One dominant color + one sharp accent + neutrals, all through the CSS token system. Here, since the 2026-09-02 earth palette (next bullet): the interface ramp is BROWN — `--gold/--gold-light/--gold-dark` = #7B5533/#9C7149/#4F3722 on `:root` (`variables.css`), re-hued per theme in `themes.css` — and orange lives on the emblem only (`--brand-mark-light/--brand-mark/--brand-mark-dark` = #EA580C/#C2410C/#9A3412, identical in every theme). The 2026-08-20 Bjart rule ("orange / black / white, orange ramp dominant") is history: re-hueing off those hexes would undo the 09-02 palette. Accent-coloured TEXT still uses `--accent-ink`, never a decorative ramp value.
- **Make unexpected, context-specific choices.** The default is **Glóð** since 2026-09-02 (Halli) — the earth palette after sundown; Bjart is the light option — Barlow voice, the 4.1 emblem mark unchanged. `classic` still owns the `:root` token set (no `data-theme`); the visitor default is `DEFAULT_THEME` in `themePrefs.js` + `theme-boot.js`, applied pre-paint. **Three themes** live in the picker (`themes.css`; cut from five on 2026-09-02 — Halli: five is too many to maintain): `ember`/Glóð (the DEFAULT: the earth palette after sundown — brown-black, sand and tan) · `classic`/Bjart (the light option: beige paper, brown ink; owns `:root`) · `midnight`/Miðnætti (high contrast: black, white ink, one bright warm accent, edges as lines). Orange lives on the emblem only (`--brand-mark-*`, identical in every theme). `light` and `mono` are retired ids — migration 094 moved their accounts to classic; the CHECK narrows in a later release (invariant 14). Halli picks themes by testing them live, so keep the picker healthy. When a row of cards is unavoidable, differentiate them (numbering, emphasis, asymmetry).

## Factory commands

`/status` · `/base-diff` (engine drift vs base HEAD) · `/test-plan` · `/audit` · `/retro` · `/e2e` · `/i18n-sync` — plus base commands `/security-check`, `/pre-deploy`, `/migration-new`. (`/strip-base`, `/clone-ui`, `/import-data` exist but do not apply to this build — see the warning above.)


## Scene engine + homepage rules (binding; the story is in `docs/HISTORY.md`)

- **Inner pages live inside Icelandic landscapes** (`public/js/scenes/` + `iceland-scene.css`); the homepage left the programme on 2026-08-22 and is the hallismiley composition: dark video hero, light Bjart site below. Media-hero surfaces are fixed dark on EVERY theme by design (`home.css`) — that is how invariant 15 is met there.
- **Photos are licensed Commons CC0/CC BY, never Halli's Facebook saves**, credited in the generated `public/assets/iceland/CREDITS.md` (footer-linked). Originals in gitignored `assets-src/iceland/`; `node scripts/build-iceland-scenes.js` regenerates renditions and FAILS if a hero AVIF exceeds 250 KB.
- **Scene assignments mean something** (`sceneDefs.js`): /thjonusta Sigöldugljúfur · /verkefni Landmannalaugar · /um-okkur glacier at blue hour · /hafa-samband Reynisfjara. `.ice-scene--band` is `min-height`, never `height`.
- **Ambience**: `/api/v1/ambience` ALWAYS answers 200 (`{available:false}` on failure); sun position client-side; sound OFF by default; everything obeys `utils/motion.js` and pauses off-screen. `landing_background` default is `video`.
- **Hero clip**: `public/assets/videos/hero-dc7df-v2.mp4` (crossfade loop, re-derive from the ORIGINAL never from v2); a new clip gets a NEW filename (the `public/` mount caches 1 h); under reduced motion / Save-Data the hero shows the poster with no autoplay; `/halli` keeps the waterfall on purpose; `e2e/navigation.spec.js` pins the filename.
- Carpentry-era copy on the home skills/stats rows and the contact page is Halli's content pass, not a bug. **All copy is DRAFT until he approves.**

## Domain map — start a feature request here

Full per-domain index (files, the rules that must hold, history links): **`docs/ARCHITECTURE.md`**. `tests/unit/architectureIndex.test.js` fails CI when a routes/controller/model/view file is missing from it.

| # | Domain |
|---|---|
| 1 | [Auth, users, RBAC, 2FA](docs/ARCHITECTURE.md#1-auth-users-rbac-2fa) |
| 2 | [Admin shell + UI kit](docs/ARCHITECTURE.md#2-admin-shell--sidebar-dashboard-surface-hiding-ui-kit) |
| 3 | [Public site + SEO](docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo) |
| 4 | [Themes, scenes, ambience](docs/ARCHITECTURE.md#4-themes-scenes-ambience) |
| 5 | [i18n](docs/ARCHITECTURE.md#5-i18n) |
| 6 | [Leads](docs/ARCHITECTURE.md#6-leads--fyrirspurnir) |
| 7 | [Markaður](docs/ARCHITECTURE.md#7-markaður--market-research-and-the-prospect-list) |
| 8 | [Accounts, commission, staff audit](docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit) |
| 9 | [Bookkeeping](docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll) |
| 10 | [Sales handbook](docs/ARCHITECTURE.md#10-sales-handbook--handbók-sölufólks) |
| 11 | [Shop (hidden)](docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface) |
| 12 | [News, projects, party (hidden)](docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio) |
| 13 | [Monitoring](docs/ARCHITECTURE.md#13-monitoring--event-logs-metrics-analytics) |
| 14 | [Self-update](docs/ARCHITECTURE.md#14-self-update) |
| 15 | [MCP](docs/ARCHITECTURE.md#15-mcp-connector) |
| 16 | [Change requests](docs/ARCHITECTURE.md#16-change-requests--breytingarbeiðnir) |
| 17 | [Content, settings, background](docs/ARCHITECTURE.md#17-content-settings-background) |
| 18 | [Uploads, media](docs/ARCHITECTURE.md#18-uploads-and-media) |
| 19 | [Email](docs/ARCHITECTURE.md#19-email) |
| 20 | [Infrastructure](docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting) |

## Doc map

- **Start here**: `README.md` (setup, scripts) · `docs/ARCHITECTURE.md` (the domain index above).
- **Rules**: this file · `.claude/rules/stack-invariants.md` (15 invariants, auto-loaded) · `docs/TESTING.md` (tiers, per-branch DBs, what CI runs) · `SECURE_SDLC.md`.
- **How it behaves**: `docs/API.md` (every mount + gate) · `docs/BOOKKEEPING-SYSTEM.md` · `docs/SELF-UPDATE.md` · `docs/mcp.md` · `docs/SALES-STAFF.md` · `docs/SLO.md`.
- **Running it**: `docs/DEPLOYMENT.md` · `RUNBOOK.md` · `docs/BOOKS-PARALLEL-RUN.md` · `docs/ACCOUNTANT-QUESTIONS.md`.
- **History + decisions**: `docs/HISTORY.md` (every programme, dated, indexed — the *why* behind the rules) · `LESSONS.md` (retro log) · `CHANGELOG.md` (release notes; keep the `## [0.1.0]` heading — `build-manifest.js` parses it) · `ENHANCEMENTS.md` (proposal queue, Halli-gated) · gitignored `company/DECISIONS.md`.
- **Frozen, banner-marked**: `PRE_LAUNCH_AUDIT.md` · `SECURITY_AUDIT_2026-04-16.md` · `SELF-UPDATE-PLAN.md`.

**Recording a chunk (since 2026-09-17)**: the write-up goes to `docs/HISTORY.md` (dated section with an `<a id>` anchor + index row); the rules it establishes go to the domain's "Rules that must hold" in `docs/ARCHITECTURE.md`, linking back; its open items go to `PLAN.md` → Status. This file changes only when a *rule* changes. `tests/unit/architectureIndex.test.js` enforces the links, the file lists and the migration citations in both directions.

## Status

Current status and open items: `PLAN.md` → Status (the migration chain end is the last entry in `server/config/schema.js`). Nothing else is recorded here.
