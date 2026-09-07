# Running a real VSK period in parallel — the books on a private instance

The ledger has never carried a real filing; `BOOKKEEPING-SYSTEM.md` says so plainly.
The way to change that without betting a statutory return on never-filed code is a
**parallel run**: post the period's real transactions here, derive the return, compare
it with an independently prepared figure, and submit through Skatturinn's own portal.
For that period this system is **not** the book of record — it is being measured
against one. Only after a run ties to the króna does the question of cutting over arise.

This is the procedure. Company-specific values — kennitala, VSK number, the actual
documents, the accountant's figure — live outside the repo, in the operator's own
runbook. Nothing below needs them.

---

## 0. The environment decision

Run the books **locally, `NODE_ENV=development`, bound to localhost, on a database of
their own.** Not the dev database, not production mode.

Why not `NODE_ENV=production` on a laptop: it sets `secure: true` on both the Lucia
session cookie (`server/auth/lucia.js`) and the CSRF cookie (`server/middleware/csrf.js`),
which the browser silently drops over `http://localhost` — login *appears* to succeed
and then does not. It also makes `server/config/paths.js` refuse to boot without
`UPLOAD_ROOT`. Neither buys anything on a machine only you can reach.

Development mode has three consequences that matter here, each with a compensation:

| Consequence | Compensation |
|---|---|
| `npm run seed:books` **will run** (it refuses only under production) and its `--wipe` deletes books rows. It is the single largest risk to the figure. | A separate database that no seed script is ever pointed at. Check 1 in §5 proves it before filing. |
| `BOOKS_UPLOAD_ROOT` defaults to `private-uploads/books` **inside the checkout** — gitignored, therefore deleted by `git clean -xdf`. | Point it outside the repo. These files are the seven-year fylgiskjöl (bókhaldslög 145/1994 gr. 20). |
| The TEST chrome and the change-request widget are on, and write rate-limiters step aside (`server/config/appEnv.js`). | Bind to localhost; never expose this instance. |

`.env` for the books instance:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<company>_books   # its OWN database
ALLOWED_ORIGINS=http://localhost:3000
CSRF_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
NODE_ENV=development
PORT=3000
DB_SSL=false
BOOKS_UPLOAD_ROOT=<a directory OUTSIDE the repo, on a disk you back up>
EMAIL_FROM=<the company's sender address>
```

**Backups.** Until the first archive export exists, this one Postgres database *is* the
company's books. `pg_dump -Fc <db> > <outside-the-repo>/books-YYYY-MM-DD.dump` after every
posting session and **before every filing**, and run one restore drill into a throwaway
`<company>_books_restore` database before the first filing. A backup nobody has read back
is a hope, not a record — the archive script's own words, and they apply here first.

## 1. Stand it up

```bash
createdb <company>_books                 # fresh and empty — do NOT clone the dev DB
npm run migrate
node server/scripts/setup-admin.js <username> <email> <password>
```

(`npm run bootstrap` also works — it upserts an admin from `ADMIN_USERNAME` /
`ADMIN_EMAIL` / `ADMIN_PASSWORD` — but it seeds portfolio content too, which real books
do not need.) **Do not run `npm run seed` or `npm run seed:books`.**

Verify the reference data landed:

```sql
SELECT COUNT(*) FROM ledger_accounts;                          -- the seeded chart
SELECT period FROM fiscal_periods WHERE period = '<YYYY-Pn>';  -- the period you are filing
SELECT kind, period, due_on FROM tax_deadlines WHERE period = '<YYYY-Pn>';
```

Periods are keyed `YYYY-P1`…`YYYY-P6` (two-month VSK windows; `server/utils/vatPeriod.js`).
`ledgerService.ensureFiscalPeriod` creates any missing period on demand.

## 2. Settings — `/admin/books/settings`

Every books screen shows a readiness banner until these are done; the banner links here.

1. **Útgefandi.** Name, kennitala, VSK number, address. The kennitala is check-digit
   validated (modulus 11) — if it is refused, the number is mistyped, not the validator.
   A company kennitala (day + 40) passes the same check. Nothing can be issued until
   `seller_complete` is true.
2. **Bókhaldslykill.** Read the chart in the table, then confirm. Confirming **requires a
   note** saying what was reviewed and against what; it is stamped with who confirmed.
   Write an honest one — say which accounts were reviewed *and which were not*. The
   confirmation is the only mechanism tracking `ACCOUNTANT-QUESTIONS.md` §1.
3. **Gengi.** Only if any document in the period is not in ISK. Enter the Seðlabanki rate
   **for each foreign invoice's own date**: lookups fall back to the most recent *earlier*
   rate, never a later one, and refuse beyond 14 days (`FxRate.forDate`). The dashboard
   warns per currency actually in use — a USD invoice with no USD rate is as loud as EUR.
   CLI alternative: `npm run books:fx -- --date=YYYY-MM-DD --rate=138.90` (`--currency=USD`).

## 3. Opening balances

There is no opening-balance wizard by design; the path is **one manual journal entry** at
`/admin/books/ledger` (memo required, ≥ 2 lines, balanced). For a company that started
inside the period, what exists at day one is share capital paid in:

```
entry_date <incorporation date>   memo "Stofnefnahagur — innborgað hlutafé"
  1900 Bankainnstæða     debit  <capital>
  3100 Hlutafé                  credit <capital>
