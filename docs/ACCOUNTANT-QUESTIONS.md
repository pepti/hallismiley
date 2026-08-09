# Questions for the accountant

This is the list to take to a bookkeeper or accountant before the books are relied on for
a real filing. Every item here is a decision the software cannot make for itself: either
it needs a figure only Skatturinn publishes, or it needs a judgement about this specific
business.

Where the system has had to pick something to be able to run at all, the current
behaviour is stated. **None of these are settled by the code being written.** A wrong
answer here produces a plausible-looking number, which is exactly the kind of error that
is not found until an assessment years later.

Print this, or send it. The answers belong back in this file with a date and a name.

---

## 1. The chart of accounts — the one that blocks everything else

**Question.** Is the chart of accounts in `server/config/schema.js` (migration 072,
`ledger_accounts`) the right one for this business, and are the account numbers the ones
you want to work with?

**Why it matters more than it looks.** Every posting in the system names an account by
code. Changing a code after entries exist means either re-pointing history (which the
append-only rules forbid) or running two charts at once. It is cheap to change now and
expensive later.

**Current behaviour.** The chart is seeded and usable, and the books settings carry a
`coa_confirmed_at` field that is **NULL** until someone confirms it. Every books screen
shows a standing warning while it is null. Nothing is blocked — the warning is the whole
mechanism.

**What we need back.** Either "this is fine" with a date, or a marked-up list. Specific
things worth a look:

- `4100` Sala vöru 24% vs `4110` Sala þjónustu 24% — the split exists because goods and
  services are zero-rated differently on export. Is one revenue account per rate enough,
  or do you want revenue split by line of business as well?
- `6900` Risna og gjafir and `6910` Fæði starfsmanna are flagged `input_vat_blocked`, so
  input VAT on them is refused with a reason recorded. Are those the right two, and are
  there others?
- `1990` Óvissureikningur is where a payment with no obvious home is parked visibly rather
  than guessed at. Are you happy with that as the practice?

---

## 2. Services sold to a business abroad — the open VAT question

**Question.** When this business invoices a company in another EU/EEA country for
software or consulting work performed in Iceland, is that turnover standard-rated (24%),
or zero-rated with the customer accounting for the VAT themselves?

**Why it matters.** It is the difference between charging a Danish customer 24% and
charging them nothing. Getting it wrong in one direction over-charges the customer and
over-declares output VAT; in the other it under-declares, and the shortfall is this
business's liability.

**Current behaviour.** **24%.** `invoiceService.buildLines()` zero-rates only EXPORTED
GOODS. A service is treated as taxed where it is performed, so joinery or software work
done in Iceland stays at the standard rate even when the customer is abroad. The reasoning
is that VSK act art. 12 enumerates a narrow set of services that are zero-rated to a
non-resident, and blanket-zeroing every cross-border service would under-declare output
VAT — so the conservative reading was chosen deliberately.

**What we need back.** Which of the art. 12 categories, if any, this business's software
and consulting work falls into. If it is zero-rated, the change is small (a flag on the
customer or the line) but it must not be guessed at.

**Note.** The Danish customer in the demo seed data is invoiced at 24% for this reason. If
the answer is 0%, that seed is wrong too.

---

## 3. Payroll: the year's figures

**Question.** For the coming tax year, what are:

- the withholding bands (the income thresholds and the **combined** rate for each —
  tekjuskattur plus útsvar, as published),
- the monthly persónuafsláttur,
- tryggingagjald,
- the mandatory pension percentages, employee and employer,
- the útsvar rate for the municipality this business is registered in?

**Why it matters.** These are re-set every January and none of them is derivable. Payroll
**refuses to run** against a year nobody has confirmed, and that refusal is deliberate: a
run computed from last year's bands produces a believable payslip that under-remits
withholding tax, and the shortfall is the employer's liability with interest.

**Current behaviour.** 2026's figures are in the database from Skatturinn's published
"Key rates and amounts", left **unconfirmed**, and the payroll screen refuses to compute
until a person confirms them with a note saying what they checked against.

One thing in particular needs your eye: `municipal_rate` is currently **0.1494**, the
AVERAGE útsvar embedded in the published combined band rates. It should be this
business's registered municipality's actual rate. The system uses it only as a sanity
check — it refuses a band rate at or below the municipal rate, on the grounds that such a
figure is the fingerprint of tekjuskattur-only rates having been typed in by mistake —
but it should still be right.

**What we need back.** The figures, and confirmation that the band rates in the system
are the combined ones rather than tekjuskattur alone.

---

## 4. Reiknað endurgjald

**Question.** Which RSK category does the owner's work fall into, and what is the monthly
minimum for that category this year?

**Why it matters.** An owner working in their own company must pay themselves at least the
published minimum for their category, whatever they actually take out. Paying less is the
commonest mistake a one-person ehf. makes, and it is assessed years later with interest.

**Current behaviour.** The employee record carries a category and the year carries a table
of minimums (`payroll_reference_wages`). The payroll preflight **blocks** a run that pays
an owner below the minimum; it can be overridden, but only with a written reason that is
stored with the run. If no minimum is recorded for the category, it **warns** instead of
blocking — it cannot check against a figure it does not have.

**What we need back.** The category, and the minimums table for the year. If the owner
intends to take part of their income as a dividend rather than salary, we should note the
reasoning here so the override reason can point at it.

---

## 5. Stripe fees

**Question.** Is the Stripe processing fee deductible input VAT, an exempt financial
service, or something else?

