<a id="harvest2-lane5-2026-09-26"></a>
## 2026-09-26 — Harvest 2, lane 5: the sales report grows up (periods, comparison, net sales, insights, marketing), "Í dag" attention cards, an order VAT snapshot, MCP sales tools

Lane 5 of Harvest 2 (generic icelandicstore work up to `ice@941cf51d`, scope approved by Halli on
2026-09-26). Branch `harvest2/lane5-reports`. Ported from icelandicstore #414 (`ad022b2`, period
presets + comparison + net sales), #417 (`30b1e14`, "Þarf athygli") and #419 (`f4baf2b`, the
analyses under the chart), onto the ENGINE's report — which differs from ice's in two ways it
keeps: a sale counts when it is PAID (`paid_at`), and money is per currency. One engine migration:
`121_order_vat_snapshot` (the number confirmed by the coordinator; 119 is reserved for lane 6c).

**Why.** The engine's `/admin/sales` offered 7/30/90 rolling days, gross revenue only, and a chart
of order counts. Ice had rebuilt its dashboard around calendar periods, a comparison with the
previous period and NET sales ("Sala án VSK") — the figure the business counts in — plus an
attention row and three analyses. Net sales need the order's VAT, which the engine only ever
computed inside the invoice.

**What changed.**
1. **One VAT rule, two callers** (`server/utils/orderVat.js`, migration 121). The core of
   `invoiceService.buildLines` — per-line rate (a missing rate is 24 %, an unknown one throws; an
   export zero-rates goods, a service keeps its rate), shipping at 24 % or 0 % on an export, the
   gap to what was paid spread over every line incl. shipping by largest remainder, a shortfall
   as a sléttun line at the largest line's rate — moved verbatim into a PURE `computeOrderVat`.
   `buildLines` now translates to ISK and calls it; its output is pinned byte-for-byte to a golden
   file written by the PRE-extraction code over eleven fixtures (ISK, discounts, shipping
   discounts, an export with a service, a 100 % discount, three translated EUR orders, one with a
   rounding line) — `tests/unit/orderVatParity.test.js`. `isExport` and the address→country read
   moved with it (`countryOf`), so the checkout and the invoice cannot disagree about "abroad".
   `Order.createWithItems` snapshots `order_items.vat_rate` and `orders.vat_total` inside the
   checkout transaction, from the line rows read back in `(created_at, id)` order — the order the
   invoice reads them in, which matters because the largest-remainder split breaks ties by
   position and rows written in one transaction share `created_at`. For an ISK order the snapshot
   equals what `createFromOrder` books, to the króna (checkout → invoice in
   `tests/integration/orderVatSnapshot.test.js`: mixed 24/11 % + a service + shipping + a 10 %
   code; local pickup; an export). EUR is snapshotted in cents (the ISK figure depends on the FX
   rate of the payment date). A rate the rule refuses leaves NULL and is logged — the sale is not
   lost over a report figure; the invoice refuses the same row when it is issued.
   **Migration 121** adds both columns nullable (a CHECK on the rate) and backfills history
   `WHERE vat_total IS NULL` in SQL from each product's CURRENT rate — APPROXIMATE (a rate changed
   since, and the króna-level allocation, are not reproduced), said so in the entry. No alias to
   ice's 087 (which also adds product VAT columns): on ice the columns exist and the backfill finds
   nothing. An order the previous release writes during a self-update swap stays NULL and the
   report reads it through the same approximation (`Order.vatTotalSql`, COALESCE — evaluated only
   for a NULL).
