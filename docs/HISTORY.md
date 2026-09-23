# History — hallismiley.is (the base until 2026-09-22, an engine downstream since)

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

**Two strands.** Entries dated up to 2026-09-22 with a hallismiley subject
(the six incidents from the base's old `CLAUDE.md`, the base docs
restructure, the graft itself) are this repo's own. Everything else is the
ENGINE's history — the orangesmiley programmes that produced the code this
site now runs — kept verbatim because the rules in `docs/ARCHITECTURE.md`
link to them. "This repo" inside an engine entry means orangesmiley.

## Index

| Date | Entry | Headline |
|---|---|---|
| 2026-08-07 | [Edited migration after it was applied](#edited-applied-migration) | hallismiley: migration 072 edited after the dev DB had applied it; never edit an applied migration |
| 2026-08-07 | [CREATE TABLE IF NOT EXISTS was a no-op](#create-if-not-exists-noop) | hallismiley: migration 076 re-declared `employees`; columns never added; rewritten as ALTERs |
| 2026-08-07 | [`journal_lines.vat_rate` never written](#vat-rate-never-written) | hallismiley: `postEntry` left the value out of the INSERT; nothing failed |
| 2026-08-07 | [Shared test database dropped mid-run](#shared-test-db) | hallismiley: two sessions on `hallismiley_test`; always a private `TEST_DATABASE_URL` |
| 2026-08-07 | [`gh pr checks` green for a stale head](#stale-pr-checks) | hallismiley: verify with the commit's check-runs, not the PR |
| 2026-08-08 | [Payroll tax bands collapsed to 0 kr.](#payroll-bands-bounds) | hallismiley: 072 seeded upper bounds, loader read lower bounds; `normaliseBands()` accepts either |
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
| 2026-09-22 | [Docs restructure in the base (PR #167)](#docs-restructure-hs) | hallismiley: per-domain index + HISTORY + `architectureIndex.test.js` in the base, the day before the graft |
| 2026-09-22 | [Engine graft — hallismiley becomes a downstream (D-021)](#engine-graft) | hallismiley: merge of the engine with a real base; `hs.js` aliases; what the identity check found, what was hooked, what stays open |
| 2026-09-22 | [Engine upstream — this repo becomes the parent of every repo (D-021)](#engine-upstream-2026-09-22) | Two layers (source by merge, runtime by product channel); `engine.json` + feature wiki; two-array migrations (091/092/104 → `os.js`, theme CHECK → 106); `engine-sync` / `engine-harvest` / `engine-drift`; icelandicstore is the current source of generic work |
| 2026-09-22 | [Handbook on D-001 pricing and the demo instance (D-020 step 5)](#handbook-d001-2026-09-22) | 13 of 14 seeded guides rewritten: build fee + service contract + verkeiningar, demos on `demo.rekstrarkerfi.is`; first product migration `os_001`; test pins seed == migration; all DRÖG |
| 2026-09-22 | [Leads transfer — enquiries from the other instances reach ops (D-020 step 4)](#leads-transfer-2026-09-22) | `leads:export` (submission fields only) / `leads:import` (one transaction, `ON CONFLICT DO NOTHING`, an ops row is never updated); by hand weekly, a timer once ops is on Azure; no migration |
| 2026-09-22 | [Identity seam + feature gate (D-021)](#identity-seam-2026-09-22) | `identity.*` in `config/client.json` owns brand, locale, theme trio, hero, hidden surfaces, Organization; ssrMeta hands it to the page; email strings take `{siteName}`/`{siteHost}`; engine tests read the seam; `features/local.json` + the feature gate skip a hidden feature's suites; no migration |
| 2026-09-23 | [Engine sync — identity through the seam, feature gate (D-021)](#engine-sync-2026-09-23) | hallismiley: up to engine `92308d2`; brand/locale/theme trio/hero/hidden surfaces/Organization now in `config/client.json`, the theme and brand hooks retired, `/aron13ara` the one remaining hook; what the seam still lacks |

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

**Same day, after the first deploy:** the container logged
`ERR_ERL_INVALID_IP_ADDRESS` — App Service forwards `X-Forwarded-For: ip:port`,
so every IP-keyed limiter (global, writes, login, contact, MCP pre-auth) keyed
per TCP connection. icelandicstore had found and fixed exactly this on
2026-09-12 (`forwardedFor.js` + test) but it never reached the base or this
repo; ported verbatim. rekstrarkerfid, LedgerLink and the base carry the same
hole. Also learned: a Key Vault reference keeps its cached value across a plain
restart — re-set the app setting to force a re-fetch after rotating a secret.

Known and out of scope: the admin, books and commission screens ship in the
image and sit behind RBAC + TOTP on an empty database; hiding them by instance
role is ENHANCEMENTS #5.

<a id="edited-applied-migration"></a>
## 2026-08-07 — dev AR page 500s after a schema edit

Migration 072 was edited AFTER the dev database had applied it, so the column
existed in `schema.js` and not in Postgres — dropped the ~21 books tables and
the `schema_migrations` rows, re-migrated. **Never edit an applied migration;
add a new one.**

<a id="create-if-not-exists-noop"></a>
## 2026-08-07 — new payroll columns silently absent

Migration 076 used `CREATE TABLE IF NOT EXISTS employees`, but 072 already
created that table, so the statement was a no-op and the service queried
columns that were never added — rewrote 076 as ALTERs on 072's tables.
**Check whether a table already exists before declaring one.**

<a id="vat-rate-never-written"></a>
## 2026-08-07 — `journal_lines.vat_rate` NULL on every row ever written

`postEntry` prepared the value and left it out of the INSERT; nothing failed
because the VSK return derives from each account's `vat_code` — added the
column to both inserts.

<a id="payroll-bands-bounds"></a>
## 2026-08-08 — payroll tax bands all started at 0 kr.

Migration 072 seeded 2026 as UPPER bounds (`{"upTo":498122}`, how Skatturinn
prints it) while the loader read LOWER bounds and defaulted a missing one to 0,
collapsing the slicing so nearly the whole salary would have been taxed at the
top rate — `normaliseBands()` now accepts either shape and refuses one that
states neither. **Found by looking at the screen, not by a test.**

<a id="shared-test-db"></a>
## 2026-08-07 — 100+ nondeterministic test failures across unrelated suites

Two sessions shared `hallismiley_test`, which jest globalSetup DROPs — always
set `TEST_DATABASE_URL` to a private database name.

<a id="stale-pr-checks"></a>
## 2026-08-07 — `gh pr checks` reported green for a stale head

It was reading a merged PR's old commit — verify with
`gh api repos/:owner/:repo/commits/$(git rev-parse HEAD)/check-runs`
and require `total_count > 0`.

<a id="docs-restructure-hs"></a>
## 2026-09-22 — Docs restructure in the base (PR #167): ARCHITECTURE index, HISTORY, parity test

Halli asked whether the estate's markdown was structured so a new feature
request is fast to locate. In the base it was not: `CLAUDE.md` was rules with
an append-only incident list growing inside it, there was no map from a
feature to the files that implement it (only `/admin/books` was discoverable,
through `docs/BOOKKEEPING-SYSTEM.md`), `CHANGELOG.md` had stopped on
2026-03-30, and nothing in the tree read any markdown file, so drift was
silent. The same shape had already been fixed in orangesmiley
(2026-09-17 — the engine's own [docs-restructure](#docs-restructure) entry above) and icelandicstore.

Why the base and not only the instances: site-factory copies the base's
whole working tree, every markdown file and all of `tests/`, and renders only
CLAUDE, PLAN, LESSONS and SLO from templates. Anything placed here reaches
every future scaffold for free; anything placed only in an instance never
does — the gap that produced base PR #153.

- **`docs/ARCHITECTURE.md`** — the engine's domains, each with its files, a
  "Rules that must hold" block linking the entry here that explains each
  rule, and its history entries.
- **This file** — the incident list moved verbatim; scaffolds get an empty
  copy from `site-factory/template/docs/HISTORY.md.tpl`.
- **`tests/unit/architectureIndex.test.js`** — every path the index names
  exists; every routes/controller/model/service/middleware/auth/util/view/
  component/client-service file is in the index; the migrations it cites are
  exactly the ones `schema.js` applies; every history link and domain-map
  link resolves. Set-difference assertions, so a failure names every
  offender in one message, and the message says what to add. Note this test
  gates the base's CI and therefore its auto-deploy: adding a router without
  an index row is a red build on purpose.
- `CLAUDE.md` gained the domain map and the "recording a change" rule;
  `site-factory/test/scaffold.smoke.js` asserts the three files survive a
  scaffold.

<a id="engine-graft"></a>
## 2026-09-22 — Engine graft: hallismiley becomes a downstream of the Orange Smiley engine (D-021)

The estate reversed direction. hallismiley was the base every repo was
scaffolded from (orangesmiley at `562c637`, 2026-08-09); by September the
engine had grown far past it and harvesting the base into it (last at
`f7d93b9`, 2026-09-13) was the wrong way round. D-021 makes orangesmiley the
ENGINE and this repo a downstream with role `personal`: engine files arrive by
`git merge upstream/master` through site-factory's `engine-sync.js`; what is
hallismiley's own lives in product-owned paths (`.engine-paths`, generated
from `features/hs/*.md` + the fixed list).

**The graft (one time).** `engine-sync.js --graft`: two temporary
`git replace --graft` refs hung the engine's root and this repo's root onto
the legacy hallismiley history, so the merge of `upstream/feat/engine-upstream`
had a real common ancestor (no `--allow-unrelated-histories`). Product-owned
paths took ours; 107 conflicted files that hallismiley had not touched since
`f7d93b9` took the engine's version; five needed a hand:

- `docs/ARCHITECTURE.md`, `docs/HISTORY.md`, `tests/unit/architectureIndex.test.js`
  — added on both sides the same day (base PR #167 vs the engine's
  registry-aware set). ENGINE versions taken (21 domains with `| Features |`
  rows; the registry test), hallismiley's domain content and its dated
  entries folded in (the base's `docs-restructure` anchor became
  `docs-restructure-hs`; the six incidents are above).
- `server/app.js` (one comment hunk) and `server/middleware/forwardedFor.js`
  (added on both sides, same code, different comment) — engine's.
- `docs/SHOP_REDESIGN.md` — engine-deleted, base-edited: removed.

**Migrations.** `server/config/schema.js` is the engine's. hallismiley's own
080–085 were the same DDL under other numbers, so
`server/config/product-migrations/hs.js` carries six `aliases`
(`082_admin_totp` ← 080, `081_system_updates` ← 082, `087_event_logs` ← 083,
`088_mcp_tokens` ← 084, `083_user_theme` ← 081, `103_books_vehicle_accounts`
← 085) and one `superseded` entry (`084_user_theme_widen`: it would have
re-declared the users.theme CHECK as the engine's five ids and rejected every
account on a base colour theme; 106 drops the constraint). The runner records
these with `resolved_from` and executes nothing. `--plan` on the dev database:
six ALIAS, one SUPERSEDED, RUN = 080, 085, 086, 089, 090, 093, 094, 095–102, 105,
106; 091/092/104 (Orange Smiley's company copy, product-owned in the engine)
never appear.

**The engine's own product files.** The merge brought Orange Smiley's
product-owned files where this repo had none. `config/client.json` and
`PLAN.md` were rewritten for this site (the config test reads the committed
file); `LESSONS.md` and `setup.ps1` (the company's log and its
`createdb orangesmiley` bootstrap) were dropped. `features/os/company-content.md`,
`server/config/product-migrations/os.js`, `server/scripts/seed-sales-guides.js`
and `tests/integration/salesGuidesServicesPage.test.js` are KEPT, inert
(rule from the coordinator, 2026-09-22: deleting a file the engine tree
carries makes every later sync a delete/modify conflict). `os.js` is never
loaded (`migrationSet.js` requires only `hs.js`); the registry test skips the
foreign `features/os/` folder (a one-line local edit the engine is adopting
too); the 104 test is `describe.skip` on any product but os (it needs the
migration at module load); `features/hs/inert-engine-product-files.md` claims
the three files so the coverage check has one owner.

**Identity check — what the engine's defaults change on hallismiley.is.** The
engine hides the portfolio by CONFIG rather than deletion, so every hallismiley
surface still renders — but the engine also hard-codes Orange Smiley's
identity in engine-owned files AND pins it in engine-owned tests (Jest, run by
the sync's verification, and Playwright, run by this repo's CI which gates the
auto-deploy). The rule followed: a residual hook is applied only where no
engine test breaks; everything else is listed as an open divergence for
Halli. Product-owned seams used: `public/js/i18n/product.<locale>.json`
(new keys only — `check:i18n` refuses an overlay that shadows an engine key),
`features/local.json`, `hs.js`, `features/hs/`.

*Residual hooks (edits on engine files; they re-conflict on every sync):*

- The auto-merge had duplicated hunks the engine already carried in another
  form (nine files hallismiley had not touched since `f7d93b9`: `auth.js`,
  `database.js`, `FxRate.js`, `httpMetrics.js`, client + server `i18n.js`,
  `sitemap.test.js`, both `localeLock*` tests) — ESLint caught two duplicate
  declarations. All nine took the ENGINE version; the one hallismiley hunk the
  engine never harvested, the `/aron13ara` Icelandic-only lock, is re-applied
  once as the hook below.
- `/aron13ara` — route + `Aron13View` import in `public/js/router.js`;
  `ROUTE_META` + `DEFAULT_META.aron13` (en/is) in `server/middleware/ssrMeta.js`;
  the entry in `public/js/utils/pageTitle.js`; `'/aron13ara'` in
  `HIDDEN_PUBLIC_ROUTES` (`server/config/publicSurface.js`) so it stays
  noindexed; the Icelandic-only lock (`IS_ONLY_PAGES` in
  `server/config/i18n.js` and its client mirror in `public/js/i18n/i18n.js`)
  with its cases in `tests/unit/localeLock.test.js` and
  `localeLockClient.test.js` — the engine never had an IS-only page.
- The five colour themes — token sets appended to `public/css/themes.css`
  with a bridge block for the 39 engine-only tokens; `THEMES`, `DARK_THEMES`,
  `THEME_SWATCHES` in `themePrefs.js`; `THEMES` in `theme-boot.js` and
  `server/config/themes.js`; names in the product overlay.
- Brand strings the tests do not pin: `nav.brandAriaLabel`, `signup.checkEmail`,
  `projectDetail.brandPara1/2` in `public/js/i18n/{en,is}.json`; seven
  `email.*` keys (reset, invite ×3, order ×2, footer) in
  `server/i18n/{en,is}.json`; `author` and `og:site_name` in `public/index.html`
  (the two head fields SSR never rewrites).

*Not reconciled — each pinned by an engine test (file:line at the graft):*

1. **Public IA + nav lockup.** Nav is Orange Smiley + `/thjonusta`,
   `/um-okkur`, `/hafa-samband`; `/projects`, `/news`, `/halli`, `/shop`,
   `/contact`, `/party`, `/privacy` are hidden, noindexed and absent from the
   sitemap; the seller/handbook/leads admin lines exist. Pinned:
   `e2e/navigation.spec.js:135-138` (exactly the four business links),
   `tests/integration/ssrMeta.test.js:109-131` (noindex on the six portfolio
   routes), `tests/integration/sitemap.test.js:47-67`.
2. **SSR titles/descriptions** — "Orange Smiley — hugbúnaðarhús knúið
   gervigreind" on `/`, "— Orange Smiley" on contact/privacy/terms, the
   `DEFAULT_META` copy; `websiteSchema` name/alternateName; product-schema
   brand "Rekstrarkerfið". Pinned: `ssrMeta.test.js:58,85-102,402`,
   `tests/unit/pageTitle.test.js:57,83-105`, `e2e/navigation.spec.js:169-194`.
3. **Hero clip** — `hero-dc7df-v2.mp4` (+ poster) instead of the base's
   `waterfall-bk-v1.mp4`. Pinned: `e2e/navigation.spec.js:46-65`.
4. **Visitor-default locale** — `PUBLIC_DEFAULT_LOCALE = 'is'` and
   Accept-Language ignored (server `locale.js`, client `i18n.js`, `consent.js`);
   the base was `en` with Accept-Language honoured. Server side the seam
   exists: set `PUBLIC_DEFAULT_LOCALE=en` in the App Service settings
   (product-owned deployment config). Client side pinned:
   `tests/unit/localeLockClient.test.js:135-144`,
   `tests/unit/localeLock.test.js:166-173` (server, if the code default moved),
   `tests/integration/i18n.test.js`, `e2e/business-routes.spec.js`.
5. **Default theme + the classic palette** — `DEFAULT_THEME = 'ember'`
   (`themePrefs.js`, `theme-boot.js`) and `classic` = Bjart (beige paper, brown
   ink; `variables.css` :root). The base's default was `classic` = charcoal +
   gold. The nearest engine theme is `ember` (dark, warm — the re-hued Ash),
   which IS the default, so the first paint stays dark-warm; the base's exact
   palette is gone. Pinned: `tests/unit/themePrefsAccount.client.test.js:132`
   (unknown id → `ember`), `tests/integration/users.test.js:588-613`,
   `e2e/iceland-scene.spec.js:47-51`.
6. **Admin hidden lines** — `HIDDEN_ADMIN_VIEWS` hides products, collections,
   bins, orders, discounts, sales, POS and the background editor for the admin
   role (an admin can reveal each in sidebar edit mode; a custom role's grants
   are its nav). The base hid nothing. Pinned:
   `tests/unit/admin-surface-parity.test.js:18` (set must be non-empty),
   `e2e/admin-surface.spec.js:65-83`.
7. **Organization JSON-LD** in `index.html` (`#organization`, "Orange Smiley
   ehf.") instead of the base's Person `#person`; the `BAKED_ORIGIN` swap in
   `ssrMeta.js` keeps it consistent on hallismiley.is. Pinned:
   `ssrMeta.test.js:404-412,466-474`.
8. **`email.verify.subject`** — "Verify your Orange Smiley account". Pinned:
   `tests/integration/i18n.test.js:25,29,45`.
9. **Eight themes in the picker**, not six: `ember` and `midnight` cannot leave
   `THEMES` (item 5's pins).

**Also carried (from the engine's `master`, ahead of the next sync):** the
`Dockerfile` copies `engine.json` into the image (`migrationSet.js` reads it
at boot — without it the container fails to start; engine commit `e2aadd3`).
It arrives again by sync and merges clean.

**Verification note.** Jest test databases are named per BRANCH
(`orangesmiley_<branch>_w<N>_test`); the LedgerLink graft ran on the same
branch name the same day and the two runs dropped each other's databases
(the [shared-test-db](#shared-test-db) incident again, one level up). The
graft was verified with an explicit `TEST_DATABASE_URL`
(`hs_graft_test`) — set one whenever two grafts run on one Postgres.

**Not a divergence.** `config/client.json` (defaults, `managed`);
`server/utils/canonicalHost.js` orphaned (see Ownership notes); the engine's
business pages, seller area, leads, markaður, accounts, commission and
handbook are served but `hidden` in `features/local.json`; `.github/workflows/deploy.yml`
stayed hallismiley's (product-owned) — `main` still auto-deploys.

**Next.** Halli decides the seam: either the engine grows a product-owned
identity config (brand strings, public IA, sitemap routes, meta tables, hero
clip, locale default, theme default) with its tests reading it, or hallismiley
forks the pinned files and their tests in `engine.json.productPaths`. Until
then this commit is reviewable but hallismiley.is presents as the company site
if deployed — do not merge to `main` without that decision.
<a id="engine-upstream-2026-09-22"></a>
## 2026-09-22 — Engine upstream: orangesmiley becomes the parent of every repo (D-021)

**Why.** Five repos ran the same engine and none of them shared git history:
each was scaffolded as a file copy of a hallismiley commit, so every generic
fix travelled by hand (`/base-diff`, cherry-pick by eye, "ported verbatim" —
the `forwardedFor` hole found in icelandicstore on 2026-09-12 was still open
in three repos ten days later, [go-live](#go-live)). The written record made
it worse: the 2026-08-22 review §3 and REKSTRARKERFI-PLAN §8 named
`rekstrarkerfid` the successor upstream "after R3+R7", which left the base
frozen, the product repo not yet upstream, and this repo — the one that
actually carried the newest engine — officially nobody's parent.

**The decision (Halli, 2026-09-13, refined 2026-09-22; D-021).** THIS repo is
the engine upstream of the estate. Orange Smiley ehf. is the parent company
and builds several products; Rekstrarkerfið is one. Downstreams:
`rekstrarkerfid` (product core, rekstrarkerfi.is), `LedgerLink` (contract
product), `icelandicstore` (customer #1, live) and `hallismiley` (the old base,
now a FULL downstream: Halli's personal site, pepti org, personal tenant,
deploys on merge to `main`). Two layers: source flows engine → repos by
`git merge upstream/master` on `engine-sync/<date>` PRs; runtime flows a
product repo → its instances by that product's own release channel
(`promote.yml`, canary/stable, self-update), one channel set per product in
its tenant — the engine repo is a product in that sense too, so its own
channel (orangesmiley.is now, ops on stable after 5.10) is armed first,
rekstrarkerfid's next; the 2026-09-13 hallismiley arming packet is parked.
Restated invariant: product repos derive from the engine; customer instances
derive from a product's image; instances are never cloned from instances.
Runbook: `docs/ENGINE-SYNC.md`.

**Mechanism.** Each downstream gets an `upstream` remote and a one-time
history graft (temporary `git replace --graft` of both roots onto the common
hallismiley ancestor `fdf9581`, one ordinary merge, replace refs deleted —
never `--allow-unrelated-histories`); after that a sync is a plain merge.
`engine.json` in every repo records product id, role, upstream, `rev`,
`syncedAt`, `grafted`, `productPaths`, `history`. Tools in `site-factory`:
`engine-sync.js` (branch, merge, mechanical lock resolution, the verification
chain, `engine.json` in the same commit; exit 3 hands conflicts to the
operator), `engine-harvest.js` (upward `cherry-pick -x` of downstream commits
that carry a `Feature: <id>` trailer or touch an engine feature's paths),
`engine-drift.js` (writes `engine-registry.json` + `FEATURE-MATRIX.md`,
derived, never hand-edited). `/base-diff` becomes `/engine-diff`.
`.claude/rules/stack-invariants.md` and `.claude/commands/` are tracked here
now (the `.claude/*` ignore has exceptions) so they reach downstreams by
merge; the site-factory template stops shipping its own invariants copy.

**Migrations: two arrays.** Auditing the chains for the graft found two
things. First, 091, 092 and 104 are not engine migrations at all — they
`UPDATE site_content` / `sales_guides` with Orange Smiley's own copy, which
every other product seeds with its own; they moved to
`server/config/product-migrations/os.js` as `legacy` entries. Second, the
per-repo `081_user_theme` CHECK constraints differ by repo (each repo has its
own theme set), so a downstream booting the engine's array would crash-loop
on the constraint it never applied — hence engine migration
`106_user_theme_check_drop`, which removes the CHECK and lets `themePrefs.js`
own the set (Halli's veto pending). The shape — engine array in `schema.js`
upstream-only, product array `<id>_NNN_name` with `legacy`, `aliases`,
`superseded`, assembled by `migrationSet.js`, `migrate.js --plan` as the
pre-flight — is `docs/MIGRATIONS.md`, now invariant #4.

**Feature wiki.** `features/<id>.md` for engine features, `features/<product>/`
for product features, `features/local.json` per repo; `.engine-paths` and
`.gitattributes` (`merge=ours` on product-owned paths) are generated from it,
and `tests/unit/featureRegistry.test.js` enforces that every migration name
and every owned path is claimed by exactly one feature.

**The ice-as-source correction.** The plan first treated icelandicstore as a
pure consumer. Halli is building it with Orri, the owner, and for the next
weeks it is the main SOURCE of new generic features. So the upward path is
first-class: `Feature: <id>` trailers on ice commits, a weekly `from-ice/<date>`
harvest PR into this repo, Halli deciding generic-or-ice-only per candidate;
customer-specific code is never touched by a sync in either direction.

**Still Halli's:** pick the window for icelandicstore's graft PR (merge deploys TEST);
adopt the `Feature:` trailer with Orri; veto or accept migration 106; merge
the hallismiley and icelandicstore sync PRs; arm `RELEASE_*` per product,
orangesmiley's own first. Superseded documents were banner-marked or rewritten
the same day (`company/DECISIONS.md` D-021 lists them).

<a id="handbook-d001-2026-09-22"></a>
## 2026-09-22 — Handbook on D-001 pricing and the demo instance (D-020 step 5)

D-020 found two faults in Handbók sölufólks. The seeded guides still sold the
flat 39/59/79 þ.kr./mán subscription with "setup fee waived on an annual
contract", which D-001 retired on 2026-09-01/03. And they told sellers to demo
on orangesmiley.is. A SALES-LOG entry of 2026-09-03 said the seed script
already carried the new model, but master's seed did not (the change never
landed), and the dev database's 14 rows were byte-identical to master's seed.
**All copy is DRÖG for Halli.** Söluþjálfari drafted it.

- **The model in the guides**: a one-time build fee of 390 / 580 / 690 þ.kr.
  (half at signing, half at go-live, D-005), plus a service contract of
  19 / 29 / 39 þ.kr./mán carrying 5 / 10 / 20 verkeiningar, all án VSK. What a
  verkeining is: verk sized 1 / 5 / 20 with the examples from the live
  rekstrarkerfi.is/verdskra copy, an estimate the customer approves before work
  starts, a notice at 80%, overage at a fixed einingaverð, and non-urgent verk
  that queue free. The slogan "Sérsniðið kostar áskrift, ekki ráðgjafatíma"
  became "Sérsniðið kostar verkeiningar, ekki ráðgjafatíma". The glossary gained
  uppsetningargjald, þjónustusamningur, verkeining (kept apart from *sérsniðin
  eining*), einingaverð and sýnikerfi. `manadarleg-samskipti` swaps the
  annual-contract pitch for the draft 12-month term (D-007, a lawyer-review
  draft).
- **Where D-001 is silent the guides say "DRÖG — Halli staðfestir"** and
  nothing more: the einingaverð amount, whether unused units carry over, the
  cost of moving up a tier, and how sellers demo before the demo instance
  exists.
- **Demos**: `kerfid-i-stuttu-mali` gained a section on `demo.rekstrarkerfi.is`.
  It covers the Kaffibrennslan Glóð data, the nightly reset, one login per
  seller behind an authenticator code, time-limited prospect logins only after
  a guided demo, the shop → order → invoice → VSK → change-request path, and
  email and payments being off. It says plainly that the instance is being
  built. `innskraning-og-handbokin` points there too, and its theme sentence
  now counts three themes, not five.
- **Migration `os_001_sales_guides_d001_pricing`**, the first entry in the
  product array `migrations` (D-021). The seed is `ON CONFLICT DO NOTHING`, so
  seeded rows only move by migration. The 34 passages were derived line by line
  from the old and new seed. Each is an exact old → new `replace()` through a
  `guideEdit` helper in `os.js`, guarded on `updated_by IS NULL`, on the old
  passage being present and on the new one being absent, so a re-run is a no-op.
  The entry carries its `edits` for the test. A dry run on the dev database, in
  a rolled-back transaction, turned all 14 rows into exactly the new seed text,
  and the second run touched nothing.
- **Test** `tests/integration/salesGuidesD001.test.js` rebuilds the old text by
  undoing the edits on the seed. It pins that text to a sha256 of the dev
  database rows as shipped. It then checks that os_001 turns the old text into
  the seed text exactly, and that no flat-tier phrase survives while the D-001
  figures and the demo host do. It also checks that a guide saved by a person
  is untouched and that a second run changes nothing.
- Not changed (flagged to Halli): `velkomin-i-soluteymid` still says the company
  "selur eina vöru", although since 2026-09-13 it sells any SMB software.
  `innskraning-og-handbokin` still sends sellers to `/admin/handbok` on
  orangesmiley.is, and D-020 has not said which instance serves the handbook
  once ops is private. Plan docs §1/§3 still carry the old model, which is
  Halli's edit per D-001.
<a id="leads-transfer-2026-09-22"></a>
## 2026-09-22 — Leads transfer: enquiries from the other instances reach ops (D-020 step 4)

D-020 gave every instance its own `leads` table and made ops the one place
the pipeline is worked — which left the enquiries the public orangesmiley.is
captures (and rekstrarkerfi.is's, once it runs this engine) invisible to the
sellers. Halli's brief: "weekly and by hand while there are 1–3 customers".
This is the by-hand pair. **No migration**: 097's `submission_id UUID NOT
NULL UNIQUE` is the idempotency key it always was.

- `server/scripts/leads-export.js` (`npm run leads:export -- [--since <ISO>]
  [--out <file>]`, default stdout) dumps `{ exportedAt, instance, leads[] }`
  from the capturing instance. `instance` = the `APP_URL` host (else
  `INSTANCE_ROLE`). The rows carry the **submission fields + `created_at`
  only** — never `status`, `owner_user_id`, `contacted_*` or `note` — so a
  file can never carry one box's workflow state onto another. Counts go to
  stderr, field values nowhere.
- `server/scripts/leads-import.js` (`npm run leads:import -- <file.json>
  [--dry-run] [--source <label>]`) on ops: validates every row against the
  contact form's own limits (`contactController`: name ≤100, well-formed email
  ≤200, message 10–2000, company ≤150, phone ≤40; `Lead.CAPS` for platform /
  locale / source), fails the whole file on any bad row, then inserts in ONE
  transaction with `ON CONFLICT (submission_id) DO NOTHING`. **An existing
  row is never updated** — on ops it is the seller's work product. Inserted
  rows are `status = 'new'`, no owner, `created_at` preserved (retention
  counts from the visitor's receipt, not the import), `source` = `--source`
  or the file's `instance`. Prints `inserted=`/`skipped=`; `--dry-run` rolls
  back.
- PII posture, in the header comments and `docs/SALES-STAFF.md` (the
  seller-facing steps): the file lives under gitignored `data/`, is carried
  by hand, deleted on both boxes after import; ops holds the rows under the
  same 24-month `/personuvernd` §6 retention. Error messages name a row by
  index and submission id only.
- `tests/integration/leadsTransfer.test.js`: export shape excludes the
  workflow columns; `--since`; import inserts / second import skips all / a
  worked row's status, note, owner AND submission text survive a "corrected"
  re-import; one bad row writes nothing; `--dry-run` writes nothing;
  `--source` wins; the export→import round trip keeps the ids; every limit.
- Deliberately NOT built: an HTTP route between the instances (the seller
  publication is one way ops → public by design, and a public → ops door
  would be the reverse), and a timer — that comes with ops on Azure (PLAN →
  Status). `source` stays a label, not an FK; the inbox shows it as text.

---

<a id="identity-seam-2026-09-22"></a>
## 2026-09-22 — Identity seam + feature gate: a downstream owns who it is in one file (D-021)

**Why.** The hallismiley graft kept the engine's identity: engine-owned
tests pinned Orange Smiley literals (the nav lockup, the SSR titles and
JSON-LD names, the `hero-dc7df-v2` clip, visitor default `is`, theme default
`ember` with its picker, `HIDDEN_ADMIN_VIEWS`, the baked `#organization`,
`email.verify.subject`), so merged as-is Halli's personal site would have
presented as the company site. LedgerLink and rekstrarkerfid carried the same
literals as "residual hooks" that re-conflicted on every sync, and
LedgerLink's graft CI showed 32 e2e failures — engine specs asserting the
engine's public IA on a product that hides it, plus jest suites the graft had
to `describe.skip` by hand. The engine was a fork by default.

**The identity seam.** `identity.*` joins `modules.*` in the existing
per-instance config (`server/config/clientConfig.js`: schema defaults <
`config/client.json` < `CLIENT_CONFIG_IDENTITY_*` env; nothing new was
invented). `brand` (name, legalName, alternateNames, titleSuffix), `locale`
(publicDefault), `theme` (default, root, picker — validated as a trio, a picker
without its default or root is rejected whole), `hero` (clip, poster),
`surface` (hiddenRoutes, hiddenAdminViews), `organization` (email,
description, logo, image, address, areaServed, knowsAbout, sameAs). The
defaults ARE Orange Smiley's values, pinned once in
`tests/unit/identityConfig.test.js`, so an engine with no block behaves as
before. A leaf is now a node with both `type` and `default` — checking
`default` alone read `identity.theme` (which has a child called `default`) as a
leaf. Readers, server: `server/config/identity.js` (the resolved record +
pure head helpers), `ssrMeta.js` (page-part titles composed by `composeTitle`;
`og:site_name`, `<meta author>`; the WebSite and a server-built Organization
JSON-LD on every page — `loadTemplate()` strips the baked block from
`index.html`), `config/i18n.js`, `publicSurface.js`, `themes.js`, and
`server/i18n/index.js`, whose `t()` injects `{siteName}` / `{siteHost}`
(APP_URL's host without `www.`) so the email tables carry no brand
(`i18nIdentity.test.js`: the default renders exactly the old text). Hand-off:
ssrMeta writes `<html data-default-theme data-theme-picker data-root-theme>`
for the pre-paint `theme-boot.js` and `<script id="identity">` (with `</`
escaped) for `public/js/utils/identity.js`, which parses it once with the
same defaults as fallback; `themePrefs.js`, `i18n.js`, `consent.js`,
`adminSurface.js`, `NavBar.js`, `HomeView.js` and `pageTitle.js` read it.
`pageTitle.js` now holds page parts + `titleMode`, and the parity test parses
both from `ssrMeta.js` and holds the two `composeTitle`s equal.

**Tests read the seam.** `ssrMeta.test.js`, `users.test.js`,
`i18n.test.js`, `localeLock*.test.js`, `themePrefsAccount.client.test.js`,
`admin-surface-parity.test.js` (engine defaults AND the resolved list ⊂
`ADMIN_VIEW_IDS`) and the e2e specs `navigation`, `admin-surface`,
`business-routes` assert against `identity.*` (`e2e/lib/identity.js`
resolves it in-process and reads what the server served). Every existing
test keeps what it protected; only where the expected value comes from
changed. `tests/integration/identityDownstream.test.js` requires the app
fresh with a temp `client.json` (brand "Halli Smiley", default `en`, theme
`glacier` in a picker of six, waterfall clip, empty hidden lists) and proves
the served page presents as that product.

**The feature gate.** `features/local.json` already recorded which engine
features a downstream hides/disables/forks; now the tests read it.
`tests/lib/featureGate.js` maps a suite to its feature through the registry's
`paths` and answers `gate(id)` / `gateForSpec(file)`; a feature that is
`hidden`, `disabled` or `forked` there, or belongs to another product
(`features/<other>/`, inert), skips with the note; an unknown id never skips.
Every engine e2e spec opens with `gateSpec(test, __filename)`
(`e2e/lib/featureGate.js`); `salesGuidesServicesPage`, `salesGuidesD001`
(os-owned) and `sellerArea` (`seller-publication`) shadow `describe` with
`describeForSpec(__filename)`. In the engine `local.json` is empty and nothing
skips — `featureGate.test.js` pins it and exercises a temp file hiding
`public-site`. Rule (ENGINE-SYNC §6, TESTING.md): tests for a hidden feature
skip; an engine spec is never deleted or hand-edited downstream.

**What a downstream puts in `config/client.json`** (hallismiley, ready to
paste):

```json
"identity": {
  "brand": { "name": "Halli Smiley", "legalName": "Halli Smiley",
             "alternateNames": ["hallismiley", "Halli"], "titleSuffix": " — Halli Smiley" },
  "locale": { "publicDefault": "en" },
  "theme": { "default": "glacier", "root": "classic",
             "picker": ["glacier", "classic", "midnight", "ember", "lava", "moss"] },
  "hero": { "clip": "/assets/videos/waterfall.mp4", "poster": "/assets/videos/waterfall-poster.jpg" },
  "surface": { "hiddenRoutes": [], "hiddenAdminViews": [] },
  "organization": { "email": "halli@hallismiley.is", "description": "…", "addressLocality": "Hafnarfjörður", "sameAs": [] }
}
```

Its `themes.css` must carry a token set per picker id, `product.<locale>.json`
its own `nav.brandAriaLabel` / `themeSwitcher.theme.<id>` names, and its
`features/local.json` whichever engine features it hides. Not in the seam, on
purpose: the seeded company COPY (`site_content`, the home hero and skills
rows, `SERVICE_OFFERINGS`) — that is product content, replaced by product
migrations; the PWA `manifest.json` name; the Product-schema `brand`.
No migration.

<a id="engine-sync-2026-09-23"></a>
## 2026-09-23 — Engine sync: hallismiley's identity through the seam, the feature gate (D-021)

Second sync, engine `1e00995` → `92308d2` (PR #168, still the graft branch).
The engine's [identity seam](#identity-seam-2026-09-22) and [feature gate](#identity-seam-2026-09-22)
answer most of the graft's "not reconciled" list, so the residual hooks of
[engine-graft](#engine-graft) were retired and this site's identity moved into
`config/client.json` `identity` — the product-owned seam, never an edit on an
engine file:

- **brand** `Halli Smiley` / legalName `Halli Smiley` / alternateNames
  `Hallismiley`, `Halli`, `halli smiley` (the base's WebSite schema) /
  titleSuffix ` — Halli Smiley`. The nav lockup, `og:site_name`, `<meta author>`,
  the WebSite and Organization JSON-LD and the email strings (`{siteName}` /
  `{siteHost}`) follow it; the seven `email.*` overrides and the
  `author`/`og:site_name` edits on `index.html` are gone.
- **locale** `publicDefault: en` (the base's default; `/` → `/en/`).
- **theme** `classic` default and root, picker = the base's six ids
  (`classic`, `glacier`, `moss`, `lava`, `aurora`, `black-sand`). The
  `THEMES` edits on `themePrefs.js`, `theme-boot.js` and `server/config/themes.js`
  are gone; the five token sets stay appended in `themes.css` (product CSS) and
  their names in the product overlay.
- **hero** `waterfall-bk-v1.mp4` + a poster extracted from its first frame
  (`waterfall-bk-v1-poster.jpg`, new — the base served the clip without one).
- **surface** `hiddenRoutes` = the three Orange Smiley company pages
  (`/thjonusta`, `/um-okkur`, `/hafa-samband`) + `/aron13ara`; the portfolio
  (`/verkefni`, `/halli`, `/news`, `/shop`, `/party`, `/contact`, `/privacy`)
  is public again. `hiddenAdminViews` = [] (the base hid nothing).
- **organization** halli@hallismiley.is, the base's Person description,
  knowsAbout and sameAs (GitHub, LinkedIn). The record is an Organization,
  not the base's Person `#person` — the seam has one shape.
- Brand strings that were edits on the engine's locale tables
  (`nav.brandAriaLabel`, `signup.checkEmail`, `projectDetail.brandPara1/2`) are
  overlay keys in `product.{en,is}.json` — an overlay key overriding an engine
  key is the intended use since engine `c43a092`.
- `tests/unit/featureRegistry.test.js` and the `describe.skip` in
  `salesGuidesServicesPage.test.js` are the engine's again: `features/os/` is
  foreign and its suites skip through the gate. `features/hs/inert-engine-product-files.md`
  claims no paths any more (a second claim reads as double-claimed).
- `Dockerfile` `COPY engine.json` merged clean (same line both sides).

**The one hook left:** `/aron13ara` — the route + view (product-owned files),
`ROUTE_META` + `DEFAULT_META.aron13` (`titleMode: 'bare'`) in `ssrMeta.js`, the
entry in `pageTitle.js`, and the Icelandic-only lock (`IS_ONLY_PAGES` in
`server/config/i18n.js` + the client mirror, with its cases in the two
`localeLock*` tests). It is noindexed through `identity.surface.hiddenRoutes`
now, not through an edit on `publicSurface.js`.

**What the seam still lacks for this site** (each one an engine change, not a
hook here):

1. **The public IA is still the company's.** `NavBar.js` links `/thjonusta`,
   `/um-okkur`, `/hafa-samband` as literals — it does not filter by
   `identity.surface.hiddenRoutes` — so hallismiley's nav offers three
   noindexed company pages and none of the portfolio links the base had
   (Projects, Shop, News, About, Contact). `tests/integration/ssrMeta.test.js`
   ("hidden public surfaces": six portfolio routes noindex, `/thjonusta` &c.
   indexable) and `e2e/navigation.spec.js` ("the public nav offers only the
   business routes", the `/thjonusta` click-throughs) and
   `e2e/business-routes.spec.js` pin that IA as literals rather than reading
   the seam. `server/routes/sitemapRoutes.js` `STATIC_ROUTES` is the same
   literal list: the sitemap names the three hidden company pages and none of
   the portfolio.
2. **Page parts are engine copy.** `DEFAULT_META` / `pageTitle.js` hold the
   company's page parts: the home part is `{brand} — AI-driven software company`
   (the base said "Icelandic Carpenter & Computer Scientist"), and the
   descriptions of `/`, `/verkefni`, `/contact`, `/privacy`, `/terms` are
   Orange Smiley's. Not overridable from a product-owned file.
3. **`tests/unit/identityConfig.test.js`** "this instance's committed
   config/client.json spells the same values out" asserts the committed file
   resolves to the Orange Smiley values — true only in the engine. Needs a
   guard on `engine.json.role === 'engine'`.
4. **The home composition** carries the engine's `home-products` section
   (the Rekstrarkerfið card) between the hero and the news row; `_tiers` /
   `_steps` are dormant. The rest — hero, news, projects, skills, stats,
   contact — is the base's order.
5. **`classic` is Bjart**, not the base's charcoal-and-gold (`variables.css`
   `:root` is engine-owned; `public/css/product/**` is product-owned but
   nothing loads it yet).
6. `manifest.json` name/short_name, the Product-schema `brand` and the
   Organization `@type` (the base had a Person) are engine literals.
7. **`APP_URL` must be set on the App Service**: the engine's fallback origin
   is `www.orangesmiley.is` since 2026-09-22 (the base's was hallismiley.is).
   `deploy.yml` does not set it; verify the App Service setting before merge.
8. **Engine suites that assume the Icelandic visitor default.** With
   `publicDefault: en` the API answers English and the OAuth callbacks land on
   `/en/`, and `auth`, `auth.google`, `auth.facebook`, `contact`, `media`,
   `projects` (128 cases) plus `localeLock` "Accept-Language never moves a
   visitor off Icelandic" assert Icelandic strings and `/is/` literally.
9. **Engine-only assumptions in engine tests**: `identityConfig` (the
   hand-off tests read the INSTANCE identity, not `defaults()`),
   `i18nIdentity` "with the engine defaults" (same), `featureGate` "in the
   engine nothing is gated" (a downstream's `local.json` is never empty),
   `featureRegistry` (the `features/os/` glob `server/config/product-migrations/**`
   also claims `hs.js`, so the hs claim on it was dropped here; and the
   foreign-folder test assumes `features/os/` is the only other folder).
   `salesGuidesD001.test.js` reads the os_001 migration at module load, so it
   fails before `describeForSpec` can skip it.

**Jest on this branch** (`hs_graft_test`): 138 suites / 3192 tests pass;
14 suites / 92 tests fail, every one in items 1, 3, 8 and 9 above. Fixed
through the overlay meanwhile: `footer.companyLine` (the engine's carried the
company's kennitala and VAT number). Not a divergence in production: the home
hero copy comes from the `home_hero` `site_content` row, which hallismiley.is
has ("Halli / Smiley / and his friend claude"); only an unseeded dev copy
shows the engine's literal fallback in `HomeView.js`.
