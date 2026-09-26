<a id="admin-home-idag-2026-09-26"></a>
## 2026-09-26 — "Í dag": the admin home replaces the card overview (D-020 step 4)

D-020 step 4 (rk `PLAN.md` R2b step 4): the owner's first screen is what is
waiting on them today, not seven cards of statistics. Hönnuður's design (spec
`idag-spec.md`, mock `idag-mockup.src.html`, measured on the engine trio
and rk's six themes) and Efnishöfundur's DRÖG labels were ready; this is the
build. It is engine code (`admin-shell`), so it reaches rekstrarkerfid and
the demo instance by engine-sync.

**One endpoint, gated per block.** `GET /api/v1/admin/home`
(`server/routes/adminHomeRoutes.js`, logic in `server/services/adminHome.js`)
replaces the seven calls the overview made. Session + the `dashboard` view,
as the page itself. Behind that gate each block is computed only when the role
holds its view — resolved by the SAME `resolveViews(req)` the guards now share
(`server/auth/requireView.js`), minus a switched-off module's views, minus, for
a `'*'` holder only, the product's `identity.surface.hiddenAdminViews` (the
sidebar's rule, so the home never talks about a surface the admin's nav hides —
on orangesmiley.is that is the shop, the bins and the till). A key the role
cannot see is absent from the JSON. Sources run in one `Promise.allSettled`; a
failing one is logged (pino), its blocks are left out, and the answer is still
200 with `errors: ["figures.vatNext", …]`. A 45 s per-viewer cache (off under
`NODE_ENV=test`); no polling.

**What it computes** (amounts integer ISK, times ISO UTC, no labels):
- `todo` (Bíður þín), only kinds with a count, warn → soon → the rest:
  `invoices_overdue` (ar), `vat_deadline` (vat; the earliest unfiled VSK
  deadline due today or later, from 14 days out, warn at ≤ 3), `orders_to_ship`
  (orders; paid, unfulfilled or partial), `leads_new` (leads),
  `change_requests_open` (feedback), `bins_unshelved` (bins; `Bin.queueCount()`
  — "án hillu", never "received": there is no goods-received record).
- `figures` (Staðan): `salesToday`, `openOrders`, `receivables` (with the
  ageing buckets), `vatNext` (payable from `vatService.deriveReturn`). A new
  instance shows none until its first order, invoice or sale; the VSK figure
  waits for the first posted journal entry.
- `recent` (Nýjast), ≤ 8 newest across paid orders, payments in against
  invoices (paid / part-paid), enquiries, change requests received / resolved.
  Till receipts are aggregated in the sales figure, never listed.
- `setup` (Fyrstu skrefin), admins only, derived, never stored: company
  details (contact email, address, town in Almennt), a first product, the
  invoice seller identity (`seller_complete`), two staff accounts (a customer
  does not count), the viewer's own two-step sign-in. A step exists only when
  the screen it links to does; `null` once all are done. No "hide" in v1.

