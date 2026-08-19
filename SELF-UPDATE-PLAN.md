# Self-update module — build plan for Claude Code

Upgrade the Orange Smiley product with a **fleet update mechanism**: a release channel published by CI, an in-app updater module with three modes (`managed` / `auto` / `manual`), and an admin UI surface. Build it here first, then upstream to the base (HalliProjects) flag-gated — this is engine capability, not an Orange Smiley special. Business context: `company/ORANGE-SMILEY-PLAN.md` §4 (one engine, many instances; fan-out gap) — this module IS the code-update half of that fan-out.

Execute phases in order; each ends with lint + `check:i18n` + tests green on a feature branch, Halli merges. All stack invariants apply (vanilla JS SPA, CommonJS, migrations appended to `server/config/schema.js` never edited, pino only, error envelope, csrf/RBAC server-side first, Jest on real Postgres, EN+IS keys synced).

---

## Phase 0 — `client.config` seam (prerequisite; skip if ENHANCEMENTS #1 already landed)

Minimal per-instance config module — the seam every future module flag uses:

1. `server/config/clientConfig.js`: loads `config/client.json` (committed, per-instance), env-var overrides win (`CLIENT_CONFIG_*`). Deep-frozen singleton, pino-logs the resolved config at boot (secrets never belong here).
2. Schema for this feature:
   ```json
   { "modules": { "selfUpdate": {
       "mode": "managed",            // managed | auto | manual
       "channel": "stable",          // stable | canary
       "manifestUrl": "https://releases.orangesmiley.is/store/{channel}.json",
       "maintenanceWindow": { "days": ["tue","wed","thu"], "fromHour": 3, "toHour": 5, "tz": "Atlantic/Reykjavik" }
   } } }
   ```
3. Unknown keys warn, don't crash; missing file → safe defaults (`managed`).

**Accept**: unit tests for precedence (defaults < file < env), boot log shows resolved config, no behavior change anywhere else.

## Phase 1 — Version identity

The app must know exactly what it is:

1. Build info generated at image build, not runtime: `server/version.json` (`version`, `gitSha`, `builtAt`, `channel`) written by a build script; Dockerfile runs it; local dev gets `{version:"dev"}` fallback.
2. `GET /api/system/version` — admin-RBAC'd, returns version info + current `selfUpdate` mode/channel. Standard error envelope.
3. Surface `gitSha` in the existing admin footer/status area if one exists.

**Accept**: endpoint tested (auth required, shape correct); `docker build` produces an image that reports its own SHA.

## Phase 2 — Update checker service

