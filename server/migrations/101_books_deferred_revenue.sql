-- 101_books_deferred_revenue — reference copy of the migration in server/config/schema.js
--
-- Bókari's ruling, 2026-09-08. `createServiceInvoice` booked the 50% build
-- deposit (D-005) as EARNED REVENUE on the issue date. Money taken before the
-- work is delivered is a customer prepayment — a liability — and it becomes
-- revenue on delivery:
--
--   * lög nr. 3/2006 um ársreikninga 11. gr. — rekstrargrunnur. An invoice is a
--     document; it is not by itself performance.
--   * 26. gr. — "Tekjur, sem innheimtar hafa verið á reikningsárinu en varða
--     síðari reikningsár, skal færa til skuldar." The deferred-income rule,
--     verbatim.
--   * 5. gr. — glögg mynd. Revenue-on-issue overstated revenue and equity by
--     290.000 kr and understated liabilities by the same at every reporting date
--     between signing and go-live.
--
-- D-005 already said this in prose ("the deposit sits as a customer prepayment
-- until then"); only the second half of the sentence was never implemented.
--
-- VSK RUNS ON A DIFFERENT CLOCK AND DOES NOT MOVE. Under l. nr. 50/1988 13. gr.
-- 2. mgr. the delivery is deemed to occur on the invoice date, and under 3. mgr.
-- an advance payment is taxable turnover in the period it is received. So the
-- deposit's net is skattskyld velta and its 24% is útskattur in the period the
-- deposit invoice is dated, regardless of when the revenue is recognised. That
-- is why 2150 carries vat_code = 'output_24' and why vatService counts it in
-- box A: moving the net to a liability without that would have dropped box A by
-- 290.000 while box D kept 69.600 — a worse bug than the one being fixed.
--
-- Pure expand (invariant 14): one data row, three nullable columns, one partial
-- index, and one CHECK that is WIDENED. The previous release writes none of the
-- columns and resolves accounts by code, so an extra row is inert to it.

-- 1. The account. Data, so the accountant can renumber it without a deploy —
--    free today (coa_confirmed_at is NULL and nothing has been posted),
--    expensive after the first posting. 2400 is deliberately avoided: BOKARI-LOG
--    2026-08-25 earmarks it for Viðskiptareikningur eiganda.
INSERT INTO ledger_accounts (code, name, name_en, type, vat_code, input_vat_blocked, sort, description)
VALUES ('2150', 'Fyrirframinnheimtar tekjur', 'Deferred income', 'liability', 'output_24', FALSE, 205,
        'Innborganir viðskiptavina á óafhenta vinnu. Telst til skattskyldrar veltu við útgáfu '
        'reiknings (13. gr. l. nr. 50/1988) og tekjufærist við afhendingu (26. gr. l. nr. 3/2006).')
ON CONFLICT (code) DO NOTHING;

-- 2. When a deferred invoice was recognised, by which entry, and into which
--    account. The account is SNAPSHOTTED at release so that crediting a
--    recognised deposit later reverses the revenue it actually became, rather
--    than driving the liability negative.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS revenue_recognised_at       DATE,
  ADD COLUMN IF NOT EXISTS revenue_recognised_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS recognised_into_account     TEXT;

-- 3. "Which deposits are still deferred" as one indexed read.
CREATE INDEX IF NOT EXISTS idx_invoices_deferred_open
  ON invoices (account_id)
  WHERE service_kind = 'build_deposit' AND revenue_recognised_at IS NULL;

-- 4. The release entry's own source type. WIDENING a CHECK: every value the
--    previous release writes still passes. The list must be copied from the
--    CURRENT constraint — migration 077 added 'pos' — and never retyped from
--    the 072 original, because a value dropped here breaks every till entry.
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IN ('invoice','payment','credit_note','expense',
                         'payroll','vat_settlement','opening','manual',
                         'reversal','stripe','bank','pos','revenue_recognition'));
