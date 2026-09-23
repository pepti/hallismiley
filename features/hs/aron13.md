---
id: aron13
name: {is: "Afmælissíða Arons", en: "Aron's birthday page (/aron13ara)"}
domain: 12
owner: hs
status: hidden
flag: null
paths:
  - public/js/views/Aron13View.js
  - public/js/views/aron13-font.js
  - public/js/views/aron13-fx.js
  - public/js/views/aron13-sprites.js
  - public/js/views/aron13-games/**
  - public/css/aron13.css
  - e2e/aron13.spec.js
migrations: []
since: 2026-09-06
origin: null
history: [engine-graft, engine-sync-2-2026-09-23]
---

Aron's 13th-birthday puzzle page: three mini games in order (mining, crafting,
catch), each revealing a message; progress persists in localStorage. A
hallismiley-only surface the engine never carried — orangesmiley was scaffolded
before it existed and the 2026-09-13 harvest did not take it — so its files
are product-owned here. Its meta, noindex and Icelandic lock are config
(`identity.routes['/aron13ara']` in `config/client.json`, engine
identity-seam-3, since [engine-sync-3](../../docs/HISTORY.md#engine-sync-3-2026-09-23));
the one residual hook on an engine file is its view route in
`public/js/router.js` (see [engine-graft](../../docs/HISTORY.md#engine-graft)).

**Rules**
- `/aron13ara` is unlisted and noindexed: no nav link
  (`identity.surface.hiddenRoutes`), and `identity.routes['/aron13ara'].noindex`
  gives it `<meta robots noindex>`, a robots.txt Disallow and no sitemap
  entry. It is Icelandic-only through `identity.routes['/aron13ara'].locale`
  (`is`; the engine's lock is prefix-aware on both sides), titled bare from
  `meta.aron13.title` / `.description` in the product overlays.
- The view loads its own stylesheet (`/css/aron13.css`, a `<link>` it appends
  once and awaits): the base's `main.css` imported it and the engine's does
  not, and the graft lost the import — the crafting cells measured 0×0 and
  `e2e/aron13.spec.js` read that as "never stable" until
  [engine-sync-2-2026-09-23](../../docs/HISTORY.md#engine-sync-2-2026-09-23).
  Never re-add the import to `main.css` (an engine file).
- The catch game exposes a finish hook only when the server stamps a
  non-production app-env; `e2e/aron13.spec.js` relies on it.
- Engine context: [../../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio](../../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio).
