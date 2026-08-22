# Orange Smiley public site — build plan

**Status:** Jobs 1–3 complete; stopped for Halli's approval of `ENHANCEMENTS.md`. Since then: self-update module built + merged 2026-08-10 (six phases — see CLAUDE.md and `docs/SELF-UPDATE.md`). **Created:** 2026-08-09. Base: `C:\Users\Notandi\claude\HalliProjects` @ `562c637`.

Not a customer migration — this is Orange Smiley ehf.'s own public instance (marketing + customer-portal seed). Brief: `company/CLAUDE-CODE-BUILD-INSTRUCTIONS.md`. Business plan: `company/ORANGE-SMILEY-PLAN.md` (same folder — gitignored, inside this repo).

## Job 1 — Scaffold with ALL features (done 2026-08-09)

- Scaffolded via site-factory, base rev `562c637`, secret scan clean.
- **`/strip-base` deliberately NOT run** (Halli's instruction — every module stays; see CLAUDE.md).
- `.env`: local dev values; `EMAIL_FROM=info@orangesmiley.is` placeholder (base gotcha fixed).
- `.env.example`: added missing `STRIPE_*`, `RESEND_API_KEY`, `DEFAULT_LOCALE` entries (BASE-SYNC gap).
- `tests/env.js` fallback DB → `orangesmiley_test`; dev DB `orangesmiley` created.
- Acceptance: dev boots, `npm test` / `lint` / `check:i18n` green, base SHA in CLAUDE.md, first commit.

## Job 2 — Re-skin + re-organize (presentation/navigation, not capability)

One branch + worktree per chunk, lint + i18n + tests green per chunk, merge to main (Halli reviews history post-hoc — his call 2026-08-09). Chunk order:

1. **B `feat/is-default-locale`** — `PUBLIC_DEFAULT_LOCALE='is'` for the visitor-facing role only; `DEFAULT_LOCALE='en'` stays as content-fallback/storage dimension (party module depends on it).
2. **A `feat/orange-brand`** — retoken `:root` values (orange ~#F97316, warm neutrals, one dark accent), `lava` theme → orange-dark variant, wordmark + smiley SVG, favicon/og-image.
3. **C `feat/business-ia`** — routes `/thjonusta`, `/verkefni` (projects module repurposed as case studies), `/um-okkur`, `/hafa-samband`, `/personuvernd`; new home hero "Allt kerfið þitt á einum stað" (static, video removed); NavBar → business links; IS-first DRAFT copy.
4. **D `feat/hide-portfolio-surfaces`** — `server/config/publicSurface.js` single source of truth; noindex on hidden routes (`/party`, `/halli`, `/news`, `/shop`, …); sitemap = business routes only; specs assert "hidden from nav, still functional".
5. **E `feat/lead-capture`** — contact plumbing extended (name, company, email, phone, current platform, message), pino instead of console.log, notification email, limiter 5/hr/IP. Leads DB table + admin view deferred to Job 3.
6. **F `feat/seo-jsonld`** — Organization + Service JSON-LD, index.html baked meta, `/personuvernd` copy, Lighthouse ≥90 on `/` + `/thjonusta`.
7. **G `feat/e2e-business-routes`** — Playwright spec walking the six business routes in both locales; final acceptance sweep.

## Job 3 — ENHANCEMENTS.md → STOP for Halli ✅ written

12 numbered proposals in `ENHANCEMENTS.md`, categorized quick-wins / architectural-now / later. **Implement nothing without approval.** The one to read first is #1: the inherited `deploy.yml` still targets Halli's personal Azure resources and must be neutralized before this repo is pushed anywhere.

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

Acceptance: 2012 Jest + 109 Playwright green · lint clean · i18n in sync · invariant hook clean · Lighthouse SEO 100 / a11y 100 on the business routes.

## Known intentional oddities

- `--url`/canonical references to hallismiley.is remain until orangesmiley.is is registered (kennitala pending) — not an oversight.
- Stripe/OAuth/Resend env vars blank in dev: shop browsable, checkout/OAuth/email inert until configured — features preserved, not removed.
- Deploy: company Azure tenant, **do not provision** until kennitala lands.

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
now ends 086_landing_background_scene. Copy on toggles/alt-texts is DRAFT
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
