# Engine sync — the runbook

Engine-owned. It reaches every downstream by merge, so it reads the same in
every repo. The story: [HISTORY → engine-upstream-2026-09-22](HISTORY.md#engine-upstream-2026-09-22);
the decision is D-021 (`company/DECISIONS.md`, gitignored, in the engine repo).
Migrations have their own page: `docs/MIGRATIONS.md`.

## 1. Purpose and the two layers

`orange-smiley/orangesmiley` is **the engine**: the one repo where generic
code is authored. Every other repo in the estate is a **downstream** that
merges it. Orange Smiley ehf. is the parent company and builds several
products; Rekstrarkerfið is one of them.

Two layers, never confused:

- **Layer 1 — source.** Engine repo → downstream repos, by `git merge
  upstream/master` on an `engine-sync/<date>` branch, one PR per repo. Generic
  work born downstream goes UP by `git cherry-pick -x` (§8).
- **Layer 2 — runtime.** A product repo → its deployed instances, by that
  product's own release channel (`promote.yml`, canary → stable, the
  self-update module — `docs/SELF-UPDATE.md`). One channel set PER PRODUCT,
  in that product's tenant. The engine repo is also a product in this sense
  (it serves orangesmiley.is and, later, `ops.orangesmiley.is`), so its own
  channel is the first one armed; rekstrarkerfid's is next.

Invariant, restated: **product repos derive from the engine; customer
instances derive from a product's image; instances are never cloned from
instances.**

## 2. Roles

