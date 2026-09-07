# Orange Smiley — public site (orangesmiley.is)

The **public instance** of Orange Smiley ehf.: marketing site + seed of the customer portal, for the software agency / ERP-replacement business serving Icelandic SMBs. **This is NOT a customer migration** — it is the company's own site, dogfooding the site factory.

## Company/product split (Halli, 2026-08-22)

- **Orange Smiley = the company**; THIS repo/site is the **company site**: what the company does + its products (content pass = roadmap R1, not yet done — the current /thjonusta tier matrix eventually moves to the product site).
- **Rekstrarkerfið = the product** — ONE product for all: one shared core for every customer + per-customer custom features as AI-built/AI-maintained flagged modules, managed via the MCP connector (feature requests flow through the same AI workflow). Positioning: against fit-everyone standard ERP.
- **Canonical product core = sibling repo `C:\Users\Notandi\claude\Projects\rekstrarkerfid`** (scaffolded from the base 2026-08-22; serves rekstrarkerfi.is). Customers are generated from IT; HalliProjects retires as upstream after the transition (criteria in `company/REKSTRARKERFI-PLAN.md` §8).
- Strategy docs: `company/REKSTRARKERFI-PLAN.md` (product plan + roadmap R0–R8) and `company/REKSTRARKERFI-BUILD-INSTRUCTIONS.md` (product-site build brief); company plan §1/§4/§7 rewritten same day.

- **Owner**: Halli. Business plan: `company/ORANGE-SMILEY-PLAN.md` (offering/tiers §1, instance architecture §4, targets §7). Build brief: `company/CLAUDE-CODE-BUILD-INSTRUCTIONS.md`. Both live in the gitignored `company/` folder in this repo, alongside `COMPANY-LOG.md` and `ORANGE-SMILEY-WEBSITE-PLAN.md`.
- **Product name** (Halli, 2026-08-20): **Rekstrarkerfi** is the ASCII/technical form — domain `rekstrarkerfi.is` (registered, with IDN `rekstrarkerfið.is` to 301 to it), slugs, identifiers. **"Rekstrarkerfið"** (definite form) is what every human-facing surface says: nav lockup, page titles, ads. The COMPANY stays Orange Smiley ehf. — footer, legal pages, /um-okkur, Organization JSON-LD. Logo unchanged.
- **Provenance**: scaffolded 2026-08-09 from the HalliProjects base — now at `C:\Users\Notandi\claude\Projects\hallismiley` (folder renamed 2026-08-23) — at base rev **`562c637`** by site-factory.
- **Estate map**: `C:\Users\Notandi\claude\Projects\README.md` orients any session across all sibling repos (roles, remotes, shared policies).
- **Deploy target**: company Azure tenant (exists since 2026-08-12; company identity details in gitignored `company/COMPANY-LOG.md`) — **no provisioning or deploy without Halli's explicit go-ahead**. ENHANCEMENTS #1 is done (2026-08-19): `deploy.yml` is neutralized, so pushing the repo is safe.

## ⚠ Do NOT run /strip-base

Halli's explicit instruction: **all base features and data models stay** — shop/cart/checkout/orders, admin + RBAC, bookkeeping suite, projects, news, party, user system, themes, i18n, Stripe, everything. Portfolio surfaces that don't fit the business (party, personal bio/news presentation) are *hidden from nav/SSR/sitemap but left functional* at their routes. Disposition of each module is decided via `ENHANCEMENTS.md` proposals with Halli's sign-off — never by deletion during the build.

## Stack (inherited — invariants, do not change)

- Express 4.x, CommonJS server. PostgreSQL via `pg` (dev DB `orangesmiley`, test DBs derived from `orangesmiley_test` — one template + one per Jest worker, `orangesmiley_w<N>_test`; user postgres/postgres).
- Vanilla JS SPA frontend — **no React/Vue/Svelte, no bundler**.
- Lucia v3 sessions. One auth system only. (The old "RS256 JWT" line was boilerplate — no JWT code exists; verified 2026-08-22.)
- Migrations are **entries appended to the array in `server/config/schema.js`** (applied by `npm run migrate` / at boot); the `NNN_name.sql` files under `server/migrations/` are reference copies. Never edit an applied entry (`/migration-new` to add).
- Consistent error envelope on all routes; pino (no console.log); typed errors → central middleware.
- Security: helmet, csrf-csrf, hpp, express-rate-limit, sanitize-html, RBAC role checks. Tighten, don't loosen.
- **Multi-theme engine:** `public/css/themes.css` + render-blocking `theme-boot.js`, `html[data-theme]` (`classic` default). Re-brand = re-hue token *values*, keep the machinery.
- Tests: Jest integration (real Postgres, no pg mocks) + Playwright e2e. Adapt inherited specs, never delete them.
- i18n: EN + IS JSON locale files; `npm run check:i18n` before pushing translation changes. Icelandic is the primary/default visitor locale (job 2); EN mirrors it. Language-switcher choice lives in the **`locale_choice`** cookie.
- Transactional email sender = **`EMAIL_FROM`** in `.env` (set to placeholder `info@orangesmiley.is` — base default is halli@hallismiley.is, never use it here).

