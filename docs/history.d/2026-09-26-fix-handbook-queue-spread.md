<a id="handbook-queue-spread-2026-09-26"></a>
## 2026-09-26 — Handbook queue note: a large verk is spread over several months

A follow-up to [handbook-d022-2026-09-26](2026-09-26-feat-handbook-d022.md#handbook-d022-2026-09-26),
asked for by Halli. D-022 kept the verk sizes at 1 / 5 / 20 einingar but cut
the monthly quotas to 2 / 3 / 5, and the tier guide `threpin-thrju` still
promised that a verk nobody is waiting for "can wait for next month and take
its units, at no extra cost". No month holds a stórt verk (20 einingar), so
that promise could not be kept. The sizes stay; the promise changes.
**All copy is DRÖG for Halli; the guides stay unpublished.**

- **The new queue note**: a verk nobody is waiting for can be kept and paid
  with the units of the coming months; a verk bigger than one month can hold
  is spread over several months, at no extra cost. New units still arrive at
  the turn of the month.
- **The sentence above the list** named only the pay-now path ("svo það sem
  umfram er greiðist á einingaverði"). It now gives both: the customer
  chooses between spreading the verk over the coming months' units at no
  extra cost and starting now, paying the rest at the einingaverð, and sees
  the amount before approving the verk.
- **A worked example for sellers**, right under it: a customer on Rekstur
  (5 einingar a month) wants a stórt verk (20 einingar). Either it is spread
  over four months, taking those months' units, or it starts now and the part
  beyond the month's units is paid at the einingaverð (15 × 6.000 kr. =
  90.000 kr. án VSK). The customer chooses, and the choice is agreed before
  work starts.
- **Migration `os_004_sales_guides_queue_spread`**: two exact old → new
  passages through os_001's `guideEdit` helper, so the same guard as os_003
  (`updated_by IS NULL`, old passage present, new passage absent). Pure data,
  expand-only, `published` untouched, no DDL. Reference copy
  `server/migrations/product/os_004_sales_guides_queue_spread.sql`, generated
  from the entry. The seed script carries the same text; on a fresh install
  os_004 matches nothing.
- **Tests**: the new `salesGuidesQueueSpread.test.js` checks that each old
  passage occurs once in the os_003 text and each new one once in the seed, that
  no guide keeps the "next month" promise or the pay-now-only sentence, that os_004 turns the os_003 text
  into the seed text exactly, that a saved guide keeps every word and the
  `published` flag is untouched, and that a second run and a run on rows
  already at the seed text change nothing. The chain grew one step:
  `salesGuidesD022.test.js` undoes os_004 before os_003 and compares os_003's
  result with that text, and `salesGuidesD001.test.js` undoes os_004, os_003,
  then os_001 (its sha256 pin of the first seed still holds).
- Not changed: whether unused units carry over is still "DRÖG — Halli
  staðfestir".
