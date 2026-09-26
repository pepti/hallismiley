<a id="passthrough-invoice-2026-09-26"></a>
## 2026-09-26 — Pass-through service invoice: hosting and AI at cost + markup, no commission (D-022)

D-022 (2026-09-26) bills two pass-throughs on top of the service contract:
hosting beyond the tier's D-012 pattern at Azure cost + 15 %, and AI inside the
customer's system above 2.000 kr./mán at cost + 15 %. Neither carries seller
commission (D-003: the base contract only). `createServiceInvoice` knew three
kinds, and the only way to bill a pass-through was a `recurring` invoice with
`amount_net_isk` overridden — which paid the seller 10 % of it, about 77 % of
the markup (Fjármálastjóri's flag in D-003's re-run). Halli approved building
the kind on 2026-09-26. Branch `feat/passthrough-invoice`.

**What changed:**
- **A fourth service kind, `passthrough`** (`invoiceService.js`). It takes a
  `period` (YYYY-MM) and 1–20 lines of `{ type: hosting|ai, description (≤120),
  cost_isk }`, the ex-VSK cost. `computePassthrough` (pure) deducts the AI
  allowance from the period's AI lines in order, never below zero, then applies
  the markup per line with `Math.round`; a line the allowance covers in full
  stays on the invoice at 0 kr., so the customer sees what was included. Each
  line names its cost basis: "Gervigreind umfram innifalið — Pantanalestur —
  september 2026 (kostnaður 3.500 kr., þar af 2.000 kr. innifalið + 15 %)".
  Nothing above the allowance and no hosting is a 400, and no number is used.
- **VSK on the net total, once**, allocated to the lines by largest remainder
  (`allocateProportional`), so a multi-line invoice's VSK equals the single-line
  kinds' rounding and EN 16931's per-rate figure exactly (the UBL export carries
  no `PayableRoundingAmount`). The single-line kinds go through the same code
  and produce the same figures as before.
- **No commission.** The hook now runs for `COMMISSIONABLE_KINDS = ['build',
  'recurring']`, an allow-list — before, it ran for everything except
  `overage`, so a new kind would have paid a seller by default.
- **Config, not literals.** `billing.passthrough.markupBp` (1500) and
  `aiAllowanceIsk` (2000) in `server/config/clientConfig.js` — D-022's values as
  the schema defaults, spelled out in `config/client.json` — env
  `CLIENT_CONFIG_BILLING_PASSTHROUGH_MARKUP_BP` / `_AI_ALLOWANCE_ISK`. No pricing
  seam existed before; `billing` is the new top-level section for it.
- **Revenue account: 4110**, the same as the contract month. We buy Azure and
  the AI service in our own name and resell at a markup, so the full marked-up
  amount is our own taxable turnover. A separate "endurseldur kostnaður" account
  would show the resale margin on its own; that is a reporting choice, not a
  tax one, and it is cheap only before the first posting, so it is asked, not
  decided: `docs/ACCOUNTANT-QUESTIONS.md` §12. Meanwhile `service_kind` already
  separates the revenue in any query.
- **Migration `122_passthrough_invoice`** (engine array; 119 and 121 are held by
  open harvest lanes): a partial unique index, ONE `passthrough` invoice per
  account per period, and a `service_kind` CHECK naming the vocabulary for the
  first time (`NOT VALID`, so no existing row is scanned and no downstream can
  fail its boot on it). Expand-only: the previous release never writes
  `passthrough`. Reference copy `server/migrations/122_passthrough_invoice.sql`.
- **The duplicate guard, and why it differs from recurring's.** One per period
  because the allowance is monthly: two invoices for one month would each take
  2.000 kr. off. Unlike 099's recurring index, a **fully credited** invoice frees
  the period as well as a cancelled one. A pass-through is metered from someone
  else's bill, which can be corrected after the fact; a full credit note plus a
  corrected invoice is how that is done without double revenue (the credited one
  nets to zero). A partial credit leaves the status `issued`, so the period
  stays taken. A late cost can also go on the next period's invoice, described
  as such.
- **Route**: the existing `POST /api/v1/admin/bookkeeping/invoices/service`
  (hard admin + CSRF, the typed-error envelope); the controller shape-checks
  `lines` (`parsePassthroughLines`) and the service re-checks. `GET
  /api/v1/admin/accounts/:id` adds `passthrough_terms` `{ markup_bp,
  ai_allowance_isk, vat_rate }` for an admin only, for the preview.
- **No MCP tool issues service invoices**, so there was none to extend and no
  `mcp.write.*` switch was added.
- **Admin UI** (`AdminAccountDetailView`, the "Gefa út reikning" card): a fifth
  choice, "Endurseldur kostnaður — hýsing og gervigreind", the shared month
  field, rows of type / description / cost with add and remove, and a live
  preview (cost, included, with markup, net, VSK, total) computed by
  `public/js/utils/passthrough.js` from the served terms. Existing UI kit only
  (`.acct-field`, `.admin-table`, `.acct-notice`); the new CSS is tokens only.
  IS + EN strings; `accounts.invoiceHelp` now names the kind.

**Tests** (real Postgres): `tests/integration/passthroughInvoice.test.js` — the
amounts (allowance, per-line rounding incl. .5, 0-kr. covered lines, the audit
summary), nothing-to-bill with the series left gapless, no `commission_events`
row and a statement preview that counts only the contract month after both are
paid, a balanced entry (1100 / 4110 / 2200), PDF + UBL, the period guard incl.
partial vs full credit and a concurrent double issue, fifteen validation 400s,
404, RBAC 403/401, the admin-only terms, migration 122 run twice and its CHECK
refusing an unknown kind. `tests/unit/passthrough.test.js` pins the preview to
the server rule, the config defaults/overrides and the commission allow-list.
`commission.test.js` gained the pass-through case beside overage.

**Owed:** Halli approves the DRAFT copy (the invoice line texts and the admin
strings); the accountant answers §12 (separate account? principal vs
disbursement); a downstream with other terms sets `billing.passthrough` in its
own `config/client.json`.
