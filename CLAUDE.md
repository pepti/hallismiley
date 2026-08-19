# Orange Smiley — public site (orangesmiley.is)

The **public instance** of Orange Smiley ehf.: marketing site + seed of the customer portal, for the software agency / ERP-replacement business serving Icelandic SMBs. **This is NOT a customer migration** — it is the company's own site, dogfooding the site factory.

- **Owner**: Halli. Business plan: `company/ORANGE-SMILEY-PLAN.md` (offering/tiers §1, instance architecture §4, targets §7). Build brief: `company/CLAUDE-CODE-BUILD-INSTRUCTIONS.md`. Both live in the gitignored `company/` folder in this repo, alongside `COMPANY-LOG.md` and `ORANGE-SMILEY-WEBSITE-PLAN.md`.
- **Provenance**: scaffolded 2026-08-09 from `C:\Users\Notandi\claude\HalliProjects` at base rev **`562c637`** by site-factory.
- **Deploy target**: company Azure tenant (exists since 2026-08-12; company identity details in gitignored `company/COMPANY-LOG.md`) — **no provisioning or deploy without Halli's explicit go-ahead**. ENHANCEMENTS #1 is done (2026-08-19): `deploy.yml` is neutralized, so pushing the repo is safe.

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

- Read-only references — never modify: `C:\Users\Notandi\claude\Projects\icelandicstore` (customer #1's live system). **Dated exception (Halli, 2026-08-19):** `C:\Users\Notandi\claude\HalliProjects` (the base) is writable for the duration of the base-upgrade program (plan: `~\.claude\plans\as-icelandic-store-is-wiggly-liskov.md` — icelandicstore features land in the base first, then fan out here). The base reverts to read-only when the program ends.
- One feature branch + worktree per chunk; every chunk ends with lint + `check:i18n` + tests green, then merges to main (Halli reviews history post-hoc — his decision 2026-08-09).
- **Halli approves before the fact**: all copy and pricing (draft natively in Icelandic, mark `DRAFT`), anything in `ENHANCEMENTS.md` before implementation, and any deploy.
- Prices on `/thjonusta` (39–79 þ.kr./mán) are placeholders marked DRAFT until Halli confirms.
- `APP_URL`/canonical host still references hallismiley.is in places — intentional until orangesmiley.is is registered; tracked in PLAN.md.
- Log surprises in `LESSONS.md` (tagged factory/base/project) so `/retro` can harvest them.

## Design rules (Halli, 2026-08-09 — binding for all UI work)

- **Banned defaults.** Fonts: Inter, Roboto, Open Sans, Arial, system-ui, Space Grotesk — not even in fallback stacks (use bare `serif`/`sans-serif`/`monospace` tails behind the self-hosted faces). Colors: purple/indigo/violet gradients, timid evenly-spread palettes, default Tailwind blue. Layout: centered hero + dual CTAs + three identical feature cards — the cookie-cutter SaaS shell.
- **Palette discipline.** One dominant color + one sharp accent + neutrals, all through the CSS token system. Here (the **Ash** default, Halli's pick from the ten-theme exploration set): the softened orange ramp dominates (`--gold-light/--gold/--gold-dark` = #F3B577/#E8853D/#B45309), warm ivory `--teal` is the sharp accent used sparingly, warm charcoals are the neutrals.
- **Make unexpected, context-specific choices.** The default is Ash — quiet warm charcoal, softened embers, Barlow voice, the waterfall video hero under a dark veil, the 4.1 emblem mark. Nine orange-and-black alternates live in the theme picker (`themes.css`) for comparison until a final cull; Halli picks themes by testing them live, so keep the picker healthy. When a row of cards is unavoidable, differentiate them (numbering, emphasis, asymmetry).

## Factory commands

`/status` · `/base-diff` (engine drift vs base HEAD) · `/test-plan` · `/audit` · `/retro` · `/e2e` · `/i18n-sync` — plus base commands `/security-check`, `/pre-deploy`, `/migration-new`. (`/strip-base`, `/clone-ui`, `/import-data` exist but do not apply to this build — see the warning above.)

## Build status (three jobs, in order)

- [x] Job 1 — scaffold with all features (no strip), env fixes, this file, acceptance green
- [x] Job 2 — re-skin + re-organize, merged in seven chunks: B (IS default locale) → A (orange brand) → C (business IA) → D (hide portfolio surfaces) → E (lead capture) → F (SEO/JSON-LD + a11y) → G (business-routes e2e). 2012 Jest + 109 Playwright green.
- [x] Job 3 — `ENHANCEMENTS.md` written. **Stopped for Halli's approval — implement nothing from it until he says so.**

## Self-update module (built 2026-08-10, six phases, merged to master `64457ef`)

The fleet update mechanism: release channel published by CI, in-app checker,
apply/verify, admin screen at `/admin/updates`. Full architecture and the
provisioning items that are NOT code: `docs/SELF-UPDATE.md`. Upstreaming it to
the base is documented but deliberately NOT performed (`docs/UPSTREAM-SELF-UPDATE.md`)
— HalliProjects is read-only, so that write needs Halli.

- `config/client.json` is the per-instance module config seam (defaults < file <
  `CLIENT_CONFIG_*` env). Every future module flag should read from it.
- This instance is `managed` on `stable`: it records updates and installs
  nothing. It has no `SELF_UPDATE_TRIGGER_URL`, so it could not install one yet.
- New invariant #14 (expand/contract migrations) — self-update is why.

## Base-sync 2026-08-19 (the base-upgrade program)

Three waves of engine features landed on master the same day they landed in
HalliProjects (ledger: site-factory/BASE-SYNC.md 2026-08-19):

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

The migration chain now ends 080_background_sections · 081_system_updates ·
082_admin_totp · 083_user_theme. NEVER adopt the base's numbering for the
same features (it uses 080/081/082 for totp/theme/system_updates).

## Where things stand for the next session

- **Awaiting Halli**: the 13 proposals in `ENHANCEMENTS.md` (#13, the MCP connector, added 2026-08-15), all DRAFT copy in the locale files, and the tier prices on `/thjonusta`.
- **Push-safe since 2026-08-19**: ENHANCEMENTS #1 is done — `deploy.yml` is dispatch-only with all targets in unset repo variables (guard step fails fast). Arming a real deploy = set the `vars.*` on the GitHub repo; no workflow edit.
- Public IA is `/`, `/thjonusta`, `/verkefni`, `/um-okkur`, `/hafa-samband`, `/personuvernd`. Everything else (party, bio, news, shop, and the `/projects` · `/contact` · `/privacy` aliases) is listed in `server/config/publicSurface.js`: hidden from nav, sitemap and search, still fully functional at its URL.
- Lighthouse desktop: SEO 100 and a11y 100 across the business routes; performance ~85 (home) / ~92 (`/thjonusta`). The gap is the router importing all 58 view modules eagerly — ENHANCEMENTS proposal #6.
