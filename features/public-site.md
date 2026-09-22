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
  - server/services/indexNow.js
  - server/config/publicSurface.js
  - server/middleware/ssrMeta.js
  - server/utils/slug.js
  - public/index.html
  - public/css/main.css
  - public/js/router.js
  - public/js/navigate.js
  - public/js/main.js
  - public/js/views/HomeView.js
  - public/js/views/ThjonustaView.js
  - public/js/views/UmOkkurView.js
  - public/js/views/ContactView.js
  - public/js/views/PrivacyView.js
  - public/js/views/TermsView.js
  - public/js/views/NotFoundView.js
  - public/js/views/AboutView.js
  - public/js/components/NavBar.js
  - public/js/utils/reveal.js
  - public/js/utils/productSite.js
  - public/js/utils/sanitizeHtml.js
  - public/js/utils/slug.js
  - public/css/home.css
  - public/css/business-pages.css
  - public/css/contact.css
  - public/css/video-section.css
  - public/css/fonts.css
  - tests/integration/contact.test.js
  - tests/integration/sitemap.test.js
  - tests/integration/ssrMeta.test.js
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
history: [homepage, r1, services-page, ui-kit, go-live]
---

The SPA shell and the visitor pages: home (video hero), `/thjonusta`, `/um-okkur`, `/hafa-samband` (the contact form that becomes a lead), `/personuvernd`, terms and 404; the router with View Transitions; SSR meta + JSON-LD (`ssrMeta.js`), robots + sitemap, IndexNow pings and the hidden-route policy (`publicSurface.js`). The company copy itself is the product's (`os/company-content`); the engine ships the structure and the JS fallbacks. `HomeView._tiers()/_steps()` are dormant with their i18n.

**Rules**
- Everything not in the public IA is in `publicSurface.js`: hidden from nav, sitemap and search, still served.
- No product tiers or prices on the company site; `SERVICE_OFFERINGS` mirrors the locale service names; `productSite.js` builds the one product-site URL.
- A new hero clip gets a NEW filename; under reduced motion / Save-Data the hero shows the poster with no autoplay; `e2e/navigation.spec.js` pins the filename.
- The canonical origin is `APP_URL`; `public/index.html` is baked with it and `ssrMeta.js` swaps it on load — change the two together.
- Full rules: [../docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo](../docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo).
