<a id="harvest2-lane7a-2026-09-26"></a>
## 2026-09-26 — Harvest 2, lane 7a: checkout settings (pause, minimum, fields, delivery price, owner alert) and the time-limited site announcement

Lane 7a of Harvest 2 (generic icelandicstore work up to `ice@941cf51d`; Halli approved the scope on
2026-09-26). Branch `harvest2/lane7a-checkout-settings`. Two ice features: #151, the checkout
settings screen, and #200, the time-limited announcement. Code carries "Ported from icelandicstore
#NNN" where it was ported. No migration: every setting lives in `app_settings` (047) through
`server/models/Setting.js`.

(Write-up completed in the docs commit of this branch.)
