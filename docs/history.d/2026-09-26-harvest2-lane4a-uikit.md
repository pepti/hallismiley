<a id="harvest2-lane4a-2026-09-26"></a>
## 2026-09-26 — Harvest 2, lane 4a: the admin UI kit (Combobox, downloadBlob, keyboard-reachable tables, drag-time file checks, tab titles, dates, theme contrast)

Lane 4a of Harvest 2 (generic icelandicstore work up to `ice@941cf51d`; Halli approved the scope on
2026-09-26). Branch `harvest2/lane4a-uikit`. Seven items from the ice admin kit, each ported into the
engine's own kit (domain 2) and, for the contrast test, the theme engine (domain 4). Code carries a
"Ported from icelandicstore #NNN" comment where it was ported.

**What shipped.**
1. **Combobox** (`public/js/components/Combobox.js`, ice #194, #264, #269, #351, #398): the file as
   ice ships it. It is a free-text input with a searchable listbox, with arrow keys and
   `aria-activedescendant`. Sources can be async, with `debounceMs`/`minQuery`; entries can carry a
   `meta` note and hidden `keywords`. Its unit test was ported too, plus keyword tests the engine
   depends on. The CSS went into `admin-kit.css` on tokens only: an elevated surface, `--border`,
   `--shadow-modal`, `--bg-hover` with no literal fallback, and the matched run in `--accent-ink`
   (ice used `--gold`, which is decorative on Bjart). Three users:
   - **AdminExpensesView**: the supplier field, which was a native `<datalist>`. The kennitala is
     shown as `meta` and is also a hidden keyword.
   - **PartyAdminView**: the assignee inputs, which were a `<datalist>`. These inputs re-render on
     every mutation, so the combobox is attached lazily on first focus. Disconnected ones are
     detached when the next one attaches. The view gained a `destroy()`. An Enter that the combobox
     already handled (`defaultPrevented`) no longer adds the chip twice.
   - **AdminRolesView**: the member search, which was a hand-built div of chips. The server search
     is now the combobox's async source (`debounceMs` 250, `minQuery` 1). Username and email ride
     along as keywords, because the server matches on them and the client re-rank would otherwise
     drop an email-only hit. Picking a person puts ONE draggable chip in the panel, which is dropped
     on a role column as before. "No results" and errors still show in the panel.
2. **`downloadBlob(filename, blob)`** (`utils/downloadCsv.js`, ice #325): revokes the object URL
   after 30 s. The engine used to revoke it synchronously, and Safari and older Firefox cancel the
   download when that happens. `downloadCsv` and the orders .xlsx export use it; the export had its
   own 4 s copy. The `PLAIN_NUMBER` guard is unchanged.
3. **`.form-input[readonly]`** (`components.css`, ice #416 c05ce2b, the CSS half): `--bg-hover`
   background, `--text-secondary` text, still selectable. Engine users today: the one-time
   credentials panel and the customer invite link.
4. **Keyboard-reachable wide tables** (`utils/stickyHScroll.js`, the pattern of ice #279 39fe3d5).
   While the wrap actually overflows it gets `tabindex="0"`, `role="region"` and an aria-label, and
   loses them when it no longer overflows. It is re-measured by the ResizeObserver, on window
   resize, and on `visibilitychange` (a tab that is not painting delivers no observer callbacks).
   Attributes the wrap had before attach are never touched, and `detach()` removes only what it
   added. There is a focus ring in `admin-shell.css`. The orders list passes its page title as the
   label.
5. **Drag-time file check** (ice #193): a new kit util, `utils/dragFiles.js` (`dragHasFiles`,
   `dragHasUsableFile(dt, mime)`). The check is MIME-only, because the spec hides file names until
   the drop. An untyped item, or a browser that exposes no items, is let through, and the drop
   re-checks. The product-image drop zone (`AdminProductsView`) marks `.is-dragreject` (an
   `--error` outline on an `--error-dim` wash, in `admin-products.css`) and sets `dropEffect`
   `'none'`. `preventDefault` still runs, so the browser never navigates to the file. **The product
   import has no drop zone** (file input only), so nothing to apply there.
6. **Tab titles and dates** (ice #324, 8e977ae):
   - `pageTitle.adminPageTitle(label, locale)` puts the subject first, then the shared /admin title.
     Three views set `view.documentTitle` through it: order detail (the order number; new key
     `adminOrders.documentTitle`), account detail (the name, re-set after a rename) and invoice
     detail (the invoice or receipt number, reusing `adminBooks.invoiceNo`/`receiptNo`). The invoice
     view's `render()` does not await its load, so it also sets `document.title` once the
     generation check passes.
   - Raw `toLocale*()` date calls were swept onto `formatDate`/`formatDateTime` in 17 files. These
     are the admin views listed in the lane brief plus `AdminSidebar` (the build stamp), `ToastLog`
     (time of day, `hourCycle: 'h23'`), `ArticleView`, `NewsView` and `HomeView`.
     `AdminCustomersView`'s spent column uses `formatMoney` instead of `toLocaleString('is-IS')`.
   - **`AdminUsersView.js:22` is left for lane 1b**, which owns that file. It is on the `PENDING`
     list of the new guard in `tests/unit/adminPageTitle.client.test.js`, which fails on any other
     raw `toLocale*` call under `public/js`.
7. **Theme contrast test** (ice #313 219d33e, #324 8e977ae):
   - `tests/themeTokens.js` reads `variables.css` and `themes.css` the way the cascade does,
     resolves `var()`, composites alpha and computes WCAG contrast. The theme set comes from
     `identity.theme` (root and picker), not a literal.
   - `tests/unit/themeTokenContrast.test.js` asserts these pairs on every theme:
     - ≥ 4.5:1: text-primary, text-secondary and text-muted on base, surface, elevated and hover;
       accent-ink on the same four; `.btn--primary`'s `--on-accent` label on `--gold`, on every
       `--accent-gradient` stop and on its hover fill.
     - ≥ 3:1: focus rings and state borders (`--text-primary`, `--gold`, `--accent-ink`) on every
       surface, and the drop zone's `--error` outline on its wash.
   - Rule-tie tests pin the Combobox, readonly and drop-zone rules to the measured tokens.

**Contrast failures found, and the fixes** (no threshold lowered):
- **Glóð `--text-muted` #9A8B78 was 4.24:1 on `--bg-hover`** (#332A22), which is muted text in a
  hovered row or a combobox option. It was re-hued to **#A3927E**: 6.05 on base, 5.64 on surface,
  4.66 on hover. Only the value changed.
- **Bjart `.btn--primary:hover` filled with `--gold-light`** (#9C7149, 4.31:1 under a white label).
  The token value was not changed, because CLAUDE.md's palette rule pins #7B5533/#9C7149/#4F3722 as
  the Bjart ramp. Instead the hover fill is now `--accent-hover`, the contract token that exists for
  this (`.lol-nav__cta:hover` already used it). On Glóð and Miðnætti `--accent-hover` is
  `--gold-light`, so only Bjart's hover changes: it darkens to #4F3722 (11.0:1).

**Measured, not fixed, and needs Halli:**
- **The resting `.form-input` border (`--border-dim`) is under WCAG 1.4.11's 3:1** on every theme:
  1.24 on Bjart, 1.51 on Glóð and 2.80 on Miðnætti, on `--bg-surface`. `--border` is not far off
  (1.50 and 2.18). Lifting either one re-hues every hairline on the site, so it is a design
  decision, not a contrast fix. It is a `test.todo` in the contrast test and an open item in
  PLAN.md. The options are a darker `--border-dim`, or a separate control-border token used only by
  inputs, which adds machinery.
- **The same `--gold-light` hover fill under a `--bg-nav` label** appears in lane-4b-owned files:
  `contact.css` (`.availability__save-btn`, `.contact-view__edit-btn`, `.contact-view__save-btn`)
  and `shop.css` (`.shop-view__edit-btn`, `.shop-view__save-btn`). These are admin inline-edit
  buttons on hidden or public surfaces, and they still use the pre-contract `color: var(--bg-nav)`
  on a fill. They were left alone per the lane split. The follow-up is to move them to
  `--on-accent` on `--accent-hover`.

**New strings (DRAFT, awaiting Halli's approval):**

| Key | IS | EN |
|---|---|---|
| `adminKit.scrollRegion` | Tafla, flettist til hliðar | Table, scrolls sideways |
| `adminOrders.documentTitle` | Pöntun {number} | Order {number} |

**Tests.** Unit suite: 117 suites, 2062 passed, 1 todo. New or extended unit tests:
- new: `combobox.client.test.js` (21), `stickyHScroll.client.test.js` (8),
  `dragFiles.client.test.js` (8), `adminPageTitle.client.test.js` (6),
  `themeTokenContrast.test.js` (35 + 1 todo);
- extended: `csvClientParity.test.js` (+3 for `downloadBlob`).

E2E, on `E2E_PORT=3021`:
- new: `e2e/admin-combobox.spec.js` (3). It covers the roles search listbox, the keyboard pick
  leaving one chip, a keyword (email) match with Escape, and the expense supplier `<datalist>` being
  gone.
- the related specs passed, 50 tests: `accounts`, `admin-monitoring`, `admin-updates`,
  `admin-feedback-switch`, `sales-handbook`, `admin-list-kit`, `admin-product-group`, `lazy-views`
  and `admin`.

A throwaway screenshot pass checked the roles search and the expense supplier at 375px on all three
themes: no horizontal scroll, and the list is legible on each.

**Trimmed from the ice commits.** ice's `adminPageTitle` users that the engine does not have (the
product-duplicates and merge views). ice's six-theme expectations and its `.imp-tab`, `.mg-tab` and
`.un-secret` pairs (ice-only surfaces). The server half of c05ce2b (company access hardening, ice
customer model). The Invoice Merger and order-builder users of Combobox and of the drop check.
