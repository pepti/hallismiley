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

**Lanes in flight.** 6a (receiving) and 6c (variants / delivery note) may add
foreign keys to products or variants. `assertCovers` makes merging refuse
(503 `schema_drift`) and `productMerge.test.js` fails CI until `repointSpec.js`
names a policy for each — whichever lane lands second adds it.

**Tests.** `tests/integration/productMerge.test.js` (14), `tests/unit/productDedupe.test.js`
(10), `tests/unit/productMergePlanner.test.js` (6).
