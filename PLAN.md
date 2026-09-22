# Orange Smiley public site — build plan

**Status:** Jobs 1–3 complete (2026-08-09). Every programme since is recorded in `docs/HISTORY.md` (dated, indexed); what is open now is the **Status** section at the end of this file; the rules each programme established are in `docs/ARCHITECTURE.md`. **Created:** 2026-08-09. Base: `C:\Users\Notandi\claude\Projects\hallismiley` @ `562c637`.

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

1. Confirm tier pricing (39–79 þ.kr./mán is DRAFT).
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
chunk lands; add a HISTORY entry for the story.

**Awaiting Halli**

- DRAFT copy everywhere it is marked: R1 ([r1](docs/HISTORY.md#r1)), the admin
  re-shape nav/dashboard labels ([admin-reshape](docs/HISTORY.md#admin-reshape)),
  leads and Markaður screens, the `/personuvernd` §3 + §6 rewrite (the site now
  stores enquiries — [leads](docs/HISTORY.md#leads)), the services page
  ([services-page](docs/HISTORY.md#services-page)). He edits in place via the
  inline editors.
- `ENHANCEMENTS.md`: 26 proposals; #1, #2, #13, #16, #17, #18 done; #9, #10, #21
  partial; the rest need his sign-off before any implementation. #5 and #7 are
  roadmap items R4/R6.
- Publish the 14 seeded sales guides ([sales-staff](docs/HISTORY.md#sales-staff));
  decide whether `solufolk` gets the `markadur` view (hand-grant in `/admin/roles`,
  then flip `e2e/markadur.spec.js`).
- Tier prices (39/59/79 þ.kr./mán DRAFT) now live on rekstrarkerfi.is only; the
  sales guides quote them while the product site drafts a build-price-plus-
  monthly model — two draft price models to reconcile
  ([services-page](docs/HISTORY.md#services-page)).
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
  their ops email. Open: (a) `/hafa-samband` on the PUBLIC instance still
  writes its own `leads` table there, which ops never sees — route those
  enquiries to ops before go-live (or keep the form on ops' copy only);
  (b) publishing is by hand until ops runs on Azure, then a timer;
  (c) a `verktaki` (`accounts` + `allaccounts`) is published with only the
  accounts they OWN — `allaccounts` does not widen the public copy, by design
  until Halli says otherwise. The `/solusvaedi` copy is DRAFT.

- Books: a button to issue a statutory invoice from an order
  (`issueInvoiceForOrder` has no caller — hard blocker for 2026-P5, due 7.12);
  Peppol inbound; the 6-month commission tail (contract 4.3) has no code —
  monthly `manual_credit` until built ([migrations-100-102](docs/HISTORY.md#migrations-100-102)).
- UI kit programme: convert `AdminLeadsView` and `AdminMarketView`; then the
  states kit, the dialog kit (port LedgerLink's `LedgerAdminBits.js`: native
  `<dialog>`, abort-on-dismiss, 15 s write timeout, backdrop dismissal keyed
  off `mousedown` so a text-drag does not discard input), auth/identity pieces
  and the money de-fork
  ([ui-kit](docs/HISTORY.md#ui-kit)). A sold-out cart line still goes straight
  to Stripe (ENHANCEMENTS #25).
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
