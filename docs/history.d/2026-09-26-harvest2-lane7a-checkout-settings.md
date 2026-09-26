<a id="harvest2-lane7a-2026-09-26"></a>
## 2026-09-26 — Harvest 2, lane 7a: checkout settings (pause, minimum, fields, delivery price, owner alert) and the time-limited site announcement

Lane 7a of Harvest 2 (generic icelandicstore work up to `ice@941cf51d`; Halli approved the scope on
2026-09-26). Branch `harvest2/lane7a-checkout-settings`. Two ice features: #151 (`444bcc93`), the
checkout settings screen, and #200 (`7196533a`), the time-limited announcement. Code carries
"Ported from icelandicstore #NNN" where it was ported. **No migration**: every setting lives in
`app_settings` (047) through `server/models/Setting.js`. ENHANCEMENTS #30.

**What shipped.**

1. **Checkout settings — Admin → Greiðsla** (`/admin/checkout`, view `checkout`, owned by the `shop`
   module, hidden here with the retail surface; `AdminCheckoutSettingsView`,
   `adminCheckoutSettingsController/Routes`, CSS `admin-checkout-settings.css`). Settings groups in
   `Setting.js`: `checkout.*` (pause + per-language message, minimum order value in ISK, the owner
   alert list, four field rules) and `shipping.*` (flat rate, free-over threshold). The read side
   coerces a hand-edited row back to its default; the write side is strict (an amount is a JSON
   number or a digits-only string — `null`, `''` and `false` are refused, not read as 0). A save
   validates every group before any write and writes them in ONE transaction
   (`Setting.applyWrites`), so a bad shipping price cannot leave the pause saved. The page PATCHes
   only the changed keys, so an untouched delivery price keeps following the env fallback.
2. **Enforcement** — `server/services/checkoutRules.js`, called by the one order-create path
   (`shopController.createCheckoutSession`), in this order:
   - the **pause** first — before the Stripe-configured check, before body validation, before any
     order row: 503 `{ error, code, reason: 'ORDERING_PAUSED' }`, the admin's message for the
     request's language, else `errors.shop.orderingPaused`. The webhook is not paused: a payment
     already under way completes;
   - the **field rules**: phone (on the shipping address, so only asked for a shipped order; hidden
     clears it off the stored address), company, kennitala (10 digits and the check digit), note
     (hidden = never written). Required and missing → 400 `FIELD_REQUIRED`; invalid → 400
     `FIELD_INVALID`;
   - the **minimum** on the DB-trusted subtotal AFTER the order discount (the brief; ice uses the
     pre-discount subtotal), measured in ISK whatever the charge currency — a EUR basket by the same
     lines' ISK prices, scaled by the discount share, so the currency is no way around it. 400
     `MIN_ORDER_VALUE` with `params.amount`.
   `tests/unit/checkoutRulesCoverage.test.js` pins the order and fails when a second caller of
   `Order.createWithItems` appears without the three calls. ice's second path (the wholesale
   invoice submit) does not exist in the engine.
3. **The delivery price, one rule in two places.** `server/config/shipping.js` gained a pure
   `computeShippingPrice` and the settings-backed `shippingRates()`; the order total uses them and
   `/shop/config` hands the same rates to the client twin `public/js/utils/shipping.js`
   (`tests/unit/shippingParity.test.js` runs both over a grid). Pickup is free; a flat-rate order at
   or above `free_over_isk` (0 = off) is free, measured on the ISK basket before discounts (the
   discount engine needs the shipping first). `shipping.flat_rate_isk` defaults to
   `SHIPPING_FLAT_RATE_ISK` (2500), so an existing instance charges exactly what it did until an
   admin saves; EUR stays `SHIPPING_FLAT_RATE_EUR`.
