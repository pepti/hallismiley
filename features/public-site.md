---
id: public-site
name: {is: "Opinber vefur", en: "Public site"}
domain: 3
owner: engine
status: live
flag: null
paths:
  - server/routes/contactRoutes.js
  - server/controllers/contactController.js
  - server/routes/sitemapRoutes.js
  - server/routes/manifestRoutes.js
  - server/routes/robotsRoutes.js
  - server/services/indexNow.js
  - server/config/publicSurface.js
  - server/middleware/ssrMeta.js
  - server/utils/slug.js
  - public/index.html
  - public/css/main.css
  - public/js/router.js
  - public/js/routePatterns.json
  - server/utils/spaRoutes.js
  - public/js/navigate.js
  - public/js/main.js
  - public/js/views/HomeView.js
  - public/js/views/ThjonustaView.js
  - public/js/views/UmOkkurView.js
  - public/js/views/ContactView.js
  - public/js/views/PrivacyView.js
  - public/js/views/TermsView.js
  - e2e/legal-pages.spec.js
  - public/js/views/NotFoundView.js
  - public/js/views/AboutView.js
  - public/js/components/NavBar.js
  - public/js/utils/reveal.js
  - public/js/utils/productSite.js
  - public/js/utils/sanitizeHtml.js
  - public/js/utils/slug.js
  - public/js/utils/contactFormat.js
  - server/utils/contactFormat.js
  - tests/unit/contactFormat.test.js
  - public/css/home.css
  - public/css/business-pages.css
  - public/css/contact.css
  - public/css/video-section.css
  - public/css/fonts.css
  - tests/integration/contact.test.js
  - tests/integration/sitemap.test.js
  - tests/integration/llms.test.js
  - tests/integration/ssrMeta.test.js
  - tests/integration/spaStatus.test.js
  - tests/unit/routePatterns.test.js
  - tests/unit/routerLazyViews.test.js
  - e2e/lazy-views.spec.js
  - tests/unit/slug.test.js
  - tests/unit/slug.client.test.js
  - e2e/business-routes.spec.js
  - e2e/contact.spec.js
  - e2e/navigation.spec.js
  - e2e/responsive.spec.js
  - e2e/responsive-screenshots.spec.js
migrations: [017_home_stats_content]
since: 2026-08-09
origin: null
history: [homepage, r1, services-page, ui-kit, go-live, identity-seam-2-2026-09-23, identity-seam-3-2026-09-23, rk-feed-2026-09-23, ssr-replace-literal-2026-09-23, harvest-ice-e-2026-09-24, legal-pages-site-host-2026-09-25, harvest2-lane4b-2026-09-26]
---

The SPA shell and the visitor pages: home (video hero), `/thjonusta`, `/um-okkur`, `/hafa-samband` (the contact form that becomes a lead), `/personuvernd`, terms and 404; the router with View Transitions; SSR meta + JSON-LD (`ssrMeta.js`), robots + sitemap, IndexNow pings and the hidden-route policy (`publicSurface.js`). The company copy itself is the product's (`os/company-content`); the engine ships the structure and the JS fallbacks. `HomeView._tiers()/_steps()` are dormant with their i18n.

**Rules**
- Every `html.replace` in `ssrMeta.js` takes a replacer function when the replacement holds content, config or request text: in a replacement string `$&`, `` $` ``, `$'` and `$$` are patterns, and admin copy or a request path carrying them spliced the template into the page (ssr-replace-literal; `ssrMeta.test.js` "replacement patterns").
- Identity comes from the seam, never a literal: brand name, title suffix, `og:site_name`, `<meta author>`, the Organization + WebSite JSON-LD, the hero clip and the hidden-route list all read `identity.*` (`config/client.json` via `server/config/identity.js` server-side, `public/js/utils/identity.js` client-side). `ssrMeta.js` and `pageTitle.js` hold page PARTS; the document title is part + suffix (or `{brand}` substituted; `titleMode: 'bare'` for the portfolio surfaces).
- The public IA is `identity.surface.nav` (ordered `{ route, labelKey }`) minus `identity.surface.hiddenRoutes`, derived once server-side (`publicSurface.js` `PUBLIC_NAV` / `LEGAL_ROUTES`) and once client-side (`utils/identity.js` `publicNav()` / `isHiddenRoute()`); the NavBar, both footers, the sitemap and the noindex rule read those, never a route literal. The home products card renders only while `/thjonusta` is public. Everything hidden is still served.
- The page parts and descriptions are i18n keys (`meta.<key>.title` / `.description`; `ssrMeta.js` `DEFAULT_META` and `pageTitle.js` name the keys, the tables carry the text, a product overrides in `product.<locale>.json`). `/manifest.json` (`manifestRoutes.js`), `/robots.txt` (`robotsRoutes.js`, Disallow lines from `hiddenRoutes` per locale) and the Product-schema `brand` read the identity; the Service catalogue JSON-LD is emitted only while `/thjonusta` is public; the Organization `@type` stays `Organization` for every product.
- A product's OWN routes are `identity.routes` (identity-seam-3), never a hook: merged over `ROUTE_META`/`DEFAULT_META` (a `product:<route>` key, after the literal tables the parity test parses) and over the client table in `titleForRoute`; `noindex` → `publicSurface.js` `NOINDEX_ROUTES`/`isDeindexedRoute()` (the robots meta, a robots.txt Disallow block, filtered from the sitemap; exact routes, may still be linked); `locale` → the lock in `config/i18n.js`. `/manifest.json` describes itself from `routes['/'].descriptionKey` when the landing is re-described; `organizationSchema(locale)` resolves an i18n-key `organization.description` per locale; `OG_IMAGE_PATH` is `identity.organization.ogImage`. The company-page cases in the suites (`testServices` in `ssrMeta.test.js`, `testCompany` in `navigation.spec.js`) run only while `/thjonusta` is public; a locale-locked nav route is walked under its own locale.
- No product tiers or prices on the company site; `SERVICE_OFFERINGS` mirrors the locale service names; `productSite.js` builds the one product-site URL.
- A new hero clip gets a NEW filename (`identity.hero`); under reduced motion / Save-Data the hero shows the poster with no autoplay; `e2e/navigation.spec.js` pins the served clip to the config's.
- The canonical origin is `APP_URL`; `public/index.html` is baked with it and `ssrMeta.js` swaps it on load (and drops the baked Organization, re-emitting it from the identity on every page) — change the two together.
- The sitemap's `<lastmod>` is the newest `site_content` row a page renders (engine routes via `ssrMeta.contentKeysForRoute`, product routes via `identity.routes[*].contentKeys`) or absent — never a deploy timestamp; `/llms.txt` is every product's, built from the seam and `ssrMeta.metaForRoute` only. Legal titles never break inside a word down to 320px.
- Full rules: [../docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo](../docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo).
