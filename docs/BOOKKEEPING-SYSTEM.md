# Bókhald — the books

A double-entry accounting system for an Icelandic business, built into this application.
It replaces an earlier "bookkeeping" section that displayed financial-looking numbers
without a ledger underneath them.

This document is for whoever maintains it — including a future Claude session. It explains
what the design is, and more usefully **why**, because most of the decisions here look
like over-engineering until you know which specific way of being wrong they prevent.

- [The one idea](#the-one-idea)
- [Layout](#layout)
- [The ledger](#the-ledger)
- [The law, as code](#the-law-as-code)
- [Money](#money)
- [VAT](#vat)
- [The areas](#the-areas)
- [Security model](#security-model)
- [Running it](#running-it)
- [Things that will bite you](#things-that-will-bite-you)
- [What is deliberately not here](#what-is-deliberately-not-here)

---

## The one idea

**Every figure the system reports is derived from posted journal lines.**

There is no second set of totals anywhere. The VSK return, the profit and loss, the
balance sheet, the aging report and the day's takings all read the same rows. That is why
they cannot disagree with each other — not by convention, but because there is nothing
else to read.

The corollary is that everything which moves money has to post to the ledger, and posting
is enforced to be balanced by a database trigger rather than by the code that calls it.
When you add a feature to this module, the question to answer first is "what does this post,
and does it balance".

---

## Layout

```
server/services/bookkeeping/
  ledgerService.js         posting, reversal, gapless counters, fiscal periods
  invoiceService.js        invoices, payments, refunds, credit notes
  expenseService.js        purchases, input-VAT assessment, duplicate detection
  vatService.js            RSK 10.01 derivation, preflight, filing, period locking
  reconciliationService.js bank CSV import, Stripe sync, matching
  reportService.js         journal, trial balance, P&L, balance sheet, account ledger
  payrollService.js        payslips, runs, the refusal to guess at rates
  posService.js            counter sales
  documentService.js       fylgiskjöl — upload, checksum, private storage
  auditLog.js              who did what (closed action vocabulary)
  intakeService.js         the capture spine: proposals in, createExpense() out (096)
  intakeShape.js           the intake row's validated shape
  replay.js, replayCase.js the replay benchmark (books:replay) and its case format
  peppol/                  UBL 2.1 / BIS 3.0 emitter (095): ublInvoice, party, vatCategory,
                           identifiers, conformance, xml, index

server/models/Commission.js                        seller commission on service invoices (098/102)
server/controllers/adminBookkeepingController.js   the whole HTTP surface
server/routes/adminBookkeepingRoutes.js            gating
server/services/bookkeepingPdf.js                  invoice, receipt and payslip PDFs
server/scripts/books-fetch-fx.js                   exchange rates
server/scripts/books-archive-export.js             the 7-year archive (see gr. 20)
server/scripts/books-backfill-orders.js            issue invoices for historical paid orders
server/scripts/books-replay.js                     replay a recorded period into a *_replay DB
server/scripts/seed-books-demo.js                  demo data for a software business

public/js/views/AdminBooksView.js         overview
public/js/views/AdminInvoicesView.js      + AdminInvoiceDetailView
public/js/views/AdminExpensesView.js
public/js/views/AdminARView.js            + AdminStatementView
public/js/views/AdminVatView.js
public/js/views/AdminBankView.js
public/js/views/AdminLedgerView.js
public/js/views/AdminPayrollView.js
public/js/views/AdminPosView.js
public/js/views/AdminBooksSettingsView.js  /admin/books/settings — seller identity, chart confirmation, FX
public/js/views/AdminCommissionView.js    /admin/commission — statements, payouts (view id commission)
public/js/views/booksShared.js            isk(), status pills, readiness banner
```

Schema lives in `server/config/schema.js` — migrations **072** (foundation), 073
(expenses), 074 (product VAT rate), 075 (reconciliation), 076 (payroll lifecycle), 077
(counter sales), 078 (payroll integrity triggers), 079 (POS idempotency), **095**
(structured party block + `invoice_ubl_exports`), **096** (capture spine: `source_kind`
+ `books_intake`), 099 (`invoices.account_id` / `service_kind` / `service_period` +
the double-issue indexes), **100** (buyer party from `customer_accounts`, the 072 guard
widened to the new columns), **101** (`2150 Fyrirframinnheimtar tekjur`: the build
deposit as deferred revenue, released on the final half), **103** (vehicle accounts,
2026-09-13 from the base's 085 — 6600 stays the deductible commercial-vehicle account, new
blocked `6610 Rekstur fólksbifreiða`; the chart is corrected by migration, never by editing
072), plus the commission ledger in 098 and 102 (`commission_events`, statements,
payouts, clawback). The `.sql` files under
`server/migrations/` are generated mirrors for human reading; **schema.js wins** if
they ever disagree.

---

## The ledger

Two tables. `journal_entries` is the event; `journal_lines` are its legs.

```
journal_entries   entry_number (gapless), entry_date, memo, source_type, source_id,
                  document_id, reverses_entry_id, is_correction, posted_at, created_by
journal_lines     entry_id, account_id, debit, credit, memo, vat_rate, sort_order
```

`ledger_accounts` is the chart: code, name, type (asset/liability/equity/revenue/expense),
`vat_code`, `input_vat_blocked` (TRUE on 6610 fólksbifreiðar, 6900 risna and 6910 fæði —
the statutory input-VAT exclusions, refused with a reason on the expense), `is_active`.

### Posting

`ledgerService.postEntry(client, { entryDate, memo, sourceType, sourceId, createdBy, lines })`
where each line is `{ accountCode, debit | credit, memo?, vatRate? }`.

An entry is built as a **draft** and then flipped to posted once its lines exist. Two
reasons, in order of importance:

1. It lets the database refuse line INSERTs into a posted entry outright. If entries were
   born posted, that guard would have to allow appends — and posted history could then be
   rewritten by adding a balanced pair of lines.
2. The gapless counter is consumed at the very end, so the row lock it takes is held for
   the shortest possible time.

The same draft-then-flip applies to invoices and receipts, for the same reason.

### Reversal

`reverseEntry(client, entryId, { createdBy, reason })` posts a mirror entry and returns
`{ reversal, original_period, reversed_entry_number }` — note the shape, it is a wrapper,
not the entry. The reversal is dated **today**, not back on the original date, because
back-dating into a period that may already have been filed is how a filed VSK return
silently stops matching the ledger. When the reversal lands in a different period it is
flagged `is_correction`.

### Counters

`nextCounter(client, name)` for `invoice`, `receipt`, `credit_note`, `journal_entry`. It
must be called inside a transaction: the UPDATE takes a row lock held until COMMIT, so a
rollback returns the number and concurrent callers queue rather than collide. Keep the work
after that call short — every round trip made while holding the lock serialises all
document creation.

---

## The law, as code

Each of these is enforced by a trigger or a constraint, not by a comment asking developers
to be careful.

| Requirement | Where it lives |
|---|---|
| Reglugerð 505/2013 gr. 8 — an identifiable person behind every entry | `created_by` NOT NULL with ON DELETE RESTRICT, plus `books_audit_log` |
| gr. 9 — posted entries are append-only | `books_forbid_posted_entry_mutation`, `books_forbid_posted_line_mutation`, `books_forbid_line_insert_into_posted`, `books_protect_issued_invoice` (extended by migration 100 to the structured party columns), `books_protect_issued_invoice_line`, `books_forbid_invoice_line_insert_into_issued`, `books_protect_expense`, `books_protect_document`, `books_protect_payroll_run`, `books_protect_payslip`, `books_protect_payroll_rates`; `books_forbid_any_mutation` on the commission statement tables (102) |
| gr. 14 — áreiðanleiki (reliability) of stored documents | SHA-256 on every upload, re-verified on every read and on every archive export |
| gr. 16 — a gapless number series per document type | `bookkeeping_counters` under a row lock |
| Reglugerð 50/1993 — what a sales document must show | snapshotted onto the invoice row at issue, and printed from that row, so a reprint years later reproduces the document as issued |
| Bókhaldslög 145/1994 gr. 10a — books kept in ISK | BIGINT everywhere; foreign currency converted at a captured rate that is stored |
| gr. 20 — seven years, retained in Iceland | `books-archive-export.js`. **Azure has no Iceland region**, so the archive is the only route |

Two properties worth stating outright because they constrain everything else:

- **Nothing posted can be edited or deleted.** A correction is a reversal or a credit note.
  If you find yourself wanting an UPDATE on posted history, the design answer is a new
  entry.
- **A user who has posted anything cannot be deleted.** That is `ON DELETE RESTRICT` doing
  its job, and it will surprise you the first time you try to clean up a test account.

---

## Money

Whole ISK, as BIGINT, everywhere. There is no minor unit and no float in the money path.

`pg` returns BIGINT as a **string**, so every read path coerces with `Number()`. When you
add a query, coerce.

Rates (VAT, pension, tryggingagjald) are decimals in the database and converted to
**integer basis points** once on load — 6.35% becomes 635. Payroll then does integer
arithmetic throughout. The reason is concrete: `0.0635 * 613000` is
`38925.499999999996`, and a payroll out by one króna per employee per month is a payroll
that does not reconcile against what the bank actually paid.

Foreign currency: `utils/fx.js`. An EUR invoice captures the rate at issue, stores it on
the row, and books ISK. `npm run books:fx` maintains `fx_rates` — manually, from a file, or
from a feed URL you supply. There is deliberately **no default feed URL**: the Central
Bank's public page is JavaScript-rendered and its API needs credentials, so shipping a URL
that silently 404s would leave the books quietly running on a stale rate.

---

## VAT

`utils/vat.js`. Rates are 0, 11 and 24 — a closed set, and `resolveVatRate()` refuses
anything else rather than normalising it. A product row carrying a rate outside the set
should stop an invoice, not be quietly rounded to the nearest legal one.

**Shop prices are VAT-inclusive.** This is the single most consequential fact in the
module. `splitVatInclusive(gross, rate)` extracts the VAT (`gross × rate / (100 + rate)`);
`addVat(net, rate)` is used only for reverse-charge self-assessment, where the foreign
supplier's invoice IS the net figure.

The system this replaced treated the shelf price as net and added VAT on top, which
overstated revenue and takings and made the till never reconcile against the drawer.

Per-rate totals survive all the way from the line to the return, because RSK 10.01 wants
box A (24%) and box B (11%) separately. A single blended rate loses that.

### The VSK return

`vatService.deriveReturn(period)` reads posted journal lines and buckets them by each
account's `vat_code`. Filing snapshots the figures and locks the period.

One predicate is load-bearing enough to name here — the settlement entry and its
reversals are excluded from the derivation, or filing would change the figure it was
derived from:

```sql
je.source_type <> 'vat_settlement'
AND (je.reverses_entry_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM journal_entries orig
   WHERE orig.id = je.reverses_entry_id AND orig.source_type = 'vat_settlement'))
```

Unlocking a filed period does three things in this order: unlock first, reverse the
settlement **on its own date**, then delete the snapshot. Any other order leaves an
orphaned settlement entry or a locked period that cannot be written to.

---

## The areas

Each area is a view id, a service, a screen, and a set of postings.

### Invoices

Issued from a paid order, or standalone. Snapshots seller and customer detail at issue.
Payments, refunds and credit notes are separate facts:

- a **payment** is cash in,
- a **refund** is cash out,
- a **credit note** reverses the SALE and the output VAT.

A chargeback is a refund with no credit note; a goodwill credit is a credit note with no
refund. They are separate endpoints because they are separate events.

Payment idempotency is by an explicit caller-supplied key **scoped to the invoice**. Reusing
a key on a different invoice is a 409, not a cheerful no-op — the earlier system's
time-window dedupe over the caller's own clock silently swallowed the second of two
genuine identical transfers.

### Expenses

The input-VAT side. `assessVat()` decides deductibility and records a **reason** when it
refuses: a blocked account, no supplier VSK number, an exempt code. A receipt-less purchase
is still recorded, at its full gross, marked non-deductible — nothing is dropped for being
awkward.

Fylgiskjöl (`documentService`) are stored outside the statically-served tree, under
`BOOKS_UPLOAD_ROOT`, with a SHA-256 verified on every read. The only way to fetch one is
the authenticated route.

### Receivables

Aging and per-customer statements, derived from invoices and their settlements.

**A note on PII, since it is an accepted decision rather than an oversight:** the `ar` and
`expenses` view ids carry sight of customer and supplier detail respectively. Granting one
grants that. The owner has accepted this explicitly.

### VSK returns

Derivation, preflight (blockers and warnings), filing, locking, unlocking with a reason.
Blockers can be overridden, because a system that cannot be overridden gets worked around —
but the override reason is stored with the return, so "why was this filed with three
warnings outstanding" is answerable.

### Bank and Stripe reconciliation

CSV import that copes with what a locale-aware Icelandic Excel actually writes: semicolons,
`dd.mm.yyyy`, decimal commas, a UTF-8 BOM. Matching is **suggested, never automatic** — a
wrongly auto-matched line looks reconciled and stops being investigated, which is worse
than one still needing attention.

Card money sits in `1400` (acquirer clearing) until the payout sweeps it to `1900`. Debiting
the bank at checkout — which the earlier system did — makes both figures wrong and
reconciliation impossible.

### Ledger and reports

Journal, trial balance, P&L, balance sheet, per-account ledger with a running balance, plus
manual entries and an accountant pack.

**Retained earnings are derived**, not posted: there is no year-end closing entry, so the
accumulated profit is computed as revenue less expenses to date. That is what makes the
balance sheet balance without a close, and it guarantees the sheet and the P&L can never
drift apart. A test asserts exactly that.

### Payroll

The area most worth reading the source of. It **refuses to compute a payslip for a tax year
nobody has confirmed**, has no fallback rates and no "last known good" year. That refusal is
the feature.

Three traps it guards explicitly, each of which produces a believable wrong number:

1. **Pension comes off before tax.** The taxable base is not the gross.
2. **Bands are sliced, not selected.** The top rate applies to the top slice only.
3. **Band rates are the COMBINED figure** (tekjuskattur + útsvar) as published.
   `municipal_rate` is reference only; adding it again double-counts útsvar.
   `upsertRates()` refuses a band at or below the municipal rate, because that is the
   fingerprint of tekjuskattur-only figures having been typed in.

Band tables can be stored either way round — `{from, rate}` or `{upTo, rate}` (how
Skatturinn prints it). `normaliseBands()` accepts both, refuses a table that mixes them,
and **refuses a band that says neither** rather than defaulting to zero. That default is
what once collapsed the seeded 2026 bands so every one started at zero.

Wages payable (`2350`) is credited, never the bank. Paying the employee is a separate event
with its own date; booking them together makes an unpaid salary invisible.

### Counter sales

A till sale is a **receipt-series row in `invoices`** — the same sales ledger, with its own
gapless counter. Not a separate table, deliberately: two sales ledgers would have to be
added together to answer "what did we sell", and the VSK return would have to read both.

A counter sale does not pass through receivables. The entry debits cash (`1910`) or card
clearing (`1400`) directly, because at a till the sale and the money are one event.

Bank transfer is **refused** as a tender: that is an invoice that happens to be paid
quickly, and it should be one so the transfer can be reconciled against a bank line.

The day's takings are split by tender because that is how a drawer is counted — the cash
figure should equal what is physically there, and the card figure what the acquirer will
settle. One total answers neither question.

### Service invoices and the build deposit (migrations 099 – 101)

`invoiceService.createServiceInvoice()` issues a company's own service documents against a
`customer_accounts` row: the build halves (50 % / 50 %), the recurring month, overage. Two
partial unique indexes (099) make a double issue a 409 rather than a second statutory
document. The buyer party comes from the account (100); the invoice keeps the value **as
at issue**.

The first build half is a **prepayment**, not revenue (101): it is credited to
`2150 Fyrirframinnheimtar tekjur` and released into revenue by a `revenue_recognition`
entry that issuing the final half posts in the same transaction. VSK does **not** wait —
`2150` carries `vat_code = output_24` and `vatService.ADVANCE_TURNOVER_ACCOUNTS` counts it
into reitur A in the period the deposit invoice is dated (l. nr. 50/1988 13. gr.). The
standing invariant: **2150 never goes debit**; crediting a released deposit goes against
the account it was recognised into.

### Commission (migrations 098 and 102)

Not a books area in the RBAC sense (view id `commission`, its own scope in
`server/auth/commissionScope.js`), but it posts nothing and derives everything from the
invoice ledger, so it belongs in the "what does this post" picture: `Commission.recordForInvoice`
snapshots seller and rate per service invoice; payability is an **amount**
(`PAYABLE_NOW_ISK`, netting credit notes and refunds proportionally) rather than a flag;
102 adds seller-month statements over a running balance, payouts and clawback by set-off.
Details: `docs/HISTORY.md` (accounts-commission, review-099, migrations-100-102) and `docs/ACCOUNTANT-QUESTIONS.md` §11.

---

## Security model

Reads are gated by a **grantable view id**; writes that move money or issue a statutory
document are hard `requireRole('admin')` + CSRF.

```
books  invoices  expenses  ar  vat  bank  ledger  payroll  pos
```

The split means a bookkeeper or accountant can be given exactly the areas they need
without being able to issue or credit real documents. `payroll` is its own id because
salary is the most sensitive data in the books: someone can be given the ledger without
being given what each person earns.

`ADMIN_VIEW_IDS` in `server/auth/adminViews.js` must stay 1:1 with `ADMIN_NAV` in
`AdminSidebar.js` — a unit test enforces the parity, because an id with no screen is
ungrantable and a screen with no id is a dead link. The one sanctioned exception is
`PERMISSION_VIEW_IDS` (`allaccounts`): grantable, no sidebar line, subtracted by the test.

Other notes:

- The route file ends with a **catch-all** requiring the `books` view, so a route added
  later outside every declared prefix cannot inherit only `requireAuth`.
- `export.csv` paths are declared **before** any `:id`/`:code` pattern that would swallow
  them.
- PDF, CSV and document routes carry a tighter `docLimiter`, placed **before** the view
  check so refused attempts count against it too (`GET /documents/:id` was the one
  exception until 2026-09-12).
- Every CSV cell goes through formula neutralisation (`utils/csv.js`). Guest checkout names
  and supplier names typed off a paper invoice are attacker-controlled, and an export is a
  real delivery mechanism into a bookkeeper's spreadsheet.
- Validation is stricter than elsewhere in the app on purpose: a bad request must be a 400
  with an explanation, never a Postgres error surfacing as a 500.

---

## Running it

```bash
npm run migrate                          # apply schema changes
npm run seed:books -- --allow-dev-db    # demo data for a software business (local dev DB)
npm run seed:books -- --allow-dev-db --wipe  # ...replacing an earlier demo (refuses if real rows exist)
npm run books:fx -- --date=2026-08-06 --rate=143.20
npm run books:archive -- --out=./archive/2026
npm run books:archive -- --verify-only --out=./archive/2026
npm run books:replay -- --all             # replay recorded periods, diff against the FILED figures
# GET /api/v1/admin/bookkeeping/invoices/:id/ubl.xml — the same issued invoice as a
# Peppol BIS Billing 3.0 (UBL 2.1 / EN 16931) document; see server/services/bookkeeping/peppol/
npm run books:replay -- --case=D:/customer1/2025-P6.json --db=postgresql://…/customer1_replay
```

`seed:books` runs only against a local `_test` database or, with `--allow-dev-db`, the local
dev database — never a `*_books`/ops/prod name or an Azure host (`server/scripts/targetGuard.js`).
Its `--wipe` deletes only the rows the seed created and refuses, deleting nothing, when the
books hold anything else.

`books:replay` drops and recreates its target schema, so it refuses any database whose
name does not end in `_replay`, or that is not on a local host (`createdb orangesmiley_replay` once). Cases live in
`server/fixtures/books-replay/` (this company's own) or outside the repo (a customer's);
the format and the reason the D-split is diffed are in `server/services/bookkeeping/replayCase.js`.

Tests:

```bash
npm test                                            # 4 workers, a database each
npx jest tests/integration/booksReports.test.js     # one suite, still on its own worker DB
```

Since 2026-09-02 the test databases are derived per branch and per Jest worker
(`tests/workerDb.js`: `<product>_<branch>_w<N>_test`, migrated from one template), so
two worktrees never share one and `TEST_DATABASE_URL` is only needed to pin a fixed name —
see `docs/TESTING.md`. The old advice here (a hand-named `hallismiley_books_test` and
`--runInBand`) predates that.

### First run

The books refuse to issue anything until the seller identity is set, and every screen shows
a standing warning until it is — the warning links to `/admin/books/settings`, where all
of it is done. In order:

1. Útgefandi → seller name, kennitala (check-digit validated), VSK number, address.
2. Confirm the chart of accounts. Confirming **requires a note** saying what was reviewed
   and against what, and is stamped with who confirmed — the same rule as the payroll
   year's `source_note`. It clears the `coa_confirmed_at` warning.
3. A rate for every currency you post in, per document date. The dashboard warns per
   currency actually in use (a USD supplier invoice with no USD rate is as loud as EUR).
4. Payroll: enter the year's figures and **confirm** them, if you run payroll.

To run a real VSK period through the books in parallel with the incumbent — the route to
the first filing this module has ever been checked against — see `BOOKS-PARALLEL-RUN.md`.

### E-invoicing (Peppol BIS Billing 3.0), outbound

An issued invoice can be downloaded as a UBL 2.1 / EN 16931 document from the invoice
screen (`GET /invoices/:id/ubl.xml`). Three things to know:

- **It needs the address as parts.** Migration 095 snapshots `seller_street/city/postal_zone/
  country` (from the books settings) and `customer_street/city/postal_zone` (from the order's
  shipping address) onto every invoice at issue. An invoice issued before 095 — or after it
  with the parts unset — is **refused by name** (`SELLER_ADDRESS_INCOMPLETE`,
  `BUYER_ADDRESS_INCOMPLETE`); the printed address is never parsed into a statutory document.
  `peppol_complete` in the settings is separate from `seller_complete` on purpose.
- **11% is category S at 11, not "AA"; a zero-rated export is G with the reason.** The books
  extract VAT per line; EN 16931 wants per-rate `round(taxable × rate)`. The difference
  (a króna or two) is stated as `PayableRoundingAmount` (BT-114), so the document carries the
  rule-conformant VAT and the payable the customer actually owes; more than 3 kr. is refused
  as `VAT_ROUNDING_DRIFT`.
- **Every emission is recorded** in `invoice_ubl_exports` — the exact bytes and their SHA-256,
  append-only — with an `invoice.ubl_exported` audit row, so a receiver's verdict can be tied
  to what was sent. The seller's VSK number is emitted as `IS` + digits (BR-CO-09); whether a
  real BIS 3.0 receiver accepts that for a non-EU number is the open question, behind one
  constant in `peppol/identifiers.js`.

### The capture spine — intake queue and the trust ladder

Migration 096 gives every fylgiskjal a **`source_kind`** — how much it can be trusted, a
different axis from what it is: `peppol` > `embedded_xml` > `extracted` > `manual`. The
ladder may drive how the entry form pre-fills and what the archive says about provenance.
It may **never** drive whether a person is required; `tests/integration/booksIntake.test.js`
has a test named after that.

`books_intake` is a queue of **proposals** (`/admin/books/expenses` → "Í bið"). A row
touches no account and moves no money. The only way out of it and into the ledger is
`expenseService.createExpense()` with the accepting admin as `created_by` — the same call
the manual form makes, in the same transaction, so the duplicate 409, the VAT verdict and
the period lock behave identically. Accepting uses the figures the operator submitted,
never the machine's `suggested` block. The database enforces the gate: an `accepted` row
without an `expense_id` and a `decided_by`, a decided row returned to `pending`, or a
repointed expense link are all refused by CHECK or trigger. There is deliberately **no
confidence score** — a number is the seed of an auto-post threshold.

v1 extracts nothing (an upload is the `manual` rung, whatever a client claims). When
inbound Peppol lands, its parser is a second caller of `intakeService.receive()` with a
real `suggested` block and `source_kind = 'peppol'`, and nothing else changes.
`expenses.supplier_vat_number` (also 096) now keeps the number `assessVat()` decided on.

---

## Things that will bite you

Collected from actually hitting them.

- **`journal_lines.vat_rate` was NULL on every row** for a while, because `postEntry`
  prepared the value and left it out of the INSERT. The VSK return survived (it derives
  from account `vat_code`), which is exactly why nothing failed. Fixed — but the lesson is
  that a column nothing reads is a column nobody notices is empty.
- **Test suites share one append-only journal.** There is no DELETE to reset between them,
  so absolute balance assertions drift as tests are added. Assert **deltas**, or claim a
  private year. Currently claimed: 2017 the replay benchmark, 2018 POS, 2019 reports,
  2020 payroll, 2021–2025 VSK, 2026 the seed.
- **`ledger_accounts.sort`, not `sort_order`.** `sort_order` exists only on `journal_lines`.
- **`payroll_rates.tax_year` is capped at 2020–2100**, so a test year must be inside that
  and (if it records a cash payment) in the past.
- **Never edit an applied migration.** Editing 072 after the dev database had it left the
  dev schema missing a column and the AR page 500'd. Recovering meant dropping ~21 tables
  and deleting rows from `schema_migrations`.
- **`CREATE TABLE IF NOT EXISTS` is a silent no-op.** Migration 076 originally re-declared
  `employees`, which 072 already created; the new columns simply never appeared and the
  service failed against a table that looked right. Check whether a table already exists
  before adding one.
- **`git fetch` before pushing.** A concurrent session pushed eleven commits to this branch
  mid-work, including fixes to code this module owns.
- **`reverseEntry` returns a wrapper**, `{ reversal, ... }` — not the entry.
- **`products.active`, not `is_active`.**
- **Inline `node -e` with Icelandic text, backticks or `$` gets mangled by bash.** Write the
  script to a file and run it.

---

## What is deliberately not here

- **No year-end closing entry.** Retained earnings are derived. See above.
- **No automatic bank matching.** Suggested only.
- **No seeded payroll rates for a future year.** Entering a year's bands from memory would
  put authoritative-looking numbers in the database that nobody has checked.
- **No default FX feed URL.** See above.
- **No opening balances.** Post them as a manual journal entry; see
  [ACCOUNTANT-QUESTIONS.md](ACCOUNTANT-QUESTIONS.md).
- **No depreciation schedule.** Depreciation is a manual entry for now. A fixed-asset
  register is the obvious next thing if it becomes routine.
- **No Iceland-resident live storage.** Azure has no Iceland region; the archive export is
  the compliance route.

Open questions for an accountant — several of which affect real figures — are in
[ACCOUNTANT-QUESTIONS.md](ACCOUNTANT-QUESTIONS.md). The two that matter most are the chart
of accounts and whether services sold to a business abroad are 24% or 0%.
