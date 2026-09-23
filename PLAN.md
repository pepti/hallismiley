# hallismiley.is — plan and status

**What this repo is:** Halli's portfolio site (www.hallismiley.is) — and, since
2026-09-22, a DOWNSTREAM of the Orange Smiley engine (D-021). It was the base
every other repo in the estate was scaffolded from; the engine (orangesmiley)
grew past it, so the direction of travel reversed: engine files now arrive
here by `git merge upstream/master` (site-factory `engine-sync.js`), and this
repo keeps only what is its own in product-owned paths (`.engine-paths`).
The write-up is [engine-graft](docs/HISTORY.md#engine-graft); the six earlier
incidents that used to live in `CLAUDE.md` are in the same file, from
[edited-applied-migration](docs/HISTORY.md#edited-applied-migration) to
[stale-pr-checks](docs/HISTORY.md#stale-pr-checks).

## Status

**Done**
- 2026-09-22 — engine graft: `engine.json` (product `hs`, role `personal`),
  `server/config/product-migrations/hs.js` (six aliases, one superseded
  entry), `features/hs/*` + `features/local.json`, the per-domain
  `docs/ARCHITECTURE.md` from the engine with this site's pieces folded in
  ([engine-graft](docs/HISTORY.md#engine-graft)).
- 2026-09-22 — docs restructure in the base, before the graft
  ([docs-restructure-hs](docs/HISTORY.md#docs-restructure-hs)).
- 2026-09-23 — engine sync to `92308d2`: this site's identity (brand, `en`
  default, `classic` + six-theme picker, waterfall hero, hidden company pages,
  Organization) lives in `config/client.json` `identity`; the theme and brand
  hooks are retired; `features/os/` suites skip through the feature gate
  ([engine-sync-2026-09-23](docs/HISTORY.md#engine-sync-2026-09-23)).

**Open — what the identity seam still lacks (engine changes, Halli decides)**
Listed with the pinning test for each in
[engine-sync-2026-09-23](docs/HISTORY.md#engine-sync-2026-09-23) § "What the
seam still lacks": the public IA (`NavBar.js` links the company pages as
literals; `ssrMeta.test.js`, `e2e/navigation.spec.js`, `e2e/business-routes.spec.js`
pin it — the red tests on the branch), the page parts/descriptions in
`DEFAULT_META`, the `identityConfig.test.js` committed-file test, the
`home-products` section, the `classic` palette, `manifest.json`, the
Product-schema brand and the Organization `@type`; the engine suites that
assume the Icelandic visitor default (auth/OAuth/contact/media/projects) and
the engine-only gate/registry/identity tests; and `APP_URL` must be set on
the App Service (the engine's fallback origin is orangesmiley.is). Jest on the
branch: 92 failing cases, all in that list — the PR stays draft until the
engine closes them.

**Open — housekeeping**
- `server/utils/canonicalHost.js` is no longer required by the app (the
  engine resolves the host inline in `app.js`); keep or drop is a
  hallismiley ENHANCEMENTS decision.
- The sales handbook, leads, markaður, accounts, commission and seller area
  ship in the image but are `hidden` in `features/local.json`; hiding them
  by instance role is the engine's ENHANCEMENTS #5.
- Deploy: merging `main` still auto-deploys — the first engine sync must be
  reviewed on hallismiley.is itself before the next one.
