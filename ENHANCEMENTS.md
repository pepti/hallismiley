# ENHANCEMENTS — Orange Smiley public site

Proposals for fitting the inherited base to the Orange Smiley business, written after building jobs 1–2 and reading the code. **Nothing here is implemented.** Each item is one branch; Halli approves before any of it starts.

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

### 3. Deterministic pagination in the bookkeeping archive
**What.** `server/scripts/books-archive-export.js` pages documents with `ORDER BY created_at LIMIT/OFFSET`. `created_at` is not unique, so a row can repeat across page boundaries; two manifest entries then claim the same `documents/<id>` path, the second copy overwrites the first, and `verify()` fails against the first entry's checksum while the manifest called it verified. Fix: `ORDER BY created_at, id`, or keyset-paginate.
**Why.** The archive's entire purpose is statutory evidence (lög 145/1994). "The verifier and the archive disagree" is the one failure it must never have. It already caused a real full-suite failure during this build (see `LESSONS.md`).
**Effort.** S. **Risk.** Very low.
**Recommendation.** Do now, and back-port to the HalliProjects base — every instance inherits the bug.

### 4. Finish the pino migration in `emailService.js`
**What.** 22 remaining `console.log` calls in `server/services/emailService.js` (plus two in `tokenCleanup.js`). New senders added in job 2E already use pino.
**Why.** Stack invariant is "pino only". Mixed logging means half the email path is invisible to structured log queries — which matters the moment a customer says "I never got the invoice".
**Effort.** S. **Risk.** Very low.
**Recommendation.** Do now; back-port to base.

---

## (b) Architectural — cheap now, expensive later

### 5. `client.config` module-flag system
**What.** Promote `server/config/publicSurface.js` (built in job 2D) into a single instance-configuration module that declares which modules an instance exposes — `marketing`, `store`, `erp`, `portal` — and have nav, routes, SSR meta, sitemap and the admin nav all read from it. Party/news/bio become the first flagged-off modules instead of a hand-maintained path list.
**Why.** This is *the* enabler for the one-engine-many-instances model (plan §4). Today "which surfaces does this instance show" is spread across `NavBar.js`, `router.js`, `ssrMeta.js`, `sitemapRoutes.js` and `publicSurface.js`; every new instance re-solves it by hand. Job 2D already proved the seam works — it just needs to be the only seam.
**Effort.** M–L. **Risk.** Medium — touches routing and nav, so it needs the e2e suite green before and after.
**Recommendation.** **Do now, while there is exactly one instance to migrate.** The cost scales with the number of deployed instances.

> STATUS 2026-08-22: strategic weight raised — this is roadmap item **R4** under the one-product-for-all strategy (`company/REKSTRARKERFI-PLAN.md` §7): tiers AND per-customer custom features are flag sets on this seam. Still awaiting Halli's implementation sign-off.

### 6. Route-level code splitting
**What.** `public/js/router.js` statically imports all 58 view modules, so every visitor downloads and parses 107 JS modules (~70 KB of it the two Party views alone) before the home page can render. Convert the route table to dynamic `import()` — native ESM, no bundler, so stack invariant #1 holds.
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

## (c) Later / needs a decision first

### 9. Disposition of the dormant portfolio modules
**What.** Decide per module: **party** (birthday landing + magic-link guest auth), **news**, **halli bio**, **shop**, and the home page's **skills/stats/discipline** sections whose inline editor lost its host when the business home page was composed (job 2C).
**Why.** They all still work and are all hidden. Each has a real cost: code to maintain, tests to keep green, DB tables, and 70 KB of JS on every page load (proposal 6). But deleting capability is irreversible and the brief was explicit that nothing goes without sign-off.
**Options per module.** Repurpose (news → company updates; skills/stats → proof points), flag off via proposal 5, or remove.
**Effort.** S to decide, M to execute. **Risk.** Low if flagged, irreversible if removed.
**Recommendation.** Halli decides. My suggestion: repurpose news, flag off party and bio, keep shop (it is the Verslun tier demo), and replace skills/stats with business proof points.

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

---

## Remaining `hallismiley` references

Not a proposal so much as a checklist for the day the domain lands: `APP_URL` fallbacks in `ssrMeta.js`, `sitemapRoutes.js`, `emailService.js` and `indexNow.js`; `robots.txt`'s sitemap line; `RUNBOOK.md` and `docs/`; and the deploy workflow (proposal 1). User-visible copy has already been rebranded.
