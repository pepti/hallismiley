---
id: news
name: {is: "Fréttir", en: News}
domain: 12
owner: engine
status: hidden
flag: null
paths:
  - server/routes/newsRoutes.js
  - server/controllers/newsController.js
  - public/js/views/NewsView.js
  - public/js/views/ArticleView.js
  - server/scripts/seed-news.js
  - public/css/news.css
  - tests/integration/news.test.js
  - tests/integration/newsMedia.test.js
migrations: [008_news, 016_news_media]
since: 2026-08-09
origin: null
history: [r1]
---

News posts with media (016) and `_is` sibling bodies, at `/news` (hidden here) with the article page. A public `/frettir` home is an open item.

**Rules**
- Hidden from nav/SSR/sitemap, fully functional at its URLs.
- Full rules: [../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio](../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio).