```

Say this out loud in the operator's runbook: **neither line touches a `vat_code`-bearing
account, so this entry cannot move any RSK 10.01 box.** If the figure or date is disputed,
post it later — it must never delay a filing. The one thing that *is* period-relevant is a
pre-incorporation cost the owner paid personally and is claiming: that is an **expense
dated in the period**, and it does move box E. Ask the accountant.

## 4. Post the period — `/admin/books/expenses`

For each document: **attach the PDF first** (the form uploads it and holds the id), then
submit. Rules that are counter-intuitive and wrong-by-default:

- **Domestic supplier with a VSK number.** Enter the total **VAT-inclusive** (the server
  extracts VAT via `splitVatInclusive`); `vat_code = input_24` (or `input_11`). Fill in the
  **supplier VSK number from the invoice** — leave it blank and `assessVat` refuses the
  deduction with `no_vat_number` and books the gross to cost, a silent 24% loss on box E.
- **Foreign supplier** (SaaS, cloud). Country ≠ `IS`, `vat_code = reverse_charge_24`. Two
  traps: (a) for reverse charge the amount you enter is treated as **NET** — the supplier's
  total carries no Icelandic VAT and the system adds 24% on top (`addVat`); entering a
  grossed-up figure inflates boxes D and E by 24% each and F still looks right. (b) Every
  reverse-charge expense is `vat_deductible = true`, so **every one needs its PDF** or the
  preflight raises the `UNSUBSTANTIATED_INPUT_VAT` blocker.
- **Foreign currency.** Type the amount as it appears on the invoice (`20.00`); the form
  converts to minor units and the step follows the currency. (Before 2026-09-05 the form
  sent the typed figure as minor units, so USD 20.00 typed as `20` booked as USD 0.20 with
  no error — `tests/unit/money.client.test.js` pins the fix.)
- **Dates.** The period is fixed by `expense_date`. An invoice dated 01.09 instead of 31.08
  moves the whole refund into the next period. Every figure in a small period should be
  traceable to a named document on the VSK screen's per-account detail.
- **Sales.** Counter sales go through `/admin/books/pos`. There is **no button yet** to
  issue a statutory invoice from a shop order — the client call exists
  (`issueInvoiceForOrder`) with no caller; until it lands, `POST /invoices/from-order/:orderId`
  is the path. Note that the `UNINVOICED_ORDERS` preflight only sees rows in `orders`: a
  sale invoiced on paper and never entered produces **no warning whatsoever**.
- **Duplicates.** `findPossibleDuplicates` warns on a repeated supplier invoice number, or
  same supplier + amount within ±5 days; it is a 409 you can override. Monthly SaaS is a
  genuine repeat, so people learn to click through — read the warning every time.

## 5. Pre-filing checks — run these BEFORE looking at the number

```sql
-- 1. No demo contamination. Both must be 0.
SELECT COUNT(*) FROM invoices WHERE customer_email LIKE '%@demo.%';
SELECT COUNT(*) FROM products WHERE slug LIKE 'demo-%';

-- 2. Every foreign supplier is on reverse charge. Must return no rows.
SELECT id, supplier_name, supplier_country, vat_code FROM expenses
 WHERE supplier_country <> 'IS' AND vat_code <> 'reverse_charge_24';

-- 3. Every deductible expense in the period has a fylgiskjal. Must be 0.
SELECT COUNT(*) FROM expenses
 WHERE expense_date BETWEEN '<period start>' AND '<period end>'
   AND vat_deductible AND document_id IS NULL;
