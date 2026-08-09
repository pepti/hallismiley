# Orange Smiley — migration plan (https://www.hallismiley.is → custom Node app)

**Status:** Draft. **Created:** 2026-08-09 by site-factory. Base: `C:\Users\Notandi\claude\HalliProjects` @ `562c637`.

## Phases

### Phase 0 — Capture & extract (read-only, done in Cowork)

1. Frontend audit of https://www.hallismiley.is (logged in if gated) → `docs/frontend-audit.md`: theme tokens, page structure, money pages, missing UX, app-specific data (pack sizes, MOQ) that exports won't contain.
2. Backend/admin audit (READ-ONLY browsing) → `docs/<platform>-audit.md`: data shapes, order workflow, installed apps = feature checklist.
3. Data export → `data/import/` (gitignored): API token preferred, CSV fallback; exports may email to the owner.

### Phase 1 — Scaffold

`scaffold.js` done. Then `/strip-base`: remove portfolio (projects/news/party/bio), **keep commerce + admin**, rewire app.js/router/NavBar/ssrMeta/sitemap. Acceptance: `npm run dev` boots with an empty catalog and admin intact. Note: inherited portfolio DB tables get dropped in Phase 2; inherited tests adapted in Phase 5.

### Phase 2 — Data model & importer

`/import-data`: migrations appended to `server/config/schema.js` (with a reference `.sql` copy under `server/migrations/`) for what the base schema still lacks (product_variants, companies/locations, price_tiers, order history…) — much commerce schema already exists in the base, so focus on the customer-specific gaps — then an idempotent `server/scripts/import-<platform>.js`; images to `public/assets/products/`. Acceptance: run the importer twice → identical row counts.

### Phase 3 — Re-theme + key pages

`/clone-ui https://www.hallismiley.is`: theme tokens → re-skin SPA; rebuild customer's key pages on base components.

### Phase 4 — Customer workflows

From the audits: checkout type (invoice/card), approval queues, reorder, admin workflows. Server-side gating first.

### Phase 5 — Verify

Adapt Jest/Playwright; seed from real import; `/security-check` + `/pre-deploy`.

Then the go-live gate:
- `/test-plan` — generate `TEST-PLAN.md` + the role × route Playwright walkthrough. Must pass **twice in a row without a DB reset**.
- Fill in `docs/SLO.md` (scaffolded as a skeleton — every `TODO` resolved) and confirm the observability it claims is actually live, not just wired.
- `/audit` — parallel read-only audit → scorecard → **GO / CONDITIONAL GO / NO-GO**. Work the P0 list before cutover.

## Open questions

1. Pricing model (single list vs per-customer tiers)?
2. Payment workflow (card, invoice, both)? Stripe is already wired in the base — reuse or replace?
3. Stock semantics (blocking or advisory)?
4. Which base theme to start from, or fully custom tokens? Which RBAC roles does this customer need?
5. AI auto-translation on or off for this customer?
6. Deployment target and environment model — a single tier, or TEST/eval + PROD with promotion? (The Icelandic Store engagement built a two-tier Azure kit — `docs/environments.md`, `azure-env.md`, `azure-monitoring.md`, `DEPLOYMENT.md` in that project — worth reading as reference before designing this one.)
7. (add per customer)
