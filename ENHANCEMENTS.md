# ENHANCEMENTS — Orange Smiley public site

Proposals for fitting the inherited base to the Orange Smiley business, written after building jobs 1–2 and reading the code. **Status is per item** — read each proposal's STATUS line (as of 2026-09-11: #1, #2, #13, #16, #17, #18 implemented; #21 partially; #9 and #10 partially; the rest open). Each item is one branch; Halli approves before any of it starts.

Format: **what** / **why for Orange Smiley** / **effort** (S ≤ half a day · M ≈ 1–2 days · L > 2 days) / **risk** / **recommendation**.

---

## (a) Quick wins

### 1. ✅ DONE 2026-08-19 — Neutralise the inherited deploy workflow

**Implemented** (approved by Halli as chunk 0.2 of the base-upgrade program):
`deploy.yml` is now `workflow_dispatch`-only (the `workflow_run` auto-trigger
is gone — re-adding it is a decision for when the company stack exists), every
target reads from repo variables that do not exist yet (`ACR_NAME`,
`IMAGE_NAME`, `WEBAPP_NAME`, `RESOURCE_GROUP` — the same inert-by-default
pattern as promote.yml), a guard step fails before Azure login while they are
unset, all `hallismiley*` names and the `halli@hallismiley.is` alert address
are gone (alerts now need `vars.ALERT_EMAIL_TO/FROM` + `RESEND_API_KEY`), and
the CI-red alert job went with the auto-trigger. The repo is push-safe.
Original proposal kept below for the record.

#### Original proposal
**What.** `.github/workflows/deploy.yml` came over verbatim from the base. It still pushes to `hallismileyacr.azurecr.io/hallismiley`, deploys App Service `hallismiley-app` in resource group `hallismiley-rg`, restarts it, and emails `halli@hallismiley.is` when a deploy is skipped. It triggers automatically on every successful CI run on `main`.
**Why.** This repo is a different company's product. The moment it lands in a GitHub repo that can see Azure credentials, a merge to `main` aims a deploy at Halli's personal live site. Today the repo has no remote and no secrets, so nothing can fire — that is exactly why this is cheap to fix now.
**Effort.** S. **Risk.** Low to change; high if left.
**Recommendation.** **Do now, before the repo is pushed.** Parameterise the registry/app/RG names via repo variables and leave them unset, or drop the `workflow_run` trigger so it is `workflow_dispatch`-only until the company tenant exists (kennitala pending).

### 2. Leads table + admin list view
**What.** Persist submissions from `/hafa-samband` to a `leads` table (name, company, email, phone, current_platform, message, source, locale, created_at, contacted_at) and add a minimal admin list behind the existing RBAC — see, filter, mark contacted.
**Why.** Job 2E deliberately stopped at "validate, notify, count". Right now a lead exists only as an email; if that email is missed the lead is gone, and there is no pipeline view for the weekly digest the operating model calls for (plan §5.6 stage 3).
**Effort.** M — one migration appended to `server/config/schema.js`, a model, one admin view. All the patterns exist (`Customer`, `AdminCustomersView`).
**Risk.** Low. Adds PII to the database, so the retention promise in `/personuvernd` (24 months) needs a cleanup job or a documented manual sweep.
**Recommendation.** Do now — it is the difference between a marketing site and a sales tool.

> ADDENDUM 2026-08-27 (sales-staff program): when this lands, add a grantable `leads` admin view id and grant it to the `solufolk` role (migration 090) so the human sales team works its own lead queue from the same shell as Handbók sölufólks. The Sölustjóri agent's lead-tracking duty currently runs on Halli forwarding the notification emails — this proposal retires that workaround.

> **STATUS: APPROVED + IMPLEMENTED — Halli, 2026-09-07 (admin re-shape, chunk B).** Migration `097_leads` (095/096 belong to the books branch), `server/models/Lead.js` (never-throwing insert alongside the email in `contactController`), `/api/v1/admin/leads` (read + status/note/owner = `requireView('leads')`; delete + CSV = admin; all `no-store`), `/admin/leads` in the Sölustarf group, `leads` appended to `solufolk` by the migration, daily prune at `LEAD_RETENTION_DAYS` = 730, and **`/personuvernd` §3 + §6 rewritten** (DRAFT for Halli) — the old text said the enquiry was not stored. Operator notes: `docs/SALES-STAFF.md`.

### 3. Deterministic pagination in the bookkeeping archive
**What.** `server/scripts/books-archive-export.js` pages documents with `ORDER BY created_at LIMIT/OFFSET`. `created_at` is not unique, so a row can repeat across page boundaries; two manifest entries then claim the same `documents/<id>` path, the second copy overwrites the first, and `verify()` fails against the first entry's checksum while the manifest called it verified. Fix: `ORDER BY created_at, id`, or keyset-paginate.
**Why.** The archive's entire purpose is statutory evidence (lög 145/1994). "The verifier and the archive disagree" is the one failure it must never have. It already caused a real full-suite failure during this build (see `LESSONS.md`).
**Effort.** S. **Risk.** Very low.
**Recommendation.** Do now, and back-port to the HalliProjects base — every instance inherits the bug.

### 4. Finish the pino migration in `emailService.js`
**What.** 13 remaining `console.*` calls in `server/services/emailService.js` (plus three in `tokenCleanup.js`) — counts re-measured 2026-09-11 (`grep -cE '^\s*console\.'`); the original proposal said 22 and two. New senders added in job 2E already use pino.
**Why.** Stack invariant is "pino only". Mixed logging means half the email path is invisible to structured log queries — which matters the moment a customer says "I never got the invoice".
**Effort.** S. **Risk.** Very low.
**Recommendation.** Do now; back-port to base.