4. **The owner's paid-order alert** — `shopController.alertOwnerOfPaidOrder`, called where the order
   BECOMES paid (after the committed transition in `handleCheckoutCompleted`), in its own catch-all;
   the recipient and order reads are local, the SEND is not awaited, so a failing or stalled mail
   endpoint can neither fail nor delay the webhook's 200 (tested with a rejecting and a
   never-settling sender). Recipients: the admin list (at most 5, lower-cased, de-duplicated), else
   `ORDER_NOTIFY_EMAIL`, else none. The sender is a small separate function,
   `emailService.sendOrderOwnerAlert` (Icelandic, the owner's language), added on its own export
   line so lane 2's edits to that file stay apart; it goes through `deliver()`, so EMAIL_ALLOWLIST
   and the demo instance's no-send rule hold. The list never reaches `/shop/config`.
5. **Storefront** — `/shop/config` now carries `checkout: { ordering_paused,
   ordering_paused_message, min_order_value_isk, fields }` and `shipping.free_over_isk`.
   `public/js/utils/checkoutSettings.js` turns it into what to show: the cart and the checkout show
   the pause (the admin's message, else the default) and the minimum ("add N kr.") and disable
   checkout; the cart shows the free-delivery line; the checkout renders only the fields the admin
   shows (hidden = not rendered; required = `required` + the label without "(valfrjálst)"), checks
   a kennitala's shape before submit and prices delivery by the twin. UX only.
6. **Site announcement — Admin → Tilkynning** (`/admin/announcement`, view `announcement`, core;
   `AdminAnnouncementView`, `adminAnnouncementController/Routes`). On/off, start and end as
   `YYYY-MM-DDTHH:mm` (a `datetime-local` input), IS + EN heading and message, an optional in-site
   link (path + per-language label). Validation: a real date-time, start before end (checked
   against the stored side too), a heading in some language to switch it on, the link a path on
   this site (no scheme, no `//`, no backslash). The API field is `message`, not ice's `body`:
   `sanitizeBody` treats a key named `body` as rich text and passes a nested `{ en, is }` through
   UNSTRIPPED — the name would have skipped tag-stripping.
7. **The window** — `server/utils/announcementWindow.js` (pure): live iff switched on AND start
   <= now < end — half-open (ice: dates, inclusive), wall-clock Reykjavík time converted through
   Intl (so it stays right in a DST zone), a blank bound open, a bound that does not parse FAILS
   CLOSED (ice widened it). `publicAnnouncement()` is the one answer: outside the window, or with no
   heading, exactly `{ active: false }`; live, the copy, the link and an `id` (a hash of the window
   and the wording). `GET /api/v1/announcement` (`announcementRoutes/Controller`, own mount — ice
   rode `/shop/config`, but the announcement is site-wide and the shop is a module) serves it with
   `Cache-Control: no-store` and never errors. The admin's "live now" chip is the same function.
8. **`components/CutoverNotice.js`** (ice's name) — signed-out visitors only, torn down on sign-in.
   First visit: the kit's `.modal-overlay/.modal` as `role=dialog aria-modal`, labelled and
   described, focus trapped by a new small kit util `public/js/utils/focusTrap.js` (Tab wraps,
   escaped focus is pulled back, release returns focus), closed by Esc / the backdrop / ✕ / "Loka".
   Closing demotes it to a slim banner above the nav with "Lesa meira" (reopens the dialog) and ✕
   (hides it). Following the link acknowledges both. The state lives in `localStorage`
   `site_announcement` keyed on the `id`, every access in try/catch, so a changed announcement shows
   again. **No layout shift**: the dialog is an overlay; the banner is a fixed 40 px, one line with
   an ellipsis, and on a return visit its slot is reserved synchronously in `main.js` in the same
   frame as the nav (`reserveSlot`), before the fetch. Tokens only (`site-announcement.css`).

**Tests.** Jest integration: `checkoutSettings.test.js` (43 — auth incl. a role with/without the
view, CSRF outside test mode, 17 validation cases, all-or-nothing, `/shop/config` never leaking the
list; enforcement verified by reading the `orders` rows back: pause 503 with no row and before any
other check, per-locale message, minimum before/after discount and in EUR, shipping env fallback /
saved rate / threshold / pickup / EUR, each field rule, the webhook alert with a failing and a
hanging sender) and `siteAnnouncement.test.js` (26 — auth, validation, CSRF, all-or-nothing, tag
stripping, the public endpoint withholding off / future / ended / unparseable). Unit:
`announcementWindow` (edges, DST zone, fail-closed, `publicAnnouncement`), `shippingParity`,
`checkoutRulesCoverage`, `checkoutSettings.client`. e2e: `site-announcement.spec.js` (4) and
`checkout-settings.spec.js` (3), both STUBBING their endpoint with `page.route` — the e2e database is
shared by four workers, and a real armed announcement or paused shop would sit on every other spec.

**DRAFT strings (Halli approves).** All EN + IS, new in this lane, drafted natively in Icelandic:
`admin.nav.checkout` (Greiðsla), `admin.nav.announcement` (Tilkynning), every `adminCheckout.*` and
`adminAnnouncement.*` key, `announcement.readMore` / `.close` / `.hide` / `.region`,
`cart.orderingPausedDefault`, `cart.checkoutPaused`, `cart.minOrderNotice`, `cart.checkoutBelowMin`,
`cart.freeShippingOver`, `cart.freeShippingReached`, `checkout.buyer`, `checkout.company`,
`checkout.companyOptional`, `checkout.kennitala`, `checkout.kennitalaOptional`,
`checkout.kennitalaInvalid`, `checkout.noteLabelRequired`; server `errors.shop.orderingPaused`,
`.minOrderValue`, `.phoneRequired`, `.companyRequired`, `.companyTooLong`, `.kennitalaRequired`,
`.kennitalaInvalid`, `.noteRequired`, and `email.orderAlert.subject` / `.heading` / `.body`.

**Deliberately not taken / different from ice.** The invoice submit path and its write-backs of
company/kennitala onto the account (no such path or columns); the address-line-2 rule, the sign-in
note, the order-flow card; the notify address on contact enquiries (`LEAD_NOTIFY_EMAIL` does that
here); ice's fixed password-reset / sign-up CTAs (an admin-set link instead); the suite-wide
pre-seeded dismissal keys in `playwright.config.js` (stubs instead).

**Open / owed.**
- **The pause status (Halli):** 503 per the brief. ice answers 403 on purpose — `docs/SLO.md`
  counts only 5xx against the error budget, so an intentional pause with customers trying to buy
  burns it. One constant: `checkoutRules.ORDERING_PAUSED_STATUS`.
- **Company and kennitala are validated but not stored** — `orders` has no column for either and
  this lane adds no migration. Owed: an expand migration (`orders.buyer_company`,
  `orders.buyer_kennitala`, staff-only like `notes`, out of `Order`'s `COLUMNS`), the write in
  `Order.createWithItems` (lane 5 is in that function now), the admin order page and the owner
  alert. The admin page says so next to both rules.
- A kennitala's 10th (century) digit is not checked — same rule as the rest of the engine
  (`Setting.isValidKennitala`).
- The customer receipt in the webhook is still awaited (pre-existing); only the new owner alert is
  detached.
