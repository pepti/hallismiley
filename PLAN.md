# Orange Smiley public site — build plan

**Status:** Jobs 1–3 complete (2026-08-09). Every programme since is recorded in `docs/HISTORY.md` (dated, indexed; frozen 2026-09-26) and, after that, one file per branch in `docs/history.d/`; what is open now is the **Status** section at the end of this file; the rules each programme established are in `docs/ARCHITECTURE.md`. **Created:** 2026-08-09. Base: `C:\Users\Notandi\claude\Projects\hallismiley` @ `562c637`.

Not a customer migration — this is Orange Smiley ehf.'s own public instance (marketing + customer-portal seed). Brief: `company/CLAUDE-CODE-BUILD-INSTRUCTIONS.md`. Business plan: `company/ORANGE-SMILEY-PLAN.md` (same folder — gitignored, inside this repo).

## Job 1 — Scaffold with ALL features (done 2026-08-09)

- Scaffolded via site-factory, base rev `562c637`, secret scan clean.
- **`/strip-base` deliberately NOT run** (Halli's instruction — every module stays; see CLAUDE.md).
- `.env`: local dev values; `EMAIL_FROM=info@orangesmiley.is` placeholder (base gotcha fixed).
- `.env.example`: added missing `STRIPE_*`, `RESEND_API_KEY`, `DEFAULT_LOCALE` entries (BASE-SYNC gap).
- `tests/env.js` fallback DB → `orangesmiley_test`; dev DB `orangesmiley` created.
- Acceptance: dev boots, `npm test` / `lint` / `check:i18n` green, base SHA in CLAUDE.md, first commit.

## Job 2 — Re-skin + re-organize (presentation/navigation, not capability)

One branch + worktree per chunk, lint + i18n + tests green per chunk, merge to master (Halli reviews history post-hoc — his call 2026-08-09). Chunk order:

1. **B `feat/is-default-locale`** — `PUBLIC_DEFAULT_LOCALE='is'` for the visitor-facing role only; `DEFAULT_LOCALE='en'` stays as content-fallback/storage dimension (party module depends on it).
2. **A `feat/orange-brand`** — retoken `:root` values (orange ~#F97316, warm neutrals, one dark accent), `lava` theme → orange-dark variant, wordmark + smiley SVG, favicon/og-image. *(As planned; no `lava` theme id ever shipped — the outcome table below records what landed, and the theme set has since been cut to three, CLAUDE.md.)*
3. **C `feat/business-ia`** — routes `/thjonusta`, `/verkefni` (projects module repurposed as case studies), `/um-okkur`, `/hafa-samband`, `/personuvernd`; new home hero "Allt kerfið þitt á einum stað" (static, video removed); NavBar → business links; IS-first DRAFT copy.
4. **D `feat/hide-portfolio-surfaces`** — `server/config/publicSurface.js` single source of truth; noindex on hidden routes (`/party`, `/halli`, `/news`, `/shop`, …); sitemap = business routes only; specs assert "hidden from nav, still functional".
5. **E `feat/lead-capture`** — contact plumbing extended (name, company, email, phone, current platform, message), pino instead of console.log, notification email, limiter 5/hr/IP. Leads DB table + admin view deferred to Job 3.
6. **F `feat/seo-jsonld`** — Organization + Service JSON-LD, index.html baked meta, `/personuvernd` copy, Lighthouse ≥90 on `/` + `/thjonusta`.
7. **G `feat/e2e-business-routes`** — Playwright spec walking the six business routes in both locales; final acceptance sweep.

## Job 3 — ENHANCEMENTS.md → STOP for Halli ✅ written

12 numbered proposals in `ENHANCEMENTS.md` (26 by 2026-09-11), categorized quick-wins / architectural-now / later. **Implement nothing without approval.** The one to read first is #1: the inherited `deploy.yml` still targets Halli's personal Azure resources and must be neutralized before this repo is pushed anywhere.

## Job 2 outcome (all seven chunks merged)

| Chunk | Branch | Landed |
|---|---|---|
| B | `feat/is-default-locale` | `PUBLIC_DEFAULT_LOCALE='is'` for the visitor default; `DEFAULT_LOCALE='en'` kept as the content/storage dimension |
| A | `feat/orange-brand` | Light warm-neutral orange token set, smiley wordmark, favicon, og-image |
| C | `feat/business-ia` | Six business routes, ThjonustaView + UmOkkurView, business hero/nav/footer, IS-first DRAFT copy |
| D | `feat/hide-portfolio-surfaces` | `publicSurface.js` as the single source of truth; noindex + sitemap + nav exclusion |
| E | `feat/lead-capture` | Company/phone/platform qualifiers, pino, notification email, 5/hr limit |
| F | `feat/seo-jsonld` | Organization + Service JSON-LD, business privacy policy, a11y 94→100 |
| G | `feat/e2e-business-routes` | 18-test bilingual route walk, spec adaptations, final sweep |

Acceptance (2026-08-09 counts): 2012 Jest + 109 Playwright green · lint clean · i18n in sync · invariant hook clean · Lighthouse SEO 100 / a11y 100 on the business routes.

## Known intentional oddities

- *(Resolved 2026-09-22: the `APP_URL`/canonical fallbacks name orangesmiley.is — [go-live](docs/HISTORY.md#go-live).)*
- Stripe/OAuth/Resend env vars blank in dev: shop browsable, checkout/OAuth/email inert until configured — features preserved, not removed.
- Deploy: company Azure tenant; the public site was approved 2026-09-22 (production only, not ops) — `docs/DEPLOYMENT.md` §6.

## Open questions for Halli

1. Confirm tier pricing (D-001: build fee 390/580/690 þ.kr. + service contract 19/29/39 þ.kr./mán with 5/10/20 verkeiningar — DRAFT; the old flat 39–79 þ.kr./mán is retired).
2. Sign-off on all IS/EN copy (marked DRAFT in locale files).
3. ENHANCEMENTS.md decisions after Job 3.

## "Úti á Íslandi" re-skin (2026-08-21, three chunks, merged)

Halli's directive: base the whole public site on Iceland photography — the
visitor should feel outside in Iceland. Delivered as the scene engine
(`public/js/scenes/`), landscapes on all five public pages, five-theme
photographic grading, View Transitions, and the live ambience layer (real
Hafnarfjörður weather via /api/v1/ambience + local solar position + aurora).
His Facebook-saved photos had no usage rights → shipped photos are Commons
CC0/CC BY equivalents, credited in /assets/iceland/CREDITS.md. Migration chain
now ends 086_landing_background_scene *(superseded: 089 reverted the scene default the next day; the chain ends 104 as of 2026-09-13; `server/config/schema.js` is the truth)*. Copy on toggles/alt-texts is DRAFT
pending Halli, like all copy.

## Product name (decided 2026-08-20)

- **Rekstrarkerfi** — ASCII base form for everything technical: domain (`rekstrarkerfi.is`), slugs, identifiers, email addresses, metadata.
- **"Rekstrarkerfið" by Orange Smiley** — definite form (fallbeyging) for all spoken/UI/advertising use.
- Logo unchanged: the existing orange smiley mark carries the product.
- **Registered 2026-08-20:** `rekstrarkerfi.is` **and** `rekstrarkerfið.is` (IDN — catches the spoken definite form typed directly) — both on Halli's ISNIC account. heildarkerfi.is was passed on. TODO when DNS goes live: 301 rekstrarkerfið.is → rekstrarkerfi.is (canonical).
- Adopting the name in site copy/locale files is **not yet approved** — separate pass with Halli's sign-off per the CLAUDE.md copy rules.

## Company/product split (decided 2026-08-22)

Orange Smiley = the company (this site lists what it does + its products);
Rekstrarkerfið = the one product for all — shared core + per-customer
AI-maintained flagged modules via MCP — with its own site rekstrarkerfi.is
served from the sibling canonical product repo `Projects\rekstrarkerfid`
(scaffolded from the base this day). Strategy + long-term roadmap R0–R8:
`company/REKSTRARKERFI-PLAN.md`; the product-site build program:
`company/REKSTRARKERFI-BUILD-INSTRUCTIONS.md`. This repo's follow-on is the
R1 company-site content pass (copy needs Halli) — nothing else changes here.

## R1 company-site content pass (done 2026-09-01)

Five chunks on master (A brand core → B homepage → C /thjonusta → D legacy
brand → E admin group). The site now presents Orange Smiley ehf., an
AI-driven software company, with Rekstrarkerfið as its first product.
Details in `docs/HISTORY.md#r1`; every line of new copy is **DRAFT pending Halli**.

Two things worth carrying forward:

- Seeded `site_content` rows shadow the view fallbacks. `home_skills`,
  `home_stats` and all six `contact_*` keys were seeded by migrations, so
  editing the JS defaults changed nothing a visitor sees. Migrations 091/092
  move the rows, guarded on `updated_by IS NULL`. Any future copy pass has to
  check for a seeded row first.
- Deferred, not forgotten: a public `/frettir` home for the news list (the
  homepage's links into the hidden `/news` were removed), an `/skilmalar`
  slug for `/terms`, and the Product-schema `brand` on the hidden shop
  surface, which still names the product as the brand of every SKU.

## Status (2026-09-17)

Moved here from CLAUDE.md's "Where things stand" on 2026-09-17; the dated
narratives it summarised are in `docs/HISTORY.md` (linked per bullet), the
rules they established in `docs/ARCHITECTURE.md`. Update this section when a
chunk lands; the story goes in a new `docs/history.d/` fragment (since
2026-09-26 — `docs/HISTORY.md` is the frozen archive; see `docs/history.d/README.md`).

**Awaiting Halli**

- DRAFT copy everywhere it is marked: R1 ([r1](docs/HISTORY.md#r1)), the admin
  re-shape nav/dashboard labels ([admin-reshape](docs/HISTORY.md#admin-reshape)),
  leads and Markaður screens, the `/personuvernd` §3 + §6 rewrite (the site now
  stores enquiries — [leads](docs/HISTORY.md#leads)), the services page
  ([services-page](docs/HISTORY.md#services-page)), the two-step reminder's
  `mfaReminder.*` strings ([mfa-reminder-2026-09-23](docs/HISTORY.md#mfa-reminder-2026-09-23);
  i18n files, not an inline editor). He edits in place via the inline editors.
- `ENHANCEMENTS.md`: 26 proposals; #1, #2, #5, #13, #16, #17, #18, #22 (till), #23 done; #9, #10, #21, #24, #25
  partial; the rest need his sign-off before any implementation. #7 is
  roadmap item R6.
- Publish the 14 seeded sales guides ([sales-staff](docs/HISTORY.md#sales-staff));
  decide whether `solufolk` gets the `markadur` view (hand-grant in `/admin/roles`,
  then flip `e2e/markadur.spec.js`).
- Handbook aligned to D-001 (DRÖG) 2026-09-22 — Halli confirms the prices, then
  publishes the guides. Tier prices live on rekstrarkerfi.is only; the guides now
  quote the same build fee + service contract + verkeiningar model and send
  sellers to `demo.rekstrarkerfi.is` for demos (migration os_001;
  [handbook-d001-2026-09-22](docs/HISTORY.md#handbook-d001-2026-09-22)). Open in
  the guides as "DRÖG — Halli staðfestir": the einingaverð amount, whether unused
  verkeiningar carry over, the cost of moving up a tier, how sellers demo before
  the demo instance exists.
- Demo decisions 2026-09-26 (D-023, [demo-decisions-os-2026-09-26](docs/history.d/2026-09-26-docs-demo-decisions-2026-09-26.md)):
  `demo.rekstrarkerfi.is` is one demo with every module, and "Fáðu demo" on each
  /verdskra tier card opens it self-serve (a throwaway session per visitor). Open:
  (a) the handbook guide "Að sýna kerfið" (`seed-sales-guides.js` + os_001) still
  tells sellers a prospect gets time-limited access only after a guided demo; it
  needs a new os product migration + the seed change, copy DRÖG for Halli
  (Söluþjálfari); (b) the demo-instance chunk (`feat/demo-mode`, not yet
  committed) plans a `kynning` prospect role with expiring logins, which the
  throwaway visitor session replaces or complements, and how visitors are kept
  from seeing each other's changes is not designed yet.
- Decisions that are his, not code's: the lawyer on netting-only set-off
  (contract 5.4 DRÖG), Bókari on written-off balances and verktakamiði, the
  accountant on `docs/ACCOUNTANT-QUESTIONS.md` §2, §6, §7, §11; the VSK
  veflykill for the 2026-P4 parallel run (gjalddagi 5.10.2026); plan §6 ("no
  salaries") vs hiring.
- D-021, the engine upstream ([engine-upstream-2026-09-22](docs/HISTORY.md#engine-upstream-2026-09-22)):
  pick the window for icelandicstore's graft PR (merging deploys TEST); adopt the
  `Feature: <id>` commit trailer with Orri; veto or accept engine migration
  `106_user_theme_check_drop`; merge the hallismiley and icelandicstore sync
  PRs (both deploy on merge); arm `RELEASE_*` per product — orangesmiley's own
  channel first, rekstrarkerfid's next (the hallismiley arming packet of
  2026-09-13 is parked).
- Next programme: R2, the product-site build in the sibling `rekstrarkerfid`
  repo per `company/REKSTRARKERFI-BUILD-INSTRUCTIONS.md`.

**Open technical items**

- Harvest 2 started 2026-09-26 (Halli approved the scope that day): generic
  icelandicstore work up to `ice@941cf51d` ported into the engine in lanes 0–9,
  each on its own branch. Lane 0 landed on `harvest2/lane0-history`
  ([harvest2-lane0-2026-09-26](docs/history.d/2026-09-26-harvest2-lane0-history.md#harvest2-lane0-2026-09-26)):
  write-ups are now one `docs/history.d/` fragment per branch and
  `docs/HISTORY.md` is the frozen archive; every chunk gets a review pass
  before it merges; `docs/TESTING.md` gained the deployed-environment
  walkthrough. This settles chunk F's open item (d) below.
- Upward harvest from icelandicstore `4694289`, lane 1 (chunks A then B, branch
  `harvest/ice-2026-09-24-ab`, not merged). Chunk A landed on the branch
  ([harvest-ice-a-2026-09-24](docs/HISTORY.md#harvest-ice-a-2026-09-24)): admin
  2FA reset, the `/api/v1/admin` outer door, MCP tokens revoked with the admin
  role, invite receipts, logins without email, the contact send budget, Claude
  over the managed identity (dark). Open: (a) **the new `adminUsers.*`,
  `adminCustomers.*`, `errors.admin.*` and `email.lead.provenance` strings are
  DRAFT** (Halli); (b) turning Claude on for an instance needs the Anthropic
  console setup in `docs/DEPLOYMENT.md` § Anthropic authentication (per-tenant
  ids, Halli's hand); (c) lane 2 shares `server/app.js` and `emailService.js`
  with this branch — whoever merges second rebases (lane 3 is merged in:
  `emailService` logs through pino, `anthropicAuth.js` dropped its
  global-fetch fallback for `trackedFetch`, the translator's client passes
  the tracked `fetch` alongside the auth options); (d) icelandicstore's graft: its `4e8eb79` outer door
  (`requireRole('admin','moderator')`) is superseded by the engine's
  `requireStaff` — take the engine side.
- Chunk B landed on the same branch
  ([harvest-ice-b-2026-09-24](docs/HISTORY.md#harvest-ice-b-2026-09-24)): migration
  `111_user_ui_prefs` (page width, Mjúk hreyfing, side-column width, cookie
  choice on the account), the centred error dialog, the sticky sideways
  scrollbar, the undefined-token test (21 engine references fixed), the focus
  ring. Open: (a) **migration number** — master (lane 3, MCP OAuth) ends at
  110, so 111 follows it; lane 2 (inventory audit, variant barcode) may also
  have taken 111 — whoever merges second renumbers, and
  ice's product file then lists `'<engine name>': ['125_user_page_widths',
  '127_user_page_width_motion', '128_user_cookie_consent',
  '135_user_aside_widths']` under `aliases`; (b) copy DRAFT (`admin.pageWidth.*`,
  `admin.asideWidth.*`, `toast.errorTitle`/`ok`, `privacy.changeCookieChoice`);
  (c) the privacy text still tells visitors to withdraw by clearing cookies —
  Halli's legal copy, the new button now does it; (d) the error dialog changes
  every error toast at once — watch the first downstream sync (chunk E's
  "page failed to load" message, shown when a lazily loaded view's file is
  missing on the current release, now opens the dialog too).
- icelandicstore harvest, chunk F landed 2026-09-24 ([harvest-ice-f-2026-09-24](docs/HISTORY.md#harvest-ice-f-2026-09-24)):
  App Insights telemetry (dark), every 5xx in `event_logs`, `X-App-Build`
  checked by `deploy.yml` and a stable promote, Jest in three CI shards, the
  docs-only PR shim, the re-runnable-constraint test. Open: (a) **Halli**:
  whether `APPLICATIONINSIGHTS_CONNECTION_STRING` is already set on the
  orangesmiley.is web app (`orangesmiley-prod-ai` exists since 2026-09-22) —
  if it is, the first deploy of this code starts sending traces and
  dependencies; if not, set it to turn telemetry on; (b) set
  `vars.CANARY_URLS` once a canary instance exists, or stable promotes keep
  warning "soak not verified"; (c) `deploy.yml`/`promote.yml` are
  product-owned: rekstrarkerfid, LedgerLink and hallismiley copy the
  X-App-Build steps into their own workflows by hand; (d) the per-PR history
  fragments (ice `459dba6`) wait for Halli's nod (harvest plan Q6) — they
  change the "Recording a chunk" rule; (e) the 4 moderate
  `@opentelemetry/core` advisories under `applicationinsights` 2.9.8 — the
  fix is the 3.x SDK major, its own item; (f) the Resend SDK's own fetch is
  not a tracked dependency.
- icelandicstore harvest, chunk E landed 2026-09-24 ([harvest-ice-e-2026-09-24](docs/HISTORY.md#harvest-ice-e-2026-09-24)):
  open tabs reload onto a new release, code under release-stamped URLs
  (cached a year), views loaded when visited (boot graph 158 → 39 modules),
  `plural()`, real 404s, Icelandic money/dates by hand. Open: (a) **Halli**:
  the five new strings are DRAFT (`updateBanner.*`, `errors.pageLoadFailed`,
  two Monitoring kinds — IS/EN in the HISTORY entry); (b) rekstrarkerfid's
  next sync: take the engine side of the `express.static` block (supersedes
  its `1b7aeff`) and move its own views into the router's `VIEWS` table;
  every downstream that adds a router route adds it to
  `public/js/routePatterns.json` or `identity.routes` too, or a hard load of
  it answers 404; (c) not ported from ice #399: IS postcode/phone validation
  twins (touches `validate.js` and the contact contract — a proposal);
  (d) `formatRelative` still asks `Intl.RelativeTimeFormat` for Icelandic (the
  same missing-ICU gap).
- Identity seam + feature gate ([identity-seam-2026-09-22](docs/HISTORY.md#identity-seam-2026-09-22)):
  the hallismiley draft PR pepti/hallismiley#168 becomes mergeable once it sets
  its `identity` block in `config/client.json` (the ready-to-paste example is in
  the HISTORY entry) and lists the engine features it hides in
  `features/local.json`; LedgerLink's and rekstrarkerfid's graft PRs likewise
  (their 32 e2e failures were engine specs on hidden features — the gate skips
  them once `local.json` says so). Second iteration landed 2026-09-23
  ([identity-seam-2-2026-09-23](docs/HISTORY.md#identity-seam-2-2026-09-23)):
  `identity.surface.nav` (nav, footers, sitemap), `meta.<key>.*` i18n keys for
  the page parts, `/manifest.json` and the Product brand from the identity,
  engine suites on the visitor default, engine-only pins gated on
  `engine.json.role`, the `.view` fade fill-mode dropped; from LedgerLink's
  addendum: `theme.dark` + root outside the picker, `/robots.txt` from
  `hiddenRoutes`, the brand aria-label from `brand.name`, the Service
  catalogue only while `/thjonusta` is public, the admin specs off the seam,
  self-update suites gated by `modules.selfUpdate.enabled`. hallismiley's next
  sync sets `surface.nav` (verkefni/news/halli), overrides `meta.home.title`
  in its `product.<lc>.json` (the engine part still says "AI-driven software
  company"), and re-runs `aron13.spec.js` ×2 — not reproducible in the engine
  (its own view); the `.view` fix is the one engine change that alters what
  moves there. Still literal, by design: the seeded company copy (product
  migrations), `SERVICE_OFFERINGS` + the Rekstrarkerfið entry in the Service
  JSON-LD (company content in `ssrMeta.js`), the `classic` palette hues, the
  static `public/manifest.json` colours. Third iteration landed 2026-09-23
  ([identity-seam-3-2026-09-23](docs/HISTORY.md#identity-seam-3-2026-09-23)):
  `identity.routes` (a product's own routes' title/description keys, `bare`,
  `noindex`, `locale`, merged over ssrMeta/pageTitle and read by the locale
  lock, robots, sitemap and manifest), `organization.description` as an i18n
  key per locale, `organization.ogImage`, `theme.swatches`; the last
  engine-site pins gated; site-factory `engine-sync.js` (`feat/engine-sync-regen`,
  `1e186fe`, not pushed) regenerates `.engine-paths`/`.gitattributes` on
  conflict. **Hooks that close on each downstream's next sync**: hallismiley —
  the `/aron13ara` rows in `ssrMeta.js` + `pageTitle.js`, the IS-only lock in
  `config/i18n.js` + the client mirror, the `localeLock*` cases, the six
  `engine-sync-2`-marked test lines, the Features-row link (→ `routes:
  { "/aron13ara": { titleKey, titleMode: "bare", locale: "is" } }` + overlay
  keys; keep re-running `aron13.spec.js` ×2); LedgerLink — the `/`, `/console`,
  `/original` rows and the `{brand} — The invoice is already there.` part, the
  two swatches in `themePrefs.js`, the `identityDownstream` / `pageTitle.test`
  re-applies; rekstrarkerfid — the landing/eiginleikar/verdskra/um-kerfid
  rows, the per-locale Organization description, the OG-card path, the
  swatches, `identityConfig`/`i18nIdentity`/`featureGate` hand edits. Still
  open, on purpose: rk's `html.js` mark in `theme-boot.js` (rk's own); a
  crawler-summary hook for a product landing; the sitemap beyond nav + legal
  (hallismiley's `/shop/products` etc.); the `/party` nav link's class/aria;
  `classic` as Bjart; `APP_URL` on every downstream's App Service.
- First upward harvest landed 2026-09-23 ([harvest-rk-totp-2026-09-23](docs/HISTORY.md#harvest-rk-totp-2026-09-23)):
  mandatory 2FA enrolment + TOTP secret sealed at rest (migration 107). Open:
  (a) **before the first deploy of 107, create `TOTP_ENC_KEY` in the instance's
  Key Vault and reference it on the web app** (`docs/ADMIN-2FA.md`; Halli's
  hand); after it every unenrolled admin is walked through enrolment at next
  sign-in — save the recovery codes; (b) rekstrarkerfid's next engine-sync
  adds `'107_totp_secret_enc': ['093_totp_secret_enc']` to `aliases` in its
  `rk.js` and removes 093 from its `legacy` (done on rk's 2026-09-23 sync;
  the rule as `migrationSet.test.js` enforces it); (c) the authenticator issuer now reads
  `identity.brand.name` (rk reads its own `brand.name`; on rk's next sync the
  two readers must agree on `identity.brand.name`); (d) release N+1 stops writing `totp_secret`, N+2 drops it;
  (e) next rk candidates: `social-login-gate`, `request-logging`.
- 2FA enrolment made OPTIONAL by default, same day ([mfa-optional-2026-09-23](docs/HISTORY.md#mfa-optional-2026-09-23)):
  `security.mfa.enrolment` = `optional` | `required` in `config/client.json`
  (this instance: `optional`), so harvest item (a)'s "walked through
  enrolment at next sign-in" now happens only on an instance set to
  `required`. Open: (a) ~~the seller area still demands 2FA~~ — sellers follow
  the switch since mfa-reminder-2026-09-23 (next bullet); (b) rekstrarkerfid
  chose mandatory enrolment itself but inherits `optional` on its next sync
  unless its own `config/client.json` says `required` — Halli's instruction
  is estate-wide, so the sync must NOT add it; (c) ~~the e2e server runs
  `required`~~ — two e2e servers since mfa-reminder-2026-09-23, both modes in
  a browser.
- Seller area follows the 2FA switch + a dismissible two-step reminder, same
  day ([mfa-reminder-2026-09-23](docs/HISTORY.md#mfa-reminder-2026-09-23)):
  `sellerRoutes.js` rule 4 only under `required`; under `optional` a
  protected account without 2FA sees a notice atop the admin shell and the
  seller area, ✕ for the page load, "Ekki sýna þetta aftur" saves per account
  (migration 109, `POST /auth/mfa-reminder/dismiss`). **Awaiting Halli: the
  `mfaReminder.*` copy is DRAFT** (IS + EN in the HISTORY entry). Not done:
  no "show it again" switch (the Prófíll panel is always there); turning 2FA
  off does not bring back a dismissed reminder.
- rk feed landed 2026-09-23 ([rk-feed-2026-09-23](docs/HISTORY.md#rk-feed-2026-09-23)):
  orange-smiley/rekstrarkerfid#45 items 2/3/4/6/7/9 — lead ids as strings,
  migration 108 (`notified_at`/`notify_error` + the "ekki sent" mark), the
  launcher/editor-bar stacking, legal titles at 320px, sitemap `<lastmod>` +
  `/llms.txt` (harvested), the alias wording. Open: (a) rekstrarkerfid's
  next sync retires its own `recordNotification`, `/llms.txt`, lastmod and
  `rowId`/`_id` shims and moves its four route→key pairs into
  `identity.routes[*].contentKeys` (list in the HISTORY entry; no alias for
  108 — its columns already exist there); (b) rk's pricing block in its
  `/llms.txt` has no engine slot — a product-content hook for llms.txt is a
  later seam item; (c) a `contentKeys` field for an ENGINE route a product
  re-describes (`/`) replaces the engine's list, by the routes rule.
- Engine upstream (D-021, [engine-upstream-2026-09-22](docs/HISTORY.md#engine-upstream-2026-09-22)):
  the first syncs, in order — LedgerLink and icelandicstore in parallel (both
  need the one-time graft; ice's PR waits for Halli's window), then
  rekstrarkerfid, then hallismiley (Halli merges; deploys). Before the SECOND
  sync of any repo: the i18n `product.{lang}.json` loader, so product keys
  stop colliding with engine keys in `en.json`/`is.json` (until then §6 of
  `docs/ENGINE-SYNC.md`: resolve by key). Convert `/base-diff` → `/engine-diff`
  in each downstream's `.claude/commands` (arrives by merge; the downstream's
  own copy, if any, is deleted in its graft PR). `engine-sync/`, `from-ice/`
  and `engine-drift.js` runs start once the graft PRs are merged.
- Seller area (D-020 step 3) is BUILT, not live ([seller-area](docs/HISTORY.md#seller-area)):
  it goes live with the public + ops instances (step 5, Halli's go), a shared
  `SELLER_PUBLISH_SECRET`, and each seller invited on the public box under
  their ops email. Open: (a) `/hafa-samband` on the PUBLIC instance writes
  its own `leads` table there — route those enquiries by `leads:export` on
  the public box / `leads:import` on ops until ops runs on Azure, then a
  timer (D-020 step 4 is scriptable since
  [leads-transfer-2026-09-22](docs/HISTORY.md#leads-transfer-2026-09-22));
  (b) publishing is by hand until ops runs on Azure, then a timer;
  (c) a `verktaki` (`accounts` + `allaccounts`) is published with only the
  accounts they OWN — `allaccounts` does not widen the public copy, by design
  until Halli says otherwise. The `/solusvaedi` copy is DRAFT.

- Module switches landed 2026-09-24 ([module-flags-2026-09-24](docs/HISTORY.md#module-flags-2026-09-24)):
  roadmap R4 done in the engine. Open: (a) each downstream sets its own
  `modules` block on its next sync (rekstrarkerfid's demo/customer instances
  a tier; hallismiley `salesOps`/`books` off; LedgerLink most of the set) —
  nothing changes there until it does; (b) no Playwright spec runs a server
  with a module off (the Jest integration + a browser check cover it; a second
  e2e server like the `required` 2FA one would); (c) the session payload still
  carries `'*'` for an admin — `canSeeView()` filters client-side, the server
  404s the APIs; (d) R5 can now add a module-flag write tool (a switch is
  resolved at boot, so a write means config + restart, or a DB-backed layer
  over the file — a design choice for R5); (e) party endpoints outside its
  prefixes (`/auth/party-magic-login`, admin `users/:id/party-*`) and MCP
  `environment_info`'s counts ignore the switches (low).
- MCP OAuth landed 2026-09-24 ([mcp-oauth-2026-09-24](docs/HISTORY.md#mcp-oauth-2026-09-24)):
  roadmap R5a; R5b (write tools) landed the same day
  ([mcp-write-tools-2026-09-24](docs/HISTORY.md#mcp-write-tools-2026-09-24)); Halli confirmed the write tools 2026-09-25 ("yes continue mcp"). Open: (a) turning `write` on
  for a stack (`MCP_ALLOWED_SCOPES=read,write`) is Halli's call per stack; a
  module switch on a scaled-out deployment reaches the other instances at
  their next boot; the `adminGeneral.module*` / `adminGeneral.preset.*` copy was
  approved by Halli 2026-09-25; (b) connecting claude.ai for real
  needs a deployed instance with `MCP_ENABLED=true` (production has it unset —
  Halli's call per stack); (c) downstreams inherit the flow by merge (their
  `APP_URL` must be set — it is the issuer); (d) the consent copy
  (`connect.*`) was approved by Halli 2026-09-25; `mcp.oauth*` too (the same day); (e) no CORS on the OAuth endpoints —
  claude.ai calls them server-side; a browser-based client (MCP Inspector)
  would need it.
- Signup switch landed 2026-09-24 ([signup-switch-2026-09-24](docs/HISTORY.md#signup-switch-2026-09-24)):
  the engine half of rekstrarkerfid's R2b step 1. Open: rekstrarkerfid's next
  engine sync, then its own PR (config: signup off + `navSignIn` false; the
  footer line) — merged 2026-09-24 (orange-smiley/rekstrarkerfid#53); the
  deploy is Halli's go; `auth.errors.signupClosed` copy was approved by Halli
  2026-09-25.
- Time-limited logins landed 2026-09-26 on `feat/login-expiry`, not merged
  ([login-expiry-2026-09-26](docs/history.d/2026-09-26-feat-login-expiry.md#login-expiry-2026-09-26)):
  engine migration `114_user_expires_at`; every sign-in path and session
  reader refuse an expired login; "Gildir til" in Admin → Users and the
  Customers "add" form. Open: Halli approves the DRÖG copy (the refusal and the
  admin strings); rekstrarkerfid's next engine sync brings it to the demo
  instance; nothing sweeps expired rows yet (they stay, refused — a cleanup
  job or "delete after N days expired" is a later decision).
- Books: a button to issue a statutory invoice from an order
  (`issueInvoiceForOrder` has no caller — hard blocker for 2026-P5, due 7.12);
  Peppol inbound; the 6-month commission tail (contract 4.3) has no code —
  monthly `manual_credit` until built ([migrations-100-102](docs/HISTORY.md#migrations-100-102)).
- UI kit programme: convert `AdminLeadsView` and `AdminMarketView`; then the
  states kit, the dialog kit (port LedgerLink's `LedgerAdminBits.js`: native
  `<dialog>`, abort-on-dismiss, 15 s write timeout, backdrop dismissal keyed
  off `mousedown` so a text-drag does not discard input), auth/identity pieces
  and the money de-fork
  ([ui-kit](docs/HISTORY.md#ui-kit)). ~~A sold-out cart line still goes straight
  to Stripe (ENHANCEMENTS #25)~~ — fixed by harvest-ice-c-2026-09-24 (next bullet).
- Ice harvest lane 2, chunk C landed 2026-09-24 on `harvest/ice-2026-09-24-cd`
  ([harvest-ice-c-2026-09-24](docs/HISTORY.md#harvest-ice-c-2026-09-24)):
  On hand / Committed / Available + the audited writer (migration 112), the
  sold-out basket guard, the search-box fix, bulk product edit, the till
  scanner, MCP catalogue tools (all switched off). Open: (a) **migration 112
  takes the number after lane 1's 111**; whichever lane merges second renumbers
  if they collide, and ice's product file aliases 112 to its 073/075/101/121 at
  graft time; (b) a till sale still moves no stock (the engine's POS never
  did) — Halli's call whether the till should deduct (reason `pos`) and what
  it does when the shelf count is wrong; (c) an order paid by the OLD
  container during the 112 swap window would be deducted twice at fulfilment
  (Stripe payment inside the swap minutes only; no shop is live on the
  engine's own instance); (d) the stock-reason list and the new admin
  strings are DRAFT; (e) not taken: sales-report periods (ice #414 — M, needs
  VAT per order derived from lines; a later chunk), ice's `scan_sounds` /
  `scan_volume` settings (a per-device switch instead), the pick / receive /
  inventory-check screens (ice-only), line discount and sequential order
  numbers (Halli's defaults).
- Ice harvest lane 2, chunk D landed 2026-09-24 on the same branch
  ([harvest-ice-d-2026-09-24](docs/HISTORY.md#harvest-ice-d-2026-09-24)): one
  server-side reader for every product file (CSV, .xlsx, PDF), barcode as the
  fallback match key (migration 113), the variant-creating import, the orders
  list as .xlsx, product images normalised + lazy `.thumb.webp`. Open: (a)
  migration 113 follows 112 — renumber both together if lane 1 lands a clash;
  ice aliases 113 to its 102; (b) **the Azure half of the image port can only
  be proved on a deployed instance** (Buffer writes on the Azure Files mount,
  sharp on node:alpine) — check one JPEG and one PNG upload on the first
  deploy; (c) the import's new strings and the `export.orders.*` headers are
  DRAFT; (d) not taken: ice's single-row product create and its AI PDF reader,
  the goods-receipt / invoice-merger / customer importers (ENHANCEMENTS #24
  stays partly open), the sticky scrollbar (lane 1), the CSP `blob:` (no
  pre-upload preview here); (e) new runtime dependencies `exceljs` 4.4.0,
  `pdf-parse` 2.4.5 (exact) and `sharp` (moved from devDependencies) — the
  Docker image grows by sharp's musl binaries.
- Post-R1 notes: a public `/frettir` home for the news list; an `/skilmalar`
  slug for `/terms`; Product-schema `brand` on the hidden shop still says
  Rekstrarkerfið.
- Performance: Lighthouse desktop SEO 100 / a11y 100 on the business routes;
  performance ~85 (home) / ~92 (`/thjonusta`) because `router.js` imports all
  65 view modules eagerly (ENHANCEMENTS #6).
- Still a decision, not code: MCP arguments pass through `sanitizeBody` and the
  global IP limit (moving the mount would exempt MCP from two protections).

**CI / deploy state**

- GitHub Actions enabled since 2026-09-03 (two repo-level toggles); the
  `main`→`master` trigger fix is in; CI green is the merge gate; Playwright
  workers match the runner's CPUs since 2026-09-13.
- `deploy.yml` is dispatch-only, by digest, production only (2026-09-22,
  [go-live](docs/HISTORY.md#go-live)); arming = the `production` environment's
  `vars.*` + OIDC secrets. orangesmiley.is is LIVE since 2026-09-22 (public site
  only; ops stays local until after 5.10 — D-020 step 2 split); stack, ids and
  hand-steps in `docs/DEPLOYMENT.md` §6; no deploy without Halli. Open: the
  `forwardedFor` port to rekstrarkerfid / LedgerLink / base, the Resend team
  moving to the company, and Halli's approval of `/personuvernd` §7 (Sweden). `npm audit --audit-level=high` clean (last advisory
  cleared 2026-09-14, fast-xml-parser 5).
- Latest base-sync 2026-09-13: migration 103 (vehicle accounts), memory watch
  timer, escaped mail title, canonical HTTPS redirect — accountant to confirm
  the 6600/6610 split (§7).
