<a id="harvest2-lane6b-2026-09-26"></a>
## 2026-09-26 — Harvest 2 lane 6b: merge duplicate products, AI reads a supplier PDF (dark)

Approved by Halli 2026-09-26 (harvest 2). Ported from icelandicstore at
`ice@941cf51d`: #309 / #311 / #312 / #315 (duplicate products and the merge)
and #306 / #314 (the AI PDF reader). Engine migration **120_product_merge**
(provisional number; renumbered at merge).

### Duplicates and the merge

**What shipped.** Products → *Duplicates* (`/admin/shop/products/duplicates`)
lists groups of products that look like the same item, each badged with the
weakest signal holding it together and the evidence per product (SKU, barcode,
live and switched-off variants, on hand, order lines, images, collections,
other references). Signals (`server/utils/productDedupe.js`, pure): the same
valid GTIN on a product or a live variant, the same SKU, the same name within
one product type, a per-colour product under a colour-axis master (or per-colour
siblings), and ≥ 80 % word overlap. Per group the admin picks the survivor,
previews the merge (every unit's target shown, refusals and warnings named) and
merges.

The merge (`server/services/productMerge/engine.js`) is one transaction:
lock (orders → parent products → variants → level products, FOR UPDATE, each
sorted — the stock lock order), re-plan and compare the preview's token, move or
map every unit, ONE `Inventory.applyLines` (`merge_out`/`merge_in` net zero, a
zero-delta `merge` row per moved variant), repoint every FK row per
`repointSpec.js`, switch mapped source variants off, fill the survivor's empty
fields, make the sources inactive with `merged_into_id`, write `product_merges`
+ a `staff_audit_log` row (`product.merged`).

**Engine cuts against ice** (their tables do not exist here): no add-axis (a
unit that does not fit the survivor's axes is refused, not given a new axis),
no stock write-off mode (no cost price to value it at — stock always moves), no
recipes/builds/pack sizes/discount scopes/customer prices/consignment/shelf
lists, no pairing tray or bulk "Merge…" on the products list (the Duplicates
screen is the one entry point), no full workbench — the preview offers a target
`<select>` per unit (a live survivor variant, or the proposal's new variant);
typing new axis values for a unit is left to a follow-up.

**Decisions made here (documented deviations).**
- **Order lines are re-pointed**, not left on the merged product: Committed
  stock (paid, unfulfilled lines) must follow the stock onto the survivor, and
  an un-fulfil of an old order must restore onto the row the stock now lives
  on. An order line carries its own name/price/attribute snapshots, so what an
  order SAYS never changes. Invoice lines are the books: only DRAFT ones follow;
  an issued line keeps pointing at the merged row (which is why it is never
  deleted), and `trg_invoice_lines_immutable` would refuse the update anyway,
  rolling the whole merge back.
- **Images move** to the survivor after its own (ice keeps them on the merged
  row): the task asked for it, and in the engine a duplicate's photo is often
  the better one. A URL the survivor already shows is not added twice.
- **Ledger reasons** follow ice (`merge_out` / `merge_in`) so the two estates
  read alike; the requested "reason `merge`" is the zero-delta row written per
  MOVED variant (its stock arrives with the row, so there is no delta to post).
- **Checkout vs merge**: FOR UPDATE on the products and variants blocks a
  checkout's order-line KEY SHARE for the length of the merge; a checkout that
  was waiting then finds the product merged and `Order.createWithItems` answers
  409 `PRODUCT_MERGED` (new server string, DRAFT). One that took its locks first
  commits first, and the merge repoints its line.
- After a merge: the merged product is hidden from every `Product.findAll`,
  frozen for writes through its own id (409 `product_merged` + `movedTo`),
  `GET /api/v1/shop/products/:slug` and the SSR `/shop/:slug` (any locale
  prefix, query kept) answer 301 `no-store` to the survivor's slug (≤ 5 hops,
  only to an active product), and a retired variant SKU resolves to the live row
  it went to in the import match and the scanner (`ProductMerge.resolveLive`).

**Lanes in flight.** Master (with lane 6a's `118_goods_receipts` and lane 3's
116/117) was merged into this branch before the review fixes: 6a's four new
foreign keys (`goods_receipt_lines` / `goods_receipt_scans` →
products / variants) follow their unit (`repoint`), and the merge locks DRAFT
goods receipts that name an involved product FOR UPDATE right after the orders
— a receipt's finalise takes its own row before the stock rows, so it cannot
post stock onto a source mid-merge. Lane 6c (variants / delivery note) may add
more: `assertCovers` makes merging refuse (503 `schema_drift`) and
`productMerge.test.js` fails CI until `repointSpec.js` names a policy for each.
Migration order is now 115, 116, 117, 118, **120** (119 is lane 6c's).

**Found on the screenshot pass, fixed.** The engine's
`uniq_product_variants_attrs` index covers switched-off rows (ice's excludes
archived ones), so a per-colour product's sizes moving onto a master that still
holds that colour's switched-off rows would have hit the index as a 500. The
planner refuses it by name (`attribute_collision_inactive`); the admin switches
that row on and maps onto it.

**The screen.** `AdminProductDuplicatesView.js` (`/admin/shop/products/duplicates`,
a "Duplicates" button on the products list; the sidebar keeps Products lit):
badges (weakest signal first), the evidence table with a "keep" radio per
product, "Preview merge" → the server's plan with a target `<select>` per unit
(re-planned on every change, the previous request aborted), refusals in
`role=alert` with the unit rows `aria-invalid`, warnings, and "Merge" (enabled
only on an ok plan, behind a confirm). A stale preview re-plans and says so.
The heading takes focus once the view is mounted. Tokens only
(`admin-product-merge.css`); tables scroll sideways at 375 px.

### "Read with AI" in the product import (dark)

**What shipped.** A supplier PDF the normal reader cannot read (or any PDF) can
be read by Claude, a few pages at a time, into rows that go through the
UNCHANGED preview → apply with `create: true`. Server:
`services/productImport/aiExtract.js` (schema, prompt, echo sentinel, text-layer
verification, derived variant SKUs — ice #314 A2) and `aiLimits.js` (the cost
gate); `controllers/adminProductImportAiController.js`; routes
`GET /products/import/ai-config` (always 200) and `POST /products/import/ai-extract`
(CSRF → flag 404 → day budget 429 → multer → page caps 422 → `aiGate` slot
429 → charge → read; 502 refunds; 499 when the client leaves, from
`res.on('close')` → `AbortSignal`). Client: `components/ProductImportAi.js`
(the modal's AI step: shown only when `/ai-config` says enabled and a PDF is
picked, primary when the normal reader failed; progress per chunk; Stop; what
could not be confirmed, per row and page; the pricing fields),
`utils/aiPdfChunks.js` (ice's chunk loop, unchanged), `utils/importMarkup.js`,
and pdf-lib.

**Engine cuts and additions.**
- **Budgets** are per request (10 pages), per file (40), per user per UTC day
  (60) and per instance per UTC day (200) — the task asked for per file and per
  day; ice had a per-user 15-minute window. In memory per container (a restart
  forgets the day's count — documented as the cost note in `docs/DEPLOYMENT.md`).
- **Model**: `PRODUCT_IMPORT_AI_MODEL`, else the engine's configured model —
  `translator.getModel()` (now exported), which is `TRANSLATE_MODEL` or its
  default. No model literal in the new code. ice used its vision model.
- **No `visionCore`** in the engine: the structured-output call, the temperature
  retry and the JSON salvage live in `aiExtract.js`, with its own client
  (`anthropicAuth` + `fetchNamed('Anthropic messages (product import)')`, one
  SDK retry, the timeout combined with the client's signal).
- **Prices**: the engine's products need `price_isk` AND `price_eur`, and
  its import has no cost column. A printed selling price fills `price_isk`; any
  other price travels as `cost_isk` for the preview only. The pricing step has
  the markup on cost (ice) AND an ISK-per-EUR rate (engine) — both typed by the
  admin, both applied to the rows as read, both flag the row.
- **Create-only** is enforced twice, as in ice: codes already ours are dropped
  at read time, and `classifyImportRows` refuses any `__ai` row that matches a
  product (`aiCreateOnly`).
- **Not ported**: ice's single-row create path. The engine import creates only
  products with variants, so AI lines without sizes/colours stay unmatched —
  the AI step says so. The upload keeps the inline multer wrapper the
  parse-file route uses; move both to lane 1a's `uploadSingle` when it lands
  (ice's 499 for a multer "Request aborted" comes with it).
- **pdf-lib 1.17.1** (MIT; its bundled pako is MIT/Zlib, tslib 0BSD) is an
  exact-pinned devDependency, vendored verbatim as
  `public/js/vendor/pdf-lib.esm.min.js` (523 KB, sha256 `72c052d9…d969` — the
  same file ice vendors) with its licence beside it, loaded only when "Read with
  AI" is pressed. `tests/unit/pdfLibVendor.test.js` fails when a bump leaves
  the copy behind.

**Not verified against the real API**: every test stubs the model
(`aiExtract._setClientFactory`); no call reached Anthropic from this branch.

### Review (invariant-reviewer, 2026-09-26) and what was done

Asked specifically about the merge transaction, the lock order, books
immutability and the AI cost gate. Verdict: the transaction is atomic (one
client, BEGIN…COMMIT, no savepoints), the lock order matches `Inventory.js`,
`lockReferences`, `setOrderStatuses` and the webhook, stock moves only through
the one `applyLines`, issued invoice lines never change, migration 120 is
expand-only and idempotent, the general invariants hold. Findings:

1. **Blocker (after master moved): lane 6a's four FKs had no policy** — fixed:
   master merged in, `goods_receipt_lines`/`goods_receipt_scans` repoint, draft
   receipts locked with the orders; tests for both.
2. **Should-fix: a failed AI read always refunded its pages** (a PDF built to
   trip the echo guard would read for free) — fixed: only an API error status
   (nothing billed) is refundable; an unusable reply or a timeout stays charged.
3. **Should-fix: the freeze lived on the routes only** (MCP `update_product` /
   `set_stock`, `/products/bulk`) — fixed: `Product.update` and
   `ProductVariant.update` refuse (typed 409 `product_merged`), bulk skips.
4. Nit: a product that has variant rows but is referenced by a product-level
   line is a "parent" for the merge and a "level" row for a checkout, and
   products merged earlier into a source join the product pass by the same
   rule; unsorted multi-row writers elsewhere (collections, image reorder) can
   meet the merge in a cycle. **Won't fix**: Postgres detects the cycle, the
   merge answers 409 `merge_busy` (the other side 409 `BUSY`), nothing is left
   half-done; the admin retries.
5. Nit: `lock_timeout` (3 s) is per lock, and every order that ever named the
   products is locked. **Won't fix** now: needed so a later un-fulfil follows
   the repoint; a long-selling product's merge is heavier but bounded, and a
   busy row still ends it as `merge_busy`.
6. Nit: an invoice issued mid-merge gave a 500 — fixed: `restrict_violation`
   from the books' trigger → 409 `stale_preview` (nothing was written).
7. Nit: a connection whose ROLLBACK failed went back to the pool — fixed:
   released as broken.
8. Nit: the Duplicates page compares every pair of names (O(n²)) on each GET.
   **Won't fix** in this lane: fine for the catalogues the engine runs today
   (hundreds); a big retail downstream wants a token index — noted for Halli.
9. Nit: the merged-product guard runs before CSRF on writes. **Won't fix**:
   it only reads, behind requireAuth + the products view, and answers 409.
10. Nit: merging is gated like product editing (`products` view), though it
    cannot be undone. **Fixed — the default taken (tighten, never loosen;
    coordinator, 2026-09-26): the merge is ADMIN-ONLY. Halli may loosen.**
    `POST /products/merge` checks `hasRole(req.user, 'admin')` on the
    session's roles, the way lane 3's customer-email gate does, and answers
    anyone else 403 `merge_admin_only` (`errors.admin.mergeAdminOnly`, DRAFT).
    The suggestions and the preview stay on the `products` view; on the screen a
    non-admin sees the candidates and the plan with Merge disabled and a hint
    (`adminProductDuplicates.adminOnlyHint`, DRAFT). Test: products-view staff
    200 on the suggestions and preview, 403 on the merge; admin 200.

### Tests

Unit 53 new (`productDedupe` 10, `productMergePlanner` 7,
`productImportAiExtract` 21, `aiPdfChunks.client` 7, `importMarkup.client` 6,
`pdfLibVendor` 2); integration 29 new (`productMerge` 17 — gate, suggestions,
refusals write nothing, simple→simple, variants→variants, 301s, frozen writes,
retired-SKU resolution, MERGE_BUSY on a held order, a checkout holding the
source's KEY SHARE commits first and its line is repointed, a checkout after the
merge refused, a held draft goods receipt → MERGE_BUSY, the freeze in the models and bulk, the FK guard both ways; `adminProductImportAi` 12); e2e
`admin-product-duplicates.spec.js` (plants a pair, previews, merges, checks the
301 and the stock). `node server/scripts/migrate.js --plan` on a database at
master's schema: only `120_product_merge` RUN.

### DRAFT strings (Halli)

All new EN/IS strings are DRAFT: `adminProducts.duplicates`,
`adminProductDuplicates.*` (72: title, subtitle, signals, columns, roles,
kinds, 19 refusal/warning reasons, merge/confirm/done/stale lines),
`adminProducts.importReason.aiCreateOnly`, `adminProducts.importAi*` (29: the
AI step, pricing fields, flags), and server-side `errors.admin.merge*`,
`errors.admin.productMerged`, `errors.admin.importAi*`,
`errors.shop.productMerged`.