```

Then in the UI: `/admin/books/ledger` → **trial balance** for the period (debits =
credits; only the accounts you expect have movement) and the **account ledger for 1990
Óvissureikningur** (must be empty — it is where a payment with no obvious home is parked
visibly rather than guessed at).

Check 2 is the asymmetric one: a foreign purchase entered as domestic `input_24` (or with
its EU VAT id pasted into the VSK-number field) inflates box E with **no matching entry in
box D** — an over-claimed refund, in the direction Skatturinn assesses with a surcharge.
The others move D and E together and leave F plausible, which is exactly why they need
checks rather than eyes.

## 6. Derive, compare, then file — in that order

`/admin/books/vat` → the period. The screen shows the six RSK 10.01 boxes derived from
posted lines, `output_vat_domestic` and `output_vat_reverse_charge` split out, per-account
detail, and the preflight findings:

| Code | Level | Meaning |
|---|---|---|
| `UNSUBSTANTIATED_INPUT_VAT` | blocker | a deductible expense in the period has no document |
| `UNINVOICED_ORDERS` | blocker | paid shop orders in the period with no invoice |
| `SUSPENSE_NOT_EMPTY` | warning | account 1990 has a balance |
| `NIL_RETURN` | warning | every box is zero — filing is still mandatory |
| `REFUND_POSITION` | info | box F is negative (an inneign) |
| `DEADLINE` / `PAST_DEADLINE` | info | days to (or past) the seeded due date |

Compare the derived boxes with the accountant's **independently prepared** figure. **If
they disagree, stop.** That disagreement is the entire product of this exercise; reconcile
it before submitting anything anywhere.

Then **submit on skatturinn.is first**, through the company's veflykill. Only after that,
press *File* here, putting the Skatturinn confirmation reference and date into the note
(`vatService.fileReturn` stores up to 1000 characters). Rationale: filing here snapshots
the return write-once, posts the settlement entry, and **locks the period**. An unlock
exists but is audited and reverses the settlement on its own date — locking a period you
have not actually submitted is the wrong order of operations.

## 7. Archive

```bash
npm run books:archive -- --out=<Iceland-resident medium>/<YYYY-Pn>
npm run books:archive -- --verify-only --out=<same>
```

The manifest carries the upload-time and the recomputed SHA-256 per document. Copy to a
medium physically in Iceland: bókhaldslög 145/1994 gr. 20 wants seven years kept here, and
Azure has no Iceland region — the export is the compliance route, not a convenience.

## 8. Afterwards — turn the run into a measurement

Record **what was actually submitted** (not what the system computed) as the `expected`
block of the period's replay case, so every future change to the books code is checked
against a real filed return:

1. The case file already exists as `pending` — `server/fixtures/books-replay/<YYYY-Pn>-<company>.json`.
   Add the period's expenses to it as they were entered (amounts as printed, `"document": "stub"`
   for each fylgiskjal — the real documents never enter the repo).
2. Fill `expected` with the eight boxes **as submitted**, add `"filed": { "reference": …, "on": … }`,
   and remove `"pending": true`.
3. `createdb orangesmiley_replay` once, then `npm run books:replay -- --all` must print
   `RESULT: MATCH`. It runs against a wiped `_replay` database and refuses any other name.

From then on it is a test: `tests/integration/booksReplay.test.js` proves the machinery
on a synthetic case, and the company case proves the ledger against Skatturinn.

---

## Which accountant questions block a filing

`ACCOUNTANT-QUESTIONS.md` has ten open items. For a period with **no turnover and only
foreign SaaS plus a domestic invoice or two**, exactly one touches the figure:

| § | Question | Blocks the figure? | Safe default meanwhile |
|---|---|---|---|
| 6 | Reverse charge on foreign services | **Yes** — it is all of box D and most of E. Mitigation: a misclassification moves D and E **equally**, so **box F, the money, is right either way**. Misstatement risk, not payment risk. Do not miss a deadline over it. | `reverse_charge_24` on every non-IS supplier of electronic services (the coded behaviour). |
| 1 | Chart of accounts | Weakly — it gates the banner only. | Confirm with a scoped note; full review before the first sales period. |
| 2 | Services sold to a business abroad — 24% or 0%? | **No** for a period with no sales. **Yes** the moment one foreign B2B invoice is issued — the coded 24% over-charges the customer. Get the art. 12 answer before then. | The coded 24%. |
| 3, 4 | Payroll figures; reiknað endurgjald | No for VSK (payroll refuses to run unconfirmed, so nothing posts). **Urgent for a different filing** (staðgreiðsla) if any salary was drawn. | Do not run payroll until confirmed. |
| 5 | Stripe fees | No unless there is card revenue. | `6500` at `exempt`; no input VAT claimed. |
| 7 | The four input-VAT exclusions | No unless risna / vehicle / staff meals were bought. | The four coded exclusions. |
| 8 | Retention | No — it is §7 above, not a gate on the figure. | Archive after filing. |
| 10 | Opening balances | No — §3 above; cannot move a box. | Post the capital entry; never delay a filing for it. |