---

## (b) Architectural — cheap now, expensive later

### 5. ✅ DONE 2026-09-24 — `client.config` module-flag system
**What.** Promote `server/config/publicSurface.js` (built in job 2D) into a single instance-configuration module that declares which modules an instance exposes — `marketing`, `store`, `erp`, `portal` — and have nav, routes, SSR meta, sitemap and the admin nav all read from it. Party/news/bio become the first flagged-off modules instead of a hand-maintained path list.
**Why.** This is *the* enabler for the one-engine-many-instances model (plan §4). Today "which surfaces does this instance show" is spread across `NavBar.js`, `router.js`, `ssrMeta.js`, `sitemapRoutes.js` and `publicSurface.js`; every new instance re-solves it by hand. Job 2D already proved the seam works — it just needs to be the only seam.
**Effort.** M–L. **Risk.** Medium — touches routing and nav, so it needs the e2e suite green before and after.
**Recommendation.** **Do now, while there is exactly one instance to migrate.** The cost scales with the number of deployed instances.

> STATUS 2026-08-22: strategic weight raised — this is roadmap item **R4** under the one-product-for-all strategy (`company/REKSTRARKERFI-PLAN.md` §7): tiers AND per-customer custom features are flag sets on this seam. Still awaiting Halli's implementation sign-off.