| Repo | Role | Product id | Default branch | Sync branch | Who merges the sync PR | What merging does |
|---|---|---|---|---|---|---|
| `orange-smiley/orangesmiley` | engine (and its own company instance) | `os` | `master` | — (it IS the engine) | — | CI + `deploy.yml` by dispatch only |
| `orange-smiley/rekstrarkerfid` | product | `rk` | `master` | `engine-sync/<date>` | Verkstjóri on green | nothing (deploy is dispatch-only) |
| `orange-smiley/ledgerlink` | product (contract, full handover later) | `ll` | `master` | `engine-sync/<date>` | Verkstjóri on green | nothing (no Azure yet) |
| `orange-smiley/icelandicstore` | customer #1, live | `ice` | `main` | `engine-sync/<date>` | **Halli** | deploys TEST |
| `pepti/hallismiley` | personal (Halli's CV/hobby site) | `hs` | `main` | `engine-sync/<date>` | **Halli** | deploys www.hallismiley.is |

`engine.json` in each repo carries `product`, `role`, `upstream`,
`upstreamBranch`, `rev` (engine commit last merged), `syncedAt`, `syncedPr`,
`grafted`, `productPaths`, `history`. It is product-owned: a sync never
overwrites it, only appends to it.

## 3. Preconditions (per downstream, once)

- An `upstream` remote → `https://github.com/orange-smiley/orangesmiley.git`.
- The one-time history graft is in place: `git merge-base HEAD upstream/master`
  resolves. If it does not, run `engine-sync.js --graft --scaffold-rev <sha>`
  first (temporary `git replace --graft` refs onto the common hallismiley
  ancestor `fdf9581`, one ordinary merge, refs deleted on exit — never
  `--allow-unrelated-histories`).
- `engine.json` exists and its `product` matches
  `server/config/product-migrations/<id>.js`.
- **A fresh clone or worktree of `origin/<default branch>`.** Never the parked
  hallismiley or icelandicstore checkouts on this disk — both hold stale,
  dirty state that is not this work.

## 4. Routine sync

`node C:\Users\Notandi\claude\Projects\site-factory\engine-sync.js` (or
`/engine-sync` in the repo) does the mechanical steps; the operator does the
rest.

1. `git fetch upstream`.
2. Branch `engine-sync/<date>` from the default branch.
3. `git merge --no-ff upstream/master` (or `--to <rev>` for a chosen engine
   commit). Exit 3 = conflicts: resolve per §6, `git add`, rerun `--continue`.
4. `engine.json` `rev`/`syncedAt`/`history` are updated **in the same commit**
   as the merge.
5. Verify: `npm ci` → `npm run lint` → `npm run check:i18n` → `npm run
   test:ci` → boot smoke → `node server/scripts/migrate.js --plan` against a
   restored copy of EACH live database of that product (the RUN list must be
   exactly the engine entries new to that database).
6. Push and open the PR titled `engine-sync: <short sha> (<date>)`. The body
   lists `git log --oneline <old rev>..upstream/master` and the `--plan`
   output per environment.
7. Merge per §2. Where merge deploys (hallismiley, icelandicstore) Halli
   merges, at a time he picks.

## 5. Security fast path

1. The patch lands on orangesmiley `master` by PR; CI green.
2. The same day: an engine-sync PR in every downstream (§4, `--no-tests` is
   NOT allowed here — the chain runs).
3. Merge per §2.
4. Each product that is live promotes: `gh workflow run promote.yml -f
   sha=<full sha> -f channel=canary -f critical=true`, the product's own
   instances soak, then the same sha to `stable`.

Targets: every downstream carries the patch **within the week; critical
within 48 h**. Öryggisvörður's Monday sweep reports any security-tagged
engine commit absent from a downstream's `engine.json.rev..upstream/master`
(that is the definition of "unsynced").

## 6. Conflict rules

- **Engine files win** unless the path is listed in `engine.json.productPaths`
  or matched by `.engine-paths` (generated from the feature wiki). Product-owned
  paths are never overwritten by a sync; `.gitattributes` marks them
  `merge=ours`.
- **`package-lock.json`**: take theirs, then `npm install --package-lock-only`
  (the tool does this).
- **`.engine-paths`, `.gitattributes`, `features/README.md`** are DERIVED —
  written by `scripts/features-index.js` from `features/**/*.md` — and differ
  per repo (a product's own feature paths), so they conflict on every sync.
  Never resolve them by hand and never `--theirs` (that would take the
  ENGINE's product paths): a sync **regenerates them** — `node
  scripts/features-index.js`, then `git add` the three. `engine-sync.js` does
  this right after the merge, again after `--continue` (once any conflicted
  `features/*.md` the generator reads is resolved), and runs `--check` before
  verification; the report and `engine.json`'s history entry (`regenerated`)
  say which files it rewrote (identity-seam-3, 2026-09-23).
- **Engine tests**: start from theirs, re-apply the product's expectations on
  top (a downstream's spec adaptation is a diff over the engine spec, never a
  fork). Two mechanisms make that diff small, and both are config, not hooks:
  - **Identity is config, not a hook.** Brand, legal name, title suffix,
    visitor-default locale, theme trio, hero clip, hidden public routes,
    hidden admin views and the Organization record live under `identity.*` in
    `config/client.json` (schema + Orange Smiley defaults in
    `server/config/clientConfig.js`; the email strings take `{siteName}` /
    `{siteHost}` from the same seam). Engine code AND engine tests read the
    seam — `clientConfig.identity` server-side, `utils/identity.js` client-side,
    `e2e/lib/identity.js` in Playwright — so a downstream sets its block once
    and the engine's suites assert its values. A sync never conflicts on a
    brand literal because the engine carries none. Since identity-seam-2
    (2026-09-23) the seam also owns the **public IA** (`identity.surface.nav`,
    ordered `{ route, labelKey }` — the top nav, both footers and the sitemap
    derive from it minus `hiddenRoutes`), the **page meta** (`meta.<key>.title`
    / `.description` are i18n keys a product overrides in its
    `product.<locale>.json`, on both sides), the manifest name and the
    Product-schema brand; engine suites take their expected locale strings
    from `tests/lib/locale.js` (the visitor default), and the engine-only pins
    (committed `client.json` = defaults, empty `local.json`, empty overlays)
    run only where `engine.json.role` is `engine`. Since identity-seam-3
    (2026-09-23) a product's **own public routes** are config too:
    `identity.routes` — `{ "/console": { titleKey, descriptionKey?,
    titleMode: "bare"|"suffix", noindex, locale } }` — is merged over the
    engine's `ROUTE_META`/`DEFAULT_META` (server) and the `pageTitle` table
    (client), `noindex` drives the robots meta + robots.txt + sitemap, and
    `locale` locks the route like the party pages (`forcedLocaleFor` asks
    the party lock first, then the product's). So a route the engine does
    not know (`/aron13ara`, `/console`) or one the product re-describes
    (`/`) needs no hook in an engine file; the keys live in the product
    overlay. Also in the seam: `organization.description` as an i18n key
    (per locale), `organization.ogImage`, `theme.swatches`. **`APP_URL` is
    not in the seam**: its code fallback is the engine's origin — set it on
    every downstream's App Service (`docs/DEPLOYMENT.md` §5).
  - **Tests for a hidden feature skip; never delete an engine spec.** A
    feature the product hides, disables or forks is recorded in
    `features/local.json`; the feature gate (`tests/lib/featureGate.js`,
    `e2e/lib/featureGate.js`) maps each suite to its feature through the
    registry's `paths` and `test.skip`s it with the note. Another product's
    feature files (`features/<other>/`) are inert, so their suites skip too.
    `describe.skip` by hand in a downstream is the smell this replaces.
- **Migrations**: the engine array (`schema.js`) is taken verbatim; the product
  array (`product-migrations/<id>.js`) is local. Never renumber, never move an
  entry between the two arrays in a downstream — `aliases` and `superseded`
  in the product file absorb history (`docs/MIGRATIONS.md`).
- **i18n**: product keys are being moved to `product.{lang}.json`; until that
  loader lands, resolve locale conflicts **by key**, never by hunk, and run
  `check:i18n` before pushing.

## 7. What never syncs

`company/` · `config/client.json` (including its `identity` block — the
product's brand, locale, theme trio, hero, hidden surfaces, Organization) ·
`.env*` · brand token VALUES (`variables.css` / `themes.css` hues — the
machinery syncs, the hues do not) · `fleet.json` · `features/local.json` ·
`features/<product>/` · `engine.json` · `server/i18n/product.*.json` and
`public/js/i18n/product.*.json`. These are product-owned by definition and
appear in `.engine-paths`. (`publicSurface.js` and `adminSurface.js` DO sync
since 2026-09-22: their lists come from `identity.surface.*`, so the files
carry no product data any more.)

## 8. The upward path

icelandicstore is, for now, the main SOURCE of new generic features (Halli is
building it with Orri). The rule for any downstream:

- A commit that is generic carries the trailer **`Feature: <id>`** naming an
  engine-owned feature (`features/<id>.md`). No trailer = product-only until
  someone says otherwise.
- Weekly, from the engine repo: `node ...\site-factory\engine-harvest.js
  --from <fresh ice clone> --since <rev> --list`, then `--apply` → branch
  `from-ice/<date>` → PR into orangesmiley. Halli decides generic-or-ice-only
  per candidate.
- A generic feature's migration is authored downstream as an **ENGINE entry**
  with the next engine number; if the engine took that number meanwhile, the
  upward PR renumbers it and the product file's `aliases` maps the engine
  name to the name the downstream's databases already applied
  (`docs/MIGRATIONS.md`).

## 9. Cadence and owners

| What | When | Who |
|---|---|---|
| Security patches to every downstream | same week; critical ≤ 48 h | Verkstjóri opens + babysits; merges per §2 |
| Feature syncs | monthly, or per engine release | Verkstjóri |
| `from-ice/<date>` harvest PR | weekly | Verkstjóri |
| Drift report (`engine-drift.js` → `engine-registry.json`, `FEATURE-MATRIX.md`) | weekly sweep | Skjalavörður |
| Security-commit gap report | Monday sweep | Öryggisvörður |
| Merges that deploy (hallismiley, icelandicstore); channel arming (`RELEASE_*` vars) | as they come | Halli |

## 10. Verification after merge

CI green on the default branch → the instance boots → `/ready` 200 →
`/api/v1/system/version` shows the merged sha → for a promoted product, the
`/admin/updates` row shows the release seen/applied. `migrate.js --plan` on
the live database must print no `RUN` lines after boot.

## 11. Rollback

- Source: `git revert -m 1 <merge sha>` on the default branch (a revert of the
  sync, not a rewrite; the next sync re-merges cleanly only after the engine
  fix lands — record why in `ENGINE-SYNC-LOG.md`).
- Runtime: promote the previous sha (`promote.yml`); digests are immutable and
  `previous_digest` names the exact bytes. Expand/contract (invariant #14)
  is what makes this safe.

## 12. Recording

- The sync itself: `engine.json` in the sync commit (`rev`, `syncedAt`,
  `syncedPr`, `history[]`). Nothing else to write for a clean sync.
- `site-factory/ENGINE-SYNC-LOG.md`: one dated line ONLY when adaptation was
  needed (a conflict resolved by hand, a superseded migration, a test
  expectation re-applied) — the "why", so the next sync does not repeat it.
- `site-factory/engine-drift.js` regenerates `engine-registry.json` and
  `FEATURE-MATRIX.md`; both are derived, never hand-edited.