2. **Period presets** (#414). `public/js/utils/dateRanges.js` + its test ported (eleven presets,
   the comparison window — calendar presets one unit back, rolling ones the window before, a
   part-day compared up to the same moment — Atlantic/Reykjavik = UTC). The engine builds the
   Icelandic labels by hand ("1.–23. sep. 2026"; Chrome has no Icelandic ICU). `AdminSalesView`
   swaps `RANGES=[7,30,90]` for a `<select>` of the presets, remembered per browser
   (`utils/localPref.js`, try/catch inside), prints the exact dates and the comparison under it,
   and puts `+n %` / `−n %` on every KPI (up on `--success`, down on `--error`, "—" without a
   base). Net sales per currency is the headline card with the gross under it; average order net;
   VAT. The chart draws net sales (the ISK series, or the only currency) as bars and orders as a
   line, by hour / day / week / month by span, zero-filled, colours from `utils/chartTheme.js` at
   draw time and redrawn on `themechange`. A failed load puts the picker back and says why.
   `Order.salesReport({ from, to, compare, bucket })` keeps the engine's semantics, cuts buckets on
   Atlantic/Reykjavik, and still answers `{ days }` with the legacy keys (`days`, `orders`,
   `revenueByCurrency`, `byDay`, `topProducts`) — `?days=` is the previous release's client during
   a swap. `server/utils/reportWindow.js` parses the window; an empty, backwards or unparsable one
   (either window) is a 400 `errors.admin.invalidDateRange`. The page now opens for any holder of
   the `sales` view (`canSeeView`), not only admins — the server was always the gate.
