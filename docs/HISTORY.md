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
| 2026-09-22 | [Engine upstream — this repo becomes the parent of every repo (D-021)](#engine-upstream-2026-09-22) | Two layers (source by merge, runtime by product channel); `engine.json` + feature wiki; two-array migrations (091/092/104 → `os.js`, theme CHECK → 106); `engine-sync` / `engine-harvest` / `engine-drift`; icelandicstore is the current source of generic work |
| 2026-09-22 | [Handbook on D-001 pricing and the demo instance (D-020 step 5)](#handbook-d001-2026-09-22) | 13 of 14 seeded guides rewritten: build fee + service contract + verkeiningar, demos on `demo.rekstrarkerfi.is`; first product migration `os_001`; test pins seed == migration; all DRÖG |
| 2026-09-22 | [Leads transfer — enquiries from the other instances reach ops (D-020 step 4)](#leads-transfer-2026-09-22) | `leads:export` (submission fields only) / `leads:import` (one transaction, `ON CONFLICT DO NOTHING`, an ops row is never updated); by hand weekly, a timer once ops is on Azure; no migration |
| 2026-09-22 | [Identity seam + feature gate (D-021)](#identity-seam-2026-09-22) | `identity.*` in `config/client.json` owns brand, locale, theme trio, hero, hidden surfaces, Organization; ssrMeta hands it to the page; email strings take `{siteName}`/`{siteHost}`; engine tests read the seam; `features/local.json` + the feature gate skip a hidden feature's suites; no migration |
| 2026-09-23 | [Identity seam, second iteration — the public IA, the page meta and the engine-only pins (D-021)](#identity-seam-2-2026-09-23) | `identity.surface.nav` drives the nav, both footers and the sitemap; `meta.<key>.*` i18n keys replace the ssrMeta/pageTitle literals; `/manifest.json` and the Product brand from the identity; engine suites assert the visitor default via `tests/lib/locale.js`; engine-only pins gated on `engine.json.role`; the `.view` fade fill-mode dropped (hallismiley's news-editor regression); no migration |
| 2026-09-23 | [Harvest from rekstrarkerfid — mandatory 2FA enrolment, TOTP secret sealed at rest (D-021, first upward pick)](#harvest-rk-totp-2026-09-23) | rk `4df0943` cherry-picked with `-x`; `auth/mfaPolicy.js` from `attachRoles`, widened to the engine's gate (role withheld for admins, `accounts` view for holders); `utils/secretBox.js` + migration 107 (rk's 093, aliased); `ADMIN_TOTP_EXEMPT`, `TOTP_ENC_KEY`, break-glass script; issuer wired to `identity.brand.name` after the seam merged |
| 2026-09-23 | [rk feed — six engine defects rekstrarkerfid's syncs found (orange-smiley/rekstrarkerfid#45)](#rk-feed-2026-09-23) | Lead ids as strings end to end; migration 108 `notified_at`/`notify_error` + the "ekki sent" inbox mark; the change-request launcher and the contact editor's bar stack (`--cr-widget-clearance`); legal titles on one line at 320px; sitemap `<lastmod>` from `site_content` + `identity.routes[*].contentKeys`, `/llms.txt` for every product (harvested from rk); the alias rule worded as enforced |
| 2026-09-23 | [Identity seam, third iteration — a product's own routes, the derived files, the last engine pins (D-021)](#identity-seam-3-2026-09-23) | `identity.routes` (title/description keys, `bare`, `noindex`, `locale`) merged over ssrMeta/pageTitle and read by the locale lock, robots, sitemap, manifest; `organization.description` as a key per locale, `organization.ogImage`, `theme.swatches`; the last engine-site pins gated (meta literal, Service catalogue, company click-throughs, foreign Features links); `identityDownstream` composes every title from the overlay, HTML-escaped, and walks a routes block; site-factory `engine-sync.js` regenerates `.engine-paths`/`.gitattributes` on conflict; no migration |
| 2026-09-23 | [Two-factor enrolment optional by default — `security.mfa.enrolment`](#mfa-optional-2026-09-23) | Halli: "change mfa to optional"; `optional` (default) or `required` in `config/client.json`, env `CLIENT_CONFIG_SECURITY_MFA_ENROLMENT`; `mfaPolicy.mustEnrol` false unless required; enrolled accounts still challenged; seller area rule 4 unchanged; mandatory-path tests set `required` for themselves, e2e server runs `required`; no migration |
| 2026-09-23 | [`/ready` details and the product-import body behind the gate](#ready-and-import-order-2026-09-23) | Two findings from rekstrarkerfid's 2026-09-19 review, fixed in the engine: anonymous `/ready` returns status/uptime/timestamp only (`checks` follow the `/metrics` rule, `internalsDenied()`; admins read `GET /api/v1/admin/events/health`); the 4 MB import and 5 MB change-request parsers moved into their routers behind the gates, `sanitizeBody` re-applied; the review found `sanitizeBody`'s tag regex quadratic (100 kb of `<` = 2.3 s, before any limiter) — replaced by a linear, byte-identical `stripTags()`; no migration |
| 2026-09-23 | [SSR splices saved copy literally — replacer functions in `ssrMeta.js`](#ssr-replace-literal-2026-09-23) | Öryggisvörður LOW from rekstrarkerfid: `$&`/`` $` ``/`$'`/`$$` in site_content copy and in the request path (og:url, no login needed) were expanded by `String.replace`; 17 calls in `rewriteHead` + `injectCrawlerContent` now take `() =>`; regression tests through `<head>`, JSON-LD and the crawler mirror; the review found the same bug in both `t()` interpolations, fixed too; no migration |

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
<a id="harvest-rk-totp-2026-09-23"></a>
## 2026-09-23 — Harvest from rekstrarkerfid: mandatory 2FA enrolment, TOTP secret sealed at rest (D-021, first upward pick)

The first commit to travel UP the engine tree under D-021: rekstrarkerfid's
`4df0943` (2026-09-18, "admin two-factor enrolment is mandatory, not an option
on the profile page" — Öryggisvörður's review while fact-checking its
/um-kerfid page, which promises "TOTP fyrir stjórnendur"). rk's history has no
`Feature:` trailers and `engine-harvest --list` keys on commits after the graft
merge, so it listed nothing; the pick was named by hand
(`git cherry-pick -x 4df0943`, a real three-way pick since the 2026-09-22
graft) and the rk-only hunks trimmed. Branch `from-rk/2026-09-23`.

**What the engine took, and how it was widened**

- **The rule, in one file — `server/auth/mfaPolicy.js`.** rk withholds `admin`
  from an unenrolled admin at every session reader. The engine's gate is wider
  (`mfaService.protectedRole`: admin OR `accounts` holder OR published seller,
  ENHANCEMENTS #17 + D-020), so the policy asks `protectedRole` and withholds
  what made the account protected: `admin` from the role set for an admin
  (effectiveRoles); the `accounts` view and a wildcard grant from the resolved
  views for a holder (`withholdViews`, called by `requireView` — the one place
  views are resolved for a guard — and by `roleFields`); a published seller's
  routes already demand `totp_enabled` (rule 4 of `sellerRoutes.js`). Other
  roles and views keep working. Applied from `attachRoles`
  (`auth/middleware.js`), which every session reader shares here (rk still
  had four copies; the engine's 2026-09-03 cleanup means ONE hook), plus the
  shop router's private `requireAuth`. The `accounts` flag needs the resolved
  views, so `applyMfaPolicyToRequest` looks them up (Role cache) only for an
  unenrolled, non-exempt, non-admin account — enrolled accounts, exempt
  accounts and admins cost nothing extra.
- **Session payloads** (`roleFields(user)`, now taking the user row) report the
  same downgrade plus `mfa_enrolment_required`; `loginTotp` now selects
  `totp_enabled` (without it the policy read "not enrolled" off the account
  that had just passed the second factor). `isEnrolmentEligible` short-cuts on
  the flag: an account that owes enrolment is always eligible. The 403 says why
  (`forbiddenMessage` in `auth/roles.js`, `errors.auth.mfaEnrolmentRequired`,
  worded for any protected account, not just admins). SPA: `auth.js`
  `mfaEnrolmentRequired()` + `refreshSession()`; `LoginModal` sends the person
  to `/profile` with `profile.twoStepRequired`; the router bounces `/admin*`
  there; `ProfileView` renders the panel on `isMfaProtected() ||
  mfaEnrolmentRequired()` and `totpConfirm` merges silently so the one-time
  recovery codes survive until "I saved them" calls `refreshSession()`.
- **The secret at rest — `server/utils/secretBox.js` + migration
  `107_totp_secret_enc`.** AES-256-GCM under `TOTP_ENC_KEY` (32 bytes, base64
  or hex; malformed → boot refuses, unset → plaintext as before, production
  warns), the user id as associated data, `v1:` prefixed. EXPAND phase: both
  columns written, the sealed copy read first with a plaintext fallback, a
  pre-107 account sealed at its next successful sign-in (`COALESCE`); N+1
  stops writing the plaintext, N+2 drops it (invariant 14). rk applied the same
  DDL as `093_totp_secret_enc`; its product file must alias
  `'107_totp_secret_enc': ['093_totp_secret_enc']` and REMOVE `093` from its
  `legacy` array — a legacy entry with an engine equivalent is aliased, never
  kept, or a fresh database runs the DDL twice; `tests/unit/migrationSet.test.js`
  enforces it (an alias value may name nothing in any array), and rk did
  exactly that on its next sync (`docs/MIGRATIONS.md`; corrected in
  [rk-feed](#rk-feed-2026-09-23), the entry first said "keep 093 untouched").
  Verified in Jest: a plaintext-only account
  signs in and is sealed on the way; a sealed-only row is enough; a foreign
  ciphertext is refused; with no key the plaintext path still works.
- **Also taken**: `ADMIN_TOTP_EXEMPT` (ignored under `NODE_ENV=production`,
  boot warns; `tests/env.js` sets `*`, Playwright exempts `testadmin`);
  `server/scripts/reset-admin-totp.js` (break-glass, both columns, ends the
  sessions); party magic links refuse admin accounts; `utils/safeEqual.js` for
  the `/metrics` bearer compare; `docs/ADMIN-2FA.md` (runbook, three-release
  plan, rollout); `.env.example` and `docs/DEPLOYMENT.md` §5 rows.
- **Trimmed from the pick**: rk's `brand.name` section in `clientConfig.js`
  (the identity seam, merged from master the same day, owns that file; the
  issuer is then wired to `identity.brand.name` in a follow-up commit on the
  branch, with rk's issuer test re-added against the seam); rk's CLAUDE.md /
  LESSONS.md hunks; the `/api/v1/content/um_kerfid` probe (engine key `home`).
- **Tests**: `tests/unit/mfaPolicy.test.js` (policy incl. the wider gate,
  `withholdViews`, `applyMfaPolicyToRequest`, secretBox, safeEqual);
  `tests/integration/adminTotpEnforcement.test.js` (20, under the production
  rule: admin, admin-by-set, accounts holder loses only `accounts` and gets it
  back on enrolling, handbook-only seller untouched, same-session unlock,
  disable re-gates, magic link, both columns, legacy seal, sealed-only, foreign
  ciphertext, no-key path, `/metrics`); `e2e/admin-totp-enrolment.spec.js`
  (a real admin through the flow, then the break-glass script).

**Next harvest candidates seen in rk** (not picked): `features/rk/social-login-gate.md`
and `features/rk/request-logging.md`; the issuer/`brand.name` hunk once the
identity seam has landed.
<a id="identity-seam-2-2026-09-23"></a>
## 2026-09-23 — Identity seam, second iteration: the public IA, the page meta and the engine-only pins (D-021)

**Why.** hallismiley's second sync (PR pepti/hallismiley#168, the engine at
`92308d2`) took the first seam and showed what it still lacked — every item
engine-side, nothing a downstream could fix in a product-owned file: the
`NavBar.js` links and `sitemapRoutes.js` `STATIC_ROUTES` were the company's
three pages as literals (so Halli's site linked three noindexed pages and
advertised none of its own), the page parts and descriptions in
`DEFAULT_META` were company copy, the home `home-products` card and the
`manifest.json` name were the company's, the Product-schema `brand` was one
product's name, and 128 Jest cases plus three e2e cases asserted Icelandic API
strings and `/is/` redirects that are only true where the visitor default is
`is`. Six engine tests pinned facts about the engine's own repo (the committed
`client.json`, an empty `local.json`, `features/os/` being the only foreign
folder, os_001 being in the migration set, `midnight` being in the picker) and
went red on any downstream. And two of hallismiley's own specs failed after
taking the engine.

**The public IA is config.** `identity.surface.nav` — an ordered list of
`{ route, labelKey }` records (a new `object[]` schema type in
`clientConfig.js`, JSON in the env layer, validated per entry; defaults = the
business nav with its existing `nav.*` keys) — joins `hiddenRoutes`.
`publicSurface.js` derives `PUBLIC_NAV` (nav minus hidden; hidden wins) and
`LEGAL_ROUTES`; `utils/identity.js` mirrors both as `publicNav()` /
`isHiddenRoute()`, with the record-list merge in `resolveIdentity`. The
NavBar, the home and contact footers and the sitemap (`/`, nav in nav order,
legal — one entry per locale) read those; the home products card renders only
while `/thjonusta` is public; the footer mail icon is
`identity.organization.email`. `config/client.json` spells `nav` out as the
worked example.

**The page meta is i18n.** `DEFAULT_META` in `ssrMeta.js` and `PUBLIC_TITLES`
in `pageTitle.js` now name KEYS — `meta.<key>.title` (both tables) and
`meta.<key>.description` (server table) — and the text moved into the engine
i18n tables, so a product overrides a title or description in its
`product.<locale>.json` on both sides. The company's name in a description is
`{legalName}`, a third implicit param of `t()` (the tables still carry no
brand); `has(locale, key)` tells an absent description (privacy, terms) from
text. `pageTitle.test.js` keeps its read-the-source mechanism: it parses
`ROUTE_META` and the key-based `DEFAULT_META`, holds the client keys and modes
to the server's, holds the client and server tables to the SAME TEXT per title
key, and composes both sides over the on-disk table. `/manifest.json` is a
small route (`manifestRoutes.js`, before the static mount) that fills
`name`/`short_name`/`description` from the identity over the static engine
default; the Product-schema `brand` is `identity.brand.name`. The Organization
`@type` stays `Organization`: schema.org accepts it for a personal site, and
a downstream does not fork it.

**Tests assert the resolved config.** `tests/lib/locale.js` exposes
`PUBLIC_DEFAULT_LOCALE` (what `config/i18n.js` resolved), `tx(key, params)`
(the server table in that locale), `tClient(key)` (the SPA table, for e2e)
and `localePrefix()`; `auth`, `auth.google`, `auth.facebook`, `contact`,
`media`, `projects`, `localeLock` and `signup-flow.spec.js` now compare
against the exact translated string or the `localePrefix()` target — no assertion
weakened, and the party route's `/is/` stays literal because it is
locale-locked. Engine-only pins are gated on `engine.json.role`:
`identityConfig.test.js` compares `defaults()` and passes the identity into
every hand-off helper; `i18nIdentity.test.js` resolves a temp `client.json`;
`featureGate.test.js` splits "every suite maps to a feature" (everywhere) from
"nothing is gated" (engine); `featureRegistry.test.js` accepts any foreign
folder, and `features/os/company-content.md` claims
`product-migrations/os.js`, not the folder (it was claiming a downstream's
own `<id>.js`); `salesGuidesD001.test.js` reconstructs the old text inside the
gated describe; `iceland-scene.spec.js` pins Miðnætti's grade only where the
picker offers it and walks the nav routes that wear a scene
(`server/config/sceneRoutes.js`, split out of ssrMeta so the spec does not
pull the middleware's database and template watcher into the runner).
`identityDownstream.test.js` now runs hallismiley's real block (brand,
`en`, classic + six-theme picker, waterfall, the three company pages hidden,
nav = verkefni/news/halli) and asserts the served nav, the sitemap, the
titles, the `{legalName}` description, the manifest and the noindex split.

**The downstream regressions.** hallismiley's `news-editor.spec.js` (overlay
at y=56, 0 expected) was the ENGINE's: `main.css` had `.view { animation:
fadeIn 300ms ease forwards }` — the end keyframe's `translateY(0)` is not
`none`, so the fill kept `.view` the containing block of every
`position:fixed` descendant, and the overlay sat below the 56px nav, sized to
the page. hallismiley's pre-graft base had already dropped the fill-mode and
the engine's sync had put it back. Fixed here (no fill; the end keyframe IS
the natural state) and the spec ported as `e2e/news-editor.spec.js` (news
feature, gated). `aron13.spec.js` ×2 ("crafting cells never stable") is a
hallismiley-only view the engine cannot run; its CSS has the same
reduced-motion block before and after the graft and nothing in the engine's
`motion.js` / `reveal.js` touches it, so it is not reproduced here — the
`.view` fix is the one engine change that alters what moves on that page,
and hallismiley re-runs the spec on its next sync (PLAN → Status).

**LedgerLink's addendum (its second sync, orange-smiley/ledgerlink#11), folded
in where engine-side.** The theme set now validates `default ∈ picker` only
(a two-theme product keeps `:root` as an unlisted base) and
`identity.theme.dark` names the dark ids — `themePrefs.js` `DARK_THEMES`
reads it, the swatch fallback stays token-built. `nav.brandAriaLabel` is
`{siteName} home` / `{siteName} — forsíða`, composed from `brand.name`. The
Service catalogue JSON-LD (the company's offering) is emitted only while
`/thjonusta` is public. `/robots.txt` is a route (`robotsRoutes.js`) whose
Disallow lines come from `hiddenRoutes` per locale, over the static engine
default. Engine tests that pinned this repo: `architectureIndex` ignores
foreign features; `identityDownstream` and `pageTitle.test` take the home
part from the table; `admin-surface.spec` asserts payroll/handbók/feedback
only where not hidden; `admin-nav-colors.spec` tints the first line the
product does not hide; `admin-monitoring.spec` reads a surface fill + border
+ padding as the styling tell, not the radius; and the feature gate treats a
feature whose registry `flag` resolves to `false` as `disabled`, so the seven
self-update suites that assert the ON state (`describeForSpec`) and
`admin-updates.spec.js` skip on a product that ships the module off. No
Barlow probe exists in the engine's suites (it is LedgerLink's own). **Not
done, on purpose:** `identity.routes` (a product slot for its own public
routes' meta, titleMode and noindex merged over `ROUTE_META` /
`DEFAULT_META` / `PUBLIC_TITLES`) — a hook in `ssrMeta.js` and `pageTitle.js`
is still needed for a route like `/aron13ara` or `/console`; it is the next
iteration (PLAN → Status).

**Docs.** `docs/DEPLOYMENT.md` §5 says the `APP_URL` fallback is the engine's
origin and every downstream sets it; ENGINE-SYNC §6 lists what the seam owns
now. No migration.

<a id="identity-seam-3-2026-09-23"></a>
## 2026-09-23 — Identity seam, third iteration: a product's own routes, the derived files, the last engine pins (D-021)

**Why.** All three downstream syncs onto the second seam asked for the same
things (pepti/hallismiley#168 sync 3, orange-smiley/ledgerlink#11,
orange-smiley/rekstrarkerfid#44): a product slot for its OWN public routes'
meta — hallismiley's `/aron13ara` (Icelandic-only, hidden), LedgerLink's `/`,
`/console` and `/original` (noindex), rekstrarkerfid's landing rows were
still hooks in `ssrMeta.js` and `pageTitle.js`; a handful of engine tests
that still pinned the engine's own site (the meta-literal pin, the Service
catalogue cases, the six company click-throughs, `identityDownstream`'s
literal "Our work — Halli Smiley" and its raw-table manifest read, the
Features row that links `features/os/company-content.md`); and
`.engine-paths` / `.gitattributes` conflicting on every sync because they are
generated per repo. Plus the small asks: a per-locale Organization
description, an og:image path in the seam, picker swatches per theme id.

**`identity.routes` — a product's routes are config.** A map of bare route
(or `/`) → `{ titleKey, descriptionKey?, titleMode?, noindex?, locale? }`, a
new `object` schema type in `clientConfig.js` (JSON in the env layer;
`$comment` keys inside ignored at any level; `defaults()` hands out a fresh
map; validated per entry — i18n-key shape, `bare|suffix`, boolean, locale
id, no unknown fields). `server/config/identity.js` `productRoutes()`
normalises it once. Readers: `ssrMeta.js` merges each entry over
`ROUTE_META` (`product:<route>` key, replacing any engine row for that route
whole — no `site_content` override, no shop section) and `DEFAULT_META`
(the i18n keys + mode), after the literal tables the parity test parses;
`pageTitle.js` reads the same entries off the hand-off in `titleForRoute`
and lets them win over its table; `config/i18n.js` `forcedLocaleFor` asks
the party lock first, then `identity.routes[*].locale` (prefix-aware like the
party lock, `/` locks the landing alone, an unsupported locale is ignored);
`publicSurface.js` `NOINDEX_ROUTES` / `isDeindexedRoute()` (exact routes —
a noindex route may still be linked) drive the `<meta robots>`, a robots.txt
Disallow block and the sitemap filter; `/manifest.json` describes itself from
`routes['/'].descriptionKey` when the landing is re-described. The client
mirror: `utils/identity.js` `routeMeta()` / `routeLockFor()` and a
record-by-record map merge in `resolveIdentity`; `i18n/i18n.js`
`forcedLocaleFor` consults the lock, so the Router guard, `href()` and the
NavBar's switcher follow. The engine's `config/client.json` carries
`routes: {}` with a `$comment` as the worked example.

**The small asks.** `identity.organization.description` may be an i18n KEY
(`org.description`) — `organizationSchema(locale)` resolves it through the
overlay per locale, a literal is emitted as written (`organizationDescription`
in `identity.js`, table-injected so the module stays free of `server/i18n`).
`identity.organization.ogImage` is the og:image card every page falls back to
(`OG_IMAGE_PATH` reads it; `organization.image` stays the entity's picture —
same file, not the same idea). `identity.theme.swatches` (`{ id: { bg, fg } }`,
CSS colour literals) feeds `themePrefs.js` `swatchFor` as the same
accent→background gradient the engine's use, over the engine map, over the
neutral token fill. `theme-boot.js` is untouched (it keeps reading the
`<html>` attributes; rk's `html.js` mark stays rk's).

**Engine tests that pinned the engine's site.** `i18nIdentity` — the
meta-literal pin is `testEngine` (a product overlays `meta.home.title`).
`ssrMeta.test.js` — the four Service-catalogue cases gate on
`isHiddenRoute('/thjonusta')` (`testServices`); the hidden/indexable paths
are built with `forcedLocaleFor(route) || LC`; a describe for the product's
noindex routes. `sitemap.test.js` — `localesOf(path)` (a locked route once,
under its locale, with no alternates), the advertised list minus
`NOINDEX_ROUTES`, the hreflang probe on the first unlocked route.
`e2e/navigation.spec.js` — the products card and the five company
click-throughs run only where `/thjonusta` is public; `e2e/business-routes`
expects a locked nav route under its own locale (`e2e/lib/identity.js` now
exports `isHiddenRoute` + `forcedLocaleFor`). `identityDownstream.test.js` —
every expected title is composed from the isolated app's own `t()` (engine
table + overlay, `{siteName}` etc. resolved to the downstream) with
`composeTitle`, compared HTML-escaped; the manifest description too; nothing
literal; hallismiley's block gains `/party` in its nav (listed under `is`
only); and a second app boots LedgerLink-style with the `routes` block above
over a mocked overlay and asserts title (bare, escaped `&amp;`), description,
noindex, the sitemap (locked once, noindex never), robots.txt, the 301s
(`/en/aron13ara`, bare, sub-route, with an `en` cookie), the canonical with no
`en` alternate, the manifest, the per-locale Organization description and
og:image. `architectureIndex` — a Features-row link to another product's
folder is allowed but not required (the engine's own row links
`features/os/company-content.md`, foreign in every downstream). `pageTitle
.test.js` keeps its parse-the-source mechanism for the engine tables and adds
a routes walk over a synthetic identity and over this repo's committed
`config/client.json`, loading a fresh `pageTitle` over a stubbed hand-off.
`localeLock` / `localeLockClient` pin the routes lock on both sides through
a temp `client.json` / a stubbed hand-off. `featureGate` / `identityConfig`
had no engine-only pin left ungated (verified).

**The derived files.** `scripts/features-index.js` is idempotent per repo
already; the fix is in the tool: site-factory `engine-sync.js`
(`feat/engine-sync-regen`, `1e186fe`) resolves a conflict on exactly
`.engine-paths`, `.gitattributes` (and `features/README.md`) by running
`node scripts/features-index.js` in the downstream and staging the result —
right after the merge, again in `finish()` after `--continue` (once any
conflicted `features/*.md` the generator reads are resolved), and a
`--check` before verification; `--theirs` there would take the ENGINE's
product paths. The report names the regeneration and `engine.json`'s history
entry records `regenerated`. Smoke: a mini engine with a `features-index.js`
stub that writes a marker line; a manufactured conflict syncs with exit 0.
ENGINE-SYNC §6 says so.

**What this closes downstream.** hallismiley: the `/aron13ara` rows in
`ssrMeta.js` + `pageTitle.js`, the IS-only lock in `config/i18n.js` + the
client mirror, the cases in the two `localeLock*` tests, the six gated test
lines, the Features-row link — all become `routes: { "/aron13ara": {
titleKey, titleMode: "bare", locale: "is" } }` + overlay keys. LedgerLink:
the `/`, `/console`, `/original` rows and the `{brand} — The invoice is
already there.` part, the swatches in `themePrefs.js`, the raw-table
`identityDownstream` edit. rekstrarkerfid: its landing/eiginleikar/verdskra/
um-kerfid rows, the per-locale description, the OG-card path, the swatches.
No migration.

**Still open, on purpose.** rk's `html.js` mark in `theme-boot.js` (rk's
own); a crawler-summary hook for a product landing (LedgerLink's `/`
crawler block); the sitemap beyond nav + legal (hallismiley's
`/shop/products` etc.); the `/party` nav link's class/aria; `classic` as
Bjart. PLAN → Status.

<a id="rk-feed-2026-09-23"></a>
## 2026-09-23 — rk feed: six engine defects rekstrarkerfid's syncs found (orange-smiley/rekstrarkerfid#45)

**Why.** rekstrarkerfid's two engine syncs of 2026-09-23 (b) left a list of
things that broke or were missing in ENGINE files — nothing rk could fix in a
product-owned file for good — and filed them as one issue, "Feed for the
engine" (orange-smiley/rekstrarkerfid#45). Items 1, 5 and 8 of that list were
already in identity-seam-3; this chunk takes the rest: 2, 3, 4, 6, 7 and 9.
Branch `fix/rk-feed`; no downstream file was touched.

**Lead ids are strings, end to end (#2).** The engine's `leads.id` is SERIAL;
rk's table predates the engine's 097 (its `092_leads`) and holds TEXT uuids —
and `AdminLeadsView` coerced `dataset.id` with `Number()`, so a uuid became
NaN and the detail never opened, while `leadsController._id` rejected any
non-integer with 400. Now `parseLeadId()` (exported) accepts a positive
integer or a uuid and returns the STRING it was given; `Lead.findById` /
`update` / `remove` compare `id::text = $1` (the table is bounded by the
retention job, the cast costs nothing); the view compares `String(l.id)` and
never coerces. Tests: `tests/unit/leadId.test.js` (the parser) and a
`leads.test.js` case that walks GET/PATCH/DELETE with a uuid — a clean 404
here, never a 400 and never the 500 that pg's 22P02 gave before — plus the
rejected shapes and the integer round-trip.

**The notification outcome on the lead — migration 108 (#4).** rk records
whether the notification email went out (`notified_at` / `notify_error`)
since 2026-09-15, when a PROD box with no `RESEND_API_KEY` made every enquiry
vanish behind a "received" reply; the engine gained `Lead.recordNotification()`
only inside rk's graft. Now the engine's: `108_leads_notification` adds the
two columns (`ADD COLUMN IF NOT EXISTS` — on rk's databases both are no-ops
because its `092_leads` created them, and NO alias is needed: an alias says
"the same DDL ran under another name", and rk's `rk_001` did far more than
this; the migration comment says so), `Lead.recordNotification(submissionId,
error)` never throws (sent → `notified_at = NOW()`, error cleared; failure →
the reason, capped at 500), `sendLeadNotification` resolves `true` / `false`
(no transport) / throws, and `contactController` records the outcome once
the insert and the send have BOTH settled (the write would otherwise race the
insert), with a trailing catch so the chain can never surface — the visitor's
200 is untouched. The inbox shows a small "ekki sent" / "not emailed" mark
next to the status (`leads.notEmailed`, the reason in `leads.notEmailedHint`
on hover; `--warning` wash, tokens only). `leads:export` carries nothing
new: workflow columns stay out. Tests: `recordNotification` both ways and
the never-throw, the controller path under mail true / false / rejected, the
inbox carrying the fields; `e2e/leads.spec.js` asserts the mark on the e2e
server (no transport there, so every lead is "email not configured").

**The launcher and the editor's bar stack (#3).** Since the `.view`
containing-block fix (identity-seam-2) the contact editor's Save/Cancel bar
(`contact.css`, bottom-right, z 90) and the change-request launcher
(`#cr-widget`, bottom-right, z 240) are BOTH really fixed to the viewport,
and the launcher covered the buttons. The widget now sets
`body.has-cr-widget` on mount and removes it on destroy; `test-env.css` sets
`--cr-widget-clearance: 64px` on that class; the bar's `bottom` is
`calc(24px + var(--cr-widget-clearance, 0px))` (12px in the phone rule). A
length, not a colour, so every theme reads the same (invariant 15). The e2e
case in `contact.spec.js` signs in an admin on the test stack (the widget is
always there), opens the editor, asserts the bar's box ends above the widget's
and clicks Save (`trial`) and Cancel — Playwright refuses a click another
element intercepts, so the click is the proof.

**Legal titles at 320px (#6).** `.ice-band-panel .legal-title` floored at
`1.2rem` and wrapped PERSÓNUVERNDARSTEFNA mid-word on a 320px phone
(rk's `qa-chrome-findings.spec.js`). The floor is `0.95rem` (`clamp(0.95rem,
4.8vw, 2rem)`), `overflow-wrap: normal; hyphens: manual` — a heading may
break at a space, never inside a word. `iceland-scene.spec.js` now asserts
one line and no overflow for both Icelandic titles at 320 and 375px, and every
word intact for the English ones.

**Sitemap `<lastmod>` and `/llms.txt`, harvested (#7).** rk's
`sitemapRoutes.js` (its `0a928c9`, 2026-09-15) carried both as product hooks;
the generic halves are the engine's now, `Feature: public-site`,
`engine.json.history` records `harvestedFrom: rk@2d9570d`. `<lastmod>` is the
newest `site_content.updated_at` among the rows a page renders, either
locale, as a date: engine routes from `ssrMeta.contentKeysForRoute()`
(`ROUTE_META`'s meta row + what the page renders — `/`: home_hero/skills/
stats, `/hafa-samband`: the five contact rows), a product route from the new
`identity.routes[*].contentKeys` (validated as `site_content` keys, mirrored
in the client `routeMeta` so both halves normalise alike). One query, cached
in-process for the response's 10 minutes; an admin save (`putContent`,
`uploadImage`) drops the cache; a page with no row gets no value — a deploy
timestamp would be a lie search engines learn to ignore. `/llms.txt`
(llmstxt.org) is the brand as H1, the Organization description (per locale
through the seam) as the blockquote, the legal name and place, then every
ADVERTISED page under each locale (a locked route under its lock only) with
its composed title — the brand suffix stripped, "Brand — x" as "Brand: x" —
and description from `ssrMeta.metaForRoute()`, so the summary and the
`<title>` can never disagree; gated on nothing. rk's pricing block
(`tierSummaries`) stays rk's. Tests: `sitemap.test.js` (lastmod follows a
save, absent without a row, a date not a timestamp, cached until dropped) and
the new `tests/integration/llms.test.js`, both reading the resolved seam.

**Wording (#9).** The harvest-rk-totp entry above said rk should keep
`093_totp_secret_enc` in `legacy` untouched; `docs/MIGRATIONS.md` and
`tests/unit/migrationSet.test.js` say the opposite and rk did the opposite: a
legacy entry with an engine equivalent is REMOVED from `legacy` and listed
under `aliases` (an alias value may name nothing in any array). The entry,
the "born downstream" paragraph of MIGRATIONS.md and PLAN's open item now
say that.

**rekstrarkerfid, on its next sync.** Retire its own copies: the
`recordNotification` / `notified_at` code in `Lead.js` and
`contactController.js` (the engine's is the same shape; keep rk's `rowId`
shim in `AdminLeadsView` only until the merge lands), the `LASTMOD_KEYS` /
`fetchLastmods` hook and the `/llms.txt` route in `sitemapRoutes.js`
(move the four route→key pairs into `identity.routes[*].contentKeys`;
the pricing block needs a product slot the engine does not have yet — keep
that one as a product route until it does), the `_id` uuid shim in
`leadsController.js`, the `h1.legal-title` override in `landscape.css`, the
`legacy` comment in `rk.js`. No alias for 108 (both ADDs are no-ops there).
*Correction, same day (rekstrarkerfid#46):* "no-op" held only for an existing
database. On a fresh one the engine list runs first, rk has superseded `097`,
so `leads` does not exist yet and 108 fails — rk now lists 108 under
`superseded`. The general rule is in `docs/MIGRATIONS.md` ("Superseding a
table means superseding what alters it").
Its `qa-chrome-findings.spec.js` 320px case and its `crawlerPages.test.js`
llms/lastmod cases can then point at the engine's.
<a id="mfa-optional-2026-09-23"></a>
## 2026-09-23 — Two-factor enrolment is optional by default: `security.mfa.enrolment`

**Why.** Halli, the same day the mandatory rule was harvested from
rekstrarkerfid ([harvest-rk-totp-2026-09-23](#harvest-rk-totp-2026-09-23)):
"change mfa to optional". Mandatory enrolment stays in the engine as a mode an
instance can choose; it is no longer what every instance gets.

**The switch.** `security.mfa.enrolment` in `server/config/clientConfig.js`
(new `security` section), `'optional' | 'required'`, default **`optional`**;
env `CLIENT_CONFIG_SECURITY_MFA_ENROLMENT` by the file's naming rule; any other
value warns at boot and keeps the default. This repo's `config/client.json`
spells out `optional` with a `$comment`.

**What changed, and what did not**
- `auth/mfaPolicy.js`: `enrolmentMode()` / `enrolmentRequired()` (exported with
  `ENROLMENT_ENV`). `mustEnrol()` is false unless the mode is `required`, so
  under `optional` `effectiveRoles` withholds no `admin`, `withholdViews` is
  never asked to strip `accounts`, no `mfaEnrolmentRequired` flag is set, and
  every session payload says `mfa_enrolment_required: false` — the SPA
  (router, LoginModal, ProfileView) never forces the panel. No client code
  changed. `applyMfaPolicyToRequest` skips its Role lookup under `optional`.
  The env var is re-read per call (like `ADMIN_TOTP_EXEMPT`) so a suite can
  flip the mode; a value the schema rejects is ignored there exactly as the
  boot resolution ignored it, so the two readings agree.
- Unchanged in both modes: `mfaService`'s login challenge (an enrolled account
  is asked for a code at every sign-in), the Prófíll 2FA panel and its "password
  only" hint (the non-blocking recommendation; `shouldEnrol` is its predicate,
  now documented as a recommendation, never a gate), `secretBox` + migration
  107 + `TOTP_ENC_KEY`, OAuth / party-magic-link refusals for admins, the
  break-glass script.
- **The seller area does not follow the switch.** `routes/sellerRoutes.js`
  rule 4 (D-020, before the harvest) demands `totp_enabled` for everything but
  `GET /me`; left as it is on purpose. Dropping that guard, or gating it on
  `enrolmentRequired()`, is the one-line change if Halli wants sellers optional
  too (`docs/ADMIN-2FA.md`).
- `server.js`'s production warning about `ADMIN_TOTP_EXEMPT` now says it
  matters under `required`.

**Tests.** The mandatory path keeps its coverage by asking for it:
`tests/unit/mfaPolicy.test.js` sets `required` in every describe that pins the
rule and adds six cases for `optional` (mode resolves to optional; nobody must
enrol; roles kept, no flag; no lookup per request; a bad env value ignored;
`required` restores withholding). `tests/integration/adminTotpEnforcement.test.js`
sets `required` in its top-level `beforeEach` and adds four API cases under the
default (an unenrolled admin is an admin with views `['*']` and reaches the
admin and accounts routes; an unenrolled accounts holder keeps `accounts`; an
admin can still enrol and is then challenged; switching to `required`
withholds on the very next request). `tests/unit/clientConfig.test.js` pins the
leaf (default, file, env name, rejected value, this instance's file).
`tests/integration/sellerArea.test.js` asserts the mode is `optional` where it
proves a seller still needs 2FA. The e2e server runs `required`
(`playwright.config.js`, `CLIENT_CONFIG_SECURITY_MFA_ENROLMENT`), so
`e2e/admin-totp-enrolment.spec.js` still walks the mandatory flow in a browser
— one server serves every spec, so the optional default is covered by Jest
only. `ADMIN_TOTP_EXEMPT` stays in `playwright.config.js` (still needed: the e2e
server is `required`) and in `tests/env.js` (no Jest suite needs it any more
under `optional`; kept for a suite that switches to `required`).

**Downstreams.** rekstrarkerfid chose mandatory enrolment itself (its
`admin-totp-enforcement`, 2026-09-18). On its next engine-sync it inherits
`optional` unless its own `config/client.json` says `required` — Halli's
instruction is estate-wide, so the sync does NOT set it. hallismiley,
icelandicstore and LedgerLink get `optional` too. No migration.

<a id="ready-and-import-order-2026-09-23"></a>
## 2026-09-23 — `/ready` details and the product-import body behind the gate

Two findings Öryggisvörður raised while reviewing rekstrarkerfid's /um-kerfid
page on 2026-09-19, left open there as "code findings NOT fixed here". Both
live in the engine, so they are fixed here and reach every downstream by
engine-sync.

- **`/ready` told anonymous callers how the instance was doing inside**: DB
  pool counts, circuit-breaker state, heap and RSS in MB, event-loop lag, and
  the database error message on failure. The verdict (HTTP 200/503, `status`)
  is all a load balancer needs. Now `internalsDenied()` in `server/app.js` is
  the one access rule for `/metrics` and for the `checks` detail of `/ready`:
  a bearer `METRICS_TOKEN` when one is set, otherwise localhost in production,
  anyone in dev/test. **`uptime` stays public** — `deploy.yml` in the engine and
  in rekstrarkerfid reads it to prove the answering process is younger than the
  container swap; removing it would turn every deploy red.
- **The product-import route parsed 4 MB before anything could refuse it.**
  `app.use('/api/v1/admin/shop/products/import', express.json({limit:'4mb'}))`
  sat ahead of the rate limiters and the admin gate (its own comment called it
  the price of the ordering trick), so an anonymous POST had its body parsed
  and sanitized first. The global 100 kb parser now skips that path (a
  case-insensitive match that ends at a slash), and `adminShopRoutes.js` parses
  it after `requireAuth` + `requireView('products')`, both limiters and, for
  apply, the header-based CSRF check — with `sanitizeBody` run again, because
  the global one ran on an empty body. The 5 MB change-request parser had the
  same shape and got the same move (after the submit limiter, the admin gate
  and CSRF).

Found by Öryggisvörður reviewing this change, both fixed in the same PR:

- **`sanitizeBody` was quadratic.** `.replace(/<[^>]*>/g, '')` rescans to the
  end of the string at every `<` that has no `>` after it: 25k, 50k and 100k
  `<` took 144 ms, 581 ms and 2.3 s here, and it ran on every JSON body BEFORE
  the rate limiters — one anonymous 100 kb request froze the event loop for
  seconds, `/health` and `/ready` included; 5 MB on the change-request route
  (then parsed pre-gate) extrapolates to about an hour. `stripTags()` in
  `server/middleware/sanitize.js` does the same removal in one linear pass;
  `tests/unit/sanitize.test.js` fuzzes it against the regex on 20 000 random
  strings and times 1 MB of `<`. Every downstream runs this file — treat the
  engine-sync as the ENGINE-SYNC security fast path.
- **Hiding `checks` would have blanked Admin → Monitoring**, whose health
  panel fetched `/ready` from the admin's browser (neither token nor
  localhost). The checks moved to `server/observability/readiness.js`, shared
  by `/ready` and a new admin-only `GET /api/v1/admin/events/health`
  (`no-store`), which the screen now reads.

Found on the re-review, fixed here too: **`validate.js`'s `EMAIL_RE` backtracks
quadratically** on a run of `.` between two `@` — `'a@' + '.'×99 000 + '@'` in
the anonymous signup body held the event loop 3.5 s, and `signupLimiter` (75 per
10 min per IP) does not bound that. `isEmail()` checks the RFC 5321 254-character
limit before the regex, at all three call sites. Noted, not changed:
`ssrMeta.js` strips tags from stored content with `/<[^>]+>/g`, the same shape;
only admins write that content — switch it to `stripTags` when the file is next
touched.

Tests: `observability.test.js` pins the anonymous `/ready` body to
`status`/`timestamp`/`uptime`, the token unlock and the admin health route;
`changeRequests.test.js` pins anonymous malformed JSON → 404 from the gate
(it was 400: parsed first); `sanitize.test.js` the fuzz and the timing;
`adminProductImportExport.test.js` pins that anonymous malformed JSON is 401
(it was 400 — parsed before auth), that an admin still gets the 4 MB limit, and
that the import body is still sanitized. Eight of the new tests fail on the
old code. No migration.

<a id="ssr-replace-literal-2026-09-23"></a>
## 2026-09-23 — SSR splices saved copy literally: replacer functions in `ssrMeta.js`

**Why.** Öryggisvörður (LOW, reproduced in rekstrarkerfid the same day):
`injectCrawlerContent` passed the crawler mirror to `String.prototype.replace`
as the replacement *string*, so the replacement patterns `$&`, `` $` ``, `$'`
and `$$` in admin-saved copy were expanded. `` $` `` pasted the whole template
prefix (`<head>`, theme-boot.js and all) into the body, `$$` collapsed to `$`,
and inside a JSON-LD block an expansion carried its own `</script>` and broke
the JSON. `rewriteHead` had the same shape in every tag it rewrites, and the
review showed one of them needs no login: og:url is `${APP_URL}${req.path}`,
so a GET to `/en/zz$'` spliced the rest of the template into it and `/en/zz$&`
put the original tag inside the attribute. Not script execution in either
case: what gets spliced is the site's own template, never text the requester
chooses, and `esc()` still covers the requester's and the admin's bytes. But
it corrupted what crawlers and AI search read, and a crafted URL got a broken
page cached for five minutes under that URL.

**What changed.** All 17 `html.replace` calls in `rewriteHead` (title,
description, robots, app-env, the two verification tokens, og:*, `<html lang>`
with the identity attributes, og:site_name, author, the scene preload, the
`</head>` tail with the identity hand-off and the JSON-LD) and
`injectCrawlerContent` take a replacer function (`` () => `…` ``); a function's
return value is inserted as is. `replaceById` already did. The rule is in
[ARCHITECTURE §3](ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo).
The internal review found the same defect in `{param}` interpolation: `t()` in
`server/i18n/index.js` and in `public/js/i18n/i18n.js` passed the value as a
replacement string, so a name, a request-body field name or an identity string
carrying `$'` was expanded. Both take a replacer function now (rule in
[ARCHITECTURE §5](ARCHITECTURE.md#5-i18n)).

**Tests.** `tests/integration/ssrMeta.test.js`, "replacement patterns in saved
copy stay literal", saves `` A $& B $` C $' D $$ E `` into `halli_bio.meta_description`,
`home_hero.heading` and a published news article, then asserts the escaped
text comes out byte-for-byte in the description and og:description, the
crawler H1, the news `<title>`, description and crawler article, and the
Article JSON-LD (every block still parses, and the Organization block is
there); the page keeps one doctype, head, theme-boot script, body and app root.
All three fail on the old code. A fourth case requests `` /<lc>/zz-$'-$&-$$ ``
and asserts og:url and the canonical carry the path literally (a backtick is
percent-encoded by the client, so it is not in the path); putting back the old
og:url call alone fails it. Paths and the rows' locale come from the seam
(`pathFor`, `forcedLocaleFor`), and the home case skips where a product
re-describes `/` (it builds its own home mirror). `t()` is pinned by a case in
`tests/unit/i18nIdentity.test.js` and by `tests/unit/i18nInterpolation.client.test.js`;
both fail on the old code.

**Downstreams.** rekstrarkerfid's copy of `ssrMeta.js` has diverged on the
lines this changes (`og:url`, `og:image`, and its `injectCrawlerContent`, which
nests the mirror inside `#app` and is where the bug was reported), so its next
engine-sync conflicts there. Resolve each conflict as a replacer function and
keep the product's markup: do NOT take the old template-string side. Its
`ssrMeta.test.js` is gated off (`public-site` is `forked`), so these tests do
not guard its copy; its own crawler tests should get the same payload.
No migration.
