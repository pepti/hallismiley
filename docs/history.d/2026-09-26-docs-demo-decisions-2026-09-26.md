<a id="demo-decisions-os-2026-09-26"></a>
## 2026-09-26 — Demo decisions: one demo containing it all; "Innskrá" stays on rekstrarkerfi.is (D-023)

Docs only. Halli settled on 2026-09-26 how visitors reach the demo and what a prospect who wants
to see their own business gets. The full record is D-023 in the gitignored `company/DECISIONS.md`
(it amends D-020); rekstrarkerfid records the product side in its own `PLAN.md` (R2b step 3) and
`docs/HISTORY.md#demo-decisions-2026-09-26`.

- **"Fáðu demo" opens the demo.** Every tier card on rekstrarkerfi.is/verdskra sends the visitor
  to `demo.rekstrarkerfi.is`. **"It is one big demo containing it all"** (Halli): one instance
  with every module (`modules.preset: all`) and the Kaffibrennslan Glóð data, not one per tier.
  Self-serve follows from that; its mechanics are the plan's proposal, not Halli's words: a
  throwaway session per visitor, never a real account, rate-limited, wiped by the reset, in place
  of D-020's "time-limited prospect logins after a guided demo". Seller logins stay.
- **"Innskrá" stays in rekstrarkerfi.is's nav** (Halli: "I needed a login as admin, to change
  text and other web page maintenance"). Public signup stays closed; only Halli signs in. D-020
  step 1 had removed both links.
- **Two further kinds of demo** for a prospect: **A**, our look with mock data modelled on their
  kind of business, not their real data (Halli: "it's a demo it would be mock data similar to
  their business"); where that mock business lives, a short-lived app per prospect or a login on
  the shared demo, is a proposal only. **B**, their look, by running their site through
  site-factory onto its own Azure instance.

What changed here: `CLAUDE.md`'s D-020 lines for rekstrarkerfi.is and `demo.rekstrarkerfi.is`,
and an open-items bullet in `PLAN.md`. No code. Still owed: the handbook guide "Að sýna kerfið"
(a new os product migration, copy DRÖG) and the demo-instance chunk's prospect-login design,
both listed in `PLAN.md`.
