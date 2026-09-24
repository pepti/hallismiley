---
id: markadur
name: {is: "Markaður", en: "Market research list"}
domain: 7
owner: engine
status: live
flag: modules.salesOps.enabled
paths:
  - server/routes/marketRoutes.js
  - server/controllers/marketController.js
  - public/js/views/AdminMarketView.js
  - public/js/services/market.js
  - public/css/admin-markadur.css
  - tests/integration/market.test.js
  - e2e/markadur.spec.js
migrations: [093_market_research]
since: 2026-09-07
origin: null
history: [market-research, markadur, review-099]
---

The prospect list at `/admin/markadur` over the 093 `market_*` tables: read, sort, filter, open a company drawer, and the one write — shortlist to `handed_to_sales` or `rejected` (admin/moderator, race-safe). The account hand-off lives in `customer-accounts`.

**Rules**
- Named companies never go into a git-tracked file; contact persons are never recorded.
- `report_path` renders as text, never a link; scraped URLs pass a `https?:` check before any `href`.
- Status PATCH is `UPDATE … WHERE status='shortlist'` (409 otherwise); sorts come from a fixed map; every response `no-store`.
- Full rules: [../docs/ARCHITECTURE.md#7-markaður--market-research-and-the-prospect-list](../docs/ARCHITECTURE.md#7-markaður--market-research-and-the-prospect-list).
