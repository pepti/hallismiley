<a id="persona-hraunbaun-os-2026-09-26"></a>
## 2026-09-26 — The demo persona is Kaffibrennslan Hraunbaun — Glóð is a real company

Halli: "Can't be Glóð anymore that is a real company." The demo persona of
rekstrarkerfi.is and the coming `demo.rekstrarkerfi.is` — fabricated sales, invoices and
receipts under its name — was a real business. Markaðsstjóri checked candidates against
Skatturinn's fyrirtækjaskrá, ISNIC and Hugverkastofan; Halli chose **Kaffibrennslan
Hraunbaun** (genitive "Kaffibrennslunnar Hraunbaunar"; never shortened to "Kaffibrennslan",
which is a real café). The theme called Glóð (`ember`) is a word, not the company, and keeps
its name. The product side (seed, copy, media, `rk_004` on saved rows) is rekstrarkerfid's
`persona-hraunbaun` entry.

Here:
- **Handbook:** `seed-sales-guides.js` names Hraunbaun in "Kerfið í stuttu máli";
  **`os_005_sales_guides_persona_hraunbaun`** makes a row still holding the old passage match
  the seed — same `guideEdit` helper and guard as os_001–004 (rows nobody saved only,
  idempotent, pure data). `tests/integration/salesGuidesPersona.test.js` pins old text + os_005
  == seed, idempotency, and that a saved row is left alone. **A row someone saved keeps the
  old name** — check the live handbook after deploy and edit it by hand if so.
- `CLAUDE.md` and `docs/SALES-STAFF.md` (the demo instance's data), and comments in
  `server/demo/seed.js`, `server/services/demoReset.js` and `seed-sales-guides.js`.
- `tests/unit/emailShell.test.js` used "Kaffibrennslan Glóð" / `glod.test` as its made-up
  downstream brand; now Hraunbaun / `hraunbaun.test`.

Left as written: the archive (`docs/HISTORY.md`), earlier fragments, and the applied
`os_001` (its SQL and comment are history; never edit an applied entry).
