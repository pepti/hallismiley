<a id="harvest2-lane6c-2026-09-26"></a>
## 2026-09-26 — Harvest 2 lane 6c: variants that work, colour → photo, the delivery note as a pick list

Lane 6c of the approved "Harvest 2" programme (Halli, 2026-09-26): generic
icelandicstore work on product variants, colour photos and the delivery note,
ported into the engine from ice@941cf51d plus the two PRs merged on top of it
the same day (#430 = 965014ee, #432 = d13c6553). Branch
`harvest2/lane6c-variants`. Provisional engine migration
**`119_product_image_color`** (the harvest renumbers at merge).

### What shipped

**1. Variants that work (ice #194).** The product editor's variant table could
not add a row (it printed a raw `POST /api/v1/admin/shop/products/:id/variants`
hint), and its only "delete" was `active = false`, which kept the row holding the
GLOBAL unique `sku` and its `(product_id, attributes)` slot for ever — re-adding
that size 409'd with no way out.
- The table is now `public/js/components/VariantGrid.js`, mounted by
  `AdminProductsView._paintVariants` (a one-method hunk; lanes 6a/6b also edit
  that view). Every cell autosaves on `change` (PATCH one field; a new row stays
  local until every option and a SKU are filled, then POSTs once); status is
  per row and a failed save keeps what was typed. "+ Add Variant" adds a row;
  its option cells are Comboboxes over the values the product already uses.
  A product with no options gets a small option-name setter (PATCH
  `variant_axes`); once a variant exists the names are frozen.
- `DELETE /products/:id/variants/:variantId` really deletes a variant nothing
  names. One that an order line (RESTRICT) **or the stock history**
  (`inventory_adjustments`, CASCADE — a delete would destroy the audit trail) still
  names is ARCHIVED: `archived_at` set, `active` false, shelf cleared, out of every
  list, the row kept so the order still resolves it. `ProductVariant.hasReferences`
  reads EVERY foreign key onto `product_variants` from `pg_constraint`, so a table
  a later lane adds (goods receipts, counts) is covered the day it lands.
- Migration 119 makes both unique rules partial on `archived_at IS NULL`
  (`uniq_product_variants_sku_live`, `uniq_product_variants_attrs_live`), creating
  each new index BEFORE dropping the old rule; the column-level SKU constraint is
  found in `pg_constraint` rather than dropped by a guessed name (ice's review
  finding). An archived row therefore frees its SKU and its size for re-use —
  pinned by `tests/integration/adminShopVariants.test.js`. `seed-shop.js`'s
  `ON CONFLICT (product_id, attributes)` now names the predicate.
- `validateVariant` (middleware) replaces the English checks in `createVariant`
  and gives PATCH validation; `createVariant` keeps `barcode` and `bin` (they were
  dropped); PATCH may fix an option value (`attributes`), still refused on a
  collision with a live sibling (409). PATCH/DELETE are scoped to the product in
  the path (`findByIdForProduct`) and archived rows are not editable.
- Lists exclude archived rows: `listForProduct(s)`, `Product.resolveByCode`,
  `findForImport(ByBarcode)`, `findBarcodesInUse`, `listForExport`. By-id lookups
  do not (old orders). `findBySku` prefers the live row.
- The product modal's saves check `res.ok`: the collections list, which on a
  failed load used to render "no collections" and let the next Save send
  `collection_ids: []` (silently emptying every collection), now shows the error
  and Save leaves membership alone; the post-upload refresh checks too. The
  subcategory field is a Combobox over the values in use (ice's value pickers —
  the engine has no Tegund/Birgir/Flokkur fields; subcategory is the analogue).

**2. Variant order (ice #352 + #381).** `public/js/utils/variantArrange.js`:
colour → size, XS → 2XL with XXL = 2XL, supplier codes folded ("French Navy
(FRNA)" ranks as navy). It replaced ProductView's own `AXIS_ORDER` table (the
storefront chips) and orders the admin grid and the detail panel by default —
the SQL order stays SKU (deterministic, MCP, export). `variantSort.js`: a header
click sorts, several columns in turn with a click-order badge, remembered per
browser (`variantSort.grid`). Display only. The client twin of
`server/utils/variantAxis.js` (named in its header, never carried) came with it,
with the parity test.

**3. "+ Add a colour" (ice #430).** `utils/variantAddValue.js` plans one row per
value the other options already use, in garment order; SKU and barcode are
pasted from a spreadsheet (keyed `size ⇥ SKU ⇥ barcode` in any order, or one line
per row in order — all or nothing), each row POSTed through the existing
one-variant route; a failed row stops nothing and a second press resends only
the failures.

**4. Many variants at once (ice #432).** `server/services/variantAdd.js` — one
writer, all or nothing, every problem in one answer (`{index, field, reason,
value}` + a localised message): every option named and nothing else (keys
written in the product's live spelling, because the unique index compares the
jsonb exactly), no existing or duplicate combination (folded), SKUs and barcodes
unique in the batch and unused in the catalogue as a SKU OR a barcode,
case-blind; re-checked under advisory locks (product + each code, sorted) inside
the transaction; stock always 0. `POST /products/:id/variants/bulk`
(`{ variants, dry_run? }` → 200 dry run / 201 / 400 / 409). MCP `add_variants`
(new variants start INACTIVE, the create_product Draft rule) behind the new
switch `mcp.write.variantCreate`, OFF by default; `list_variants` (scope read,
writes nothing) rides the same switch so the default read surface stays the v1
system tools. `registry.validateArgs` learned arrays (`minItems`/`maxItems`/
`items`) and nested objects (`properties`, `required`, `additionalProperties` as
a schema), refusing unknown keys at every level and looking props up with
`Object.hasOwn`. `ProductVariant.create` takes an outer `client`.

**5. Swatch → photo (ice #182/#265/#270/#273).** `product_images.color`
(migration 119). The match lives on the SERVER only
(`server/utils/colorMatch.js` → `color_images` on `GET /api/v1/shop/products/:slug`):
exact, then token containment accepted only when unambiguous both ways — the
lesson of ice #265, where a browser-side matcher missed "French Navy (FRNA)"
against a photo tagged `navy` on PROD. The product page renders the colour axis
as swatches (garment colours, literal by design — they must not move with the
theme; every surface around them is tokens), names the chosen colour without its
supplier code, opens on the pre-selected colour's photo and cross-fades to the
picked one; an unmatched colour leaves the gallery alone. The admin image
editor has a per-photo colour select listing the product's ACTIVE colours only
(ice #270) and a "n of m colours have a photo" line; `PATCH
/products/:id/images/:imageId { color }` stores the folded tag. Ported e2e:
`e2e/shop-colour-swatch.spec.js` (its fixture created in `beforeAll`).
`utils/colorLabels.js` (lane 4b) now imports `colorKey`/`matchKnownKey` from the
ported `variantAxis.js`/`colorMatch.js` instead of its inlined copies.

**6. The delivery note as a pick list (ice #8, #334, #335).**
`services/deliveryNote.js` loads the lines (`Order.listItemsWithSku`: the live
SKU/bin, the variant's current options, the product's axes), a size label per
line (`server/utils/variantLabel.js`: the product's axis order, and nothing when
the line name already carries it — no double size) and a 120 px JPEG per line
(`productImages.printThumbnail`, from the `.thumb.webp`; the colour's own photo
when `color_images` matches it, else the first). At most four decodes run at
once, process-wide, with a 15 s slot timeout; each photo is decoded once per
request and embedded once per PDF (`openImageOnce`). `pdfService` prints # |
picture | product + size | BIN | SKU | QTY and walks the lines by BIN, then SKU
(`server/utils/skuCompare.js`, numbers as numbers). A picture problem costs the
line its picture, never the PDF. `tests/unit/deliveryNotePdf.test.js` pins line
order, the columns, the single embed and the concurrency cap.

**7. The lane 4a leftover.** The inline-edit controls in `shop.css` and
`contact.css` (edit / save buttons, the availability save, the add button's
hover) filled with `--gold-light` under the near-white `--bg-nav` label; they
now use `--on-accent` for the label and `--accent-hover` for the hover fill, and
the editable-region focus outline uses `--accent-ink`.
`tests/unit/themeTokenContrast.test.js` stays green.

### Engine deltas from ice (deliberate)
- No product merges yet (lane 6b brings them): `variantAdd` has no merged-product
  refusal and no merged-SKU check — add both when 6b lands.
- An ARCHIVED variant's SKU is free for the bulk writer too (ice counts archived
  SKUs as taken there); one rule with the single route, which item 1 requires.
- Variant prices are the engine's VAT-inclusive `price_isk` / `price_eur`
  overrides (ice's variant price is net ISK only).
- The shelf is written on the variant row; the engine has no bin-move audit.
- Archiving also clears the variant's shelf: `Bin.js` lists variants without an
  archive filter, and a deleted variant occupies no shelf.
- The client `variantLabel.js` mirror is not taken (no engine caller).
- `list_variants` is behind the `variantCreate` switch (ice lists it always) so
  the default MCP read surface is unchanged (ENHANCEMENTS #13).

### Review (invariant-reviewer on `git diff master...HEAD`)
Verdict: every stack invariant passes (1, 2, 4, 5, 6, 7 incl. MCP gating, 8,
9, 10, 13/15, stock only through `Inventory.js`, no SQL injection in
`hasReferences`, no IDOR). Findings and what was done:
- **Fixed — the delete could lose stock history to a race.** The reference
  check and the delete were two statements, and `inventory_adjustments` is
  CASCADE, so a movement committed in between would have been deleted with the
  variant. Now `ProductVariant.deleteOrArchive` decides and acts in ONE
  transaction after locking the product FOR KEY SHARE and the variant FOR
  UPDATE (the engine lock order); the stock writers and an order line's FK
  queue behind it.
- **Fixed — option-key spelling on the single-row routes.** POST/PATCH now
  write the product's own axis spelling (`axisSpelled`), as the bulk writer
  does, so `{"Color":…}` and `{"color":…}` cannot become two rows.
- **Fixed — a SKU clash on create said "combination taken".** Both single-row
  routes map a 23505 by constraint (`variantConflictKey`).
- **Fixed — the migration's DO block** matches `con.conrelid =
  'product_variants'::regclass` (schema-safe), and its comment now spells out
  the rollback case: after SKUs were re-used, the previous image's
  `resolveByCode` can resolve a code to the archived twin and the old
  `seed-shop.js` fails with 42P10 — degraded, not broken; no
  `minCompatibleVersion`.
- **Fixed — docs:** the bulk route's `errors` array is documented under
  "Error format" in `docs/API.md`. Also found in passing: PATCH could empty a
  SKU; `validateVariant` now refuses that.
- **Won't fix — the archived-variant notice uses `errors.admin.variantArchived`
  for a 200.** The server locale has no success namespace (email, validation,
  errors, export, meta); the message is shown as a row status. Kept as ice has it.
- **Won't fix — the single POST is not case-blind across SKU and barcode like
  the bulk writer.** The single route keeps the engine's existing rule (exact
  SKU via the unique index); the bulk path is stricter by design (ice #432).
- **Won't fix — `list_variants` shows inactive products' bin and stock to a
  read token.** It is behind the `variantCreate` switch (off), and every MCP
  token's owner is re-checked as an admin on each call (`server/mcp/owner.js`),
  the same exposure as the existing catalogue tools.
- **Won't fix — the swatch `box-shadow` literals.** Decorative depth on a
  garment-colour disc, not text; the disc's edge is the `--border` token, which
  carries it on Miðnætti.

### DRAFT strings (Halli approves)
Client (`public/js/i18n`): `adminProducts.variantHint` and `adminProducts.noVariants`
(rewritten), `variantInherit`, `variantBarcode`, `variantIncomplete`,
`variantArchived`, `confirmDeleteVariant`, `deleteVariant`, `variantAxesHint`,
`variantAxesLabel`, `variantAxesPlaceholder`, `variantAxesInvalid`, `addColor`,
`addAxisValue`, `addValueCreate.one/.many`, `addValueLead`, `addValueLeadValue`,
`addValueLeadSingle`, `addValueAxis`, `addValueColor`, `addValueValue`,
`addValueExists`, `addValueNoOthers`, `addValuePaste`, `addValuePastePlaceholder`,
`addValuePasteHint`, `addValuePasteErr.count/.spaces/.unknown/.dupe`,
`addValueNeedSku`, `addValueProgress`, `addValueDone`, `addValueSomeFailed`,
`imageColorLabel`, `imageColorNone`, `imageColorCoverage` (all `adminProducts.*`);
`shop.sortByCol`, `variants.axisColor`, `variants.axisSize`. Server
(`server/i18n`): `errors.admin.variantArchived`, `errors.admin.imageColorRequired`,
the 19 `errors.variantAdd.*`, the 11 `validation.variant.*`. Icelandic drafted
natively (most follow ice's approved wording).

### After merging master (lanes 3 and 6a, 116–118)
119 sits after 118. Lane 6a's stock code now sees live variants only:
`GoodsReceipt.matchCodes` (an archived twin sharing the SKU made the code
"ambiguous", or received onto a deleted variant), `Inventory.watchRows`,
`stockItems`, `variantRefs` and `searchItems` filter `archived_at IS NULL`, and
`applyLines` refuses an archived variant under a new `refuseArchived` flag that
`applyBatch` (every count and receipt) passes; `Inventory.correct` ("Fix
stock") refuses one too. Order fulfilment does NOT pass the flag: an order line
may name an archived variant and must still ship or be restored.
`tests/integration/archivedVariantStock.test.js` pins it: a receipt line and the
count lookup/search pick the live variant that shares the archived one's SKU; a
count batch and "Fix stock" naming the archived one are refused and move
nothing; fulfilment still moves it. The receiving tables' foreign keys are read
by `hasReferences`, so a variant on a receipt is archived, not deleted.

The other filled `--gold` controls (add-to-cart, basket checkout, checkout
submit) keep their `--bg-nav` label: measured with the contrast test's helpers
they clear AA on every theme (lowest Bjart's brightness(1.15) hover, 5.12 : 1),
so nothing moved; `themeTokenContrast.test.js` now pins those pairs and those
rules, and pins the inline-edit controls to `--on-accent` / `--accent-hover`.

### After merging master again (lane 6b, product merge, 120)
119 sits before 120. The merge now knows 119:
- an archived variant is never a merge unit (it is inactive): it stays
  archived on its source, never moved or switched back on; the merge engine
  reads `archived_at` and the planner no longer refuses a moved variant that
  lands on an ARCHIVED survivor row's combination
  (`attribute_collision_inactive` now covers switched-off, not archived, rows —
  the unique index is live-only); a new variant's SKU check ignores archived
  SKUs; the Duplicates screen's "inactive variants" count leaves them out;
- `product_images.color` travels with the image (the `images` policy moves the
  row);
- 119 adds no foreign key, so `repointSpec.js` needs no new rule;
- a merged-away product is frozen for the variant writers: lane 6b's route
  guard (`router.use('/products/:id', …refuseMergedProduct)`) already covers
  POST/PATCH/DELETE variants, `/variants/bulk` and the image colour PATCH, and
  `services/variantAdd.js` (the MCP `add_variants` path) refuses it up front and
  again under its product lock (409 `product_merged` + `movedTo` on the route,
  a clear MCP error). `Product.findForImport` (6b's merged-aware version) reads
  live variants only.
Pinned in `tests/integration/productMerge.test.js`.

### Still owed
