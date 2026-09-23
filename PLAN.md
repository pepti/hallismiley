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
- 2026-09-23 — engine sync to `57362dc` (identity seam v2 + the 2FA harvest):
  the public IA (`identity.surface.nav` = the base's six links), the dark
  theme set and the page meta (overlay `meta.*` keys) are config; the nav,
  sitemap, manifest and robots present as this site; `news-editor.spec.js`
  went up to the engine ([engine-sync-2-2026-09-23](docs/HISTORY.md#engine-sync-2-2026-09-23)).
- 2026-09-23 — engine sync to `61e0920` (MFA optional + identity seam v3 + the
  rk feed): `/aron13ara`'s meta, noindex and Icelandic lock are
  `identity.routes`; the hooks in `ssrMeta.js`, `pageTitle.js`, both `i18n.js`
  and the six engine-test re-applies are retired; two-factor enrolment is the
  engine default `optional`; migration 108 runs
  ([engine-sync-3-2026-09-23](docs/HISTORY.md#engine-sync-3-2026-09-23)).

**Open — what the identity seam still lacks (engine changes, Halli decides)**
Since the 57362dc sync the list is § "What the seam still lacks" in
[engine-sync-2-2026-09-23](docs/HISTORY.md#engine-sync-2-2026-09-23):
(the 61e0920 sync closed `identity.routes` for `/aron13ara`, the title
literals in `identityDownstream.test.js` and the ungated `i18nIdentity` pin) the `identityDownstream.test.js` title
literals (so `meta.projects.title` is not overlaid), the nav-only sitemap,
Bjart-as-classic, `APP_URL` on the App Service, the per-repo `features-index`
output; plus two test-side residuals for the engine (`i18nIdentity` meta pin
ungated, `architectureIndex` counting foreign links). The first sync's list,
kept for the record —
[engine-sync-2026-09-23](docs/HISTORY.md#engine-sync-2026-09-23) § "What the
seam still lacks": the public IA (`NavBar.js` links the company pages as
literals; `ssrMeta.test.js`, `e2e/navigation.spec.js`, `e2e/business-routes.spec.js`
pin it — the red tests on the branch), the page parts/descriptions in
`DEFAULT_META`, the `identityConfig.test.js` committed-file test, the
`home-products` section, the `classic` palette, `manifest.json`, the
Product-schema brand and the Organization `@type`; the engine suites that
assume the Icelandic visitor default (auth/OAuth/contact/media/projects) and
the engine-only gate/registry/identity tests; and `APP_URL` must be set on
the App Service (the engine's fallback origin is orangesmiley.is). Items 1–4,
6, 8 and 9 of that list are closed by identity-seam-2.
- `e2e/aron13.spec.js` — the ×2 failure was the graft losing the base's
  `main.css` `@import` of `aron13.css`; the view loads its stylesheet itself
  since the 57362dc sync (product-owned fix, no engine hook).

**Open — housekeeping**
- `server/utils/canonicalHost.js` is no longer required by the app (the
  engine resolves the host inline in `app.js`); keep or drop is a
  hallismiley ENHANCEMENTS decision.
- The sales handbook, leads, markaður, accounts, commission and seller area
  ship in the image but are `hidden` in `features/local.json`; hiding them
  by instance role is the engine's ENHANCEMENTS #5.
- Deploy: merging `main` still auto-deploys — the first engine sync must be
  reviewed on hallismiley.is itself before the next one.
