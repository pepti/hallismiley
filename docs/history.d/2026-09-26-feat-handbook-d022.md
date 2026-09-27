<a id="handbook-d022-2026-09-26"></a>
## 2026-09-26 — Handbook on D-022 pricing, with the fourth tier Samstarf

Halli approved D-022 (`company/DECISIONS.md`, amends D-001) on 2026-09-26.
Fjármálastjóri's model on Ský's measured Azure bills showed that under D-001
the included 5/10/20 verkeiningar cost 118–231 % of the contract fee at full
use. The handbook quoted D-001's contract figures in three guides, left the einingaverð open and named only three tiers.
**All copy is DRÖG for Halli; the guides stay unpublished.**

- **The model in the guides**: build fees unchanged at 390 / 580 / 690 þ.kr.;
  the service contract becomes 29 / 59 / 89 þ.kr./mán án VSK carrying
  2 / 3 / 5 verkeiningar (verk sizes stay 1 / 5 / 20). The einingaverð, which
  D-001 left open, is 6.000 kr. án VSK. Hosting beyond the tier's pattern
  (D-012) is billed at Azure cost + 15 %, and AI inside the customer's system
  is included up to 2.000 kr./mán, then cost + 15 %. The example of what a
  month's units buy was rewritten for the smaller quotas: a stórt verk
  (20 einingar) is larger than any tier's month, so the rest is paid at the
  einingaverð, shown before the customer approves. The seller rule "you name
  no einingaverð" is gone; "whether unused units carry over" and "the cost of
  moving up a tier" still say DRÖG — Halli staðfestir.
- **Samstarf, the fourth tier**: no listed price, agreed after a free
  assessment of the customer's business and of what we propose to build, for
  customers who need a system built around their own business (customer #1's
  kind). `threpin-thrju` (retitled "Þrepin þrjú, Samstarf og hverjum þau
  henta"; slug unchanged) gained a Samstarf section and a section on when to
  offer the free assessment instead of quoting a tier: a way of working no
  standard system supports, many integrations, many or large custom needs from
  the start, a move off a long-customised system, or no tier that clearly
  fits. The seller says the assessment is free, names no figure ("ekki heldur
  svona í kringum"), does not run the assessment, and never names customer #1.
  The tier rule now reads "in doubt between two tiers, take the lower; in doubt
  whether any tier fits, offer the assessment". `fyrsta-samtalid`,
  `tilbodsferlid` (the assessment comes before the offer),
  `hvad-er-i-hverju-threpi` (Samstarf sits outside the feature table),
  `hvad-thu-lofar-aldrei`, `ordalisti` (Samstarf, Ókeypis úttekt),
  `kerfid-i-stuttu-mali` and `velkomin-i-soluteymid` point to it. How a
  Samstarf contract is shaped is left to the offer; D-022 does not say.
- **Migration `os_003_sales_guides_d022_pricing`**: 25 exact old → new
  passages through os_001's `guideEdit` helper, so the same guard
  (`updated_by IS NULL`, old passage present, new passage absent). It is pure
  data and expand-only: text columns of rows nobody saved, `published`
  untouched, no DDL. It runs on top of os_001's text; on a fresh install the
  seed already carries the D-022 text and os_003 matches nothing. The seed
  script carries the same text; the edits were applied to it by script, not by
  hand, so the two cannot drift.
- **Tests**: `salesGuidesD001.test.js` now walks seed → undo os_003 → undo
  os_001; its sha256 pin of the text as first seeded still holds, and its
  flat-tier check runs on the D-001 text (59 is Verslun's fee again).
  The new `salesGuidesD022.test.js` checks that every old passage occurs once
  in the D-001 text and every new one once in the seed, that the seed carries
  the D-022 figures and the Samstarf copy with no D-001 contract figure and no
  figure inside the Samstarf section, that os_003 turns D-001 text into the
  seed text exactly and os_001 + os_003 turn the first seed into it, that a
  saved guide and the `published` flag are untouched, and that a second run
  and a run on already-current rows change nothing.
- Not changed: D-003's commission examples and D-012's margin column (the
  decision lists them for re-running against the new fees), and the "selur eina
  vöru" line in `velkomin-i-soluteymid` flagged on 2026-09-22.
