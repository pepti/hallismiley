<a id="engine-sync-gaps-2026-09-26"></a>

## 2026-09-26 — The gaps today's engine syncs found: suites that depend on their neighbours, tests that named a product, the nav that scrolled phones sideways

Halli approved the fixes the same day ("Implement all findings and fixes"). Today's engine
syncs into LedgerLink (orange-smiley/ledgerlink#14) and hallismiley (pepti/hallismiley#174)
each carried hand re-applied engine tests; master CI was red on most of the day's merges. All
of it was engine-side; the fixes are generic (they read the identity seam, the module switches
or the feature gate, never a product name).

### What was wrong, and the fix

**Suites that passed only by luck of scheduling.** A Jest worker's database outlives each file,
and `cleanTables()` (DELETE over the users FK closure) leaves `products` and `roles`, among
others, alone. Every case was reproduced first by running the pair in ONE worker
(`--runInBand` plus a test sequencer that honours the given order), and re-run green in both
orders after the fix:

| Failing suite | Left behind by | Fix |
|---|---|---|
| `booksPos` "the receipt list" (LedgerLink CI 36259126420) | `adminHome` — tenderless receipts numbered 900001+ inserted straight into `invoices`, still there after its last test | booksPos lists its own days only (`from: DAY, to: NEXT_DAY`, the 2018 year no other suite writes); adminHome runs `cleanTables()` in `afterAll` |
| `adminHomeAttention` "every card counts…" (3 where 2 was expected, master) | any suite leaving an active product at stock 0 (reproduced after adminInventory, goodsReceipts, inventoryThreeNumbers, productMerge, shop, import/export) | the sold-out card is held to the linked list's own count, and this suite's two products must be exactly the ones out among them |
| `loginExpiry` "other staff stay time-limitable" (master CI 36260175513, FK `user_roles_role_name_fkey`) | `adminRoles` — `DELETE FROM roles WHERE is_system = FALSE` removes the MIGRATION-seeded roles (solufolk, solumadur, verktaki) | adminRoles snapshots `roles` in `beforeAll` and restores it in `afterAll` — read from the table, so every product's seeds come back (81567f9's re-seed in adminOuterGuard worked around the same leak) |
| `media` "deletes disk file…" (master CI 36258240196) | `videos` on ANOTHER worker: both made project 1 (each worker restarts the serial), and videos' `afterEach` rmSync'd `public/assets/projects/1/` | fixed on master meanwhile by [security-hygiene-2026-09-26](2026-09-26-fix-security-hygiene-2026-09-26.md#security-hygiene-2026-09-26) (per-worker `UPLOAD_ROOT`); this branch's per-worker project-id offset (`workerScopedProjectIds()`) was dropped at the merge as a second mechanism for the same thing |

**Engine tests that named a product's IA.** `moduleFlags` "the core still answers" requested
`/is/thjonusta` and asserted `index, follow` — LedgerLink and hallismiley hide `/thjonusta`
and carried a re-applied copy. It now takes the first page of the public IA
(`publicSurface.publicNav()` + `legalRoutes()`, minus `isDeindexedRoute`) under the locale
prefix from `tests/lib/locale.js`, home if a product links none. `withEnv` now runs each case
inside `jest.isolateModulesAsync`: with the synchronous `isolateModules`, a module required
LAZILY after the block (the MCP `environment_info` handler's `require('config/modules')`)
resolved in the file's main registry, so that case passed only while nothing at the top of
the file had loaded `config/modules` under the default env first — adding the
`tests/lib/locale` require did exactly that, and the preset read "all".

`adminHome` "what the instance lacks": the HTTP half (run where the product hides `orders`,
`bins` and `pos`) read `salesToday.partial`; LedgerLink hides `invoices` too, so it keeps no
sales channel and there is no figure. The test now reads `HIDDEN` (the seam plus
`disabledAdminViews()`): with `invoices` hidden, no `salesToday` and no payments in the feed;
otherwise the wholesale channel alone with `partial: false`. Proven by running `adminHome` and
`moduleFlags` with LedgerLink's shape through the env seam
(`CLIENT_CONFIG_IDENTITY_SURFACE_HIDDEN_ROUTES` + `/thjonusta`,
`CLIENT_CONFIG_IDENTITY_SURFACE_HIDDEN_ADMIN_VIEWS` + `invoices`): 21/21.

**`architectureIndex`'s PLAN.md guard.** "PLAN.md links a `docs/history.d/` fragment" bound
every repo; `PLAN.md` is product-owned and a downstream's may not link one yet (both syncs
added a line only to satisfy it). It is its own test now: always in the engine
(`engine.json.role`), and in a downstream once its `PLAN.md` mentions `history.d/` at all — a
link written there that the parser misses still fails.

**The nav scrolled every signed-in phone page sideways** (e2e `admin-roles-grid` "on a
phone", red on every master since lane 3; eb56790's fix to the title row did not reach it).
Measured locally by narrowing the viewport: the brand column was `flex: 0 0 auto`, so when the
row ran out of room the RIGHT cluster shrank — the account button went below its content
(34 px for 62) and its caret poked past the edge. At 375 px it fitted by 2.5 px on Windows
fonts with the e2e TEST pill in the brand; on CI's Linux fonts it did not (1 px). At 320 px it
overflowed by 53 px on any machine. At ≤ 1024 px the brand now shrinks (`flex: 0 1 auto`,
`min-width: 0`, the wordmark ellipsises) and `.lol-nav__right` keeps its size
(`flex-shrink: 0`). The spec now also checks 320 px, which fails (53) without the CSS and
passes with it; overflow is 0 at 375/360/340/320 signed in and out.

### site-factory (engine-sync.js)

- `--worktree` read `engine.json` from the main checkout while cutting its branch from
  `origin/<default>`, so a checkout on a branch without one (LedgerLink's) was refused. It now
  reads it with `git show origin/<default>:engine.json` (`L.readEngineJsonAt`).
- A `package.json` conflict next to a `package-lock.json` one ran
  `npm install --package-lock-only` on a file with conflict markers, failed with exit 1 and
  wrote no state, so `--continue` could not resume. The state file is written before any step
  that can stop the run; a `package.json` conflict defers the lock regeneration to
  `--continue` (`st.lockPending`) and stops with exit 3; a failed regeneration is exit 3 too.
- Smoke sections 10–11 (5 checks, a fake `npm` first on PATH; 4 more after the review); the first five fail on the previous
  code. `docs/ENGINE-SYNC.md` §5/§10 say both.

### The admin-home seam — decided with evidence, implemented

LedgerLink's `/admin` is its own ledger overview (`LedgerAdminOverviewView`); every case of
`e2e/admin-home.spec.js` failed there on the sync PR's CI (renders the blocks, 390 px phone,
the three theme cases). The feature gate already is the product seam for this —
`features/local.json` `{ "<feature>": { "status": "forked" } }` skips a feature's engine specs
with the note — but "Í dag" lived inside `admin-shell`, and forking that would have silenced
the sidebar's, the surface-hiding and the page-width specs too. So "Í dag" is its own feature
now, [`admin-home`](../../features/admin-home.md) (AdminView.js, the route, the service and
its cache, `admin-idag.css`, the suites and the e2e spec, moved out of `admin-shell`). No new
config key and no runtime code: a product whose `/admin` is its own records
`"admin-home": { "status": "forked", "note": "…" }` and the spec skips; the endpoint's Jest
suites keep running (they do not gate). Small and generic, so it was implemented rather than
proposed in ENHANCEMENTS.md.

### Master CI (checked 2026-09-26, `gh run list -b master`)

Every red run since d0d99ad was one of: the roles-grid phone overflow (fixed here), the
loginExpiry/adminRoles leak (fixed here), the media/videos upload-dir race (fixed here, seen
once), or cancelled by a newer push. None belonged to another session's in-flight lane.

### Not done / owed

- LedgerLink: at its next sync, add `"admin-home": { "status": "forked", … }` to
  `features/local.json` and drop the re-applied `moduleFlags` / `adminHome` hunks and the
  PLAN.md line added for the guard; hallismiley can drop its `moduleFlags` re-apply.
- LedgerLink's three theme-contrast failures (`--on-accent` on the cobalt `--gold`,
  black-sand's inherited gradient and `--error` wash) are the product's own token decisions
  (Hönnuður / Eva), not engine gaps.

### Review

**Engine** — `invariant-reviewer` on the branch diff: PASS, no invariant violation. Findings:
- Low, fixed: adminHome's `afterAll` claimed to leave the DB "as we found it" but still left
  its `home-*` products and roles and the filled `general.*` / `books.seller_*` settings — it
  now deletes those by name and restores an `app_settings` snapshot (§20 rule 1 says so).
- Low, fixed: this fragment's Review section was a stub.
- Low, won't fix: end the isolated app's pool inside `moduleFlags`' `withEnv`. Not a
  regression (the synchronous form leaked the same pool), and ending an app pool under its
  fire-and-forget writes is exactly what `jest.config.js` warns against; `test:ci` runs
  `--forceExit`.
- Low, won't fix here: an e2e pin that the wordmark is not truncated at 375 px WITHOUT the
  test env. The e2e server always runs as the test env (the TEST pill is in the brand), so
  the pin cannot be written against it; measured instead: production (no pill) truncates
  only signed in at ≈ 340 px and below, by a few characters, and the link keeps its
  `aria-label`.
- Info: the rest of `moduleFlags` still requests `/is/...` literals — both locales are
  served, so they hold in an EN-default downstream; left as they are.
- Info: the roles snapshot restores rows the table held when the file started — a seeded
  role deleted by an EARLIER suite would not come back; no suite does that today.

**site-factory** — a general review of 733e56f: nothing blocking. Fixed in b62d970: the
state file is written right after the merge (a modify/delete lock conflict used to exit 1
with no state; the lock now takes ours when the engine deleted it); the lock is regenerated
only in `finish()`, after every conflict is resolved (a failing npm no longer hides the
conflict list), through `L.npm` (no DEP0190 warning); `--no-tests` keeps the lock as merged
and says so; every exit-3 and verification message prints the exact `--continue` command
with `--repo`, and `--continue` against the main checkout after a `--worktree` sync names
the worktree; the dead second fetch is gone and a missing `origin/<default>` after the
fetch has its own message. Four more smoke checks pin them. Left: `--worktree --dry-run`
creating and leaving its worktree (pre-existing), and a smoke check for a checkout whose
`engine.json` DIFFERS from origin's (the fix covers it; only the no-file case is pinned).
