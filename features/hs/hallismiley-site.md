---
id: hallismiley-site
name: {is: "Hallismiley.is — eigin hlutar", en: "hallismiley.is — the site's own pieces"}
domain: 3
owner: hs
status: live
flag: null
paths:
  - .github/workflows/trivy.yml
  - e2e/news-editor.spec.js
  - server/utils/canonicalHost.js
  - tests/unit/canonicalHost.test.js
  - tests/unit/booksRouteOrder.test.js
  - public/assets/party/venue/**
migrations: []
since: 2026-09-22
origin: null
history: [engine-graft, docs-restructure-hs]
---

The files that are hallismiley's own and not the engine's: the scheduled,
non-blocking Trivy image scan (`trivy.yml` — the engine's CI runs Trivy inside
`deploy.yml` instead), two regression tests written in the base after the
engine forked (`news-editor.spec.js` for the fixed-position editor overlay,
`booksRouteOrder.test.js` for the `docLimiter` position on
`GET /documents/:id`), the party venue photos, and `canonicalHost.js` with its
test. The engine resolves the canonical host inline in `server/app.js` from
`APP_URL`, so the util is no longer required by the app; it stays until Halli
decides its disposition (a hallismiley ENHANCEMENTS item, not a drive-by
delete) and its test keeps its contract honest.

**Rules**
- hallismiley is a DOWNSTREAM of the engine since
  [engine-graft](../../docs/HISTORY.md#engine-graft): engine files arrive by
  `git merge upstream/master`; anything hallismiley must keep different lives
  in a product-owned path (`.engine-paths`) or is a listed residual hook.
- Merging `main` auto-deploys www.hallismiley.is: never push an engine sync
  without green CI, and never push from a scratch clone.
- Engine context: [../../docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo](../../docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo).