Full rules: `.claude/rules/stack-invariants.md` (auto-loaded). Two footguns worth repeating here: Express 5 catch-alls are `app.get('/{*splat}', …)` — keep the braces, `'/*splat'` stops matching `/`; and Node 26 is Current-not-LTS — the Docker digest and ci.yml node-version move TOGETHER, and dependabot must not major-bump the base image on its own.

## Project rules

- Read-only references — never modify: `C:\Users\Notandi\claude\Projects\icelandicstore` (customer #1's live system) and `C:\Users\Notandi\claude\Projects\hallismiley` (the HalliProjects base; folder renamed from `HalliProjects` 2026-08-23). The base was temporarily writable for the 2026-08-19 base-upgrade program (13 PRs, ledger: site-factory/BASE-SYNC.md); that program is closed and the read-only rule is back in force — base writes need Halli's explicit say-so again.
- One feature branch + worktree per chunk; every chunk ends with lint + `check:i18n` + tests green, then merges to main (Halli reviews history post-hoc — his decision 2026-08-09).
- **Halli approves before the fact**: all copy and pricing (draft natively in Icelandic, mark `DRAFT`), anything in `ENHANCEMENTS.md` before implementation, and any deploy.
- Prices on `/thjonusta` (39–79 þ.kr./mán) are placeholders marked DRAFT until Halli confirms.
- `APP_URL`/canonical host still references hallismiley.is in places — intentional until orangesmiley.is is registered; tracked in PLAN.md.
- Log surprises in `LESSONS.md` (tagged factory/base/project) so `/retro` can harvest them.

## Design rules (Halli, 2026-08-09 — binding for all UI work)

- **Banned defaults.** Fonts: Inter, Roboto, Open Sans, Arial, system-ui, Space Grotesk — not even in fallback stacks (use bare `serif`/`sans-serif`/`monospace` tails behind the self-hosted faces). Colors: purple/indigo/violet gradients, timid evenly-spread palettes, default Tailwind blue. Layout: centered hero + dual CTAs + three identical feature cards — the cookie-cutter SaaS shell.
- **Palette discipline.** One dominant color + one sharp accent + neutrals, all through the CSS token system. Here (the **Bjart** default since 2026-08-20, Halli's call): orange / black / white only — the orange ramp dominates (`--gold-light/--gold/--gold-dark` = #EA580C/#C2410C/#9A3412), near-black `--teal` is the sharp accent used sparingly, white and whisper-grey are the neutrals. **`--gold-light` is decorative-only on a light page (3.41 : 1)** — accent-coloured TEXT must use `--accent-ink`.
- **Make unexpected, context-specific choices.** The default is **Glóð** since 2026-09-02 (Halli) — the earth palette after sundown; Bjart is the light option — Barlow voice, the 4.1 emblem mark unchanged. `classic` still owns the `:root` token set (no `data-theme`); the visitor default is `DEFAULT_THEME` in `themePrefs.js` + `theme-boot.js`, applied pre-paint. **Three themes** live in the picker (`themes.css`; cut from five on 2026-09-02 — Halli: five is too many to maintain): `ember`/Glóð (the DEFAULT: the earth palette after sundown — brown-black, sand and tan) · `classic`/Bjart (the light option: beige paper, brown ink; owns `:root`) · `midnight`/Miðnætti (high contrast: black, white ink, one bright warm accent, edges as lines). Orange lives on the emblem only (`--brand-mark-*`, identical in every theme). `light` and `mono` are retired ids — migration 094 moved their accounts to classic; the CHECK narrows in a later release (invariant 14). Halli picks themes by testing them live, so keep the picker healthy. When a row of cards is unavoidable, differentiate them (numbering, emphasis, asymmetry).

## Iceland scene engine ("Úti á Íslandi", 2026-08-21 — INNER PAGES only since 2026-08-22)

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

## Homepage = the hallismiley composition (2026-08-22)

Halli's call: revert all the way back to the Halli Smiley homepage layout and
iterate from there — **dark waterfall-video hero, light Bjart site** below it.
`HomeView` renders hero → news → projects → skills → stats → contact →
footer again; the business `_tiers()`/`_steps()` sections (and the scene
band mount) are the dormant methods now, kept with their i18n for the coming
content pass. The media-hero surfaces are fixed dark on EVERY theme by design
(home.css — the veil's bottom stop alone hands off to the themed page), which
satisfies invariant 15 by construction. Content still wearing carpentry-era
copy (skills/stats rows, Unsplash discipline placeholders, contact page) is
Halli's content pass, not a bug.

## Factory commands

`/status` · `/base-diff` (engine drift vs base HEAD) · `/test-plan` · `/audit` · `/retro` · `/e2e` · `/i18n-sync` — plus base commands `/security-check`, `/pre-deploy`, `/migration-new`. (`/strip-base`, `/clone-ui`, `/import-data` exist but do not apply to this build — see the warning above.)

## Build status (three jobs, in order)

- [x] Job 1 — scaffold with all features (no strip), env fixes, this file, acceptance green
- [x] Job 2 — re-skin + re-organize, merged in seven chunks: B (IS default locale) → A (orange brand) → C (business IA) → D (hide portfolio surfaces) → E (lead capture) → F (SEO/JSON-LD + a11y) → G (business-routes e2e). 2012 Jest + 109 Playwright green.
- [x] Job 3 — `ENHANCEMENTS.md` written. **Stopped for Halli's approval — implement nothing from it until he says so.**

## Self-update module (built 2026-08-10, six phases, merged to master `64457ef`)

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

## Base-sync 2026-08-19 (the base-upgrade program)

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

## Harvest 2026-08-22 (icelandicstore → here + base)

Five chunks merged on master + five base PRs (#136–#140); full ledger entry in site-factory/BASE-SYNC.md. Highlights here: Tier-1 fixes (cached-user, memory-alert, loud mail + EMAIL_ALLOWLIST, nav-saver races, CORP brand exemption, role-SET 2FA/OAuth gates via utils/adminRole.js); ISOLATED per-branch e2e DBs (e2e/lib/dbUrl.js — local e2e used to write into the dev DB); status-token completion + chartTheme.js + invariant 15; Admin → Monitoring (event_logs = migration 087, beacon, /admin/monitoring); MCP connector (mcp_tokens = 088, /admin/mcp, ships dark behind MCP_ENABLED) = ENHANCEMENTS #13 approved+implemented. Migration chain now ends 087_event_logs · 088_mcp_tokens. **HalliProjects is read-only again.** Ice back-port queue (when ITS window opens): role-SET gate fix, /auth/session totp_enabled.

## Sales-staff program (2026-08-27 — Handbók sölufólks)

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

## R1 — company-site content pass (2026-09-01, five chunks on master)

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
  rekstrarkerfi.is at R2; comment in the view says so.
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

## Market-research program (2026-09-01 — Markaðsstjóri)

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

## Harvest 2 — icelandicstore `601b2f2` → here (2026-09-02, five chunks on master)

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

## Admin console re-shaped for the business (2026-09-07, chunk A)

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

## Leads inbox — Fyrirspurnir (2026-09-07, chunk B; ENHANCEMENTS #2 + addendum)

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

## Markaður — the prospect list (2026-09-07, chunk C; ENHANCEMENTS #16)

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

## Where things stand for the next session

- **Company/product split decided 2026-08-22** (section above): R1 is DONE (section above, copy pending Halli's review); next is R2 (product-site build in the sibling `rekstrarkerfid` repo per `company/REKSTRARKERFI-BUILD-INSTRUCTIONS.md`). The base PR upstreaming `promote.yml` is prepared, pending Halli.
- **Awaiting Halli**: the 13 proposals in `ENHANCEMENTS.md` (#13, the MCP connector, added 2026-08-15), all DRAFT copy in the locale files **including everything R1 wrote**, and the tier prices on `/thjonusta`. (#5 client.config and #7 portal are now roadmap items R4/R6 — still not implemented without his sign-off.)
- **Admin re-shape landed 2026-09-07** (three chunks, sections above: hidden retail lines + Sölustarf/Þjónusta + company overview · Leads inbox = migration 097 · Markaður). Still his: the DRAFT copy those chunks wrote (nav labels, dashboard, leads, markaður, and the **`/personuvernd` §3 + §6 rewrite** — the site now stores enquiries), whether `solufolk` gets the `markadur` view (hand-grant in `/admin/roles`), and #17/#18 (customer accounts + commission), which stay proposals. Existing admins keep their saved sidebar order until they hit Reset.
- **Own books into the product, landed 2026-09-07** (D-017/D-018 in `company/DECISIONS.md`, plan `~/.claude/plans/have-my-agents-go-glowing-mist.md`). Halli's call: keep Orange Smiley's statutory books in its own module, **books first on a private instance** (orangesmiley.is has no deployment), **parallel run** for the first VSK period — júlí–ágúst 2026, gjalddagi **5.10.2026** — deriving here and filing manually through the veflykill. Four pieces: the minor-units fix (the expense form sent major units where the API takes minor, so a USD 20.00 invoice typed as `20` booked as USD 0.20 — `public/js/utils/money.js`); **`/admin/books/settings`** (rides the `books` view id, no new RBAC id; confirming the chart of accounts requires a note and stamps who; FX freshness is per currency in use, not EUR alone); **`npm run books:replay`** (a period through the real services, VSK boxes diffed against what was filed, D split domestic/reverse-charge, target DB must end `_replay`); **migration 095** (structured party block + append-only `invoice_ubl_exports` + a Peppol BIS 3.0 emitter at `GET /invoices/:id/ubl.xml` — 11% is category S/11 not AA, exports are G with a reason, rounding drift is BT-114 and >3 kr is refused); **migration 096** (the capture spine: `source_kind` trust ladder + `books_intake`, a queue of proposals whose only exit is the same `createExpense()` the manual form calls, gated by CHECK constraints and CSRF, deliberately no confidence score). Runbooks: `docs/BOOKS-PARALLEL-RUN.md` (generic) + `company/runbooks/books-2026-P4.md` (this period). **Migration chain ends 097_leads**, with the books pair 095/096 landing behind it — independent of 097, so the array order is safe on a fresh database and on one that already has 097. Still owed: a button to issue a statutory invoice from an order (`issueInvoiceForOrder` has no caller — a hard blocker for 2026-P5, due 7.12) and Peppol **inbound**. Halli's, not code's: the VSK veflykill, Bókari's ruling on pre-12.08 expenses and `ACCOUNTANT-QUESTIONS.md` §6, and §2 (art. 12 zero-rating) before any foreign B2B invoice.
- Post-R1 notes: the news list wants a public `/frettir` home (home links into it were removed, not re-homed); `/terms` could take an `/skilmalar` slug; Product-schema `brand` on the hidden shop still says Rekstrarkerfið.
- **GitHub Actions is ENABLED on the repo since 2026-09-03** (Halli's call; it had been disabled at repo level, which is why CI never ran — two toggles: Settings → Actions → General "Allow all actions" AND the "Enable Actions on this repository" button on the Actions tab). The `main`→`master` trigger fix (2026-09-02) is in; PR #2 carries the first runs. `npm audit --audit-level=high` is clean as of 2026-09-02 (browserslist + sanitize-html patched via `npm audit fix`), so the first run should be green. **Push-safe since 2026-08-19**: ENHANCEMENTS #1 is done — `deploy.yml` is dispatch-only with all targets in unset repo variables (guard step fails fast). Arming a real deploy = set the `vars.*` on the GitHub repo; no workflow edit.
- Public IA is `/`, `/thjonusta`, `/um-okkur`, `/hafa-samband`, `/personuvernd`. Everything else (party, bio, news, shop, **verkefni** — hidden 2026-09-03, Halli — and the `/projects` · `/contact` · `/privacy` aliases) is listed in `server/config/publicSurface.js`: hidden from nav, sitemap and search, still fully functional at its URL.
- Lighthouse desktop: SEO 100 and a11y 100 across the business routes; performance ~85 (home) / ~92 (`/thjonusta`). The gap is the router importing all 58 view modules eagerly — ENHANCEMENTS proposal #6.
