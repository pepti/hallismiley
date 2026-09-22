# History — Orange Smiley company site

The dated write-up of every programme that has landed on this repo, moved out
of `CLAUDE.md` on 2026-09-17 **unchanged in wording** (only a date prefix and an
anchor were added to each heading). This is where the *why* lives: the
reasoning behind the rules that `docs/ARCHITECTURE.md` lists per domain.

**How to use this file.** Append-only. When a chunk lands: its write-up goes
here (a new `## YYYY-MM-DD — title` section with an `<a id>` anchor, plus a row
in the index below); the rules it establishes go into the domain's "Rules that
must hold" block in `docs/ARCHITECTURE.md`, each linking back here; its open
items go to `PLAN.md` → Status. `CLAUDE.md` changes only when a *rule* changes.
`tests/unit/architectureIndex.test.js` checks that every link between the two
files resolves.

Which domains an entry touches is read from the `**History**:` footers in `docs/ARCHITECTURE.md`, not kept here.

## Index

| Date | Entry | Headline |
|---|---|---|
| 2026-08-09 | [Build status](#build-status) | Jobs 1–3: scaffold without strip, seven re-skin chunks, ENHANCEMENTS written and stopped for Halli |
| 2026-08-10 | [Self-update module](#self-update) | Fleet update mechanism; `config/client.json` seam; this instance is `managed` on `stable`; origin of invariant 14 |
| 2026-08-19 | [Base-sync 2026-08-19](#base-sync) | Migrations 080–083 (never the base's numbering); admin TOTP; Node 24 + Express 5; social login OFF here |
| 2026-08-21 | [Iceland scene engine](#scene-engine) | Licensed Commons photos + CREDITS.md; 250 KB AVIF budget; scene assignments; ambience always 200 |
| 2026-08-22 | [Homepage = the hallismiley composition](#homepage) | Home reverted to the base layout; hero fixed dark on every theme; 2026-09-13 hero clip swap + reduced-motion still |
| 2026-08-22 | [Harvest 1 (icelandicstore → here + base)](#harvest-1) | Migrations 087 (event logs) + 088 (MCP tokens); isolated per-branch e2e DBs; ice back-port queue |
| 2026-08-27 | [Sales-staff program](#sales-staff) | Migration 090 `sales_guides` (IS-canonical, `_en` siblings); role `solufolk`; guides seeded as drafts awaiting Halli |
| 2026-09-01 | [R1 — company-site content pass](#r1) | Brand core, homepage, /thjonusta, legacy strings, Vörustýring group; migrations 091/092 move SEEDED copy (`updated_by IS NULL` guard) |
| 2026-09-01 | [Market-research program](#market-research) | Migration 093 `market_*`; importer; named companies never in git; Halli's list/sector/source decisions |
| 2026-09-02 | [Harvest 2 (icelandicstore `601b2f2`)](#harvest-2) | 4 Jest workers; every rate limit ×5; `staticAsset.js`; `verifyImageBytes`; slug folding; `changeRequestGate` PROD switch; latest-updates card |
| 2026-09-07 | [Admin console re-shaped](#admin-reshape) | Sölustarf / Þjónusta groups; `HIDDEN_ADMIN_VIEWS` (hide, never delete); `/admin` = company overview |
| 2026-09-07 | [Leads inbox — Fyrirspurnir](#leads) | Migration 097 `leads`; `Lead.create` never throws; 730-day retention tied to `/personuvernd` §6; delete + CSV admin-only |
| 2026-09-07 | [Markaður — the prospect list](#markadur) | `/admin/markadur` over the 093 tables; the one write is shortlist → handed_to_sales/rejected, race-safe; `report_path` never a link |
| 2026-09-07 | [Customer accounts + commission](#accounts-commission) | Migration 098; scope required and fails closed; `allaccounts` permission-only; service invoices + commission events; 2FA widened |
| 2026-09-07 | [Review pass (migration 099)](#review-099) | Six high-severity fixes: rate fields, commission gate, enrolment gate, hand-off gate, payable netting, double-issue index |
| 2026-09-08 | [The three deferred items (migrations 100–102)](#migrations-100-102) | Payable is an amount; buyer party block (100); deposit is a prepayment, 2150 never debit (101); statements/payouts/clawback (102); `commissionScope` |
| 2026-09-08 | [Shared admin UI kit (ENHANCEMENTS #21)](#ui-kit) | The kit (`adminTable`, `adminPager`, `listState`…); eight defects; 2FA gate mirrored both sides; `pageTitle` mirrors `ssrMeta.js`; base PR #153 |
| 2026-09-13 | [/thjonusta = the services page](#services-page) | Company sells any SMB software; no tiers or prices on this site; `SERVICE_OFFERINGS` mirror; migration 104 rewrites two seeded guides |
| 2026-09-17 | [Docs restructure — ARCHITECTURE, HISTORY, parity test](#docs-restructure) | CLAUDE.md 776 → ~100 lines of rules; this file + `docs/ARCHITECTURE.md`; `architectureIndex.test.js`; review pass fixed 8 findings |
| 2026-09-21 | [Seller area — published one way from ops (D-020 step 3)](#seller-area) | `INSTANCE_ROLE`; migration 105 `published_*`; signed snapshot ingest; `/solusvaedi` read-only behind 2FA; built, not deployed |
| 2026-09-22 | [TEST chrome is admins only](#test-chrome-admin) | Logged-out visitors on TEST see production; `changeRequestGate` admin-only on every stack; `openToEveryone` → `testStack` |
| 2026-09-22 | [Iceland v2 — a landscape on every page](#iceland-v2) | Halli's AI-generated set replaces the Commons photos; band or card backdrop on every visitor page; no place chip; native-width renditions |
| 2026-09-22 | [orangesmiley.is go-live, public site only](#go-live) | D-020 step 2 split: public site first, ops stays local; deploy.yml by digest, production only; `APP_URL` default + baked origin → orangesmiley.is; `EMAIL_REPLY_TO` |

---

<a id="build-status"></a>
## 2026-08-09 — Build status (three jobs, in order)

- [x] Job 1 — scaffold with all features (no strip), env fixes, this file, acceptance green
- [x] Job 2 — re-skin + re-organize, merged in seven chunks: B (IS default locale) → A (orange brand) → C (business IA) → D (hide portfolio surfaces) → E (lead capture) → F (SEO/JSON-LD + a11y) → G (business-routes e2e). 2012 Jest + 109 Playwright green (2026-08-09 counts; 2026-09-11: 2647 / 178 declared — `docs/TESTING.md`).
- [x] Job 3 — `ENHANCEMENTS.md` written. **Stopped for Halli's approval — implement nothing from it until he says so.**

<a id="self-update"></a>
## 2026-08-10 — Self-update module (built 2026-08-10, six phases, merged to master `64457ef`)

The fleet update mechanism: release channel published by CI, in-app checker,
apply/verify, admin screen at `/admin/updates`. Full architecture and the
provisioning items that are NOT code: `docs/SELF-UPDATE.md`. **Upstream status
(verified 2026-08-22): the base ALREADY has the whole module** — its own PR
#134 (migration 082_system_updates, ship-dark `enabled:false` default); the
old "documented but deliberately NOT performed" claim was stale. Only
`promote.yml` (channel publisher workflow) remained orangesmiley-only; its
base PR is prepared (see COMPANY-LOG 2026-08-22).

- `config/client.json` is the per-instance module config seam (defaults < file <
  `CLIENT_CONFIG_*` env). Every future module flag should read from it.
- This instance is `managed` on `stable`: it records updates and installs
  nothing. It has no `SELF_UPDATE_TRIGGER_URL`, so it could not install one yet.
- New invariant #14 (expand/contract migrations) — self-update is why.

<a id="base-sync"></a>
## 2026-08-19 — Base-sync 2026-08-19 (the base-upgrade program)

Four waves of engine features landed on master the same day they landed in
HalliProjects (ledger: site-factory/BASE-SYNC.md 2026-08-19). The program is
CLOSED — all 13 base PRs merged and deployed, base back to read-only:

- **6A security**: transactional+locked migration runner, UPLOAD_ROOT boot
  guard, upload-path allowlists, FB auto-link takeover refusal, CSP
  frameAncestors, PG TLS default-on, log secret-scrubbing, uploaded-avatar
  owner-scoping, **admin TOTP** (migration 082_admin_totp; enrol from the
  profile), OAuth-admin refusal, social-login kill switch (**OFF here** — no
  OAuth app configured), TEST-chrome one-way clamp.
- **6B stack**: Node 24 LTS (digest-pinned), Express 5 (catch-all +
  IndexNow-route idioms fixed), CI boot smoke declares UPLOAD_ROOT+DB_SSL.
- **6C theme**: per-account UI theme as migration 083_user_theme, adapted to
  the 2-theme palette (classic/light); Appearance section in the profile.
- **6D nav tints + CI**: admin-nav 12-tint row colours (rides the existing
  admin_nav_config JSONB, no migration) + Playwright CI hardening. A ported
  CSS hunk initially hid the admin sidebar at all widths (rule appended
  outside its @media block — fixed same day, see LESSONS.md 2026-08-19).

The migration chain now ends 080_background_sections · 081_system_updates ·
082_admin_totp · 083_user_theme. NEVER adopt the base's numbering for the
same features (it uses 080/081/082 for totp/theme/system_updates).

<a id="scene-engine"></a>
## 2026-08-21 — Iceland scene engine ("Úti á Íslandi", 2026-08-21 — INNER PAGES only since 2026-08-22)

The public INNER pages live inside photographic Icelandic landscapes (Halli's
directive: the visitor should feel like they are outside in Iceland). Built in
three chunks on master; the engine is `public/js/scenes/` + `iceland-scene.css`.
**The homepage left the program on 2026-08-22**: Halli rejected the hard
cutovers between the home scene bands and reverted the home page to the
original hallismiley composition (see next section). The engine, ambience and
inner-page scenes are untouched.

- **Photos are licensed, never Halli's Facebook saves** — those were the mood
  board only. Shipped photos come from Wikimedia Commons (CC0/CC BY), credited
  in the generated `public/assets/iceland/CREDITS.md` (linked from the footer —
  CC BY requires it). Originals in gitignored `assets-src/iceland/` +
  `SOURCES.json`; `node scripts/build-iceland-scenes.js` regenerates all
  renditions/manifests and FAILS if a hero AVIF exceeds the 250KB LCP budget.
- **Scene assignments mean something** (sceneDefs.js): /thjonusta =
  Sigöldugljúfur (many falls, one river); /verkefni = Landmannalaugar (brand
  as landscape); /um-okkur = glacier at blue hour; /hafa-samband =
  Reynisfjara. (home/tiers/steps defs remain for the dormant home scenes.)
  Three themes grade the same photos via `--scene-*` tokens (Miðnætti =
  the hardest cut, for contrast).
- **Live ambience, on by default**: `/api/v1/ambience` proxies Open-Meteo
  (10-min server cache, ALWAYS 200 — failure is `{available:false}` and static
  scenes); real sun position computed client-side (sun.js — midnight sun falls
  out of the math); weather particles + WebGL aurora (dark themes at real
  night, CSS fallback); synthesized waterfall sound OFF by default. Toggles in
  the ThemeSwitcher (`ws_ambience`, `ws_ambience_sound`); everything obeys
  `utils/motion.js` (reduced-motion + Save-Data) and pauses off-screen/hidden.
- **landing_background mode 'video' is the hero default again** (migration
  089 reverted 086's one-day scene default); scene/gradient/photo/plain
  remain admin-selectable. SPA navigation uses View Transitions where
  supported (router.js); `.view` fadeIn is reduced-motion-gated and
  suppressed during VT.

<a id="homepage"></a>
## 2026-08-22 — Homepage = the hallismiley composition (2026-08-22)

Halli's call: revert all the way back to the Halli Smiley homepage layout and
iterate from there — **dark video hero, light Bjart site** below it (the
clip was the waterfall until 2026-09-13; see the next paragraph).
`HomeView` renders hero → news → projects → skills → stats → contact →
footer again; the business `_tiers()`/`_steps()` sections (and the scene
band mount) are the dormant methods now, kept with their i18n for the coming
content pass. The media-hero surfaces are fixed dark on EVERY theme by design
(home.css — the veil's bottom stop alone hands off to the themed page), which
satisfies invariant 15 by construction. Content still wearing carpentry-era
copy (skills/stats rows, Unsplash discipline placeholders, contact page) is
Halli's content pass, not a bug.

**Hero clip swapped 2026-09-13** (Halli): the waterfall gave way to
`public/assets/videos/hero-dc7df-v2.mp4`, encoded from his
`pictures/iceland-originals/done videos/imagine-dc7df.mp4` (H.264 CRF 21,
audio and embedded cover art stripped, faststart; 1168×768, 5 s, 2.4 MB).
The source is a continuous push-in, so a plain loop snapped from full zoom
back to the wide shot every cycle; v2 is a **crossfade loop** — source frames
24–144, with the last second dissolved into the first (the filter graph is in
the review PR's description; re-derive from the ORIGINAL, never from v2).
`hero-dc7df-v2-poster.jpg` is v2's first frame. The generic `public/` mount
caches 1 h, so a new clip gets a NEW filename rather than overwriting.
**The hero obeys `utils/motion.js`**: under reduced motion or Save-Data it
renders without `autoplay`, with `preload="none"`, and shows the poster;
`_initHeroVideo` follows a live OS-setting change both ways. The hidden
`/halli` page (`HalliView`) still plays the waterfall on purpose.
`e2e/navigation.spec.js` pins the clip's filename and the still state.

<a id="harvest-1"></a>
## 2026-08-22 — Harvest 2026-08-22 (icelandicstore → here + base)

Five chunks merged on master + five base PRs (#136–#140); full ledger entry in site-factory/BASE-SYNC.md. Highlights here: Tier-1 fixes (cached-user, memory-alert, loud mail + EMAIL_ALLOWLIST, nav-saver races, CORP brand exemption, role-SET 2FA/OAuth gates via utils/adminRole.js); ISOLATED per-branch e2e DBs (e2e/lib/dbUrl.js — local e2e used to write into the dev DB); status-token completion + chartTheme.js + invariant 15; Admin → Monitoring (event_logs = migration 087, beacon, /admin/monitoring); MCP connector (mcp_tokens = 088, /admin/mcp, ships dark behind MCP_ENABLED) = ENHANCEMENTS #13 approved+implemented. Migration chain now ends 087_event_logs · 088_mcp_tokens. **HalliProjects is read-only again.** Ice back-port queue (when ITS window opens): role-SET gate fix, /auth/session totp_enabled.

<a id="sales-staff"></a>
## 2026-08-27 — Sales-staff program (2026-08-27 — Handbók sölufólks)

Halli is hiring human salespeople; they log in on the site and work from the
handbook. Built in four chunks on master, operator guide: `docs/SALES-STAFF.md`.

- **Data/RBAC**: `sales_guides` (migration 090 — IS-canonical + `_en` siblings,
  the INVERSE of the news `_is` convention) + seeded non-system role
  **`solufolk`** holding the new view id **`handbok`**. Read = requireView;
  edit/drafts = admin/moderator; delete = admin. Every guide response
  `no-store`; nothing public. The sanitize fix that rode along: `body_is`/
  `body_en` joined RICH_TEXT_FIELDS (news IS bodies were being tag-stripped —
  LESSONS.md 2026-08-27).
- **UI**: `/admin/handbok` — four numbered sections (grunnur/sala/þjónusta/
  vara), reader + overlay editor, per-section reorder; `AdminView` forwards
  dashboard-less users to their first visible view, so sales users land there
  with a one-item sidebar. Shared sanitizer extracted to
  `public/js/utils/sanitizeHtml.js` (ArticleView uses it too).
- **Onboarding a hire** (no code): create in `/admin/customers` (set-password
  email) → add to `solufolk` in `/admin/roles`.
- **Content**: `server/scripts/seed-sales-guides.js` seeds 14 Icelandic
  guides as DRAFTS (idempotent). **Awaiting Halli: review + publish each in
  the editor — sales staff see nothing until he does.** Prices inside guides
  carry DRÖG per the standing rule.
- **Agents**: Söluþjálfari (`soluthjalfari.md`, handbook content + proposals)
  and Sölustjóri (`solustjori.md`, sales ops) joined the AI staff; shared log
  `Projects\SALES-LOG.md`.
- **Proposals awaiting Halli**: ENHANCEMENTS #14 (in-app AI sales assistant),
  #15 (guide media), #2 addendum (leads view for solufolk). Flagged to Halli
  in COMPANY-LOG: plan §6 ("sole human employee, no salaries 2 years")
  contradicts hiring — his call.

<a id="r1"></a>
## 2026-09-01 — R1 — company-site content pass (2026-09-01, five chunks on master)

Halli's directive: this is the COMPANY site of an AI-driven software company;
Rekstrarkerfið is a product it sells, not the site's identity. **All new copy
is DRAFT awaiting his approval — he edits it in place via the inline editors.**

- **A, brand core**: nav lockup is ORANGE SMILEY + descriptor (`nav.brandTagline`);
  SSR business-route titles suffix "— Orange Smiley"; `og:site_name`, static
  head, PWA name. Hidden portfolio routes keep "Halli Smiley" ON PURPOSE.
- **B, homepage**: hero/skills/stats/discipline fallbacks are company copy and
  all four are `{en,is}` now; new `_products()` section (one card →
  /thjonusta, grid takes a second product); news/projects links no longer
  point at hidden surfaces. `_tiers()`/`_steps()` stay dormant.
- **C, /thjonusta**: products page — h1 is the product, the tier matrix is a
  section under it (`thjonusta.tiersTitle` = the page's old h1). Moves to
  rekstrarkerfi.is at R2; comment in the view says so. **Superseded
  2026-09-13** — see the services-page section below.
- **D, legacy brand**: ContactView defaults, its footer (5 business routes,
  /personuvernd), the 7 server email strings, pdfService fallback, and a full
  TermsView rewrite (IS-first, company as legal entity).
- **E, admin**: new **Vörustýring** sidebar group = updates + monitoring + mcp
  (ids untouched → RBAC/parity unaffected; saved layouts keep their own order,
  Reset adopts the new one). Seed of the fleet console (R3–R8).
- **Migrations 091 + 092 matter**: `home_skills`/`home_stats` and all six
  `contact_*` rows are SEEDED (007/017/030/036-038), so code fallbacks never
  render on a real instance — copy had to move in the DB too. Both guard on
  `updated_by IS NULL` (seeds leave it null, contentController stamps the
  admin id), so admin-written copy survives and re-runs are no-ops.
- Out of scope, deliberate: hallismiley.is canonical/robots/sitemap hosts
  (domain cutover), the MCP instance string, Product-schema brand on the
  hidden shop.

<a id="market-research"></a>
## 2026-09-01 — Market-research program (2026-09-01 — Markaðsstjóri)

Halli's ask: find the ~100 Icelandic companies most likely to buy
Rekstrarkerfið, judged from their annual accounts, and map the sites that
publish Icelandic company financials. A new agent, **Markaðsstjóri**
(`Projects\agents\markadsstjori.md`, log `Projects\MARKADS-LOG.md`), owns it
with a full marketing charter (market picture, prospect universe + scoring,
source map, competitor/incumbent tracking, channel briefs).

- **Data**: migration **093_market_research** — `market_companies` (one row
  per company, `list_type` smb|large, workflow `status`), `market_financials`
  (per company per fiscal year; `admin_cost_ratio` is a GENERATED column =
  skrifstofu- og stjórnunarkostnaður / tekjur, Halli's fit signal),
  `market_stats` (Hagstofa sizing aggregates). Read in the app since
  2026-09-07 by **Markaður** (`/admin/markadur`, view id `markadur` — see the
  chunk-C section below); `market_stats` still has no screen.
- **Importer**: `npm run market:import -- company/markadur/market.json
  [--dry-run]` (`server/scripts/market-import.js`) — validates every row, one
  transaction per file, idempotent upserts by kennitala / (company, year) /
  stats key; `status` is only overwritten when the JSON row carries one.
  Test: `tests/integration/marketImport.test.js`.
- **Staging + PDFs live in gitignored `company/markadur/`** (`market.json`,
  `arsreikningar/<kennitala>-<year>.pdf`, `report_path` stored repo-relative).
  Named companies never go into a git-tracked file; contact persons are never
  recorded anywhere.
- **Decisions (Halli, 2026-09-01)**: two lists — smb best-fit (~100, 25 deep,
  10 with reports) + large watchlist; sectors smásala 47 / heildsala 46 /
  iðnaður+verktakar 41–43 / þjónusta+ferðaþjónusta, plus the admin-cost ratio
  across all; size band is DATA-DRIVEN (he confirms the proposal before it
  filters); free/public sources only — Skatturinn ársreikningaskrá downloads
  (free per Halli), Keldan public figures first; the top-10 download batch is
  listed to him before it runs.
- Migration chain now ends 093_market_research.

<a id="harvest-2"></a>
## 2026-09-02 — Harvest 2 — icelandicstore `601b2f2` → here (2026-09-02, five chunks on master)

Halli: "add useful updates from icelandic store". Two surveys sorted ice's 33
post-08-22 commits; customer-specific work (Regla, Shopify import, AI order/
shelf vision, multi-store, adoption analytics, `made_to_order`) was NOT ported.
Ledger: site-factory/BASE-SYNC.md 2026-09-02. Everything below is queued for the
base (hallismiley is read-only).

- **Tests/CI** (`1536fb2`): Jest runs **4 workers, one database each** —
  `tests/workerDb.js` derives `orangesmiley_w<N>_test` (worker id BEFORE the
  `_test` suffix so the safety guard holds); globalSetup migrates ONE template
  (`orangesmiley_tmpl_test`) in a child process and clones it per worker. Full
  suite 112 s vs 8m20s serial. Never add an `afterAll pool.end()` (fire-and-
  forget writes). **CI had never run**: `ci.yml` triggered on `main`, the branch
  is `master` — fixed, but **Actions is also disabled at repo level** (see the
  next section); plus weekly cron, Jest transform cache, dependabot
  `rebase-strategy: disabled` + docker ecosystem. Ice's `main-gate` job was
  deliberately NOT ported (this repo merges locally; deploy is dispatch-only).
- **Observability** (`7cf7b1d`): `query()` now feeds the DB circuit breaker
  (connectivity errors only) and `db_query_duration_seconds`; httpMetrics feeds
  the error-rate alert; `/metrics` refreshes the pool gauges. The client
  rate-limit toast ignores the error beacon (feedback loop) and stays silent
  before the dictionary loads.
- **Limits/uploads/slugs** (`dcbc501`): **every rate limit ×5, auth included**
  (Halli 2026-09-02): global 2000/15 min, writes 450, login 50, signup 75, reset
  25, checkout 50, beacons 100/300. Untouched: the /hafa-samband lead limit,
  MCP, party, self-update, discount. Static-asset exemption =
  `server/utils/staticAsset.js` (location-only, never by extension; root files
  /favicon.svg, /manifest.json, /og-image.jpg; catch-all 404 reuses its regex).
  `middleware/verifyImageBytes.js` sniffs magic bytes behind EVERY image upload
  (mismatch → file unlinked, 400; video/PDF untouched). `utils/slug.js` folds
  ð/þ/æ/ö — GENERATION paths only (news, sales guides, party keys, collections
  form via the ESM twin `public/js/utils/slug.js`); stored slugs never change.
- **i18n + admin** (`352b977`): `check:i18n` now also scans every
  `t('literal')`/`labelKey` in public/js against en.json (a missing key fails
  CI). `loadLocale()` dispatches **`localechange`** for components mounted
  outside `#app` (widget, theme switcher). Change-request widget has a **PROD
  switch**: `change_requests.enabled` setting (Admin → Feedback, admin only),
  `changeRequestGate` = non-prod app-env OR (switch on AND admin), **404 not
  403**; the widget then mounts for admins only, without the TEST chrome. Admin
  sidebar is a capped scroll container (`--nav-h` token) with the tint popover
  flipping above near the bottom. `stock <= 0` (negative = still sold out).
- **Latest updates card** (`144559d`): `server/scripts/generate-changes.js`
  stamps the last 30 non-merge commits into gitignored `server/changes.json` on
  the BUILD HOST (ci.yml docker job + deploy.yml, `fetch-depth: 50`); opt-out
  per commit = `[internal]` in the subject or a `Customer-visible: no` body
  line. `GET /api/v1/system/changes` (admin) sits ABOVE the self-update module
  gate so instances shipping self-update OFF still get the card. Also landed
  the **missing `admin-monitoring.css`** — H4 ported the view without its
  stylesheet.

<a id="admin-reshape"></a>
## 2026-09-07 — Admin console re-shaped for the business (2026-09-07, chunk A)

Halli: the inherited admin looked like a webshop back office and had "nothing
to do with Orange Smiley as a company". Decisions: hide the retail screens
(never delete), keep payroll, `/admin` becomes a company overview.

- **IA** (`AdminSidebar.js` `ADMIN_NAV`; group KEYS unchanged, one new key):
  Yfirlit · **Sölustarf** (`staff`: handbok, customers — leads + markadur
  join in chunks B/C) · Bókhald (payroll visible, pos hidden) · **Þjónusta**
  (`service`, new: feedback = change requests, the support product) ·
  Vörustýring · Vefur (analytics; background hidden) · Stillingar · Verslun
  (`shop`, last — every line hidden). Saved per-admin layouts keep their old
  placement until that admin hits Reset (same precedent as 2026-09-01).
- **Hide mechanism** = `public/js/components/adminSurface.js`
  `HIDDEN_ADMIN_VIEWS` (products, collections, bins, orders, discounts,
  sales, pos, background), the admin twin of `server/config/publicSurface.js`.
  Applies only to accounts holding `'*'` (`auth.hasAllViews()`); a role
  granted only `orders` still sees it. Routes stay live, ids stay in
  `ADMIN_VIEW_IDS` and grantable. The eye toggle in edit mode writes
  `revealedItems` into the layout blob (`adminNavRoutes.js` bounds it like the
  other flag arrays); Reset re-hides. `tests/unit/admin-surface-parity.test.js`
  keeps the set ⊂ `ADMIN_VIEW_IDS`. An all-hidden group renders no header.
- **Dashboard**: `AdminView` = cards over EXISTING endpoints, each gated on
  the view/role its endpoint demands (books 30 days · open change requests ·
  error count · latest changes via `components/ChangesList.js`, shared with
  Monitoring · handbook counts · users + pending). The projects board is
  `AdminProjectsView` at unlisted `/admin/projects` (gate: `dashboard` view or
  editor). CSS `admin-dashboard.css`, tokens only.
- Copy (DRAFT, Halli): `admin.navGroup.staff` → Sölustarf, `admin.nav.feedback`
  → Breytingarbeiðnir, `adminGeneral.store*` → company wording,
  `adminDashboard.*`. `e2e/admin-nav-colors.spec.js` tints `invoices` now
  (orders is hidden in view mode); new `e2e/admin-surface.spec.js`.

<a id="leads"></a>
## 2026-09-07 — Leads inbox — Fyrirspurnir (2026-09-07, chunk B; ENHANCEMENTS #2 + addendum)

Every `/hafa-samband` submission is now a row as well as an email. **Migration
097_leads** (095/096 are the books branch's — never renumber) creates `leads`
(PII: name, email, company, phone, platform, message; workflow: `status`
new|contacted|won|lost, `owner_user_id`, `contacted_at`/`contacted_by` =
FIRST human touch, never restamped, `note`) and appends `leads` to the seeded
`solufolk` role (append-only, `@>` guarded — `roles` has no `updated_by`).

- `server/models/Lead.js` — `create()` NEVER throws (contactController fires
  it alongside the email; a DB failure logs the submission id only). Shape =
  EventLog. `server/services/leadsCleanup.js` prunes daily at
  `LEAD_RETENTION_DAYS` (default **730** = the 24 months `/personuvernd` §6
  now promises; `tests/unit/leadsRetention.test.js` pins it). All statuses
  prune alike.
- `/api/v1/admin/leads` (`leadsRoutes.js`): read + PATCH status/note/owner =
  `requireView('leads')` (the seller's own work product; `validateLeadUpdate`
  whitelists the body — submission fields are immutable); DELETE (= erasure)
  and `/export.csv` (bulk PII, `csvCell` formula-neutralised) = admin. Every
  response `no-store`.
- UI `/admin/leads` (`AdminLeadsView`, `admin-leads.css`) in Sölustarf after
  Handbók: chips with counts, search, "Mínar", row → message + actions.
  `/admin` overview has a Fyrirspurnir card (new count). A `solufolk` user's
  sidebar is now Handbók + Fyrirspurnir (`e2e/sales-handbook.spec.js`
  asserts 2; the sales user helper moved to `e2e/lib/salesUser.js`).
- **`/personuvernd` §3 + §6 rewritten** (IS + EN, DRAFT for Halli): the old
  text said the enquiry was NOT stored. The file's header rule stands —
  change the retention number and §6 together.
- Not done on purpose: no MCP leads tool (separate sign-off, #13 note), no
  automatic per-seller routing (accounts, #17). Migration chain now ends
  097_leads.

<a id="markadur"></a>
## 2026-09-07 — Markaður — the prospect list (2026-09-07, chunk C; ENHANCEMENTS #16)

The 093 research tables finally have a screen. **No migration.**

- `/api/v1/admin/markadur` (`marketRoutes.js` + `marketController.js`): list =
  `market_companies c` ⋈ `LATERAL` latest `market_financials` (→ `latest`
  object, `null` without figures), filters `list_type/sector_group/status/
  tier_fit/q` (name ILIKE or kennitala prefix), sorts from a fixed map
  (`fit_score` default desc · `admin_cost_ratio` · `revenue` · `employees` ·
  `name` · `updated`; anything else 400), `NULLS LAST`; detail = company +
  every year desc + `sources` + `fit_notes` + `summary` + `report_path` as a
  string. Reads = `requireView('markadur')`; every response `no-store`.
- **The one write**: `PATCH /:id/status` with `{status: handed_to_sales |
  rejected}` (`validateMarketStatus`), admin/moderator, only FROM `shortlist`
  — `UPDATE … WHERE status='shortlist'` makes it race-safe, anything else is
  409. Audit = pino info `{companyId, from, to, userId}` + the 093
  `updated_at` trigger (`researched_by` is the importer's field, not reused).
- UI `/admin/markadur` (`AdminMarketView`, `admin-markadur.css`) in Sölustarf
  after Fyrirspurnir: four selects + search, sortable headers with
  `aria-sort`, money in m.kr., ratio in %, row → drawer (`role=dialog`, ESC /
  backdrop, focus returns to the row) with facts, summary, notes, all years,
  sources, and **`report_path` as `<code>` text — never a link** (gitignored
  PDFs under `company/`). Hand-off buttons render for editors only and are
  enabled only on a shortlisted row.
- `markadur` is **not seeded onto `solufolk`** — Halli grants it in
  `/admin/roles` when the team should see the shortlist (`e2e/markadur.spec.js`
  asserts the sales user is bounced; flip that test when he does).
- Importer caveat (header of `market-import.js`): a JSON row that carries
  `status` overwrites a hand-off on re-import — export without it.
  `tests/integration/market.test.js` pins the safe case.

<a id="accounts-commission"></a>
## 2026-09-07 — Customer accounts + commission (2026-09-07, chunk D; ENHANCEMENTS #17 + #18)

Halli: "Do the proposals." **Migration 098_customer_accounts** (pure expand):
`customer_accounts` (one row per customer, ONE owning seller — commission
follows `owner_user_id`), `users.github_login`, `staff_audit_log`
(books_audit_log's shape + the same immutable trigger; closed vocabulary in
`server/services/staffAudit.js`), `commission_events` (seller + rate
SNAPSHOTTED per invoice, `UNIQUE(invoice_id)`), and the seeded roles
`solumadur` (handbok, leads, accounts, commission) and `verktaki` (handbok,
accounts, allaccounts). Chain now ends **098**; the books branch's 095/096
sit before 097 in numeric order (already applied on the dev DB).

- **Scope in both layers**: `server/auth/accountScope.js` (after
  `requireView`) → `{all:true}` for `'*'` or the `allaccounts` permission,
  else `{ownerId}`; `CustomerAccount` takes `scope` as a REQUIRED argument of
  every method and fails closed (throws without one). A foreign id is a 404,
  never a 403. `allaccounts` is a **permission-only view id**
  (`PERMISSION_VIEW_IDS` in `adminViews.js`): grantable, no sidebar line — the
  parity test subtracts it; the role editor shows it under "Heimildir".
- **Lifecycle** = `CustomerAccount.TRANSITIONS`; a skip is 409; every write
  (create/update/status/owner/provision-request/commission) lands in
  `staff_audit_log` with the SAME client. Role grant/revoke, customer
  invitation and user disable/enable hook the log best-effort (`recordSafe`).
  Admin reads it at `/api/v1/admin/audit` (a section on `/admin/monitoring`);
  the account's own trail at `/api/v1/admin/accounts/:id/audit`.
- **2FA widened**: `utils/adminRole.js userHoldsView(…, 'accounts')` →
  `user.accounts_holder` at login → `mfaService.isProtected/shouldEnrol`
  treat it like admin (`tests/unit/mfaProtected.test.js`).
- **Service invoices** (#18): `invoiceService.createServiceInvoice` — build
  50%/50% (D-005), recurring month (override for pro-rating), overage; ex VSK
  + 24%; same counter/lines/journal/books-audit path as orders, account row
  locked; then `Commission.recordForInvoice` (15% build / 10% recurring,
  D-003; overage none). Route `POST /api/v1/admin/bookkeeping/invoices/
  service` (admin). Report `/api/v1/admin/commission` (`requireView(
  'commission')` + scope): per seller per month, **payable = invoice paid in
  full** (earned on receipt); CSV.
- **UI**: `/admin/accounts` (list + create overlay; admin picks the owner),
  `/admin/accounts/:id` (lifecycle buttons, details form, admin-only owner
  change + "Gefa út reikning", commission events, audit trail),
  `/admin/commission`; Markaður's drawer gains "Stofna viðskiptareikning" =
  the #16 hand-off in one transaction. All in Sölustarf; `admin-accounts.css`.
- Not built (plan): GitHub teams/rulesets/drift script (#19), verkeiningar
  metering (#20), payout marking / clawback / tail automation, the seller
  agreement itself. #17–#20 now exist in `ENHANCEMENTS.md`.

<a id="review-099"></a>
## 2026-09-07 — Review pass on the 2026-09-07 admin work (migration 099)

Halli asked for the day's work to be reviewed and the findings fixed before it
stood. Three reviewers (security, money/bookkeeping, frontend) went over chunks
A–D; six high-severity defects were confirmed and fixed on `review/admin-fixes`,
each with a regression test that fails on the merged code:

- **A seller could set their own commission rate.** `build_rate_bp` /
  `recurring_rate_bp` were in the create/update whitelist for every `accounts`
  holder. `stripRateFields()` in `accountsController.js` drops them for anyone
  but an admin — silently, because a seller has no business being told the
  field exists.
- **Commission figures leaked past `requireView('commission')`.**
  `GET /accounts/:id/commission` was gated on the `accounts` view alone, so the
  `verktaki` role (accounts + allaccounts) read every seller's earnings. Both
  views are required now.
- **The 2FA widening was unreachable.** `mfaService.protectedRole` covered
  `accounts` holders, but both enrolment endpoints still tested
  `user.role !== 'admin'` — the users the gate newly protected were the only
  ones who could not enrol. `isEnrolmentEligible()` now asks the same predicate
  the gate does.
- **The market hand-off was a second, ungated door onto `market_companies`.**
  Creating an account from a market row never checked that row's status, while
  the sanctioned `PATCH /markadur/:id/status` is admin/moderator AND
  shortlist-only. `CustomerAccount.create` now requires `shortlist` under the
  same `FOR UPDATE`; not-eligible answers 404, so ids cannot be enumerated.
- **`payable` ignored credit notes and refunds.** It compared `amount_paid`
  against `total_gross`, so a fully refunded invoice still paid commission on
  money the company had given back. One `PAID_IN_FULL` fragment now nets
  refunds and credits, shared by `events` and `report`.
- **Service invoices could be double-issued.** Two clicks issued two statutory
  documents, and 505/2013 allows no deletion — only a credit note.
  **Migration 099_invoice_account_link** adds `account_id`, `service_kind` and
  `service_period` to `invoices` with two partial unique indexes (one build
  half per account; one recurring invoice per account per month; cancelled rows
  excluded, overage deliberately not deduplicated — it is metered). The INSERT
  maps 23505 to a 409 telling the user to credit the first one. The client
  disables the submit button too, but the index is the guarantee.

Also in the pass: `role.updated` joined the staff-audit vocabulary (widening a
role's views is the most security-relevant role event there is), `q` joined the
log URL scrubber and `app.js` now scrubs request URLs in its own success/error
lines, the leads CSV pages to the end instead of truncating at 200,
Markaður's scraped `website`/`sources[].url` go through a `https?:` check
before landing in an `href`, the six new views got `destroy()` and
stale-paint sequence guards, unmapped enum values print themselves instead of
a confidently wrong label, `--overlay` became a real per-theme token, and the
neutral status chips moved to `--text-secondary` (`--text-muted` on
`--bg-hover` is 4.24:1 on Glóð, under 4.5).

**Migration chain now ends 099_invoice_account_link.** Deferred, and Halli's
call rather than code's: `customer_accounts` has no address columns, so a
service invoice can never be Peppol-exported (the 095 emitter needs a party
block); the build deposit is booked as revenue on issue rather than as a
prepayment, which is a question for the accountant; and commission payout
tracking (marking a statement paid, clawback on a later credit note) is still
unbuilt.

<a id="migrations-100-102"></a>
## 2026-09-08 — The three deferred items, built 2026-09-08 (migrations 100 – 102)

Halli: "Have my agents build solutions to these 3 things" — the items the
2026-09-07 review pass had left as his call. Bókari designed both bookkeeping
pieces and ruled on the accounting question; Sölustjóri designed the third and
found a live money bug on the way.

- **The commission payability bug (merged first, no migration).** Sölustjóri
  found that the 099 `PAID_IN_FULL` fix was still wrong, and that the
  regression test written for it hid the hole by issuing a REFUND only.
  Undoing a sale properly is TWO facts — a credit note for the document, a
  refund for the cash — and with both, `paid - refunded >= gross - credited`
  reads 0 >= 0 and paid FULL commission on a sale that no longer existed. An
  invoice never paid at all and fully credited read the same way, vacuously.
  `PAID_IN_FULL` gained an explicit `surviving gross > 0` guard, and payable
  became an AMOUNT (`PAYABLE_NOW_ISK`) rather than an all-or-nothing flag:
  credit half the invoice and half the commission was never earned.

- **Migration 100 — the buyer party block.** 098 gave the company a customer
  of record and 095 gave an invoice a structured party block; nothing
  connected them, so `createServiceInvoice` wrote `customer_address = ''` and
  `customer_country = 'IS'` as literals. Two consequences, and the REPORTED
  one was the lesser: no service invoice could be Peppol-exported, and the PDF
  of every service invoice printed **no buyer address at all** — a defect in
  the statutory document. Seven party columns on `customer_accounts` +
  `customer_vat_number` (BT-48) on `invoices`; the account holds the CURRENT
  value, the invoice keeps the value AS AT ISSUE (Reglugerð 505/2013 gr. 9).
  Statement 3 brings the 095/099/100 columns INSIDE the 072 immutability
  trigger’s frozen tuple — otherwise the snapshot argument is only half true.
  New `server/services/bookkeeping/peppol/party.js` is ONE rule with two callers (the account screen and
  the export preflight), so "ready" and the 409 can never disagree;
  `invoice_ready` (statutory minimum: a kennitala) gates ISSUING and
  `peppol_complete` gates only the export, mirroring Setting’s own split.
  **Behaviour change**: an ORDER-path invoice can no longer be UBL-exported —
  `pickCustomer` has no kennitala to record, so BT-49 (mandatory in Peppol)
  can neither be given nor derived. Every UBL document we had ever emitted was
  missing it while claiming BIS 3.0 conformance. The shop is hidden here and
  nothing transmits, so nothing breaks; a B2B order path would need to capture
  a kennitala.

- **Migration 101 — the build deposit is a prepayment.** D-005 already said
  "the deposit sits as a customer prepayment until then"; only the first half
  of that sentence was implemented, so revenue and equity were overstated by
  the deposit net between signing and go-live (l. nr. 3/2006 11. + 26. gr.).
  Lykill **2150 Fyrirframinnheimtar tekjur**, plus a release entry
  (`source_type = revenue_recognition`) that issuing the final build half
  posts in the same transaction. **VSK does not move**: under l. nr. 50/1988
  13. gr. the deposit is skattskyld velta in the period its invoice is dated,
  so 2150 carries `vat_code = output_24` and `vatService.ADVANCE_TURNOVER_
  ACCOUNTS` counts it in reitur A — deferring the net without that drops box A
  while box D keeps the 24%, which is worse than the original bug. Crediting a
  RELEASED deposit goes against `recognised_into_account`, never 2150; the
  standing invariant is that **2150 never goes debit**. Nothing to restate:
  no deposit invoice exists anywhere and 2026-P4 has no sales.
  `docs/ACCOUNTANT-QUESTIONS.md` §11 asks the accountant to confirm the account
  code and answer 25. gr. (áfangaaðferð) before a build straddles áramót.
  D-005 carries an implementation addendum.

**Migration chain now ends 101_books_deferred_revenue** (100 → 101).

- **Migration 102 — commission statements, payouts and clawback.** Halli
  decided the open question on 2026-09-08: clawback **nets against future
  statements for 12 months and the company never invoices a seller for cash**.
  Recorded as **D-019** amending D-003, with contract clause 5.3 split in two
  (churn creates no claim; a credited-and-refunded sale is recomputed and set
  off) and `[[ENDURGREIÐSLA_MÁNUÐIR]]` set to 12. D-019 is not a reversal:
  D-003’s "no clawback" is about CHURN and bad debt, and is silent on money
  the company did receive and later gave back.

  The unit is the seller-month STATEMENT over a running balance —
  `Σ payable_now(event) + Σ adjustments − Σ payouts`. Payability is DERIVED,
  so pinning events to a payout would need un-pinning; clawback is simply that
  equation going down. Two properties carry the design: the windows are **set
  differences, not date ranges** (global unique indexes on `adjustment_id` and
  `payout_id`), so a late payment, a backdated payout or a skipped month lands
  on the NEXT statement rather than falling between two; and **no statement is
  ever reopened**. The arithmetic is a CHECK constraint, not a convention, so a
  composer bug fails the INSERT instead of producing a statement someone
  invoices against. Statements, lines, payouts and adjustments are append-only
  on `books_forbid_any_mutation`; only `amount_paid_isk` moves, being a counter.

  **A narrowing security fix rode along**: the commission routes used
  `accountScope`, which grants all-access to the `allaccounts` permission —
  while `adminAccountRoutes` states the opposite intent in its own comment. New
  `server/auth/commissionScope.js` honours only a true admin, so a hand-granted
  `allaccounts` + `commission` role can no longer read every seller’s earnings.

  `users.payee_kind` forks the payment: a **contractor** is a verktakagreiðsla
  against their own invoice; an **employee** is gross pay that must go through
  payroll (a `bank_transfer` is refused 409, because withholding is the payroll
  module’s job); **internal** — Halli owning his own accounts — is an
  attribution that is structurally unpayable. Every write is hard admin: a
  seller must never generate their own statement or record their own payout.

**Migration chain now ends 102_commission_settlement** (100 → 101 → 102).

**Still Halli’s, not code’s**: the lawyer on whether netting-only set-off is
enforceable without an express repayment right (clause 5.4 is DRÖG); Bókari on
whether a written-off balance is a taxable benefit to the seller and a
deductible loss to the company, plus the verktakamiði questions in the design;
and the accountant on `docs/ACCOUNTANT-QUESTIONS.md` §11. **Not built, by
design**: the 6-month tail in contract clause 4.3 has no code behind it —
`recordForInvoice` snapshots the owner at issue, so an owner change moves all
future commission immediately. Until it is built the tail is a monthly
`manual_credit` adjustment; it is worth its own proposal.

<a id="ui-kit"></a>
## 2026-09-08 — Shared admin UI kit (2026-09-08, ENHANCEMENTS #21 — merged `ecd85f5`, upstreamed as base PR #153)

Halli asked why LedgerLink's admin screens lacked affordances icelandicstore has
had since June. Six read-only comparison sweeps answered it, and the answer was
structural rather than a missed harvest:

- **LedgerLink was scaffolded from `hallismiley`, not from here.** site-factory's
  `DEFAULT_BASE` is the base, so work landing only in an instance reaches no
  future scaffold. The 08-22 and 09-02 harvests took infrastructure and
  correctness and skipped the **affordances**, so the base never got them either.
- **No repo in the estate had a shared admin UI layer.** ice hand-rolls 5
  near-identical table implementations; this repo had ~35 admin tables of which
  **4** sorted; LedgerLink's three new screens hand-rolled everything and its
  design gate then found 23 issues, 3 High.
- ⚠ **The ice checkout is 141 commits stale** (parked on `fix/pos-vat-rate`, 207
  dirty entries of real local-only work). Read it with
  `git show origin/main:<path>` @ `b3bb35d`. **Never check that tree out.**
- **The harvest is NOT one-directional.** Our books module is ~14,800 lines and
  is a system of record; ice's is a ~2,500-line reporting veneer whose screens
  say so on their face and whose `createExpense` is wired only to the seed
  script. **On books we are upstream.** Ice leads on the shop floor only.

**The kit** (`utils/debounce.js`, `utils/localPref.js`, `utils/listState.js`,
`utils/pageTitle.js`, `components/adminTable.js`, `components/adminPager.js`,
`css/admin-kit.css`, `format.formatRelative`). Every module = pure functions
returning HTML strings + a `bind*()` attaching **ONE delegated listener to a
container that outlives the repaint**. That shape is dictated by
`testEnvironment: 'node'` with no jsdom — the string half is unit-testable, the
DOM half is Playwright's — and by the house style of repainting `innerHTML`
wholesale, which a node-owning component would fight.

- `listState` uses **`replaceState` only, never `pushState`**: a pushState per
  settled keystroke would bury the page the user came from and break every spec
  calling `goBack()`. Page SIZE is deliberately NOT in the URL — it is a personal
  habit, so it lives in localStorage and a shared link honours the recipient's.
- `adminPager.PAGE_SIZES` tops out at **200 because `leadsController` clamps
  `limit` to [1,200]**. Offering more would let the client request a page the
  server silently truncates, and the pager would then lie about the page count.
- `sortableTh` emits a real `<button>` inside the `<th>` (WAI-ARIA pattern), not
  `tabindex="0"` on the `th`. `aria-sort` stays on the `th`.
- `admin-kit.css` loads after the per-screen sheets and **before `themes.css`**,
  and carries zero colour literals.
- **`.admin-pagination` had NO CSS anywhere** before this — Leads and Markaður
  had been shipping unstyled inline pagers.

**`AdminUsersView` is the converted reference** (86 lines removed, 68 added;
gained page-size memory, shareable URLs, a showing-range, accessible names on
the glyph-only controls, and a `destroy()` that cancels a queued search).
`e2e/admin-list-kit.spec.js` (13 tests) covers what node cannot see.
**AdminLeadsView and AdminMarketView are NOT converted yet** — both were touched
by PR #3, so re-read them before starting.

**Eight defects fixed alongside**, all verified in a running browser:
2FA QR unscannable on Glóð (no `totp-*` CSS existed — the view came across in
the 08-22 harvest without its stylesheet) · the enrolment gate (see below) ·
checkout `required` inert under `novalidate`, plus a latent one-way bug where
`syncShipping()` cleared `required` then re-queried `[required]` so local pickup
and back left the address fields permanently optional · `LoginModal` leaking a
document keydown listener per mount and per abandoned-2FA re-mount · hardcoded
English country labels · `avatarHint` promising 2MB against an enforced 5MB ·
the client CSV writer having drifted from the server's `PLAIN_NUMBER` exemption ·
`OrderHistoryView` hardcoding `'en-GB'`.

**The 2FA gate is now mirrored on both sides and must stay that way.**
`auth.isMfaProtected()` = `isAdmin() || canSeeView('accounts')`, mirroring
`mfaService.protectedRole`. #17 widened the server without widening the UI, so a
seller was pushed to enrol with no panel; PR #3's review pass found the same
defect from the endpoint side the same day. **Both halves were needed** — a UI
that renders the panel and an API that accepts the request.
`tests/unit/mfaProtectedClient.test.js` pins the two together. If either side
widens again, widen both.

**`pageTitle` mirrors `ssrMeta.js` and the test PARSES that file.** The router
never set `document.title` on client navigation, so the tab kept the landing
title all session. The mirror is enforced, not hoped for: the parity test reads
`ROUTE_META`/`DEFAULT_META` out of the server source and fails on drift —
including a guard that the parser itself still matches, so refactoring
`ssrMeta.js` cannot silently make it assert nothing. Hidden portfolio routes
(`/verkefni`, `/projects`) diverge from SSR **on purpose** and are listed as such.

**Upstreamed: base PR #153** (merged `e43666b`). The kit plus all eight defects,
each re-confirmed on the base — including #2 in its narrower `admin_anywhere`
form. **No view is converted there** on purpose. Note the base **auto-deploys to
Azure on green CI on `main`**, unlike here, and it has **zero e2e coverage of
checkout**, so that path was verified by hand before merging. Ledger entry:
`site-factory/BASE-SYNC.md` 2026-09-08.

**Still open on this programme**: the Leads/Markaður conversions, then the states
kit, dialog kit (port LedgerLink's `LedgerAdminBits.js` — native `<dialog>`,
abort-on-dismiss, 15 s write timeout, backdrop dismissal keyed off `mousedown` so
a text-drag does not discard input), auth/identity (`AccessGateView` +
`storefrontGate`, `_redirectAfterLogin`, exporting `ICONS`), and the money
de-fork. **ENHANCEMENTS #22–#26** carry the real ice harvest backlog and need
Halli: scanning (`ScanInput.js`), audited stock adjustments, import wizards,
storefront QoL — of which **a sold-out cart line currently goes straight to
Stripe** — and a shared `Footer`.

<a id="services-page"></a>
## 2026-09-13 — /thjonusta = the company's services page (2026-09-13)

Halli, looking at the page: "orange smiley does not only sell
rekstrarkerfið, it sells any software to medium/small size companies." The
R1 layout had made the product the page's h1. Rebuilt on
`content/thjonusta-services`; **all new copy is DRAFT for Halli**.

- **Order**: h1 "Hugbúnaður fyrir lítil og meðalstór fyrirtæki" → *Hvað við
  smíðum* (six `thjonusta.service.<id>.name/desc`, the first — custom
  systems — full width, the rest numbered) → *Hvernig við vinnum* (three
  steps: fixed price for the build, never hourly; one monthly fee after) →
  Rekstrarkerfið in two paragraphs plus a "Nánar á rekstrarkerfi.is" button
  (`target=_blank`, locale-matched `/is/` or `/en/`) → closing CTA to
  `/hafa-samband`.
- **No product tiers or prices on this site** (Halli, same day, second
  pass): the tier cards, DRÖG chips, 12-row matrix and setup note were
  removed with their `thjonusta.*` keys and CSS. They live on
  rekstrarkerfi.is.
- **Titles**: "Þjónusta — Orange Smiley" / "Services — Orange Smiley" in
  `ssrMeta.js` and its `pageTitle.js` mirror; home description, static
  `index.html` head and `manifest.json` no longer say the company builds
  Rekstrarkerfið alone.
- **JSON-LD**: the Service's OfferCatalog lists the six services and then
  Rekstrarkerfið as one offer with its product-site `url`, no tiers.
  `SERVICE_OFFERINGS` in `ssrMeta.js` mirrors the locale names — change
  them together. No `price` in structured data.
- **Scene engine fix that rode along**: `.ice-scene--band` is `min-height`
  now, not `height`. The fixed band clipped long headers on phones (this page
  by 69px at 320px; `/um-okkur` by 21px already on master). LESSONS.md
  2026-09-13.
- **Review pass (PR, same day)**: the home `_products()` card now opens
  rekstrarkerfi.is in a new tab too (`public/js/utils/productSite.js` is the one
  place that builds the URL; `common.opensNewTab` is the shared screen-reader
  note). **Migration 104_sales_guides_services_page** rewrites the two seeded
  sales guides that told sellers the prices and tier table "appear on the
  services page" — exact-sentence `replace()`, guarded on `updated_by IS NULL`
  like 091/092. **The migration chain now ends 104.** Open for Halli: the
  guides quote 39/59/79 þ.kr./mán while the rekstrarkerfi.is DRAFT prices are
  a build price plus a monthly contract — two draft price models.
- Not touched: the DB-seeded home skills copy and ContactView's demo-led
  wording.

<a id="docs-restructure"></a>
## 2026-09-17 — Docs restructure: ARCHITECTURE index, HISTORY, parity test (PR #9 + review fixes)

Halli asked whether the markdown files were structured so a new feature
request is fast to locate. They were not: CLAUDE.md was 776 lines, about 120
of them rules and the rest sixteen dated chunk write-ups plus a status
section; there was no per-domain map anywhere, and `docs/API.md`'s "Feature
doc" column pointed into CLAUDE.md history sections.

- **`docs/ARCHITECTURE.md`** — twenty domains, each with its files, a "Rules
  that must hold" block (every rule linking the entry here that explains it)
  and its history entries. Rules stay next to the domain they govern; a flat
  "standing facts" list was the first draft and was rejected because that is
  how rules get dropped in a copy edit.
- **This file** — the write-ups moved verbatim (a second read-only pass
  confirmed byte-identity), date-prefixed with `<a id>` anchors and an index.
- **CLAUDE.md** — rules, a domain map, a doc map, the "recording a chunk"
  rule and a one-line status pointer.
- **`tests/unit/architectureIndex.test.js`** — every path in the index
  exists (bare names resolve against the tracked tree, not line position);
  every routes/controller/model/service/middleware/auth/util/view/component/
  client-service/util file is in the index; migrations are cited and applied
  in both directions; ARCHITECTURE numbered headings equal CLAUDE.md's domain
  rows; the HISTORY index table equals the anchors; links from ARCHITECTURE,
  PLAN and API resolve. Set-difference assertions, so a failure names every
  offender in one message.
- **Knowledge-preservation review before merge** found 53 rule statements the
  extraction had dropped and 4 stated wrongly; all folded in. **The
  /code-review pass after merge** found eight more: a sed escape had
  corrupted PLAN.md's base path and SHA (a form-feed byte and uppercase),
  three dangling references to deleted CLAUDE.md sections, API.md pointers
  outside the test's guard, the `DEFAULT_BASE` upstreaming rule surviving only
  here, a duplicated Status in CLAUDE.md, and a test that was positional,
  one-directional and 962 cases wide. Fixed in the follow-up PR.
- LESSONS.md 2026-09-17 carries the factory lesson: scaffold ARCHITECTURE +
  HISTORY + the parity test from day one.

<a id="seller-area"></a>
## 2026-09-21 — Seller area: published one way from ops (D-020 step 3)

D-020 made the private ops instance the place the business runs and gave the
public orangesmiley.is a seller area: each seller's leads, accounts and
commission statements, read-only, published one way from ops. The seller
screens already existed in the admin shell (`solumadur`); what did not exist
was the split. Halli chose, 2026-09-21: **push signed snapshots** (over a
hand-carried export file), **every seller sees all leads** (over only assigned
ones), and the full build in one chunk.

- **`INSTANCE_ROLE`** (`server/config/instanceRole.js`): `ops` by default so
  every existing instance is unchanged; `public` switches on the two new routes.
- **Migration 105** — `seller_publications` (the ingest log: snapshot id,
  generated_at, counts, body sha256) and six `published_*` tables keyed by ops
  ids and the seller's lower-cased email, with no FKs to users: the public box
  never grants anything itself.
- **Ops → public**: `npm run publish:sellers` builds the snapshot
  (`sellerPublish/snapshot.js`), signs it (HMAC-SHA256 over `t.rawBody`, the
  Stripe scheme) and posts it. The ingest verifies the MAC on the raw bytes,
  validates every field, refuses stale or replayed snapshots, and replaces the
  whole copy in one transaction — which is also how an erasure on ops reaches
  the public box.
- **Who sees what** is decided on ops by the existing views: a non-admin with
  `leads`/`accounts`/`commission` is a seller; rates and payee kennitala are
  never published. The statement status rule moved into one function so the
  admin list and the snapshot cannot disagree.
- **Public side**: `/api/v1/seller` (GET only) and `/solusvaedi`
  (`SellerAreaView`, reusing the admin statement drawer with the payout form
  off). A seller is matched by a proven email (verified or admin-invited), and
  published sellers join the 2FA-protected set — login challenge, enrolment,
  and every route but `/me` refusing until TOTP is on.
- 15 Jest integration tests (`sellerArea.test.js`); lint + i18n clean.
- **Not live.** It needs the public and ops instances (D-020 step 5, after the
  5.10 VSK filing, Halli's go), a shared `SELLER_PUBLISH_SECRET` on both, and
  each seller invited on the public box with the same email as on ops. Copy is
  DRAFT.

<a id="test-chrome-admin"></a>
## 2026-09-22 — TEST chrome is admins only

Halli, looking at the local TEST stack logged out: the blue TEST badge, the
nav glow and the "Óska eftir breytingu" button must not show unless an admin
is signed in with TEST mode on. Until now the test stack showed all three to
every visitor and the submit endpoint took anonymous requests, a leftover of
icelandicstore's validation trial.

- Client: `themePrefs.getEffectiveEnv()` returns `production` for anyone who
  is not an admin, so `body.is-test-env` and the widget follow the role.
  `main.js` used to decide once at boot, before the session was restored; it
  now runs one sync at boot and on every `authchange` (sign-in mounts the
  chrome, sign-out tears it down, including a widget the theme switcher's
  TEST toggle mounted).
- Server: `changeRequestGate` checks the admin role first on every stack; the
  test stack only waives the Admin → Feedback switch. Hiding the button while
  leaving the door open would have been a hidden anonymous write path.
- The settings endpoint's `openToEveryone` became `testStack`, and the admin
  note (`adminCR.switchTestNote`, DRAFT copy) now says "admins" not "everyone".
- Tests: three clamp cases in `themePrefsEnv.client.test.js`; the gate matrix
  in `changeRequests.test.js` flipped for anonymous/customer on TEST; two e2e
  cases in `admin-feedback-switch.spec.js` (logged out: no badge, no widget;
  admin: both).
- The same code lives in `rekstrarkerfid` (whose TEST stack is public); not
  ported in this chunk.

<a id="iceland-v2"></a>
## 2026-09-22 — Iceland v2: a landscape on every page

Halli: most pages had no background landscape. Only /thjonusta, /verkefni,
/um-okkur and /hafa-samband wore one; privacy, terms, signup, the password
and email pages, profile and 404 were flat. He supplied 19 AI-generated
stills of his own (`pictures/iceland-v2-originals`, 1280×720 JPEGs named
`.png`) and chose to **replace the whole Commons set** with them.

- **Assignments** (`sceneDefs.js` header has the meanings): /thjonusta
  canyon river · /verkefni rhyolite ridges · /um-okkur glacier tongue ·
  /hafa-samband black beach · /personuvernd cave falls · /terms basalt canyon ·
  /signup moss falls · forgot/reset/verify snow rapids · /profile hot spring ·
  404 braided sand; the dormant home defs got ice-lagoon / braided-moss /
  braided-valley. Six more stills wait in `assets-src` as spares.
- **No place chip.** Its reason was "real places, so the site feels located";
  these are landforms, so a name would be false. `SceneStage`'s `chip` now
  defaults off and needs a `place` in the def.
- **Two mounting shapes.** Header pages use `mountSceneHeader` (ProfileView
  moves its *bound* header node in, so the edit button keeps its listener; the
  legal and 404 views put their flat header back if the manifest lacks the
  image). Card pages use the new `mountSceneBackdrop`: the scene fills one
  viewport behind a frosted card (`.scene-page`), masked into the page
  background below the fold. Page-tall was tried first: `cover` on a long
  signup form blew the 1280px image up until the first screen was only sky.
- **Build script.** Sources below a width step now ship at their own width
  (1280), not only 480/960; the 250 KB budget applies to the largest ≤1600w
  AVIF (all 13 are 56–107 KB). CREDITS.md renders entries without a license
  URL and says the images, and the hero video, are AI-generated for Orange
  Smiley ehf.
- **Known soft edge.** 1280px sources are upscaled ~1.5× on a 1920px screen;
  the scrim and grade hide most of it, and larger originals drop straight in.
- The /personuvernd title (one 20-letter word at 2rem + tracking) was clipped
  by the band on a phone; it scales with the viewport inside the band now.
- Verifying in the desktop app's browser pane: IntersectionObserver only fires
  when the pane paints, so a band can look like its blurred placeholder until a
  screenshot forces a frame. That is the pane, not the site (the e2e run
  loads every scene).

<a id="go-live"></a>
## 2026-09-22 — orangesmiley.is go-live, public site only

Halli parked the VSK veflykill (next-steps item 1) and brought item 2 forward
**without ops**: the public company site goes up now, ops stays the local
instance (D-017) until after the 5.10 filing. His choices: canonical
`www.orangesmiley.is`; small and production only (own B1 plan + B1ms
Postgres, no TEST stack, ~€35–40/month, B2 when ops arrives); a fresh database
from the seeded built-in content — nothing copied from the local DB, which
holds the books; Resend on `mail.orangesmiley.is` (D-015) from day one.
The stack, names and Halli's hand-steps are in `docs/DEPLOYMENT.md` §6.

Code chunk (`feat/orangesmiley-go-live`):

- **`deploy.yml`** rebuilt from the rekstrarkerfid workflow (build once,
  deploy by digest), cut to one stack: environment `production`, optional
  `sha` input, build only when `:<sha>` is not in the registry, Trivy on the
  digest, pin the app to the digest, `/ready` from a process younger than the
  swap, the replaced image printed as the rollback target. The
  `generate-changes.js` stamp from the neutralized version is kept.
- **hallismiley.is fallbacks gone.** Every `APP_URL` default (app.js canonical
  301, emailService, indexNow, sitemap, ssrMeta, party) and the `EMAIL_FROM`
  / settings `contactEmail` defaults now name orangesmiley.is.
  `robots.txt` names the new sitemap. `index.html` is baked with the new
  origin, and `ssrMeta.js` swaps it for `APP_URL` when it loads the template:
  the static Organization JSON-LD is never rewritten by id, so without the swap
  its `@id` dangles from the publisher refs on any other host (tests run as
  hallismiley.is and still pass for that reason). `PARTY_NOTIFY_EMAIL`'s
  default stays Halli's personal address: it is a person, not a host, and the
  party surface is hidden.
- **`EMAIL_REPLY_TO`** (new): the sending domain has no inbox, so replies go
  to a real mailbox on every message that sets no replyTo of its own.
- **No contact-card migration needed.** The seeded card still carried
  halli@hallismiley.is, but migration 092 already rewrites it on any database
  where nobody edited it — which includes a fresh one.
- **Self-update off on this instance** by app setting
  (`CLIENT_CONFIG_MODULES_SELF_UPDATE_ENABLED=false`): `config/client.json`
  points at `releases.orangesmiley.is`, which nothing serves yet (D-014).
- `/personuvernd` §7 (DRAFT) names Sweden as where Azure keeps the data.

Known and out of scope: the admin, books and commission screens ship in the
image and sit behind RBAC + TOTP on an empty database; hiding them by instance
role is ENHANCEMENTS #5.
