<a id="harvest2-lane9-2026-09-26"></a>
## 2026-09-26 — Harvest 2, lane 9: ops (expiry watch, role × route harness, TEST-stack data)

Lane 9 of Harvest 2 (generic icelandicstore work up to `ice@941cf51d`; Halli approved the scope on
2026-09-26). Branch `harvest2/lane9-ops`.

**1. The weekly expiry watch (ice #90).** `.github/workflows/secret-cert-watch.yml` runs Mondays
06:30 UTC and on dispatch. It fails when a TLS certificate on an instance hostname expires within 21
days, or a Key Vault secret expires within 30 days or carries no expiry stamp.
