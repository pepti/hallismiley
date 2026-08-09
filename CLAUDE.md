# Orange Smiley — public site (orangesmiley.is)

The **public instance** of Orange Smiley ehf.: marketing site + seed of the customer portal, for the software agency / ERP-replacement business serving Icelandic SMBs. **This is NOT a customer migration** — it is the company's own site, dogfooding the site factory.

- **Owner**: Halli. Business plan: `C:\Users\Notandi\claude\Projects\orange smiley\ORANGE-SMILEY-PLAN.md` (offering/tiers §1, instance architecture §4, targets §7). Build brief: `CLAUDE-CODE-BUILD-INSTRUCTIONS.md` in the same folder.
- **Provenance**: scaffolded 2026-08-09 from `C:\Users\Notandi\claude\HalliProjects` at base rev **`562c637`** by site-factory.
- **Deploy target**: company Azure tenant — **pending kennitala, do not provision anything yet**.

## ⚠ Do NOT run /strip-base

Halli's explicit instruction: **all base features and data models stay** — shop/cart/checkout/orders, admin + RBAC, bookkeeping suite, projects, news, party, user system, themes, i18n, Stripe, everything. Portfolio surfaces that don't fit the business (party, personal bio/news presentation) are *hidden from nav/SSR/sitemap but left functional* at their routes. Disposition of each module is decided via `ENHANCEMENTS.md` proposals with Halli's sign-off — never by deletion during the build.

## Stack (inherited — invariants, do not change)

- Express 4.x, CommonJS server. PostgreSQL via `pg` (dev DB `orangesmiley`, test DB `orangesmiley_test`, user postgres/postgres).
- Vanilla JS SPA frontend — **no React/Vue/Svelte, no bundler**.
- Lucia v3 sessions + RS256 JWT. One auth system only.
- Migrations are **entries appended to the array in `server/config/schema.js`** (applied by `npm run migrate` / at boot); the `NNN_name.sql` files under `server/migrations/` are reference copies. Never edit an applied entry (`/migration-new` to add).
- Consistent error envelope on all routes; pino (no console.log); typed errors → central middleware.
- Security: helmet, csrf-csrf, hpp, express-rate-limit, sanitize-html, RBAC role checks. Tighten, don't loosen.
- **Multi-theme engine:** `public/css/themes.css` + render-blocking `theme-boot.js`, `html[data-theme]` (`classic` default). Re-brand = re-hue token *values*, keep the machinery.
- Tests: Jest integration (real Postgres, no pg mocks) + Playwright e2e. Adapt inherited specs, never delete them.
- i18n: EN + IS JSON locale files; `npm run check:i18n` before pushing translation changes. Icelandic is the primary/default visitor locale (job 2); EN mirrors it. Language-switcher choice lives in the **`locale_choice`** cookie.
- Transactional email sender = **`EMAIL_FROM`** in `.env` (set to placeholder `info@orangesmiley.is` — base default is halli@hallismiley.is, never use it here).

Full rules: `.claude/rules/stack-invariants.md` (auto-loaded).

## Project rules

- Read-only references — never modify: `C:\Users\Notandi\claude\HalliProjects` (the base) and `C:\Users\Notandi\claude\Projects\icelandicstore` (customer #1's live system).
- One feature branch + worktree per chunk; every chunk ends with lint + `check:i18n` + tests green, then merges to main (Halli reviews history post-hoc — his decision 2026-08-09).
- **Halli approves before the fact**: all copy and pricing (draft natively in Icelandic, mark `DRAFT`), anything in `ENHANCEMENTS.md` before implementation, and any deploy.
- Prices on `/thjonusta` (39–79 þ.kr./mán) are placeholders marked DRAFT until Halli confirms.
- `APP_URL`/canonical host still references hallismiley.is in places — intentional until orangesmiley.is is registered; tracked in PLAN.md.
- Log surprises in `LESSONS.md` (tagged factory/base/project) so `/retro` can harvest them.

## Factory commands

`/status` · `/base-diff` (engine drift vs base HEAD) · `/test-plan` · `/audit` · `/retro` · `/e2e` · `/i18n-sync` — plus base commands `/security-check`, `/pre-deploy`, `/migration-new`. (`/strip-base`, `/clone-ui`, `/import-data` exist but do not apply to this build — see the warning above.)

## Build status (three jobs, in order)

- [x] Job 1 — scaffold with all features (no strip), env fixes, this file, acceptance green
- [ ] Job 2 — re-skin + re-organize: chunks B (IS default) → A (orange brand) → C (business IA) → D (hide portfolio surfaces) → E (lead capture) → F (SEO/JSON-LD) → G (business-routes e2e)
- [ ] Job 3 — `ENHANCEMENTS.md` proposals → **STOP for Halli's approval**
