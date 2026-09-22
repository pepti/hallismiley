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

**Open — identity items the engine's own tests pin (Halli decides)**
The engine hard-codes Orange Smiley's identity in engine-owned files AND in
engine-owned tests, so after the graft hallismiley.is would present as the
company site unless each item below gets a product-owned seam in the engine.
The exact list, with the pinning test for each, is in
[engine-graft](docs/HISTORY.md#engine-graft) § "Not reconciled":
public IA + nav lockup, SSR titles/descriptions, sitemap routes, hero clip,
visitor-default locale (`is` → was `en`), default theme (`ember` → was
`classic`) and the `classic` palette itself, the admin hidden-lines set, the
Organization JSON-LD, and `email.verify.subject`.

**Open — housekeeping**
- `server/utils/canonicalHost.js` is no longer required by the app (the
  engine resolves the host inline in `app.js`); keep or drop is a
  hallismiley ENHANCEMENTS decision.
- The sales handbook, leads, markaður, accounts, commission and seller area
  ship in the image but are `hidden` in `features/local.json`; hiding them
  by instance role is the engine's ENHANCEMENTS #5.
- Deploy: merging `main` still auto-deploys — the first engine sync must be
  reviewed on hallismiley.is itself before the next one.
