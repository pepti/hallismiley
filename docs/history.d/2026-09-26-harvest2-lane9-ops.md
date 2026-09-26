<a id="harvest2-lane9-2026-09-26"></a>
## 2026-09-26 — Harvest 2, lane 9: ops (expiry watch, role × route harness, TEST-stack sample rows)

Lane 9 of Harvest 2 (generic icelandicstore work up to `ice@941cf51d`; Halli approved the scope on
2026-09-26). Branch `harvest2/lane9-ops`. Three ice PRs, read in full first (#90 `226b810e`, #62
`d873f0ef`, #183 `a5005e10`); code carries "Ported from icelandicstore #NNN" where it was ported.
No migration, no new strings. ENHANCEMENTS #33.

**1. The weekly expiry watch (ice #90).** `.github/workflows/secret-cert-watch.yml` runs Mondays
06:30 UTC and on dispatch. It fails when a TLS certificate on an instance hostname expires within 21
days, or a Key Vault secret expires within 30 days or carries no expiry stamp.
- **Where the judging lives.** ice scanned in inline bash inside the YAML. Here the workflow only
  gathers inputs (the host list, and `az keyvault secret list` → names, `expires`, `enabled` per
  vault) and `scripts/expiry-watch.js` judges them. The date arithmetic, both thresholds, the
  no-stamp rule, host validation and the trust check (a certificate the runner does not trust is a
  finding even with a good date) are pinned in `tests/unit/expiryWatch.test.js`. It reads the
  certificate with Node's `tls` (`rejectUnauthorized: false`, so an expired one is still read and
  reported with its date). Checked live against `www.orangesmiley.is`: 177 days, to 2027-03-22, the
  date DEPLOYMENT.md records.
- **Hosts.** The engine has no fleet manifest CI can read, so the host list is the `WATCH_HOSTS`
  repository variable (documented in the workflow header, `docs/DEPLOYMENT.md` §7 and RUNBOOK).
  Vaults are `WATCH_KEY_VAULTS`. ice hard-coded its four names.
- **Azure login.** deploy.yml's OIDC pattern, pinned to the same action sha. The job runs in no
  environment, so its subject is `ref:refs/heads/master`, which the deploy identity already has a
  federated credential for, and the three `AZURE_*` values must be REPOSITORY secrets. The identity
  holds Key Vault Reader: metadata only; nothing calls `secret show`.
- **Unarmed is green.** A plan step reads the variables and secrets (secrets cannot be tested in
  `if:`) and skips the vault half, or the TLS half, with a `::warning::`. A repo without Azure — any
  fresh downstream — is not red every Monday. An az failure once armed DOES fail the run: a watch
  that cannot read the vault is a finding.
- **The alert.** The engine already had a mail pattern (deploy.yml's Resend step on
  `ALERT_EMAIL_TO`/`_FROM` + `RESEND_API_KEY`), so the digest reuses it; unset, the failed run is the
  alert. Names and dates only.
- **No setup-node.** The script is dependency-free CommonJS and runs on the runner's Node, so the
  Node major stays pinned in its three places.
- **Also.** `workflowsParse.test.js` now fails any workflow `uses:` not pinned to a 40-hex sha.

**2. The role × route harness (ice #62).** `e2e/roles/{anonymous,user,seller,admin}.spec.js`, one
matrix in `e2e/lib/roleMatrix.js`, `npm run test:e2e:roles`. ice's harness had hand-kept route
lists per role and storefront selectors; the engine's is derived:
- **Routes** (`e2e/lib/routes.js`) come from `public/js/router.js` `ROUTES` — pattern, view module,
  guard (`canSeeView('<id>')` / `isAdmin()` / a session). The parse is cross-checked against
  `routePatterns.json` and `adminViews.js` at load and in `tests/unit/roleRoutes.test.js`. 33 public
  and 37 admin concrete routes today; `:param` routes are left out.
- **Roles** (`e2e/lib/roleSession.js`): a visitor, `user`, the engine-seeded `solumadur` (handbok,
  leads, accounts, commission) and `admin`, each on its own `e2erole_*` account seeded behind
  `targetGuard.js`, signed in once per worker through `POST /auth/login` and reused as storageState.
  A signed-in role's grants are read from `roles.view_access`.
- **Checks.** Click every public nav/footer link, and every admin sidebar line for a staff role (the
  sidebar must offer exactly the role's grants, minus switched-off modules and — for an all-views
  account — `identity.surface.hiddenAdminViews`). The visitor and the plain account open every public
  route: its view module loads, not the 404 view, no console error, no 5xx. Every role opens every
  admin route: with the view it opens (the URL kept, the shell, no `.admin-error`), without it it is
  refused (the URL replaced, no shell, the view's module never requested). Every public page, and
  every admin page for the admin, is measured at 375px after its desktop check, in the same load.
- **Gate.** A route of a switched-off module or of a feature `features/local.json` hides/disables/
  forks is skipped with the reason; a product without `solumadur` skips the seller spec.
- **Speed.** The public sweep runs for the visitor and the plain account only (the staff roles still
  click through the public nav); 228 tests after merging master `912d221` (lane 7a added admin routes — they were walked the day they arrived), ~1.7 min locally on 4 workers.

**What it found (22 failures on the first run, one more on the second: four bugs, all fixed on the branch in the "fix(spa)" commit).**
1. `/admin/monitoring`, `/admin/mcp` and `/admin/projects` painted the HOME page under their own URL
   for the seller and the plain user (6 failures): their factories fall back to `new HomeView()` in place, and only
   `/admin/roles` had an early redirect. `router.js` now redirects all four (`ADMIN_ONLY_PATHS`, and
   `/admin/projects` on its view or the editor carve-out). UX only — the server gates their APIs.
2. Eight admin screens scrolled the page sideways at 375px. Title rows and toolbars that never
   wrapped (accounts, projects, customers, orders, ledger), tables with no scroll box of their own
   (VAT, books settings, projects, customers), and the till's one-column `1fr` grid widened by the
   scan field. One phone block at the end of `admin-shell.css`, the roles-grid fix
   ([fix-roles-phone-overflow-2026-09-26](2026-09-26-fix-roles-grid-phone-overflow.md#fix-roles-phone-overflow-2026-09-26)) made general. A table
   already inside `.admin-table-wrap` is untouched; wider screens are unchanged.
3. The analytics charts held the page 960px wide after a resize down: a `1fr` track's minimum is its
   content, and a Chart.js canvas is as wide as it was last drawn, so the chart could never shrink.
   `minmax(0, 1fr)` in `analytics-admin.css`. (It showed on the second run only — the first measured
   before the chart had drawn — which is why the 375px check now polls for 3 s before judging.)
4. `/halli` and `/about` (hidden portfolio) scrolled 73px sideways until the scroll-reveals ran: a
   `translateX(56px)` start counts toward scrollable width. `overflow-x: clip` on `.halli-bio`.

**3. TEST-stack sample rows (ice #183) — only the gap.** Master already has a demo instance
([demo-instance-2026-09-26](2026-09-26-feat-demo-mode.md#demo-instance-2026-09-26)): its own
stack, its own database of sample data, rebuilt nightly, seeded by the product-owned
`server/demo/seed.js`. That covers "a place to demo with invented data". It does NOT cover ice's
case: a TEST stack running the production image, on a copy of production's data (ice clones PROD
into TEST weekly), that wants a few invented rows production must never get. A migration cannot
carry them — promotion ships the whole image — and the demo instance's gate (`APP_ENV=demo`, a
"demo" database, a nightly `DROP SCHEMA`) must never touch such a stack. So only that gap came up:
- `server/demo/testStackData.js` — PRODUCT-OWNED datasets, `{ name, statements }`, with ice's four
  rules in its header (idempotent, natural keys, labelled, non-destructive). The engine ships none.
- `server/services/testStackSeeder.js` — `applyTestStackData()` after `migrate()` on every boot
  (which also restores the rows after a PROD→TEST clone). Gate: `APP_ENV` exactly `test` (never
  NODE_ENV, which is `production` on TEST and PROD alike; not `development`, a laptop goes through
  the script), not a demo instance, and no `prod`/`production`/`live` word — nor targetGuard's `books`/`ops`,
  added after review — in the database host or name (libpq `?host=`/`?dbname=` included) — the fleet's servers are `<x>-prod-pg` / `<x>-test-pg`, so a PROD app given `APP_ENV=test`
  by mistake is still refused. One transaction per dataset (ice ran statements bare, so a half-
  applied dataset stayed half-applied); never throws.
- `npm run seed:test-stack` (`server/scripts/seed-test-stack.js`) forces past the gate for a LOCAL
  database only, after `targetGuard.js` (ice's `seed:demo` only printed a warning). `targetGuard` is
  not the boot gate: it refuses any Azure host and any App Service process, i.e. every real TEST
  stack.
- Tests: `tests/unit/testStackSeeder.test.js` (24: both directions of the gate, production hosts
  and names, NODE_ENV ignored, the engine list empty, the boot order) and
  `tests/integration/testStackSeeder.test.js` (6: nothing written off TEST, idempotent across two
  boots, a failing dataset rolled back alone, a demo instance left alone, the script refusing an
  unguarded target).
- Not ported: ice's DEMO-RVK tee grid and its migration 097 (customer data), the Jest heap bump
  (ice CI). ice can move its datasets into `testStackData.js` at its next graft and drop its seeder.

**Tests.** Unit 2843 passed (1 skipped, 1 todo) after merging master `912d221` and the review fixes; full Jest 5422 passed before them; the new unit suites
are `expiryWatch` (26), `testStackSeeder` (24), `roleRoutes` (4) and the sha-pin cases in
`workflowsParse`; integration `testStackSeeder` (6). Full Playwright suite on `E2E_PORT=3029` after the
merge: 522 passed, 6 skipped (lane 3's review screenshots, skipped by design), 0 failed — the
harness's 228 among them.

**Review.** `invariant-reviewer` on `git diff origin/master...HEAD`: no FAIL; one WARN and six NOTEs.
- WARN, fixed: the seeder's production-word check lacked targetGuard's real-records names, so an
  ops or books database given `APP_ENV=test` by mistake would have passed. It now refuses `books`
  and `ops` too (this engine is about to run the company's own books, D-017/D-020).
- Fixed: libpq `?host=` / `?dbname=` / `?database=` overrides are judged like targetGuard does;
  the product's data file is required INSIDE the never-throw (a default parameter ran outside it —
  now pinned by a unit test with a throwing module); checkout drops its credentials
  (`persist-credentials: false`); a whitespace-only `WATCH_HOSTS` / `WATCH_KEY_VAULTS` counts as
  unset; `docs/ENGINE-SYNC.md` §7 says a downstream that fills `server/demo/testStackData.js` (or
  `seed.js`) lists it in `productPaths` in the same change.
- Won't fix: echoing a bad `WATCH_KEY_VAULTS` entry in an `::error::` line. Only maintainers set the
  variable, and the name in the message is what makes the error useful.
- Not taken: making the sync tooling protect the two stubs by default (`FIXED_PRODUCT_PATHS` →
  `.gitattributes merge=ours`). In the engine itself that would also apply to master → branch
  merges and could silently keep a branch's stale stub; the productPaths rule is enough.