> STATUS 2026-09-24: **IMPLEMENTED** (Halli picked R4 when asked which roadmap items to build). Shipped as `modules.preset` + `modules.<id>.enabled` over a catalogue (`server/config/moduleCatalog.js`) rather than the `marketing/store/erp/portal` split sketched above: the modules are shop, pos, books, news, projects, party, bio, salesOps; the tiers vefur/verslun/rekstur are presets. Off = absent (404 before auth), a different idea from `publicSurface.js`'s hidden-but-functional — so party/news/bio on THIS instance stay hidden, not off (Halli's rule). Per-customer custom modules join the catalogue as they are built. [HISTORY](docs/HISTORY.md#module-flags-2026-09-24).

### 6. Route-level code splitting
**What.** `public/js/router.js` statically imports all 65 view modules (2026-09-11 count; 58 when filed), so every visitor downloads and parses the whole module graph — measured at 107 JS modules in August 2026, more now (~70 KB of it the two Party views alone) — before the home page can render. Convert the route table to dynamic `import()` — native ESM, no bundler, so stack invariant #1 holds.
**Why.** This is the entire remaining Lighthouse performance gap: `/thjonusta` scores 92–93 but the home page sits at 84–85 against a ≥90 target, and the profile shows the cost is module graph, not content (network settles by ~680 ms; the rest is parse/execute of views nobody asked for). It also gets worse with every module the ERP tier adds.
**Effort.** M. **Risk.** Medium — changes navigation timing app-wide; needs a loading state and a full e2e pass.
**Recommendation.** Do now. It is the one change that moves perf past 90, and the fix gets harder as the view count grows.

### 7. Customer-portal module
**What.** Evolve the existing user system into a portal: account = company (kennitala), tier/subscription display, their invoices, service status, change-request submission via the existing `ChangeRequest` model. Data is published *into* this instance one-way from ops (plan §4) — design the ingest seam now even though the publisher does not exist yet.
**Why.** It is the second half of what this instance is for, and the ChangeRequestWidget is already the support product. `kennitala` already exists in the bookkeeping schema (`invoices`, `suppliers`), so the identity key is not new.
**Effort.** L. **Risk.** Medium-high — it is the first surface where one customer could see another's data, so RBAC and row scoping need real tests.
**Recommendation.** Later — after the first customer contract is signed and the ops instance actually has data to publish. Design the seam now, build when there is something to show.

> STATUS 2026-08-22: roadmap item **R6** under the one-product-for-all strategy (`company/REKSTRARKERFI-PLAN.md` §7). Timing unchanged (after first contract).

### 8. Company deploy workflow (prepare, do not provision)
**What.** A parameterised CI → ACR → App Service workflow whose registry, app name, resource group and alert address come from repo/org variables, so the same shape serves the public site, the ops instance and every customer instance. Includes the `/health` + `/ready` boot smoke already in `ci.yml`.
**Why.** Every future instance needs this; writing it once as a template is the difference between a fleet and a pile of bespoke pipelines.
**Effort.** M. **Risk.** Low while nothing is provisioned.
**Recommendation.** Prepare now (it supersedes proposal 1), provision when the kennitala and company Azure tenant land.

---

### 21. Shared admin UI kit — and push it down to the base

**What.** A small, framework-free kit of admin primitives under `public/js/components/` and `public/js/utils/`: `debounce`, `localPref`, `pageTitle` (+ a router hook), `listState` (filters ↔ query string), `adminTable` (`sortableTh`/`cycleSort`/`bindSortable`), `adminPager` (`pagerHtml`/`bindPager`/page-size memory), `adminStates` (loading/empty/error + retry + `aria-busy`), `adminFilters` (chips with counts, debounced search), `adminDialog` (native `<dialog>` confirm/prompt) and `modalA11y` (`trapFocus`/`onEscape`/`captureFocus`/`focusFirstInvalid`), plus one `admin-kit.css`. Roughly 925 lines across 11 files, none over 160. Each module exports pure HTML-string builders plus a `bind*()` that attaches ONE delegated listener to a persistent container and returns `detach()` — nothing owns state, nothing owns a node. Four to six flagship views convert to prove it (`AdminUsersView`, `AdminLeadsView`, `AdminMarketView` first); the rest convert opportunistically. Ends with a PR upstreaming the kit to `hallismiley`.

**Why (as surveyed 2026-09-07; the pager CSS and `document.title` items below are fixed since `ecd85f5`).** Nothing in the estate is reusable at the admin layer. This repo has ~35 admin tables and **4** of them sort; `.admin-pagination` is used by Leads and Markaður and has **zero CSS**, so both pagers render unstyled today; `debounce` exists as ~10 hand-rolled copies at two different delays; there are 27 native `window.confirm()` calls, no focus trap anywhere, no `aria-busy`, no retry affordance, and `router.js` never sets `document.title`, so the browser tab keeps the boot title through every navigation. The cost of this is not theoretical: LedgerLink was scaffolded from `hallismiley` on 2026-09-07, had to hand-roll every affordance for its three new screens, and its design gate then found 23 issues, 3 of them High. The two icelandicstore harvests (2026-08-22, 2026-09-02) took infrastructure and correctness and skipped the affordances, so the base never received them — which is why work that lands only here flows downward to nothing.

**How it respects the invariants.** Vanilla ES modules, no bundler, no framework (#1). `admin-kit.css` carries zero colour literals and loads before `themes.css`, so all three themes ride `html[data-theme]` (#15) — the one deliberate exception is the TOTP QR plate, which must stay literal white or it stops scanning on the dark themes. Server-side gating is untouched; the kit is UX only (#8). New `adminKit.*` keys land in EN and IS in the same commit as first use (#10). The string half of every module is unit-testable under `testEnvironment: 'node'`; the DOM half is covered by Playwright (#9). No migration, no schema change, no new route — the one server change is hardening `adminController.js`'s sort whitelist to 400 on an unknown key like `marketController.js` already does, plus a parity test that the client's sort literals are a subset of the server's exported map.

**Effort.** M — eight branches, each ending lint + `check:i18n` + Jest + Playwright green. **Risk.** Low-to-medium, concentrated in the conversion chunks: `sales-handbook.spec.js` asserts `.admin-error` is absent on a healthy page (so `errorHtml('')` must return `''`), `admin-surface.spec.js` waits on `.dash-card__loading` reaching 0 (so that class must not be renamed), URL sync must use `replaceState` and never `pushState` or `page.goBack()` breaks in every admin spec, and `responsive-screenshots.spec.js` baselines need refreshing where a page-size picker joins the toolbar.

**Recommendation.** Do it, and upstream it. The kit is worth more in `hallismiley` than here — this repo gets tidier, but the base is what every future customer instance is cut from.

> **STATUS: APPROVED — Halli, 2026-09-07. PARTIALLY IMPLEMENTED — merged `ecd85f5` 2026-09-08, upstreamed as base PR #153.** Landed: the eight defects below, `utils/debounce.js`, `utils/localPref.js`, `utils/listState.js`, `utils/pageTitle.js`, `components/adminTable.js`, `components/adminPager.js`, `css/admin-kit.css`, `format.formatRelative`, and `AdminUsersView` as the converted reference (`e2e/admin-list-kit.spec.js`). Still open: the Leads/Markaður conversions, the states kit, the dialog kit, auth/identity, the money de-fork (`docs/HISTORY.md#ui-kit`; open items in `PLAN.md` → Status). Sequenced as: defects first (see below), then kit foundations, table kit, states kit, dialog kit, auth/identity, money de-fork, then the base PR. LedgerLink and `rekstrarkerfid` pull from the base afterwards rather than by parallel port, which keeps LedgerLink's `Ledger*` handover boundary clean.

**Defects found while surveying, fixed alongside (branch `feat/admin-kit-defects`).** All verified by inspection, not inferred:

1. **The 2FA enrolment QR was unscannable on the default theme.** `public/css/` had no `totp-*` rules at all — the view came across in the 2026-08-22 harvest without its stylesheet, so the QR rendered with no white plate on Glóð. Ported and re-tokenised into `user-system.css`.
2. **A seller pushed to enrol in 2FA had no panel to enrol from.** #17 widened `mfaService.protectedRole()` to `accounts_holder`/`admin_anywhere` without widening the UI, which stayed on `profile.role === 'admin'`. New `auth.isMfaProtected()` mirrors the server predicate; `tests/unit/mfaProtectedClient.test.js` pins the two together.
3. **Every `required` at checkout was inert.** `CheckoutView` set `novalidate` and called `reportValidity()` on no path. Fixed — and a latent one-way bug found next to it: `syncShipping()` cleared `required` and then re-queried `[required]` on the next call, so choosing local pickup and switching back left the address fields permanently optional.
4. **`LoginModal` leaked a document listener** — an anonymous `keydown` handler added in `mount()` and never removed, so every ESC on the page closed the modal for the rest of the session, and `_resetToPasswordStep()` stacked another one per abandoned 2FA attempt. Now rides the open/close lifecycle.
5. **Checkout country labels were hardcoded English**, so the IS locale showed an English country list. Moved to `checkout.countryName.<code>` in both locale files.
6. **`profile.avatarHint` promised "max 2MB"** while code and server both enforce 5MB. Corrected in both locales — a factual correction, not new copy.
7. **The client CSV writer had drifted from the server's.** `server/utils/csv.js` exempts a plain number from formula-neutralisation (blanket-prefixing turned every negative balance into the text `'-500` and broke numeric import); `downloadCsv.js` did not, despite a comment claiming the two were in step. `tests/unit/csvClientParity.test.js` now pins them to one truth table.
8. **`OrderHistoryView` hardcoded `'en-GB'`** for dates while the locale-aware `utils/format.js` sat unused, so an Icelandic reader got English month names.

**Dead capability noticed in passing, not built:** `POST /shop/discounts/validate` exists with no client caller; `GET /reports/accountant-pack` has no UI; `issueInvoiceForOrder` still has no caller (tracked in `PLAN.md` → Status as a 2026-P5 blocker).


## (c) Later / needs a decision first

### 9. Disposition of the dormant portfolio modules
**What.** Decide per module: **party** (birthday landing + magic-link guest auth), **news**, **halli bio**, **shop**, and the home page's **skills/stats/discipline** sections whose inline editor lost its host when the business home page was composed (job 2C).
**Why.** They all still work and are all hidden. Each has a real cost: code to maintain, tests to keep green, DB tables, and 70 KB of JS on every page load (proposal 6). But deleting capability is irreversible and the brief was explicit that nothing goes without sign-off.
**Options per module.** Repurpose (news → company updates; skills/stats → proof points), flag off via proposal 5, or remove.
**Effort.** S to decide, M to execute. **Risk.** Low if flagged, irreversible if removed.
**Recommendation.** Halli decides. My suggestion: repurpose news, flag off party and bio, keep shop (it is the Verslun tier demo), and replace skills/stats with business proof points.

> **STATUS 2026-09-07 (partial — the admin side, Halli):** the retail admin screens (products, collections, bins, orders, discounts, sales report, POS till) and the home-background editor are **hidden from the admin sidebar by policy**, not removed: `public/js/components/adminSurface.js` (the admin twin of `publicSurface.js`), revealable per admin in sidebar edit mode, routes live, ids grantable. The projects board moved off `/admin` to the unlisted `/admin/projects`; `/admin` is the company overview. Public-side disposition (party, news, bio, skills/stats) is still his decision.

### 10. Observability

> **STATUS: substantially delivered in-app (harvest 2026-08-22):** event_logs + client error beacon + /admin/monitoring + retention cleanup came over from icelandicstore #195, and the false-memory-critical alert bug was fixed (#180 port). Remaining from this proposal: App Insights wiring + external availability ping — still with-first-deploy.
**What.** App Insights wiring + an availability ping, plus pino serializers for the lead flow. Scaled-down version of the icelandicstore monitoring runbook.
**Why.** Plan §5.6 stage 3 assumes a daily fleet-health report exists. Nothing reports today.
**Effort.** M. **Risk.** Low.
**Recommendation.** With the first deploy — it is meaningless before there is a running site.

### 11. IS-first i18n audit
**What.** Job 2B made Icelandic the visitor default via `PUBLIC_DEFAULT_LOCALE`, leaving `DEFAULT_LOCALE='en'` as the content-fallback dimension. Audit the consequences: ISK/date/number formatting, admin surfaces still authored EN-first, and the ~2,100 inherited client keys whose Icelandic is machine-translated portfolio copy.
**Why.** The site now *defaults* to Icelandic, so any English leaking through is customer-visible.
**Effort.** M. **Risk.** Low.
**Recommendation.** Before launch, alongside Halli's copy review.

### 12. Instance provenance / upstream hooks
**What.** Keep the recorded base SHA current, keep the `LESSONS.md` habit, and add whatever makes a future base→instance update agent's job mechanical (plan §4 fan-out gap). This build already produced five base/factory lessons worth folding back.
**Why.** Instances have fresh git histories, so updates are agent-applied patches. The cheaper that is, the more likely the fleet actually stays current.
**Effort.** S ongoing. **Risk.** None.
**Recommendation.** Run `/retro` at the end of this engagement and fold the lessons into site-factory.

### 13. MCP connector — let owners/admins drive the system from their Claude accounts

> **STATUS: APPROVED + IMPLEMENTED (read-only v1) — Halli, 2026-08-22, harvest program.** Shipped as a port of icelandicstore #188 rather than the OAuth design below: bearer tokens minted at /admin/mcp (sha256-hashed, expiring, revocable — migration 088), stateless Streamable-HTTP endpoint at /api/v1/mcp, scope double-gate, ships dark behind MCP_ENABLED. v1 tools: environment_info + updates_status (no leads tool — leads have no DB rows by design, see #4). The OAuth flow sketched below remains the phase-2 path (the mcp_tokens table pre-ships kind/oauth_client_id/parent_id for it); note the design's "existing RS256 JWTs" premise was disproved during the harvest — no JWT layer ever existed.
**What.** Expose the app as a remote MCP server: one `POST /mcp` endpoint (Streamable HTTP, official `@modelcontextprotocol/sdk` on the existing Express app), which a store owner or admin adds as a **custom connector** in their own Claude account (claude.ai → Settings → Connectors; requires Pro/Max/Team/Enterprise — Team/Enterprise owners can add it org-wide). Claude then gets typed, RBAC-gated tools against this instance: look up orders/products/stock, sales summaries, list + filter leads, bookkeeping queries; a second phase can add write tools (mark order shipped, adjust stock, mark lead contacted), each individually flagged.
**Why for Orange Smiley.** Two-sided: (a) admins of this instance get conversational access to their own data — "hvaða leads komu inn í vikunni?" — without new UI; (b) it becomes a **fleet feature**: every customer instance inherits it, and "talk to your store from Claude" is a differentiator no Icelandic ERP replacement offers. Dogfooding it here first is exactly what this instance is for.
**How it respects the invariants.**
- *#3 one auth system:* connectors authenticate via OAuth 2.1 (authorization-code + PKCE + dynamic client registration, per the MCP spec). The authorize page is a normal site page behind the existing Lucia session; issued access tokens are the existing RS256 JWTs (`keys/`). New grant flow, same system — no parallel auth.
- *#8 server-side gating:* every tool call re-resolves the caller's role set from the DB (same path as `requireAuth`), so disabled accounts and revoked roles are rejected immediately regardless of token lifetime. Tools declare a required role; scoping is enforced in SQL, not in the tool description.
- *#7 security posture:* rate limit on `/mcp` + the OAuth routes, pino audit line per tool call (who, tool, args hash), sanitized inputs, no CSRF needed (bearer tokens, not cookies). Discovery documents (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`) are static and public by spec.
- *#5 error envelope:* MCP is JSON-RPC — protocol responses follow the MCP error shape, not the REST envelope. Documented exemption with reason, per the rule.
- *Module seam:* `modules.mcp` in `config/client.json` — `enabled`, `allowedRoles`, `writeTools` — so a customer instance can ship with it off or read-only.
**Effort.** M–L: M for OAuth routes + consent page + read-only tool set; the write tools and per-instance flagging push it to L. **Risk.** Medium — it is a new authenticated surface exposing business data, and the OAuth endpoints must be reviewed like auth code, not like a feature. Mitigated by read-only first, RBAC re-check per call, and the audit log. Verify at implementation time that the current SDK version loads cleanly under CommonJS (it ships a CJS build; pin the version that does).
**Recommendation.** Approve the design now; implement read-only after the site is deployed (a remote connector needs a public HTTPS URL, so it is meaningless before then — same sequencing as proposal 10). Write tools as a separate sign-off.

> STATUS 2026-08-22 (strategy): this connector is the substrate of the one-product-for-all AI-operations model — per-customer monitoring, module management and the feature-request workflow all run over it. Phase 2 (OAuth 2.1 + write tools + feature-request tool) is roadmap item **R5**, the AI ops loop **R8** (`company/REKSTRARKERFI-PLAN.md` §5/§7). Write tools remain a separate Halli sign-off.

> STATUS 2026-09-24 (R5a): **the OAuth half of phase 2 is IMPLEMENTED** — discovery, dynamic client registration, PKCE, admin consent on `/tengja/<id>`, rotated refresh tokens, revocation (migration 110; [HISTORY](docs/HISTORY.md#mcp-oauth-2026-09-24)). Tokens are the opaque `mcp_tokens` rows, not JWTs (none exist). Every call re-checks the owner is still an admin. Write tools and the feature-request tool are R5b — **IMPLEMENTED 2026-09-24** ([HISTORY](docs/HISTORY.md#mcp-write-tools-2026-09-24)): `set_update_settings`, `set_module`, `file_feature_request`, scope `write` (Halli's "continue" after R5 was recommended, taken as the write-tool sign-off; production stays read-only until he sets `MCP_ALLOWED_SCOPES` per stack).

> NOTE 2026-09-07: the "no leads tool — leads have no DB rows" premise changed with #2 (migration 097). A read-only `leads` tool (counts + the queue, never the message bodies by default) is a natural candidate for the next tool sign-off; it is NOT added here.

### 14. In-app AI assistant for the sales handbook

**What.** A chat panel inside `/admin/handbok` where a salesperson asks product/pricing/objection questions in Icelandic and gets answers grounded EXCLUSIVELY in the published `sales_guides` rows (the handbook, migration 090). Server-side: one new route under `/api/v1/admin/handbok/assistant` behind `requireView('handbok')` + its own rate limit, calling the Claude API (current model tier at implementation time) with the published guides as context and a system prompt that refuses questions the handbook cannot answer ("spurðu Halla"). Ships dark behind `modules.salesAssistant` in `config/client.json` (`enabled`, `model`, `maxTokensPerDay`) + an `ANTHROPIC_API_KEY` env — the same seam discipline as #13.
**Why.** The sales team has average software knowledge; search-by-reading is slower than asking. The guides table is already the curated, Halli-approved corpus — grounding on it (and nothing else) keeps answers inside approved positioning and DRAFT-price discipline. This is also the customer-facing pattern (R6 portal assistant) dogfooded internally first.
**How it respects the invariants.** Server-side gating (#8): the view check + per-user rate limit on the route; the client panel is UX only. Security (#7): the API key lives in env, never the client; prompts and answers logged via pino (who, tokens, truncated question) for cost control; user text is data, never executed. Error envelope (#5) on the route. No new auth (#3).
**Effort.** M — one route + one service + a panel in AdminHandbookView; the corpus query is `SELECT ... WHERE published`. **Risk.** Medium: recurring API cost (mitigated by `maxTokensPerDay` and caching the corpus in the prompt-cache), and answer quality is bounded by handbook quality — which is the point.
**Recommendation.** Approve after the handbook has real content and the team has used it for a few weeks; the guides table and read API were built as the seam, so nothing needs restructuring later.

### 15. Guide media — images in handbook bodies

**What.** A `sales_guide_media` table + upload route cloned from the news-media pattern (`createNewsUpload`), plus `<img>`/`<figure>` added to BOTH rich-text allowlists (server `sanitize.js` and client `utils/sanitizeHtml.js`). Crucially the files must be served behind auth: news assets under `/assets/` are statically served to anyone, so guide images need an authenticated file route (`/api/v1/admin/handbok/:id/media/:file` with `requireView('handbok')`) instead of the static mount.
**Why.** Screenshots are the natural medium for "how do I do X in the admin" guides aimed at people with average software knowledge. v1 shipped text-only because widening the allowlist and the static-serving question deserve their own review.
**Effort.** M. **Risk.** Low-medium — allowlist widening touches the XSS surface (both layers must move together, see LESSONS.md 2026-08-27 on the `body_is` precedent), and the auth-gated file route must not regress the upload-path allowlist hardening from base-sync 6A.
**Recommendation.** Do when the first guide actually needs a screenshot, not before.

### 16. Markaður — read-only prospect list in the admin

**What.** A `/admin/markadur` list view over `market_companies` joined to each company's latest `market_financials` row (migration 093, 2026-09-01): filter by `list_type`, `sector_group` and `status`, sort by `fit_score`, and a row opens the company's summary, sources and figures. Wiring: view id `markadur` in `ADMIN_VIEW_IDS` (`server/auth/adminViews.js`), a sidebar item in the **staff** group beside Handbók sölufólks (`AdminSidebar.js`), routes behind `requireAuth` + `requireView('markadur')` mirroring `salesGuidesRoutes.js`, `admin.nav.markadur` in both locale files, and optionally a migration granting the view to `solufolk` so the sales team works its shortlist from the same shell. The one write is the status change (`shortlist` → `handed_to_sales` / `rejected`), admin/moderator only.
**Why.** The research data lands in the DB today (Halli's decision, 2026-09-01) but is reachable only through SQL or the importer's staging JSON. Sölustjóri's prospect duty and the human sales team need to see the shortlist without a database client.
**How it respects the invariants.** Server-side gating (#8) via `requireView`; every response `no-store` like the guides; read-only apart from the status field, so no new sanitize surface; error envelope (#5) on the routes; tokens only, so it survives all three themes (#15).
**Effort.** S–M — one routes file, one view, one sidebar entry, two locale keys. **Risk.** Low.
**Recommendation.** Do after the first research pass has filled the tables and Halli has confirmed the size band — the list is only worth a screen once the rows are worth reading.

> **STATUS: APPROVED + IMPLEMENTED — Halli, 2026-09-07 (admin re-shape, chunk C).** No migration. `/api/v1/admin/markadur` (`marketRoutes.js`/`marketController.js`: list over `market_companies` ⋈ LATEST `market_financials`, filters + whitelisted sorts, detail with every year; reads = `requireView('markadur')`, all `no-store`), the single write `PATCH /:id/status` shortlist → handed_to_sales / rejected (admin/moderator, race-safe `WHERE status='shortlist'`, 409 otherwise; audit = pino line + `updated_at`), `/admin/markadur` in the Sölustarf group (`AdminMarketView`, drawer; `report_path` rendered as text, never a link). **Not seeded onto `solufolk`** — Halli grants it by hand in `/admin/roles`. Optional later: a two-column `status_changed_at/by` migration if a durable actor is wanted. Caveat: a re-import whose JSON row carries `status` overwrites a hand-off (export without it) — `tests/integration/market.test.js` pins the safe case.

### 17. Customer accounts + staff roles + staff audit log

**What.** The per-customer state of record (`customer_accounts`: slug, kennitala, tier, lifecycle status lead → offered → signed → provisioning → building → live → paused/churned, the owning seller, contact, contract dates, fees, quota, commission rates, repo/URL/Azure identifiers), two seeded staff roles (`solumadur` = owns accounts + earns commission; `verktaki` = services every account, no commission), an append-only `staff_audit_log` (account writes, role grants, invitations, disable/enable, commission), `users.github_login`, row scoping in both layers (a seller sees only their own accounts; `allaccounts` is a permission-only id that widens it), and the 2FA gate widened to anyone holding `accounts`. Filed 2026-09-03 from the operating plan §1a (D-002); the D0 chunk never wrote it here.
**Why.** Sellers with full autonomy (D-002) need an account to own before anything else — commission, GitHub access and provisioning all key off `owner_user_id`.

> **STATUS: APPROVED + IMPLEMENTED — Halli, 2026-09-07.** Migration **098_customer_accounts** (pure expand: three tables, one column, two roles). `server/models/CustomerAccount.js` (scope is a required argument of every method; foreign ids answer 404), `server/auth/accountScope.js`, `server/services/staffAudit.js` (closed vocabulary, `books_forbid_any_mutation` trigger), `/api/v1/admin/accounts` (`adminAccountRoutes.js`: read/create/patch/provision-request/audit/commission = `requireView('accounts')` + scope; owner change = admin), `/api/v1/admin/audit` (admin) on `/admin/monitoring`, hooks in the roles/customers/users controllers, `utils/adminRole.js userHoldsView` → `mfaService` treats accounts holders like admins. UI `/admin/accounts` + `/admin/accounts/:id` in Sölustarf; Markaður's drawer gains "Stofna viðskiptareikning" (the #16 hand-off, one transaction). NOT here: GitHub teams/rulesets and the drift script (#19), the seller-access runbook.

### 18. Service-contract invoices + commission ledger

**What.** `POST /api/v1/admin/bookkeeping/invoices/service` — the company's own revenue path (the bookkeeping suite could only invoice shop orders): a build-fee instalment (50% at signing / 50% at go-live, D-005), a contract month in advance (pro-rated override allowed), or overage verkeiningar; ex VSK + 24%. `commission_events` written in the invoice's transaction with the owner and rate snapshotted (D-003: 15% build / 10% recurring; overage carries none). Report `GET /api/v1/admin/commission?from&to` per seller per month: accrued vs payable (invoice paid in full — commission is earned on receipt), plus the events and a CSV; scoped like accounts.
**Why.** D-003's commission cannot be paid by hand for long, and the company had no invoicing path for its own contracts.

> **STATUS: APPROVED + IMPLEMENTED — Halli, 2026-09-07.** `invoiceService.createServiceInvoice` (same counter/lines/journal/books-audit machinery as `createFromOrder`; account row locked for the document), `server/models/Commission.js`, `adminCommissionRoutes.js`, UI: the "Gefa út reikning" card on `/admin/accounts/:id` (admin) and `/admin/commission` (`AdminCommissionView`). Not built on purpose (plan): `paid_at`/payout marking (Halli pays the seller's verktaka invoice outside the app), clawback, split ownership, volume tiers, the 6-month tail on departure (D-003 — recorded, applied by hand at the statement).

### 19. Site-factory generate/provision workflows + deploy guardrails

**What.** `generate-client.yml` + `provision-client.yml` + `provision-client.ps1` in site-factory (claims a pooled subscription, appends to `fleet.json`), `scaffold.js` defaults to `rekstrarkerfid` at a release tag, `deploy.yml` rollback + slot swap + `DEPLOY_ACTORS`, GitHub teams/rulesets per customer repo, the weekly access-drift script. Filed 2026-09-03 (plan §1b, D-009–D-013).
**Effort.** L. **Risk.** Medium — it arms real deploys. **Recommendation.** After the first signed customer; needs Halli's arming list (SP, subscription pool, release host).

### 20. Verkeiningar metering

**What.** The quota D-001 sells: `einingar:N` labels on customer-repo PRs, `einingar-check.yml` summing the month, the 80 % signal to the seller and customer, overage feeding #18's `overage` invoice. Filed 2026-09-03.
**Effort.** M. **Recommendation.** With the first customer under contract.

---

#### The icelandicstore harvest backlog — survey note for #22–#26

The 2026-09-07 survey compared this repo against `icelandicstore@origin/main` (`b3bb35d`) across six surfaces. ⚠ The local icelandicstore clone is parked on `fix/pos-vat-rate`, **141 commits behind** origin/main with 207 dirty entries of real local-only work — read it with `git show origin/main:<path>`, never check it out.

The survey's headline is that **the harvest is not one-directional**. This repo's bookkeeping module is ~14,800 lines and is a system of record — immutability triggers citing Reglugerð 505/2013, period locking, a 39-action audit log, Peppol/UBL, the replay harness — against icelandicstore's ~2,500-line reporting veneer, where every Books screen carries a banner saying the figures are not the official books and `createExpense` is wired only to the seed script. On books, **this repo is upstream**. Where icelandicstore leads is the shop floor. Those are #22–#25. The reverse queue is at the end.

### 22. ✅ DONE 2026-09-24 (till) — Barcode scanning at the till and on the floor

**Status.** Approved by Halli with the 2026-09-24 ice harvest (chunk C, his defaults) and landed: `components/ScanInput.js` (ice's file, unchanged) mounted on `AdminPosView` with `GET /api/v1/admin/bookkeeping/pos/lookup` (variant first). The sounds are a per-device switch on the till, not the `scan_sounds`/`scan_volume` settings pair; the pick / receive / inventory-check screens stay ice-only. [HISTORY](docs/HISTORY.md#harvest-ice-c-2026-09-24).


**What.** Port `ScanInput.js` (226 lines): a USB keyboard-wedge detector with an auto-focused field firing on Enter *plus* a document-level capture listener for scanners that send no Enter suffix, burst timings (35 ms gap, 60 ms idle flush, minimum length 3), a duplicate-read cooldown, six distinct WebAudio feedback tones synthesised with no asset (ok / error / wrong item / line done / all done / over-scan, told apart by tone count and pitch direction), vibrate patterns, and a reduced-motion-aware flash. It bails whenever an editable element has focus, so it never swallows typing.
**Why.** `AdminPosView` here is tap-and-search only — no `keydown`, no `.focus()`, no scan path — while its own header comment at line 15 already says "after every scan". That is the difference between ringing up a queue and clicking through one. icelandicstore mounts it in five views and re-focuses after every line added and every completed sale.
**Effort.** M. **Risk.** Low — additive, one component plus a mount per view. The audio needs a settings pair (`scan_sounds`, `scan_volume`) so a shop floor can turn it off.
**Recommendation.** Highest-value single item in the backlog, and the cheapest of the four.

### 23. ✅ DONE 2026-09-24 — Audited stock adjustments

**Status.** Approved by Halli with the 2026-09-24 ice harvest and landed as ice's three-number model: migration 112 `inventory_adjustments` + `orders.stock_deducted_at`, `models/Inventory.js` the one writer (product editor, variant grid, import, MCP, fulfilment), a reason list, `GET /products/:id/adjustments` and a Stock history panel. The engine keeps `stock >= 0` (no overselling). [HISTORY](docs/HISTORY.md#harvest-ice-c-2026-09-24).


**What.** An `inventory_adjustments` table, a reason enum mirrored client↔server and re-validated on write, a history endpoint, and batch corrections applied under row lock — one audit row per line.
**Why.** Stock is written **directly** here, and `adminShopController.js:54-56` says so in a comment: "no inventory-adjustments audit table, so there's nothing to stay consistent with (revisit if an audited stock-adjust feature is ever ported)." This is that revisit. For an ERP sold to Icelandic SMBs, "who changed this count, when, and why" is not optional.
**Effort.** M — needs a migration. **Risk.** Low. Expand-only, so invariant 14 is satisfied by construction.
**Recommendation.** Do it with, or just after, #22 — a scanner that corrects stock wants the audit trail underneath it.

### 24. ◐ PARTLY DONE 2026-09-24 — Import wizards with a dry-run stage

**Status.** The products half landed with the 2026-09-24 ice harvest (chunk D): the product import reads CSV, .xlsx and PDF on the server (`services/productImport`, `exceljs` + `pdf-parse`), matches on SKU then barcode, never reads an order quantity as stock, and can create a product with its variants from grouped rows — the dry run is the existing preview. Still open: the customer importer's column mapping, goods receipt and the invoice merger (Ísprjón-specific). [HISTORY](docs/HISTORY.md#harvest-ice-d-2026-09-24).


**What.** icelandicstore's four-stage customer importer (ingest → map columns → preview → confirm), the invoice merger with fuzzy catalogue matching, the goods-receipt receive/reconcile flow, and `utils/parseSalesReport.js` — delimiter detection, quote-aware splitting, header-row detection that disqualifies numeric and banner rows, and bilingual field hints.
**Why.** The product import here is CSV-only, parsed in the browser, 9 columns, and update-never-create. Every customer migration starts with someone else's spreadsheet.
**Effort.** L. **Risk.** Medium — server-side file parsing pulls in dependencies (ExcelJS is already present; `pdf-parse` is not) and a row-cap/preview discipline.
**Recommendation.** Scope to the customer importer first; the merger is Ísprjón-specific.

### 25. ◐ PARTLY DONE 2026-09-24 — Storefront quality of life

**Status.** The bug-shaped half is approved and landed with the 2026-09-24 ice harvest: the shortfall guard (`utils/availability.js` in the cart and the checkout, a 409 from the checkout API, the webhook re-check) and the shop search box that dropped letters (ice #350). Still open, for a later decision: reorder from order history, order-history depth, quantity steppers, kennitala at checkout, pay-by-invoice. [HISTORY](docs/HISTORY.md#harvest-ice-c-2026-09-24).


**What.** The stale-basket / shortfall guard (`utils/availability.js`) that blocks checkout on a sold-out line, reorder from order history, order-history depth (expandable line items, delivery-note and invoice PDFs, CSV), quantity steppers with pack/MOQ snapping, kennitala at checkout with admin-configurable requiredness, and the pay-by-invoice path.
**Why.** One of these is bug-shaped rather than nice-to-have: **a cart line that sells out here goes straight to Stripe.** icelandicstore warns per line, caps the quantity, and disables the checkout button.
**Effort.** M–L. **Risk.** Low each, but it touches the money path, so it wants its own e2e coverage.
**Recommendation.** Take the shortfall guard on its own, ahead of the rest.

### 26. Shared site-wide Footer component

**What.** Extract the footer into `components/Footer.js`, mounted once from `main.js` and re-rendered on locale change.
**Why.** The footer markup lives inside `HomeView.js` here, so most routes have no footer at all. icelandicstore's is a component with an explicit comment about the stale-locale trap it had to solve.
**Effort.** S. **Risk.** Low.

### 27. ✅ DONE 2026-09-26 (on its branch) — Merge duplicate products; AI reads a supplier PDF into the import (dark)

**Status.** Approved 2026-09-26 (harvest 2) by Halli; built on `harvest2/lane6b-merge-ai` from icelandicstore `941cf51d` (#309/#311/#312/#315, #306/#314). Products → Duplicates suggests duplicates with their evidence and merges them in one transaction (engine migration 120, provisional number); "Read with AI" ships dark behind `PRODUCT_IMPORT_AI_ENABLED` — **switching it on costs money per page** (budgets and the cost note in `docs/DEPLOYMENT.md`). [history](docs/history.d/2026-09-26-harvest2-lane6b-merge-ai.md#harvest2-lane6b-2026-09-26).

**What.** (a) Duplicate suggestions (same barcode, same SKU, same name, colourway, similar name) and a merge that moves variants, stock (through `Inventory`, audited), images, collection links and order lines to the product kept, leaves issued invoices alone, and redirects the merged product's URL. (b) Claude reads a free-form supplier price list into create-only import rows, verified against the PDF's own text, priced by the admin's markup and EUR rate.
**Why.** Every catalogue that came from an import has duplicates; and a supplier's price list is rarely a spreadsheet.
**Effort.** L. **Risk.** Money/stock path (merge) and spend (AI) — both behind review, tests and, for the AI, a switch that is off.

### Reverse queue — this repo → icelandicstore and the base

Where the core is ahead. Queue for icelandicstore's next window; fold into the base PR where it fits.

- **Consent-banner language bug (icelandicstore).** Its `consent.js` resolves the visitor's locale and then uses it *only* to build the privacy href — every visible string is hardcoded English, so an Icelandic visitor's first interaction with the site is in English. Fixed here. *(The converse is also true and is ours to fix: our banner uses hardcoded hex and ignores the theme, where icelandicstore's uses custom properties.)*
- **Avatar owner-scoping (icelandicstore).** Its `UPLOADED_AVATAR_RE` is `/^user-\d+-…/` but `users.id` is a UUID text column, so `\d+` can never match and **every uploaded avatar is rejected on PATCH**. Its `uploadAvatar()` also has zero callers, so an icelandicstore user cannot change their picture after signup. Both fixed here.
- **`verifyImageBytes`** on the avatar upload route — absent from icelandicstore *and* the base. Also orphan-file cleanup on PATCH, `no-store` + `attachment` on invoice PDFs, and `docLimiter` on document routes (icelandicstore rate-limits none of its exports or PDFs).
- **The books module**, if icelandicstore ever wants real books rather than the reporting veneer.


## Remaining `hallismiley` references

Not a proposal so much as a checklist for the day the domain lands (re-grepped 2026-09-11): `APP_URL` fallbacks in `ssrMeta.js`, `sitemapRoutes.js`, `emailService.js` (also its `EMAIL_FROM` fallback `halli@hallismiley.is`) and `indexNow.js`; `robots.txt`'s sitemap line; **`public/index.html`** (baked canonical, the three `hreflang` alternates, `og:url`, `og:image`, and the Organization JSON-LD `@id`/`url`/`logo`/`image` — structured data IS user-visible); `server/app.js`'s canonical-host 301 (derives from `APP_URL` since 2026-09-12; only its fallback literal remains); `server/models/Setting.js`'s `contactEmail` fallback `hallismiley@gmail.com`; `tests/env.js`'s pinned `APP_URL`; `.env.example`'s `APP_URL` and OAuth redirect URIs (the DB example host was neutralised 2026-09-11); `RUNBOOK.md` and `docs/`. The deploy workflow is done (proposal 1). Rendered copy has been rebranded (R1); the metadata above has not.