**Why it matters.** It changes both the expense figure and box E of every VSK return where
a card payment was taken.

**Current behaviour.** Booked to `6500` Bankakostnaður og greiðslugjöld with vat_code
`exempt`, so **no input VAT is claimed**. That is the conservative choice: claiming input
VAT that is not deductible is a correction to make later, while not claiming deductible
VAT is money left on the table but not a compliance problem.

**What we need back.** Whether the fee (a) is exempt as a financial service, (b) carries
Icelandic VAT that is deductible, or (c) is a service from abroad subject to reverse
charge. If (c), the treatment is already implemented for other foreign services and just
needs switching on for this one.

---

## 6. Reverse charge on foreign services

**Question.** Is the reverse-charge treatment being applied to the right purchases, and is
the threshold being handled correctly?

**Why it matters.** Buying software services from abroad (Azure, GitHub, Figma) means
self-assessing Icelandic VAT: an output leg and a deductible input leg of the same size.
Get it wrong and the return is wrong on both sides at once — which nets to zero on the
payable figure and is still a misstatement.

**Current behaviour.** `expenseService.assessVat()` applies reverse charge when the
supplier country is not IS and the vat_code says `reverse_charge_24`, posting both legs.
The demo seed has Azure, GitHub and Figma set up this way.

**What we need back.** Confirmation that this is right for these suppliers, and whether
the registration threshold in `REVERSE_CHARGE_THRESHOLD_ISK` matters for a business
already VSK-registered (our reading is that it does not, but it is in the code).

---

## 7. Input VAT and the four statutory exclusions

**Question.** Are the input-VAT refusals the system enforces the right set?

**Current behaviour.** Input VAT is refused, with the reason recorded on the expense,
when:

1. the account is flagged `input_vat_blocked` (currently risna/gifts and staff meals),
2. the supplier has **no VSK number** on the document — a till receipt without one does
   not prove input tax,
3. the vat_code is `exempt` or `none`,
4. the expense is a passenger car or its running costs (via the account flag).

Number 2 is the one that surprises people: a receipt-less or VSK-number-less purchase
still gets recorded as an expense, at its **full gross**, with `vat_deductible = false`
and a reason. Nothing is silently dropped.

**What we need back.** Whether that list is complete, and whether the "no VSK number"
rule is too strict for any category this business actually buys.

---

## 8. Retention, and the fact that Azure has no Iceland region

**Question.** Is the archive export an acceptable way to satisfy bókhaldslög 145/1994
gr. 20, and where should the archive live?

**Why it matters.** Art. 20 requires accounting records to be kept for seven years **and
kept in Iceland**. This application runs on Azure App Service, and Azure has no Iceland
region — the nearest are North Europe (Dublin) and West Europe (Amsterdam). No
configuration changes that.

**Current behaviour.** `npm run books:archive -- --out=DIR` writes a complete, checksummed
copy of the books: every journal line, invoice, expense, filed VSK return, the chart of
accounts as it stood, the audit log, and every uploaded document. The manifest carries a
SHA-256 per file, and for documents it carries **both** the checksum recorded at upload
and the one computed now, so bit-rot or a careless restore is visible rather than
certified. `--verify-only` reads an archive back.

This is documented as the ONLY route to compliance, not as a convenience.

**What we need back.** Whether an annual (or more frequent) archive on media physically in
Iceland satisfies the requirement in your view, and if so what medium and what retention
practice you would want. The owner's stated position is that hosting stays on Azure and
Icelandic storage is a planned addition.

---

## 9. Where the VSK return figures come from

**Question.** Does deriving the return from the ledger, rather than storing a separate set
of VAT totals, match how you want to work?

**Current behaviour.** RSK 10.01 boxes are **derived from posted journal lines** via each
account's `vat_code`, per period. Filing takes a snapshot and locks the period; nothing
can then be posted into it without an explicit unlock, which is audited and which reverses
the settlement entry on its own date.

The consequence worth knowing: the return and the P&L cannot disagree, because they read
the same lines. The cost is that a correction to a filed period is a deliberate,
recorded act rather than an edit.

**What we need back.** Whether you want the annual reconciliation (RSK 10.25) produced
from the same source, and in what form.

---

## 10. Opening balances

**Question.** What are the opening balances at the point these books take over, and on
what date?

**Why it matters.** Without them the balance sheet is missing whatever existed before —
share capital, the bank balance, any receivable or payable already outstanding — and it
will not tie to anything.

**Current behaviour.** There is no opening entry. The manual journal entry screen
(`/admin/books/ledger`) is how one gets posted, with `sourceType: 'manual'` and a memo.
The balance sheet derives retained earnings from revenue less expenses to date, so it
balances without one — but it balances around an incomplete picture.

**What we need back.** A trial balance as at the changeover date, which we will post as a
single manual entry.

---

## Standing notes

- **Amounts are whole ISK.** Everything is stored as BIGINT; there are no subunits and no
  floats anywhere in the money path.
- **Nothing posted can be edited or deleted.** Corrections are reversals or credit notes,
  so the mistake and the fix are both on record (Reglugerð 505/2013 gr. 9).
- **Every document series is gapless** and allocated under a row lock (gr. 16).
- **Every entry names a person** (gr. 8), which is also why a user who has posted anything
  cannot be deleted.
- **Foreign-currency documents are converted to ISK at a captured rate**, stored with the
  rate used, because the books are kept in ISK (bókhaldslög 145/1994 gr. 10a).

If any of the above is not what you expect, that is worth a conversation before the
first filing rather than after it.
