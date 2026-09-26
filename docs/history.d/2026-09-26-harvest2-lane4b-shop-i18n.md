<a id="harvest2-lane4b-2026-09-26"></a>
## 2026-09-26 — Harvest 2, lane 4b: shop polish and Icelandic pages (VAT per rate, re-priced basket, postcode/phone rules, colour names)

Lane 4b of Harvest 2 (generic icelandicstore work up to `ice@941cf51d`, scope approved by Halli on
2026-09-26). Branch `harvest2/lane4b-shop-i18n`. Ported from ice `6f5b37e` (#399), `6c0f99fc`
(#400), `0faa32c2` (#51), `e1f75e0e` (#343, the cart half) and `fa8de049` (#213, the autofill
half). No migration.

**Why.** The shop surfaces (hidden on this instance, live on every shop downstream) still had the
base's English literals on Icelandic pages, a fixed "Price includes 24% VAT" sentence although a
product can be 0, 11 or 24 % and an export is zero-rated, and a basket that kept quoting the price
a line was added at while checkout charged today's. Icelandicstore had fixed all of these; this
lane brings the generic part up.

**What changed.**
1. **No English on Icelandic pages** (#399/#400). `ProductView` builds its default chrome through
   `t()` at render (`defaultChrome()`): the module-level `DEFAULT_CHROME` froze "← Back to shop"
   into the page because the locale table is not loaded when the module is first evaluated. "No
   image", "Image n" and the picker labels are locale keys; the colour picker says "Veldu lit",
   the size picker "Veldu stærð" (`shop.chooseColor` / `shop.chooseSize`; the `{axis}` template
   put the noun in the nominative). `public/js/utils/colorLabels.js` maps the garment colour list
   to locale keys (exact name before a partial match; bare Pink/Green match only exactly, so a
   real shade keeps its own name). The nav landmark's `aria-label` goes through
   `t('nav.mainNavigation')` and is relabelled on a switch; `main.js` re-translates the static
   skip link on `localechange`; `AdminSalesView`'s load-failure fallback is a key.
2. **One phone rule, one postcode rule** (#399). `server/utils/contactFormat.js` + its ESM twin:
   `PHONE_RE` moved out of `validate.js` unchanged, plus `isValidZip` — an Icelandic postnúmer is
   three digits, abroad the postcode is free text. Used by `validate.js` (signup/profile phone, as
   before), the contact form (`errors.contact.phoneInvalid`; the API still answers
   `{ errors: [...] }`; the view checks first and focuses the field) and the checkout
   (`validate.validateCheckoutContact` on `POST /api/v1/shop/checkout`, and `setCustomValidity` in
   `CheckoutView` so `reportValidity()` points at the field). Only an address whose country is IS
   (or blank) is held to three digits; local pickup reads no address.
3. **Status pills on status tokens** (#399). `.approval-badge--pending/--declined` (was
   `#1a1a1a` on `#c9a84c`, `#fff` on a hex fallback), the admin order badges (pay-pending,
   ful-unfulfilled, ful-partial → `--warning` on `--warning-dim`; paid/voided rgba literals →
   `--success-dim` / `--error-dim`) and the storefront's pending status. In the orders list a
   badge may wrap to two short lines (#400); the order number never breaks.
4. **Duplicate-name chip** (#399). `utils/duplicateNames.js`; `renderProductCard(p, { showSku })`
   shows the SKU (the first variant's when the product has none) when two different products on
   the grid or a landing row share a name.
5. **VAT per rate** (#51). `public/js/utils/vat.js` is the display twin of `server/utils/vat.js`
   (`splitVatInclusive`, `allocateProportional`) and of `invoiceService.buildLines` (each line at
   its product's rate, shipping at 24 %, a discount spread over the lines in proportion, the
   rounding line at the largest line's rate, an export zero-rated on goods and shipping while a
   service keeps its rate). The cart shows "Þar af VSK n%" per rate under the subtotal; the
   checkout under the total, live as the method or the country changes, with a note on an
   export; the admin order page under the total. `Order.listItems` now also returns the product's
   `vat_rate` (the same live read the invoice books with), and so does the public catalogue:
   `Product.publicCols` (both locales) had left `vat_rate` out, which a browser check caught — an
   11 % book showed as 24 % until it was added. Cart lines carry `vatRate` and `isService`. `tests/unit/vatDisplay.client.test.js` runs six orders through both the display
   and `buildLines` and requires the same per-rate figures.
6. **Re-priced basket** (#343). `cart.syncPrices(products)` runs on the payload the cart and the
   checkout already fetch for availability; it copies the current prices onto the stored lines
   (variant before product, a payload without prices never wipes one, a vanished variant is left
   to the stock check), fills in the VSK rate on older lines, and returns the lines whose price
   moved — the page then says "Verð hefur breyst síðan þetta fór í körfuna: …".
7. **Checkout autofill** (#213, part). A signed-in buyer's delivery name starts as the account's
   display name (else username) and the phone as the account's phone; both stay editable.

**Measured.** Unit tier 2 065 passed / 1 skipped; new suites
`colorLabels.client` (27), `contactFormat` (29), `duplicateNames.client` (7),
`vatDisplay.client` (14), `cartPriceSync.client` (7). Integration: `contact.test.js` (+1: shape
400s and passes) and `shop.test.js` (+5: `vat_rate` on the public catalogue in both locales and
on `listItems`, the postcode/phone 400s in the envelope, foreign postcodes and pickup untouched)
— the two suites 43/43. e2e `cart-sold-out.spec.js` (+1, 3/3 on `E2E_PORT=3022`): the re-price
notice, VAT rows at 11 % plus 24 % shipping, export 0 %, the IS postcode stop. Checked by eye at
375 px on Glóð, Bjart and Miðnætti (cart, checkout summary, the SKU chip).

**Not done / chosen differently.**
- **The checkout order note (#213) is NOT ported: `orders.notes` does not exist in the engine
  schema.** It needs an engine migration (`ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes
  TEXT`, expand-only, safe for invariant 14) — left for the lane owner / Halli to schedule rather
  than taking an engine migration number inside a parallel lane. Once the column exists: trim,
  1000-char cap, write in the order-create path of `shopController.createCheckoutSession` (the
  engine has one order path, not ice's two), show on the admin order page.
- **The phone rule is ice's, not a stricter one**: `PHONE_RE` (7–20 of digits, spaces, `-().`, an
  optional leading +) is what ice shares; an Icelandic-only "7 digits, optional +354" rule would
  refuse a buyer abroad. Its only tightening is on the contact form, which checked length only.
- Trimmed from ice: the `/catalog` back link (the engine has no catalogue view), `prettyColor`
  title-casing (an unlisted colour shows as the catalogue spells it), the quick-order grid's SKU
  chip (no quick-order grid here), `zipChangeRefused` and the store/company forms (no store
  locations in the engine), #213's store radio cards and admin "change store" (same reason), #343's
  staff customer-price surfaces (no customer prices in the engine), #51's net-price note on the
  product card (engine prices are gross).
- **Open**: `CheckoutSuccessView` still prints the fixed `orders.vatNote` (its order payload comes
  from `shopController.getOrderBySession`, lane 1a's file this round); the product page's
  `vat_note` chrome is an editable `site_content` sentence that still says 24 % for an 11 %
  product; a EUR order's display VAT is split in cents while the invoice splits in ISK after
  conversion, so the two can differ by a rounding; the product page's admin-only "Shared labels"
  edit hints are still English; `checkout.vatNote` is now unused; at 375 px the cart table
  (unchanged here) runs a few pixels past the screen and clips the remove ✕.
- Files shared with other lanes, kept minimal: `NavBar.js` (the landmark label, two lines; lane 1b
  owns its document click listener), `server/models/Product.js` (lane 1a's: `vat_rate` added to
  the two `publicCols` strings, nothing else), `shopRoutes.js` (one middleware in the checkout
  chain; `shopController.js` untouched), `AdminOrderDetailView.js` (the totals block only; lane
  4a sweeps its date format and title).

**Review pass** (`invariant-reviewer` on `git diff master...HEAD`): no blocking findings. Fixed on
the branch: (A1) the cart and checkout printed a line's stored variant label ("Black / M") inside
Icelandic sentences — `colorLabels.translateVariantLabel` now re-labels known colours at render;
(A3) the cart's VAT label is escaped like the others; (A4) the postcode rule's "Iceland" is now the
same set of spellings as the VAT export rule (`IS`, `ISL`, `ICELAND`, `ÍSLAND`, blank), pinned by a
test. Deliberate won't-fixes: (A2) `cart.syncPrices` sees the first 100 products the catalogue
endpoint returns, so a basket line past that cap keeps its stored display price — the charge is
still the server's, and a catalogue that size is a later concern (an `?ids=` filter on the
catalogue would close it); (nit) a malformed postcode on an instance without Stripe now answers 400
before the controller's 503 — harmless.

**New strings (all DRAFT, Halli approves).** Public table, IS / EN:
`nav.mainNavigation` Aðalvalmynd / Main navigation ·
`adminSales.loadFailed` Ekki tókst að sækja söluskýrsluna. / Could not load the sales report. ·
`shop.imageN` Mynd {n} / Image {n} ·
`shop.chooseAxis` Veldu {axis} / Choose {axis} ·
`shop.chooseColor` Veldu lit / Choose color ·
`shop.chooseSize` Veldu stærð / Choose size ·
`shop.colorBlack` Svartur / Black · `shop.colorWhite` Hvítur / White · `shop.colorNavy` Dökkblár / Navy ·
`shop.colorFrenchNavy` Djúpblár / French Navy · `shop.colorGrey` Grár / Grey ·
`shop.colorSage` Salvíugrænn / Sage · `shop.colorSageGreen` Salvíugrænn / Sage Green ·
`shop.colorSlateGreen` Grágrænn / Slate Green · `shop.colorGreen` Grænn / Green ·
`shop.colorRed` Rauður / Red · `shop.colorRust` Ryðrauður / Rust · `shop.colorBurgundy` Vínrauður / Burgundy ·
`shop.colorPink` Bleikur / Pink · `shop.colorBlushPink` Fölbleikur / Blush Pink ·
`shop.colorMistyPink` Grábleikur / Misty Pink · `shop.colorSweetPink` Ljósbleikur / Sweet Pink ·
`shop.colorNatural` Náttúrulitaður / Natural · `shop.colorBeige` Drapplitaður / Beige ·
`shop.vatIncludedRate` Þar af VSK {rate}% / Incl. VAT {rate}% ·
`checkout.vatExportNote` Sent úr landi: 0% VSK á vörum og sendingu. / Shipped abroad: 0% VAT on goods and shipping. ·
`cart.pricesUpdated` Verð hefur breyst síðan þetta fór í körfuna: {names}. Karfan sýnir nú núgildandi verð. / Prices have changed since you added: {names}. The cart now shows today's price. ·
`checkout.postcodeInvalid` Íslenskt póstnúmer er þrír tölustafir, t.d. 101. / An Icelandic postcode is three digits, e.g. 101. ·
`checkout.phoneInvalid` Sláðu inn símanúmer, t.d. 555 1234. / Enter a phone number, e.g. +354 555 1234. ·
`contact.phoneInvalid` Athugaðu símanúmerið, t.d. 555 1234. / Check the phone number, e.g. +354 555 1234.
Server table: `validation.checkout.postcodeInvalid` Íslenskt póstnúmer verður að vera þrír tölustafir /
An Icelandic postcode must be three digits · `errors.contact.phoneInvalid` Athugaðu símanúmerið, t.d.
555 1234. / Check the phone number, e.g. +354 555 1234. The colour names and picker sentences are
ice's approved Icelandic.
