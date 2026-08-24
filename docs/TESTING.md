# Test tiers — run the right suite for the change

_Introduced 2026-08-24 (Halli's ask: a 1-line prod fix must not cost a full-suite run). The tiers change the **inner loop**; the merge gate is unchanged — every chunk still merges only with the FULL suite green, and CI (`test:ci`) still runs everything._

## The tiers (timings measured 2026-08-24 on the dev machine)

| Command | What | Size / time | DB |
|---|---|---|---|
| `npm run test:unit` | All of `tests/unit/` via `jest.unit.config.js` — no globalSetup (no DB drop/migrate), parallel workers | 981 tests, **~8 s** | none |
| `npm run test:smoke` | Critical-path integration specs: auth, security (CSRF/RBAC/headers/envelope), shop, contact (lead capture) | 112 tests, **~28 s** | yes |
| `npm run test:hotfix` | unit + smoke, in that order | **~36 s** | yes |
| `npm run test:related -- <files…>` | Jest picks every test that (statically) depends on the named source files | varies | maybe |
| `npm test` | Everything (unit + all integration, serial) | ~2012 tests, minutes | yes |
| `npm run test:e2e:smoke` | Playwright: auth, navigation, business-routes | subset of 109 | yes |
| `npm run test:e2e` | Full Playwright suite | 109 tests | yes |

## The hotfix workflow (production bug)

1. **Reproduce as a failing test first** — in the tier where it belongs (a controller bug → integration spec; pure logic → unit).
2. Fix it.
3. Run `npm run test:hotfix` **and** `npm run test:related -- <every file you touched>`. Total cost ≈ one minute.
4. Push the branch — CI runs the full suite with coverage exactly as before. CI green is still the deploy gate; the tiers only buy you a fast, high-confidence local loop.
5. If the fix touched auth, payments, RBAC, migrations, or the error envelope: run the full local suite anyway before pushing. Those surfaces are why the smoke tier exists, but they deserve the whole net.

## Rules

- **The smoke list is per-instance.** It names this instance's revenue/security-critical paths. When porting this scheme: icelandicstore's list should be auth, security, shop/orders, adminBookkeeping + the Stripe webhook specs — not `contact`. Keep the list short enough to stay under ~30 s; it is a tripwire, not a safety net.
- **A prod bug that escaped the suite earns a permanent test** in the tier that would have caught it fastest — and if that test is critical-path, it joins the smoke list.
- **Never delete inherited specs** (stack invariant: adapt, don't delete). Tiering reorganizes when tests run, never whether they exist.
- `jest.unit.config.js` derives from `jest.config.js` — config drift between them is a bug. New unit specs must stay DB-free; a unit spec that needs Postgres belongs in `tests/integration/`.

## The structural next step (engine work — belongs upstream in rekstrarkerfid)

Integration runs serially (`maxWorkers: 1`) because all suites share one `orangesmiley_test` DB — `tests/globalSetup.js` documents the race. The estate already solved this shape for Playwright with per-branch e2e DBs (`e2e/lib/dbUrl.js`). Applying the same idea per Jest worker (`orangesmiley_test_w${JEST_WORKER_ID}`, one migrate per worker DB) would parallelize the integration tier and cut the full suite by roughly the worker count. That is a change to the engine's test harness: build it once in the upstream repo and let every instance inherit it — do not hand-build it per instance.