3. **"Í dag" attention cards** (#417). The admin home already had orders to fulfil and open change
   requests; added: **sold out** (`inventory` view; the Birgðavakt's `out` bucket — every stocked
   unit whose Available is 0 or less, counted by the SAME `Inventory.watchRows` →
   `buildWatchReport` the page renders; lane 6a, merged into this branch mid-lane) and **sign-ups
   awaiting approval** (`users` view; `utils/signupApproval.js`). Each to-do now links to its list
   FILTERED to exactly the rows counted: `/admin/shop/orders?view=open` (`Order.ORDER_VIEWS.open`,
   which the card's count now uses too), `/admin/inventory?status=out`,
   `/admin/users?status=pending`, `/admin/feedback?status=open`. `AdminOrdersView` keeps its filter
   in the URL through the kit's `listState` (`?view=`, `?filter=`, `?q=`); the users and
   change-request lists read `?status=`, the users list with a chip back to the whole list (the
   Birgðavakt already did). A source that fails keeps its row: `{ failed: true, count: null }` from the server, "—"
   and "Náðist ekki að lesa" on the page — never 0 (the VSK deadline, a number of days, is exempt).
   Each card only exists for a role holding its view, as every "Í dag" block. ice's backorder,
   Regla, Pressan cards have no engine counterpart.
4. **Insights** (#419). `GET /api/v1/admin/shop/reports/insights?from&to`: payment → fulfilment
   median and average (`fulfilled_at − paid_at`, orders fulfilled in the window; one stamped
   fulfilled before it was paid is left out); new customers (first PAID order ever in the window,
   top 5 by net); dormant customers (ordered before, nothing in 90 days — the state NOW, labelled
   so — top 10 by lifetime net and the total). A customer is a user, else a guest by e-mail. Names
   go only to a viewer who also holds `customers` or `orders`; a `sales`-only role gets the counts.
   Left out: channels, companies, the shop's own kennitala — the engine has none of them.
5. **Marketing overview** (Halli's item 1). A section of the sales report (one period picker; no
   new view id): visits by channel from `page_views.referrer_host` — a visit is one visitor's day
   (the token is a daily hash), its channel the first page view's referrer, classified by the pure
   `server/utils/trafficChannel.js` (Direct / Search / Social / Email / Referral, webmail before
   search), plus the top referring sites; sales that used a discount (per currency: orders, net,
   discount given); a campaigns table from `discounts` (live now or used in the window: status,
   orders, net, discount, uses). `GET /api/v1/admin/shop/reports/marketing?from&to`; the traffic
   block needs the `analytics` view as well.
6. **MCP read tools** (`server/mcp/tools/orders.js`). `sales_report` (the report for inclusive
   dates, optional comparison) and `recent_orders` (newest first, `open_only` = the to-fulfil
   list). A FOURTH registry gate: a tool may name a `view`, and it is listed and callable only
   when the token OWNER holds that view on this instance (`mcp/owner.js ownerViewAccess` — the
   admin home's `homeAccess`: role views, minus switched-off modules, minus the product's hidden
   admin views for an all-views holder). This product hides its shop, so neither tool is listed
   here; a shop downstream gets both. No e-mail, address, phone, note or Stripe id leaves.

**DRAFT strings** (all `DRÖG` until Halli approves; IS first): the `adminSales.*` block — period
and preset names (Í dag · Í gær · Þessi vika · Síðustu 7 dagar · Þessi mánuður · Síðasti mánuður ·
Síðustu 30 dagar · Síðustu 90 dagar · Á árinu · Síðustu 12 mánuðir · Allt tímabilið), "Borið saman
við …", "Sala án VSK (ISK)", "Með VSK: …", "Meðalpöntun án VSK", "VSK", the chart labels, the
duration units, Afgreiðslutími / Nýir viðskiptavinir / Sofandi viðskiptavinir and their lines,
Markaðssetning / Heimsóknir eftir leið (Beint · Leitarvélar · Samfélagsmiðlar · Tölvupóstur · Aðrir
vefir) / Sala með afslætti / Herferðir and the campaign states (Virk · Á dagskrá · Lokið · Uppurin
· Óvirk), the two failure lines; `adminHome.waiting.outOfStock.*` ("{n} vörunúmer uppseld", "Opna Birgðavakt"),
`.signups.*` ("{n} umsóknir bíða samþykkis", "elsta frá …"), `.tag.unread` ("Náðist ekki að
lesa"); `adminOrders.viewOpen` ("Bíða afgreiðslu"), `adminUsers.onlyPending`,
`adminUsers.clearFilter`; server `errors.admin.invalidDateRange`.
Removed (unused now): `adminSales.range7/30/90`, `adminSales.ordersPerDay`.

**Measured.** Unit tier 2 355 passed / 1 skipped (135 suites) before the second master merge; new
unit suites `orderVatParity` (22), `dateRanges.client` (27), `reportWindow` (11), `trafficChannel`
(30), `adminHomeTodo.client` (2). Integration after both master merges: 23 suites / 393 tests green,
among them the new `orderVatSnapshot` (5), `adminSalesReport` (11), `adminHomeAttention` (4),
`mcpSalesTools` (5), and the touched `adminHome`, `shop`, `booksInvoice`, the `mcp*` suites,
`adminInventory`, `productMerge`. e2e on `E2E_PORT=3027`: the new `admin-sales-report.spec.js` (6)
plus `admin-home`, `admin-feedback-switch`, `admin-surface`, `admin-stock`, `admin-list-kit` — 36/36.
`migrate.js --plan` on a throwaway database at master's state (every entry applied, then 121's
columns and row removed): `RUN 121_order_vat_snapshot` and nothing else; applying it there
succeeded. Screenshots of the report (periods, deltas, insights, marketing) and the Í dag cards on
Glóð, Bjart and Miðnætti at 1440 px and 375 px were checked by eye (the lane's scratch folder, not
committed).

**Review pass (invariant-reviewer, same day).** Both flagged areas clean: the snapshot cannot fail,
double-lock or deadlock a checkout (a plain SELECT, updates only to rows the transaction created, the
lock order untouched), and `buildLines` matched the pre-extraction code on the golden file AND on
30 011 randomised differential inputs (rounding lines, ties, zero lines, 100 % discounts, bad rates —
identical output and identical errors). Fixed: the two comments that said the snapshot always equals
the booked VAT now name the exception (a rate changed before invoicing); a stale `?stock=out`
comment; `AdminSalesView` no longer throws on a previous release's report shape during a swap.
Won't fix, recorded here: (a) **icelandicstore prices are NET and a variant may override the rate**
— ice keeps its own `vat_total` logic, so at the next graft its `Order.createWithItems` must win any
conflict with `snapshotVat` (migration 121 itself is a no-op there); (b) the backfill's
`UPPER('ísland')` depends on the database collation — inside the documented approximation (every
engine database is UTF-8 with a real locale); the inner join to `products` is exact because
`order_items.product_id` is NOT NULL with ON DELETE RESTRICT; (c) migration 121 holds its ALTER lock
through the backfill — negligible at today's sizes; (d) `buildLines` still builds `grossBefore`
though only its quantity assertion is used — kept so the checks run in the same order and the error
a bad row throws stays byte-identical.

**Owed / for Halli.** The invoice still reads each line's CURRENT product rate, not the new
snapshot — making `createFromOrder` book `COALESCE(oi.vat_rate, p.vat_rate)` would pin the invoice
to the rate the customer was quoted (a books-path change, not in this lane's scope). The
marketing "visit" (a visitor-day from the daily token) is not a browser session; Halli may want
the beacon to carry a real session id before the channel split is used for decisions.
