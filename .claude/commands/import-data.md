---
description: Build migrations + an idempotent importer from the customer data in data/import/
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

Build the data layer from the customer's exports in `data/import/` (CSV/JSON — READ-ONLY source platform; never write back to it).

Use the **data-importer** subagent for schema analysis, then implement:

1. **Inspect** every file in `data/import/`: headers, row counts, variant structure, encodings. Print a short summary before coding.
2. **Migrations** (sequential, via `/migration-new` conventions): add only what the base schema lacks — typically `product_variants` (SKU, barcode, options, price, stock, pack_qty), `companies` → `company_locations`, `price_tiers`, order history columns. Drop leftover portfolio tables here if Phase 1 deferred them.
3. **Importer** at `server/scripts/import-customer.js` (npm script `import:customer`):
   - **Idempotent** — re-runnable without duplicates (upsert by external ID/SKU/order number).
   - Preserve original order numbers, dates, statuses.
   - Download product images to `public/assets/products/` (skip if present).
   - Merge obvious duplicate companies (same name different spellings) and log every merge.
   - Log a final summary: products/variants/companies/users/orders imported, skipped, merged.
4. **App-specific data** (pack sizes, MOQ) may live in a separate JSON captured from the live site (e.g. `data/import/pack-qty.json`) — join it by SKU.
5. **Verify — loop until green:**
   - Run `npm run migrate` then the importer against the dev DB; `npm run lint` passes.
   - **Idempotency (required, not optional):** run the importer a **second** time and assert per-table `count(*)` is identical to the first run — print before/after counts. If any table grew, the upsert keys are wrong; fix and re-run until the second pass adds zero rows.
   - Spot-check counts vs the audit doc; update CLAUDE.md/PLAN.md status.