**Decisions taken in the build** (Halli's brief, 2026-09-26):
- **Sales channels — to confirm with Bókari/Halli**: web = shop orders paid
  today (ISK orders only; the figure is ISK); wholesale = invoices issued today
  that were NOT created from an order; pos = till receipts rung up today. A
  channel the instance has but the role lacks is omitted and the figure is
  `partial`. Compared with the same weekday last week up to the same time.
- **Change requests** have only open/resolved (`ChangeRequest.js`), so the
  to-do is "N opnar breytingarbeiðnir" and the feed says received / resolved.
  "Waiting on you" needs a new state and an expand migration; not built.
- **Verkefni** (`AdminProjectsView`, `/admin/projects`) is a Vefur sidebar line
  with its own `projects` view id (`adminViews.js`, parity test; owned by the
  `projects` module), gated on that view or editor. The sidebar label
  `admin.nav.dashboard` is unchanged — "Í dag" vs "Stjórnborð" is Halli's.
- Two bounds the spec did not state, so an open-orders count cannot only grow:
  "í sendingu" counts orders fulfilled in the last 14 days, "bíður greiðslu"
  pending orders from the last 24 hours (a Stripe Checkout session's life).

**Client.** `public/js/views/AdminView.js` rewritten; `public/css/admin-idag.css`
(new, `idag-*` classes only, tokens only, imported after
`admin-dashboard.css`) is the mock's CSS minus its DRÖG chip. Container
queries on `.idag` choose the layout (two columns ≥ 760px, a 2×2 rail
520–759, one column in reading order below). Bar shares are written through
the CSSOM (`el.style.flexGrow`), never a `style=""` attribute (CSP). Icelandic
weekday and month names are written out (Chrome ships no Icelandic ICU data);
names only ever sit as the subject, after a colon or in quotes; counted strings
go through `plural()`. A moderator with no admin view is forwarded to the
projects board, which the old overview's header linked to.

**Labels (DRÖG, all of them).** From Efnishöfundur's `labels.json`:
the `adminHome.*` keys the page uses, and `admin.nav.projects`. New in the
same style, IS first: `adminHome.asOf`, `partialError`, `waiting.count.*`,
`waiting.tag.overdue` ("Gjaldfallið"), `waiting.latest`,
`waiting.overdue.oldest.*`, `waiting.crOpen.*` ("{n} opin
breytingarbeiðni" / "{n} opnar breytingarbeiðnir" — replacing the label pair
that said "bíður svars"), `waiting.unshelved.more`, `waiting.vat.period`,
`figures.title` ("Staðan"), `figures.asOf`, `figures.salesToday.channel.*`
(Vefverslun / Heildsala / Sölukassi), `.delta`, `.vsLastWeek`, `.lastWeek`,
`.none`, `.partial`, `figures.openOrders.{toShip,shipped,awaitingPayment}`,
`figures.receivables.aging`, `feed.changeRequestReceived`, `time.today`.
Not used (and not added): the `demo.*` keys (another chunk), the greeting pair,
the "bíður svars" pair, the setup hide/hidden/allDone keys, the unused
time/feed variants. The old `adminDashboard.*` keys stay in the locale files
for now.

**Tests.** `tests/integration/adminHome.test.js` (new, 10): the gate (401,
403 without `dashboard`, a moderator refused), an admin's blocks and shapes,
the all-clear instance, a counter role (`dashboard, orders, bins, pos`) that
gets only its blocks — the books and the leads never leave the server —, a
failing source on DATA (a deadline whose period is no VSK period) → 200 +
`errors`, the derived setup steps down to `null`, a customer not counted as
staff, and the sales channels on a fixed clock (today vs a week ago at the same
time, an order-born invoice never wholesale, `partial` for a role vs for an
instance). `e2e/admin-home.spec.js` (new, 5): the blocks the server sent are
the blocks painted, a 390px phone has no sideways scroll, and each theme in the
picker paints the status line and the rail from its own tokens.
`e2e/admin-surface.spec.js` adapted (the home, then the board via its new
sidebar line). No migration.

**Review pass (same day).** Three reviews (Öryggisvörður, invariant-reviewer,
Hönnuður) folded in before merge:
- **Verkefni is hidden on this product** (Halli 2026-09-24: projects hidden for
  now): `projects` joins `identity.surface.hiddenAdminViews`. This repo's
  committed `client.json` must equal the engine defaults (the
  `identityConfig` pin), so the id went into the schema default
  (`clientConfig.js`), the client fallback (`utils/identity.js`) and the pin
  too — every downstream that keeps the default hides the line, which is where
  the board stood before this chunk (unlisted). The view stays live and
  grantable; the specs reach the board by URL where the line is hidden. A
  moderator with no admin view falls back to `/` where the `projects` module
  is off. `features/projects.md` records the view and the gate.
- **Cache** moved to `server/services/adminHomeCache.js`: a pure
  `cacheKey(user, views, disabled, isAdmin)` (unit-tested), an answer with
  `errors` is never stored, and `clearHomeCache()` runs on lead erasure
  (`leadsController.remove`) and the retention job (`leadsCleanup`). The view
  resolution is a pure `homeAccess()` in `adminHome.js`. Sources log the error
  object, not its message.
- **Decision I1** (recorded in ARCHITECTURE §2): the sales figure is gated by
  the channel views (`orders` / `invoices` / `pos`), not the `sales`
  report view.
- **Design** (Hönnuður): the VSK row counts the days in its number column
  ("9" · "dagar í VSK-skil"), puts the amount and the period on the detail
  line and a word in the tag (Á næstunni / Brýnt); at one day, today or past it
  says so in words with an empty number cell. The rail stops being sticky on a
  viewport under 760px tall; a figure label wraps its right half below instead
  of crushing it; the feed's amounts are back in their own column (a part
  payment keeps its amount in the sentence only), its glyphs follow the event
  type; the channel legend shows only when there are sales; relative times are
  lower-case metadata ("fyrir 4 mín."); a figures-only grid spreads the rail
  across the width. New DRÖG keys: `waiting.tag.soon`, `waiting.tag.urgent`,
  `waiting.vat.daysLeft.*`, `waiting.vat.titleToday`, `.titleTomorrow`,
  `.titleOverdue`; changed: `figures.receivables.invoices.*` ("{n} reikningar",
  no "ógreiddir"), `feed.orderPlaced`, `.orderPlacedGuest`, `.invoicePaid` (no
  amount), `time.justNow`, `time.minutesAgo.*`.
- New tests: `tests/unit/adminHomeCache.test.js`; in `adminHome.test.js`, the
  books module switched off (an `ar`/`vat`/`invoices` role gets none of its
  keys) and a wildcard admin on a product that hides orders/bins/pos (none of
  those blocks, `partial: false`).
