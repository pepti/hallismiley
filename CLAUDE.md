# Orange Smiley — customer site on the HalliProjects base

Scaffolded 2026-08-09 from `C:\Users\Notandi\claude\HalliProjects` (base rev `562c637`) by site-factory. Customer's current site: https://www.hallismiley.is

**Read `PLAN.md` first — phases 0–5, data model, open questions. Update its status checklist as work lands.**

## Stack (inherited — invariants, do not change)

- Express 4.x, CommonJS server. PostgreSQL via `pg` (dev: local PG 17; the base pins no Node/PG version).
- Vanilla JS SPA frontend — **no React/Vue/Svelte, no bundler**.
- Lucia v3 sessions + RS256 JWT. One auth system only.
- Migrations are **entries appended to the array in `server/config/schema.js`** (applied by `npm run migrate` / at boot); the `NNN_name.sql` files under `server/migrations/` are reference copies, not the source of truth. Never edit an applied entry (`/migration-new` to add).
- Consistent error envelope on all routes; pino (no console.log); typed errors → central middleware.
- Security: helmet, csrf-csrf, hpp, express-rate-limit, sanitize-html, RBAC role checks. Tighten, don't loosen.
- **Multi-theme engine:** `public/css/themes.css` + render-blocking `theme-boot.js`, `html[data-theme]` (`classic` default). Re-skin = re-hue token values, keep the machinery.
- **Inherited platform** (strip only what this customer doesn't need): shop/cart/checkout/orders, admin (products, collections, discounts, orders, roles/RBAC, bins, customers, analytics, change-requests), Stripe, Sentry, transactional email, AI auto-translation.
- Tests: Jest integration (real Postgres, no pg mocks) + Playwright e2e.
- i18n: EN + IS JSON locale files; `npm run check:i18n` before pushing translation changes. The explicit language-switcher choice is stored in the **`locale_choice`** cookie (renamed from `preferred_locale` — don't reintroduce the old name).
- Transactional email sender comes from **`EMAIL_FROM`** in `.env`; it defaults to the base owner's address, so set it per customer rather than editing `emailService.js`.

Full rules: `.claude/rules/stack-invariants.md` (auto-loaded).

## Project rules

- **Customer's source platform is READ-ONLY.** Data arrives as CSV/API exports in `data/import/` — gitignored, never committed. Never write to the customer's live platform.
- Keep the customer's look: re-theme the base, don't redesign without asking.
- Demo/seed data is throwaway; real imports via the idempotent importer only.

## Factory commands

`/strip-base` (remove portfolio, keep commerce+admin) · `/clone-ui <url>` (theme from customer site) · `/import-data` (migrations + importer from data/import/) · `/status` (phase report) · `/base-diff` (engine drift vs base HEAD) · `/test-plan` (role × route walkthrough + Playwright specs) · `/audit` (pre-cutover GO/NO-GO) · `/retro` (harvest lessons back to the factory) · `/handoff` (customer handoff packet) · `/e2e` · `/i18n-sync` — plus base commands `/security-check`, `/pre-deploy`, `/migration-new`.

Keep a running `LESSONS.md` as you go — `/retro` harvests it back into the factory at the end of the engagement.

## Status

- [ ] Phase 0: audits (`docs/frontend-audit.md`, `docs/<platform>-audit.md`) + data in `data/import/`
- [ ] Phase 1: scaffolded, stripped, boots on `npm run dev`
- [ ] Phase 2: migrations + importer
- [ ] Phase 3: re-theme + customer's key pages
- [ ] Phase 4: customer-specific workflows
- [ ] Phase 5: tests + seed from real data