1. Migration (append to `schema.js`, reference `.sql` copy): `system_updates` table — id, discovered_at, version, image_digest, channel, changelog_md, status (`available|scheduled|applying|applied|failed|dismissed`), applied_at, previous_digest, detail (jsonb).
2. `server/services/updateChecker.js`: on interval (reuse the base's existing scheduled-job pattern; hourly default, jittered), fetch `manifestUrl` for the configured channel. Manifest shape:
   ```json
   { "version": "1.4.2", "imageDigest": "sha256:…", "publishedAt": "…",
     "minCompatibleVersion": "1.3.0", "changelogMd": "…", "critical": false }
   ```
   Compare against `version.json`; newer ⇒ upsert an `available` row (idempotent — one row per version). Network failures: log at warn, never crash, exponential backoff. Outbound fetch goes through the existing SSRF-allowlist mechanism — add the release host to the allowlist explicitly.
3. Mode gating (server-side): `managed` ⇒ check + record only (visibility without controls). `manual` ⇒ check + expose apply action. `auto` ⇒ check + self-schedule within the maintenance window; `critical:true` may bypass the window (config flag `allowCriticalOutsideWindow`, default true).

**Accept**: Jest (real Postgres) — new-version detection, idempotent re-check, mode gating, malformed manifest rejected, allowlist enforced.

## Phase 3 — Apply + verify mechanism

Honest v1 scope: on App Service the actual image pull is platform-side (ACR CD webhook / DevOps pipeline). The app's job is to **trigger, verify, and record** — not to replace the platform.

1. `POST /api/system/updates/:id/apply` (admin RBAC + CSRF; enabled only in `manual`/`auto` modes): marks row `applying`, stores current digest as `previous_digest`, then triggers the deployment webhook (`SELF_UPDATE_TRIGGER_URL` env — the App Service CD webhook or a pipeline dispatch URL; secret, Key-Vault-sourced). In `auto` mode the scheduler calls the same code path when the window opens.
2. **Post-boot verification**: at startup, if the newest `applying` row exists — compare running version: match ⇒ `applied` (+ applied_at); mismatch after a grace period ⇒ `failed` + pino error + (if the base has an alert/email hook) owner notification.
3. **Rollback, v1 = assisted, not automatic**: `POST /api/system/updates/:id/rollback` re-triggers deployment pinned to `previous_digest` where the trigger mechanism supports it; otherwise the UI shows the exact operator command. Document plainly: an image that fails to boot cannot roll itself back — platform guard (staging-slot swap on S1, or last-known-good) is the real safety net and belongs to provisioning, not this repo.
4. Never run `applying` during boot migrations; migrations must be expand/contract — add this rule to `.claude/rules/stack-invariants.md` as a new numbered invariant ("a release's migrations must be backward-compatible with the previous release's code").

**Accept**: full state-machine covered by Jest (available→scheduled→applying→applied / failed paths, previous_digest recorded); apply endpoint refuses in `managed` mode (403, error envelope); simulated post-boot verification both directions.

## Phase 4 — Admin UI (the visible feature)

New SPA view `AdminUpdatesView.js` (vanilla JS, existing MVC/component pattern), route `/admin/updates`, nav entry in the admin section (RBAC-gated in nav AND server-side):

1. **Status card**: current version, gitSha, builtAt, channel, mode — and where updates come from (channel URL host).
2. **Available update card** (when an `available` row exists): version, published date, rendered changelog (sanitize-html), `critical` badge; buttons per mode — `manual`: "Update now" (confirm dialog states expected ~restart window); `auto`: "Scheduled for next window (Tue 03:00)" + "Update now instead"; `managed`: read-only "Updates are managed by Orange Smiley".
3. **Settings card** (`auto`/`manual` only): mode toggle auto↔manual, channel selector (stable/canary behind an "advanced" disclosure), maintenance window editor. Persisted server-side (settings table or config-override mechanism from Phase 0 — pick what the base already has for admin settings), CSRF on all writes.
4. **History table**: applied/failed updates with timestamps, digests, status chips; failed rows expose the rollback action.
5. i18n: full EN + IS key sets (`admin.updates.*`), IS drafted natively; `check:i18n` green.
6. Theme tokens only — no hardcoded colors; works in both light/dark if the instance has both.

**Accept**: Playwright — admin sees the view, non-admin 404s (route + API), mode renders correct controls, update-now flow reaches `applying` against a mocked trigger; axe/a11y pass on the view.

## Phase 5 — Release pipeline (CI side, this repo's workflow)

1. Extend the deploy workflow: build → full test suite → `npm audit` (fail on high/critical) + container scan (Trivy) → push image `:sha-<gitSha>` to ACR.
2. New **promote workflow** (manual dispatch, like icelandicstore's "Promote to PROD"): input = git SHA + channel; retags the image (`:canary` or `:stable`) **by digest**, regenerates the channel manifest (version from package.json, changelog section from CHANGELOG.md, digest, publishedAt), uploads manifest to the release host (Azure Storage static site or equivalent — env-configured).
3. Rollout discipline documented in the workflow file header: promote to `canary` → Orange Smiley's own instances soak 24–48 h → promote same digest to `stable`.

**Accept**: dry-run of promote against a test tag produces a valid manifest (schema-checked by a script `scripts/check-manifest.js`, run in CI); audit/scan gates demonstrably fail the build on a seeded vulnerable dep (test once, then revert).

## Phase 6 — Upstream + factory hand-off

1. Upstream the module to the base (HalliProjects) per BASE-SYNC discipline: default config `managed` there, everything flag-gated, `BASE-SYNC.md` entry describing what the template must know.
2. Write `docs/SELF-UPDATE.md` in this repo: architecture, manifest schema, modes, the provisioning-time items that are NOT code — per-customer ACR pull token, CD webhook wiring, `SELF_UPDATE_TRIGGER_URL` secret, platform rollback guard — flagged for the site-factory provisioning playbook (factory `RECOMMENDATIONS.md` gets a pointer).
3. `LESSONS.md` entries for anything that surprised you, tagged base/factory/project.

**Accept**: base builds green with module dormant; factory docs reference the new provisioning steps.

---

## Out of scope (v1)

Automatic unattended rollback of a non-booting image (platform concern); delta/partial updates; multi-region orchestration; updating infrastructure (env vars, Azure resources) — those remain provisioning/contract territory. Do not build a second scheduler if the base has one; do not add any new auth mechanism for the manifest host (it's public, integrity comes from digest pinning — the manifest carries the digest, the platform pulls by digest).
