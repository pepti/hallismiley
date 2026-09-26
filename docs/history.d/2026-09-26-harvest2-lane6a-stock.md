<a id="harvest2-lane6a-2026-09-26"></a>
## 2026-09-26 — Harvest 2, lane 6a: stock (Inventory Watch, the stock count, goods receiving)

Lane 6a of Harvest 2 (generic icelandicstore work up to `ice@941cf51d`; Halli approved the scope on
2026-09-26). Branch `harvest2/lane6a-stock`. Three ice screens ported onto the engine's stock model
(domain 11): the one audited writer `models/Inventory.js`, the kept `stock >= 0` CHECK, and no
`made_to_order` / consignment / channel concepts. This reopens the 2026-09-24 call (ENHANCEMENTS #22)
that "the pick / receive / inventory-check screens stay ice-only": receive and inventory-check are
now engine screens; pick stays ice-only. Code carries "Ported from icelandicstore #NNN" where it was
ported. Every surface is retail and hidden here (`identity.surface.hiddenAdminViews` gains
`inventory` and `receiving`; both ids are owned by the `shop` module).

**What shipped.**

1. **Inventory Watch** — Birgðavakt (ice #13 `415151ad`, #15 `56e07ca4`). A pure
   `server/utils/inventoryStatus.js` carries ice's thresholds (critical < 0.5 month of cover ≤ low
   < 1 ≤ watch < 2 ≤ ok; out when nothing is available). The engine adds `buildWatchReport`, which
   builds one item per stocked unit and puts it in a bucket by **Available**, as ice #243 does.
   `Inventory.watchRows` has one row for each active product without variant axes and one for each
   active variant. Bookable services are left out. Velocity comes from the order lines of PAID
   orders (the committed predicate's status set) created in the last 90 days. ice counted every
   non-cancelled order, pending included. `GET /api/v1/admin/shop/reports/inventory` is answered
   BEFORE the router's `/reports` prefix, which asks for `sales`. So `inventory` opens it and
   `sales` does not. The `/admin/inventory` view uses the admin kit: sortable headers, chip filters
   with counts, a deep-linkable `?status=` (plus `q`, `scope`, `sort`), a needs-attention scope and
   `stickyHScroll`. Status pills sit on the `--error` / `--warning` / `--success` washes and always
   carry their word. "Fix stock" opens an inline panel with the three numbers, the counted figure,
   a reason and a note. It saves through `PATCH /api/v1/admin/inventory/stock` →
   `Inventory.correct`, which takes the parent FOR KEY SHARE, then the row FOR UPDATE, reads the
   current figure under that lock, then calls `setAbsolute`. From #15: its own load-error message
   (with a retry), and the strict number check. The body must be a JSON number or a numeric
   string, whole and between 0 and 100 000 000, never a boolean, an array or a blank
   (`Inventory.isWholeCount`). The engine refuses a negative count; ice allows one because it
   dropped the CHECK.
2. **Stock count** — Talning (ice #18 `bbce630e`, the EasyScan "Update inventory" screen) at
   `/admin/stock-count`. It is a tab of the inventory screen: same view id, no sidebar line.
   - **Building the list.** The USB-wedge `ScanInput` adds one unit per scan. The kit `Combobox`
     searches stocked units only (`GET /inventory/search`). A product-level code on a variant
     product asks "which variant?" (`GET /inventory/lookup` → `variantRequired`).
   - **Each line** has Set / Add / Remove, a quantity, and a live current → new column. A line that
     would go below zero is flagged before the save.
   - **Saving.** One `POST /api/v1/admin/inventory/count` → the new `Inventory.applyBatch`: one
     transaction and ONE `applyLines` call, so the module lock order holds. Every line is checked
     under its row lock. There is one `inventory_adjustments` row per line, all sharing a
     `batch_id` (migration 118). Any refusal is ONE 409 listing every refused line (`NEGATIVE` or
     `VARIANT_REQUIRED`), and nothing is written.
   - **Idempotency.** The page sends a client token per count. It lands on one row's existing
     unique `client_token`, so a re-sent save is 409 `DUPLICATE_BATCH`.
   - **Engine differences from ice:** the mode is per line (ice: one mode per batch); a decrement
     never clamps at 0 (ice silently wrote a different number); a duplicate line in one batch is a
     400, not merged.
3. **Goods receiving** — Vörumóttaka (ice #23 `dcf5c0f9` + `e9c83de6`, the review follow-ups).
   - **Migration `118_goods_receipts`** (provisional number; 115–117 are reserved by other lanes)
     adds `goods_receipts`, `goods_receipt_lines` and `goods_receipt_scans`, with ice's 080 column
     names, plus `goods_receipt_lines.sku` and `inventory_adjustments.batch_id` /
     `goods_receipt_id`.
   - **Reading the supplier's file.** It goes through the ONE product-file reader
     (`services/productImport/parseFile.js`, .csv / .xlsx / .pdf, memory-only, the products
     import's 10 MB upload), with a receipt column table in `adminReceivingController.js`. The
     table's canonical headers claim the ORDER-quantity names (Qty, Quantity, Magn, Fjöldi …),
     which the products import refuses to read as stock. Here they are exactly the expected
     quantity.
   - **Matching.** Lines match by OUR code only, never guessed: a variant's SKU, then a product's
     SKU, then a barcode. A code on two rows, an unknown code, or a variant product's own code
     stays `unmatched`. A person matches it with the Combobox, or skips it.
   - **Scanning** resolves by code like the count screen. It lands on the matching line, or in
     "not on the invoice". received is re-derived from the scan log after every scan, undo,
     re-match and import, so a scan that came before its line was imported still counts.
   - **Finalise** runs in one transaction. It locks the receipt row FIRST, refuses anything but a
     draft, and refuses while a counted line is unmatched (409 `INCOMPLETE` + `lineIds`). Then it
     calls `Inventory.applyBatch` with reason `receipt`, the receipt id on every row, and a note
     naming the supplier and the reference. It moves stock by what was RECEIVED, never what was
     expected, and not-on-invoice groups go in unless unticked. Then it flips to `finalized`. A
     second finalise waits on the lock, finds `finalized`, and is a 409 that moves nothing. ice
     needed a `finalizing` claim state and a revert path for the same guarantee.
   - **The PDF.** The receipt prints through `pdfService.streamGoodsReceipt` (bilingual labels,
     expected / received / difference, the not-on-invoice section, sign lines), in any status.
   - **Screens.** `/admin/receiving` has the list with status chips and a start form (supplier,
     reference, note). `/admin/receiving/:id` has the file button, a summary strip, the scanner
     with units-per-scan, the lines, the extras and the recent scans with undo.
   - **Rate limiting.** Receiving scans have their own per-user limiter (1500 / 15 min) instead of
     `writeLimiter`, because a pallet is hundreds of one-unit POSTs. The gate is still requireAuth
     + requireView + CSRF, and the global limiter still applies. Every other write sits under
     `writeLimiter`.

**The stock money path and the lock order.**
- **The writer.** Every stock write in this lane goes through `Inventory.applyLines`: `correct` →
  `setAbsolute`, and `applyBatch`.
- **Refusal instead of a 500.** The `stock >= 0` CHECK is never reached as a 500. `applyLines`
  refuses below zero, and with `collectShortfalls` it writes nothing more after the first
  refusal, then throws once so the caller's transaction rolls back.
- **Lock order.** Each transaction takes: the receipt row (finalise only), then the parents FOR
  KEY SHARE, then the variants, then the products, each sorted, all inside the one `applyLines`
  call.
- **Receipts cannot join a cycle.** A receipt row is locked only by the receiving model
  (scan / undo / import / re-match / cancel / finalise), always before any stock row, and no stock
  writer locks a receipt.
- **`applyLines` is tightened.** It now refuses a variant that does not belong to the product the
  line names (`LINE_NOT_FOUND`), so an audit row can never file a movement under the wrong
  product. The existing callers already pass matching pairs; `inventoryThreeNumbers` stays green.
- **Pinned by tests.** Two batches adding to one variant serialise, with a continuous
  previous → new audit chain. Two batches that cannot both fit: exactly one wins and the other is
  refused. Two finalises racing: exactly one moves stock.

**Measured.** Unit: 115 → 116 suites; the new `inventoryStatus.test.js` has 11 tests. The engine
pins `identityConfig.test.js` (hidden views) and `routePatterns.json` (four routes) moved with the
change. Integration: `adminInventory.test.js` 12 tests and `goodsReceipts.test.js` 8 tests, both
green on real Postgres. `inventoryThreeNumbers.test.js` stays green (19 tests). `migrate.js --plan`
on a master-level copy: only `118_goods_receipts` RUN, and a second run is a no-op.

**Trimmed from ice.**
- Inventory Watch: the made-to-order exclusion and its "excluded" tally; recipe/`build_consume`
  demand; the BIN on-hand classifier; the dashboard stock card; reorder suggestions.
- Count: the "recent activity" history panel and ice's moderator-open scan routes. Here the
  `inventory` view gates everything.
- Receiving: the suppliers directory and supplier email; the fuzzy description matcher
  (`matchReceipt.js`); `new_product` creation from a line (a `new_product` line from ice data is
  treated as skipped); the intermediate states.

**DRAFT strings (Halli approves).** All EN + IS, new in this lane:
- client `admin.nav.inventory`, `admin.nav.receiving`, `adminInventory.*` (45 keys),
  `adminStockCount.*` (25), `adminReceiving.*` (66);
- server `errors.inventory.batchEmpty` / `batchTooMany` / `batchDuplicateLine` /
  `batchLineInvalid` / `batchRefused` / `belowZero` / `variantRequired` / `duplicateBatch` /
  `stockRange` / `noteTooLong` / `codeRequired` / `codeNotFound`, and `errors.receiving.*` (12).

The Icelandic was drafted natively. The receipt PDF's fixed bilingual labels ("GOODS RECEIPT /
Vörumóttaka", "Received by / Móttekið af" …) are DRAFT too.

**Still owed.**
- Halli: the DRAFT strings above.
- Ice at the next graft: engine `118_goods_receipts` runs on ice's databases and adds only `sku`
  and the two `inventory_adjustments` columns; its `CREATE`s are no-ops against 080. The engine's
  receipt status CHECK is narrower than ice's, but it only matters on a fresh engine database.
- The migration number is provisional until the Harvest 2 merge order is set.
