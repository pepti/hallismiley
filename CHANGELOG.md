# Changelog

All notable changes to Halli Smiley (the HalliProjects base) are documented
here, newest first, written from the merge and squash commits on `main`.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). The heading of
a version section is load-bearing: `scripts/build-manifest.js` extracts the
`## [<package.json version>]` section as the release notes the self-update
channel publishes (`docs/SELF-UPDATE.md`). `package.json` is still `1.0.0`, so
**until it moves, a promotion would publish the `[1.0.0]` March-2026 notes
below as the current release** (and an instance already on 1.0.0 would never
see an update). The release step is one commit: bump `package.json` and rename
`## [Unreleased]` to `## [<version>] — <date>`. Dated sub-sections inside a
version use `###` only — a `## <date>` heading would be parsed as a version
string and end the section. Everything under a version heading is published
verbatim — which is why the note about the 1.0.0 items that no longer describe
the code sits HERE, above the sections: routing is pushState, auth is Lucia
sessions, hosting is Azure; see the `[Unreleased]` entries.

---

## [Unreleased]

Everything merged to `main` since the 1.0.0 release, by date (one line per
merged PR or chunk, taken from the merge subjects and branch names).

### 2026-09-12

- Docs back in step with the code, and the defects the sync found (#154): every
  markdown file verified against source and the live Azure/GitHub state;
  canonical host from `APP_URL`; MCP realm/alias say `hallismiley`; `docLimiter`
  first on `/documents/:id`; `deploy.yml` pushes `:sha-<sha>` + build-args;
  `promote.yml` on Node 24; CI waits for the runner's apt lock; scheduled
  non-blocking Trivy scan; `nodemailer` and `railway.toml` gone.
- The leftovers (#155): migration 085 splits vehicle costs (6600 commercial,
  6610 passenger cars blocked); the expense form converts to minor units; the
  contact form delivers to the admins; the error-rate and memory alerts get
  their inputs; the HTTPS redirect targets the canonical host; the books
  settings screen `/admin/books/settings` comes upstream from orangesmiley.

### 2026-09-07 → 09-08

- Shared admin UI kit + eight defect fixes found alongside it (#153, upstreamed
  from orangesmiley): `debounce`, `localPref`, `pageTitle` + router hook,
  `listState`, `adminTable`, `adminPager`, `admin-kit.css`; 2FA QR plate,
  enrolment gate for `admin_anywhere`, checkout `required`, `LoginModal`
  listener leak, country labels, avatar hint, CSV parity, `en-GB` dates.
- Monitoring stylesheet shipped — `/admin/monitoring` rendered unstyled (#152).

### 2026-09-03 → 09-06

- Hidden birthday mini-game page `/is/aron13ara` (#151).
- News editor overlay could not scroll to its footer with many media (#149).

### 2026-08-25

- `AGENTS.md` replaced by a pointer to `CLAUDE.md` (#145); `CLAUDE.md` trimmed
  of derivable sections (#143).

### 2026-08-22 — harvest from icelandicstore

- H1 Tier-1 fixes (#136) · H2 isolated per-branch e2e database (#137) · H3
  status tokens, chart theming, docs truth (#138) · H4 Monitoring: `event_logs`
  (migration 083), client error beacon, `/admin/monitoring` (#139) · H5 MCP
  connector: `mcp_tokens` (migration 084), `/admin/mcp`, dark behind
  `MCP_ENABLED` (#140).
- Static-asset rate-limit exemption (#141).
- `promote.yml` — release-channel publisher for the self-update fleet (#142).

### 2026-08-19 → 08-20 — the base-upgrade program

- Harden the migration runner (one transaction per migration, advisory lock)
  and the upload roots (#123).
- Close the SDL audit gaps ported from icelandicstore (#124); uploaded avatars
  validate, unlink and stay owner-scoped (#125).
- Admin two-factor sign-in — TOTP + recovery codes, migration 080 (#126).
- Two-layer social-login kill switch, default ON (#127); TEST chrome one-way
  clamp (#128).
- Node 24 LTS, digest-pinned; dependabot keeps it patched (#129). Express 4 → 5
  (#130). CI pipeline hardened against the failures that hit `main` that day
  (#131).
- Per-account UI theme + Appearance section, migration 081 (#132).
- Self-update module upstreamed from orangesmiley, ships OFF — migration 082
  (#134).
- Admin nav row tints, 12 colours, per admin (#133); re-tuned for the base's
  dark surfaces (#135).

### 2026-08-06 → 08-08

- Real double-entry bookkeeping — ledger, VSK, payroll, till, archive;
  migrations 072–079 (#117).
- Party page Icelandic-only (#97); deploy-alert and CI-toolchain fixes (#115,
  #116); audit gate fix (#105); wave-3 icelandicstore port (#87); feature
  branch merges of 2026-07-29 (#114).

### 2026-07-11 → 07-29

- Party module: cost tracking and cost overview, logistics tables and a
  collaborative to-do list, invite/RSVP admin editing, Icelandic-primary
  translation with IS→EN auto-follow, instant guest access with owner-sent
  info e-mails, party-specific OG tags, schedule editing, "Skrá mætingu"
  (#78–#104, #96, #98–#99).
- CI audit lockfile refresh (#100).

### 2026-06-19 → 06-28

- Shop + admin platform upgrade — catalog, discounts, orders, dynamic RBAC,
  theming (#67); BIN system, the visual warehouse-stock board (#68); port of
  icelandicstore admin updates — auth, CSV, bulk PDF, sidebar, roles,
  customers (#70).
- Multi-role membership + Roles "Members" board (#77); sortable, searchable
  Manage Users (#76); owner always notified of party access requests (#74);
  invite code replaced by e-mail request → owner approval → magic link (#71);
  mail From `halli@hallismiley.is` (#75); Facebook login hidden until the Meta
  app is live (#69).
- Docs: project guidance, S-SDLC policy v1.0, shop-redesign plan (#73).

### 2026-05-06 → 05-19

- Shop: multi-section storefront with bookable services — migration 045,
  `/shop/{products,tech,carpentry}` (#64); product-card clean URLs (#66).
- SEO: IndexNow + crawler content for Bing (#63); `BingSiteAuth.xml` (#65).
- Party: sortable guest tables, per-option RSVP status, editable activity
  headings with EN→IS auto-translate, Icelandic default, inline-edit RSVP
  labels (#54–#60); dependency patch `sanitize-html` 2.17.4 (#61); the
  2026-05-08 → 05-12 batch of PR merges (#20, #33–#50): CI-gated deploy, stale Railway
  references stripped (migration 043), local test-DB setup doc, deprecated
  actions bumped, npm audit high.
- Home hero inline edit (#31); party stat cards, hero cover upload, logistics
  tracker, inline cell editing (#23–#30); theme steps smoothed (#29, #25);
  content uploads routed through `UPLOAD_ROOT` (#24); `/halli` 15 MB upload
  cap + image resize (#22).

### 2026-04-15 → 04-29

- Editable usernames with Icelandic letters preserved in OAuth-derived names;
  TOCTOU race on username uniqueness closed.
- Rich-text HTML sanitizer + CSRF/CSP/CORP hardening (#18); write cap tripled
  with a quota warning (#16); admin-editable `/halli` hero and divider images
  (#15).
- i18n: EN→IS auto-translation on admin save via Claude Haiku, retranslation
  of stale IS leaves, batched `translateTree`; per-locale news/product admin
  UI; real Icelandic content; validation/error locale (P0–P3).
- Performance: recompressed hero JPEGs (153 MB saved), self-hosted fonts,
  immutable cache for uploads, pg keepalive + statement timeout, bulk
  checkout/product queries, seeds and admin bootstrap moved out of server
  start.
- Deploy: force container restart after image deploy; OIDC auth restored in
  the Azure workflow; SEO overhaul with dynamic sitemap + JSON-LD + crawler
  pre-render; dead-domain refs fixed.
- Party: invite-code flow, guest confirmation e-mail, admin visibility, RSVP
  helper fields (migration 027); shop e-commerce MVP — apparel with
  size/colour variants, prod-safe seeder; Google Sign-In via OAuth 2.0
  (Arctic + PKCE); every Contact page section editable.

## [1.0.0] — 2026-03-30

Initial production release.

### Added
- Vanilla JS SPA with hash-based routing (Home, Projects, About, Admin, Privacy, Terms)
- RS256 JWT authentication with 15-minute access tokens and 7-day refresh token rotation
- Refresh token storage and revocation in PostgreSQL (replay-attack prevention)
- Admin panel for creating, editing, and deleting portfolio projects
- Project filtering by category, featured status, and year
- Pagination support on GET /api/v1/projects (limit/offset query params)
- Featured projects endpoint with 5-minute public Cache-Control
- Contact form endpoint
- Structured HTTP request logging with pino/pino-http
- Sentry error tracking integration (opt-in via SENTRY_DSN env var)
- Global unhandledRejection and uncaughtException process handlers
- Rate limiting: global (200/15 min), auth login (10/15 min), auth refresh (20/15 min), writes (30/15 min)
- Helmet CSP, HSTS, frame protection, Permissions-Policy headers
- CORS whitelist, HPP protection, body size limit (100 KB)
- Gzip compression, ETag/Last-Modified caching on static assets
- No-cache policy on index.html and SPA fallback routes
- robots.txt, sitemap.xml, manifest.json (PWA shell)
- PostgreSQL schema with migration runner, auto-updated `updated_at` trigger
- Token cleanup service (expired/revoked tokens pruned every 24 hours)
- Railway deployment config with Docker multi-stage build and Node.js healthcheck
- HTTPS redirect in production, non-root Docker user
- Comprehensive integration test suite (auth, projects, contact, rate limits, security)
