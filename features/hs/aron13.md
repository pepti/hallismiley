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
history: [engine-graft]
---

Aron's 13th-birthday puzzle page: three mini games in order (mining, crafting,
catch), each revealing a message; progress persists in localStorage. A
hallismiley-only surface the engine never carried — orangesmiley was scaffolded
before it existed and the 2026-09-13 harvest did not take it — so its files
are product-owned here and its route is a residual hook on three engine files
(`public/js/router.js`, `server/middleware/ssrMeta.js`,
`public/js/utils/pageTitle.js`, `server/config/publicSurface.js`,
`server/config/i18n.js`, `public/js/i18n/i18n.js`; see [engine-graft](../../docs/HISTORY.md#engine-graft)).

**Rules**
- `/aron13ara` is unlisted: no nav link, absent from the sitemap, Icelandic-only
  (`IS_ONLY_PAGES` in `server/config/i18n.js` + its mirror in
  `public/js/i18n/i18n.js` — a residual hook, the engine has no IS-only pages)
  and noindexed through `HIDDEN_PUBLIC_ROUTES` in
  `server/config/publicSurface.js`.
- The catch game exposes a finish hook only when the server stamps a
  non-production app-env; `e2e/aron13.spec.js` relies on it.
- Engine context: [../../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio](../../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio).
