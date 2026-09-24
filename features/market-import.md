---
id: market-import
name: {is: "Innlestur markaðsgagna", en: "Market data importer"}
domain: 7
owner: engine
status: live
flag: modules.salesOps.enabled
paths:
  - server/scripts/market-import.js
  - tests/integration/marketImport.test.js
migrations: []
since: 2026-09-01
origin: null
history: [market-research]
---

`npm run market:import` loads JSON batches from gitignored `company/markadur/` into `market_companies`, `market_financials` and `market_stats`: one transaction per file, idempotent upserts by kennitala / (company, year) / stats key.

**Rules**
- A JSON row carrying `status` overwrites a hand-off on re-import; export without it.
- Full rules: [../docs/ARCHITECTURE.md#7-markaður--market-research-and-the-prospect-list](../docs/ARCHITECTURE.md#7-markaður--market-research-and-the-prospect-list).
