# Upstreaming self-update to the base

The self-update module is **engine capability, not an Orange Smiley special**.
Every instance the factory ever scaffolds has the same problem — "how does this
customer get the security fix?" — so the module belongs in HalliProjects, with
the flag off, and each fleet turns it on.

> **DONE — verified 2026-08-22.** The base performed this port itself (its PR
> #134, `feat/self-update-module`): all files below are in the base, migration
> numbered **082_system_updates** there, wiring complete, and the one
> deliberate difference (ship-dark `enabled: false` default) is in place. The
> only piece that stayed instance-only was `.github/workflows/promote.yml`
> (channel publisher) — upstreamed via its own base PR (COMPANY-LOG
> 2026-08-22). This document remains as the port's record; the read-only rule
> on the base is back in force.

---

## What the base gets

Copy verbatim — none of it contains anything Orange Smiley-specific:

```
server/config/clientConfig.js          server/models/SystemUpdate.js
server/config/version.js               server/services/updateChecker.js
server/routes/systemRoutes.js          server/services/updateApplier.js
server/utils/semver.js                 server/services/selfUpdateSettings.js
server/utils/maintenanceWindow.js      server/services/outboundAllowlist.js
server/services/changelogRender.js     server/migrations/081_system_updates.sql
scripts/generate-version.js            scripts/build-manifest.js
scripts/check-manifest.js
public/js/views/AdminUpdatesView.js    public/js/services/buildInfo.js
public/css/admin-updates.css
docs/SELF-UPDATE.md
tests/unit/{clientConfig,version,semver,maintenanceWindow,outboundAllowlist,changelogRender,buildManifest}.test.js
tests/integration/{updateChecker,updateApplier,systemUpdates*,selfUpdate*}.test.js
e2e/admin-updates.spec.js
```

Edits to existing base files:

| File | Change |
|---|---|
| `server/config/schema.js` | append migration `081_system_updates` (renumber if the base is ahead) |
| `server/app.js` | `app.use('/api/v1/system', systemRoutes)` |
| `server/server.js` | `logResolvedConfig()`, `verifyPendingUpdate()` after `migrate()`, `startUpdateChecker()` after `listen()`, `updateChecker?.stop()` in shutdown |
| `server/auth/adminViews.js` | add `'updates'` to `ADMIN_VIEW_IDS` |
| `public/js/components/AdminSidebar.js` | `updates` nav item + `update` icon + the `UNAVAILABLE` filter + build stamp |
| `public/js/router.js` | `/admin/updates` route + `VIEW_BY_PATH` entry |
| `public/css/main.css` | `@import './admin-updates.css'` |
| `public/js/i18n/{en,is}.json` | the `admin.updates.*` + `admin.build.*` keys (67 each) |
| `.gitignore` | `server/version.json` |
| `.env.example` | the `CLIENT_CONFIG_*` block |
| `Dockerfile` | the build-identity ARGs + `RUN node scripts/generate-version.js` |
| `.claude/rules/stack-invariants.md` | invariant #14 (expand/contract) |
| `playwright.config.js` | `E2E_PORT` support |
| `package.json` | devDependency `@axe-core/playwright` |

## The one deliberate difference

**The base ships the module OFF.** In `config/client.json` — or, since the base
has no such file, simply by changing the schema default:

```js
// server/config/clientConfig.js — in the base only
enabled: { type: 'boolean', default: false },
```

With `enabled: false` the API answers 404, the checker never starts, and the
sidebar drops the Updates line. The base therefore builds, boots and tests green
with the whole module dormant — which is the acceptance criterion.

Leave every other default as it is here. `managed` is already the conservative
mode, and a base whose defaults differ from the fleet's is a base whose tests
prove less than they appear to.

## What the base must NOT inherit

- `config/client.json` — per-instance, and this one names orangesmiley.is.
- The registry/app names in `.github/workflows/deploy.yml`.
- The `RELEASE_*` repository variables — per fleet.

## Order of operations

1. Port the files and the edits above; flip the `enabled` default to `false`.
2. `npm run lint`, `npm run check:i18n`, `npm test`, `npx playwright test` — all
   green with the module dormant.
3. Flip `enabled` to `true` in a scratch checkout and re-run: also green. A
   module that only passes while switched off is not ported, it is buried.
4. Append a `BASE-SYNC.md` entry in site-factory (already drafted there).
5. The factory's provisioning playbook picks up the non-code checklist from
   `docs/SELF-UPDATE.md`.
