# Lessons — Orange Smiley

Running log of what this engagement taught us. `/retro` reads this file at the end of the project and folds the generalizable entries back into site-factory (or the HalliProjects base).

**Append as you go, while it is fresh** — a lesson written at the end of the project is a lesson half-remembered. One entry per surprise: something that cost time, broke unexpectedly, or turned out to work better than the obvious approach.

Mark each entry so `/retro` knows where it belongs:

- **factory** — every future customer hits this → `site-factory/template/`
- **base** — belongs in the HalliProjects engine → the base repo
- **project** — specific to Orange Smiley, stays here

## Entries

### 2026-08-09 — scaffolded

_(project)_ Project created from the base by site-factory. Nothing learned yet.

### 2026-08-09 — setup.ps1 createdb hangs on password prompt

_(factory)_ `setup.ps1`'s `createdb <name>` runs as the Windows user with no `-U`/`PGPASSWORD`, so on a box where Postgres only has the `postgres` role it blocks forever on an interactive password prompt (and in a non-interactive agent run it hangs until killed). Fix for the template: use `createdb -U postgres` with `PGPASSWORD` from env, or `--no-password` so it fails fast instead of prompting. Also create the *test* database (`<name>_test`) — `tests/env.js` needs it and setup.ps1 only creates the dev DB.

### 2026-08-09 — setup.ps1 git commit fails without git identity

_(factory)_ The final `git commit` in `setup.ps1` dies with exit 128 ("Author identity unknown") on a machine with no global `user.name`/`user.email`, but the script still prints "Initialized git and committed scaffold." — misleading success message, empty repo. Template fix: set repo-local identity (or check for one) before committing, and fail loudly. Recovered here by `git config user.name/user.email` (repo-local) + manual first commit.

### 2026-08-09 — Jest suite silently depends on the developer's .env APP_URL

_(base)_ `tests/env.js` doesn't set `APP_URL`, but dotenv injects the developer's `.env` into the test process, and `ssrMeta.test.js` asserts absolute URLs on the canonical host. On the base machine `.env` happened to match; on a fresh scaffold with `APP_URL=http://localhost:3000` four ssrMeta tests fail. Fixed by pinning `process.env.APP_URL` in `tests/env.js`. Base fix: same pin upstream — tests should never inherit unpinned env from `.env`.

### 2026-08-09 — dev-server.ps1 polls port 3001 but the app binds .env PORT (3000)

_(factory)_ `scripts/dev-server.ps1` defaults `-Port 3001` for its bind-check but never sets `$env:PORT` for the node process it spawns, which reads `PORT=3000` from `.env`. Result: server starts fine on 3000, script reports "ERROR: server did not bind port 3001" and exits 1 while leaving the server running — `npm run dev:up` "fails" on every fresh scaffold with a stock `.env`. Template fix: pass `$env:PORT = $Port` to the spawned process, or read the port from `.env` for the check. (`dev:down` still works — it kills the recorded pid.)

### 2026-08-09 — tests/env.js hardcodes the base's test DB name

_(base)_ The base's test-DB name is hardcoded in FOUR places, and missing any one of them fails subtly: `tests/env.js` AND `tests/globalSetup.js` (each has its own `hallismiley_test` fallback — fixing only env.js makes globalSetup migrate the wrong DB while workers query the empty right one: "relation news_articles does not exist"), plus `.github/workflows/ci.yml` (test, e2e, smoke jobs) and docs (`RUNBOOK.md`). Base fix: derive the fallback from `package.json` name in ONE shared module, or have scaffold.js rewrite these files like it rewrites package.json.

### 2026-08-19 — base-sync fan-out: apply the base squash commits as patches, expect 3 kinds of drift

_(factory)_ Wave 6A applied the base engine’s six Phase-1 squash commits here with
`git apply -C1 --reject`. Five of six applied clean. The rejects came in exactly three shapes:
locale-shape drift (this instance is IS-first, so redirect assertions differ), structure drift
(ProfileView here mounts the background editors, so methods were spliced by anchor), and
i18n-context drift (keys land at different lines — insert by anchor KEY, never by hunk).
Migrations must be RENUMBERED per chain: the runner records by name, and three repos now own
the same numbers for different things (see site-factory/BASE-SYNC.md 2026-08-19).

### 2026-08-19 — two ways to delete a repo’s node_modules through an NTFS junction

_(factory)_ (1) `git worktree remove --force` on a worktree whose node_modules is a junction
recurses THROUGH the junction and empties the target repo’s packages — this emptied two
repos’ roots today and was first misblamed on npm. (2) `npm install` inside a junctioned
worktree rewrites node_modules wholesale, deleting through the link first. Rules: junctions
are for read-only tooling; delete the junction BEFORE removing the worktree
(PowerShell (Get-Item path -Force).Delete() removes just the link); installs need a real
npm ci. Symptom: husky says ‘eslint is not recognized’ — check ls node_modules | wc -l.

<!--
Format for new entries:

### YYYY-MM-DD — short title

_(factory|base|project)_ What happened, why it was surprising, and what to do instead next time.
Include the file path or command involved so the fix is actionable without this conversation.
-->

### 2026-08-09 — books archive pagination is not deterministic (flaky in full-suite runs)

_(base)_ `server/scripts/books-archive-export.js` pages documents with
`ORDER BY created_at LIMIT $1 OFFSET $2`. `created_at` is not unique, so when
rows are inserted while the export runs (every books suite shares one test
database) a row can be returned on two consecutive pages. Both manifest
entries then point at the same `documents/<id><ext>` destination, the second
`copyFile` overwrites the first, and `verify()` re-hashes those bytes against
the FIRST entry's `checksum_recorded` — which fails, while that entry was
recorded `verified: true`. Surfaces as `booksReports.test.js › archive export
› writes every file, and a manifest that verifies against them` failing in a
full `npm test` run but passing in isolation. Fix: order by a unique key
(`ORDER BY created_at, id`) — or better, keyset-paginate. Raised as an
ENHANCEMENTS.md proposal rather than fixed inside a job-2 UI chunk.

### 2026-08-09 — inherited e2e specs pin the OLD product, and only e2e catches it

_(factory)_ Jest stayed green through every job-2 chunk while two Playwright
specs silently described a site that no longer existed: `contact.spec.js`
drove the homepage inline form (moved to `/hafa-samband`) and
`editable-homepage.spec.js` drove the skills/stats inline editor (whose
sections the business home page stopped rendering, so the admin affordance
became unreachable). Neither is a server-side behaviour, so 2000+ integration
tests could not see them. Lesson for the factory flow: run `npm run test:e2e`
after every IA/composition chunk, not just at the end — and treat a removed
section as a capability question ("who edited that, and where do they go
now?"), not just a layout change.

### 2026-08-09 — a re-skin needs a contrast pass, not just a palette

_(factory)_ Swapping the dark charcoal/gold tokens for a light warm-neutral
orange set produced four separate WCAG failures that no test caught: the
brand orange (#F97316/#EA580C) is only 3.56:1 on white, so button labels,
the wordmark, the language toggle and the price unit all failed AA. Fix was
to split the token roles — `--gold` became #C2410C (5.18:1, carries white
text and works as small text) while `--gold-light` keeps the vivid #F97316
for hovers, glows and large display text. Worth adding to `/clone-ui`: after
re-hueing tokens, compute contrast for text-on-surface and text-on-accent
before declaring the re-skin done.

### 2026-08-09 — "default locale" must beat Accept-Language for a single-market site

_(factory)_ Job 2B made Icelandic the default by putting `PUBLIC_DEFAULT_LOCALE`
at the BOTTOM of the resolution chain, below Accept-Language. That reads
correctly ("default = what you get with no signal") and is wrong in practice:
a large share of Icelandic users run an English-language OS, so their browser
sends `Accept-Language: en-US` and the Icelandic business site served English
to its own target market. Every automated gate passed — the tests asserted the
chain I had written, not the outcome Halli wanted.

For a site aimed at ONE market, Accept-Language is noise: only an explicit
choice (URL prefix, `?locale=`, the switcher's `locale_choice` cookie, or a
signed-in preference) should move a visitor off the default. Removed it from
resolution on both sides — `server/middleware/locale.js`, the root redirect in
`server/app.js`, and `resolveUserLocale` in `public/js/i18n/i18n.js`. The
client half matters as much as the server half: if they disagree, the page
hydrates in a different language than the SSR `<head>` just advertised.

Factory lesson: when scaffolding a single-market instance, ask which language
wins for a browser that asks for something else — and test the OUTCOME
(`curl -H 'Accept-Language: en-US' /` → `/is/`), not the priority list.

### 2026-08-09 — a re-skin has to cover the pre-module chrome too

_(base)_ `public/js/consent.js` is a classic script that runs before the ESM
i18n layer, so it carries hardcoded English — meaning the very first thing a
visitor saw on the Icelandic site was an English cookie banner, and it linked
to `/privacy` (superseded by `/personuvernd`). Same class of miss: the static
`index.html` shell shipped `<html lang="en">` and an English skip link before
any JS ran. Anything outside the SPA's translation pass — consent banner,
skip link, `<html lang>`, `<title>`/OG defaults — needs its own locale
handling. Fixed by giving consent.js a small two-locale string table and
re-translating `body > [data-i18n]` in `main.js` after messages load.

### 2026-08-09 — the token system paid for itself on the second re-theme

_(project)_ Halli rejected the light business look ("too generic, like every
Claude-made page") and asked for the original dark hallismiley/LoL language
with orange instead of gold, plus the moving-background wow factor. The whole
visual flip — light SaaS → deep warm dark, sharp corners, Cinzel back,
gradient-metal headings, glows — took one rewrite of variables.css values,
~120 lines of hero/card CSS, and re-enabling machinery that job 2 had kept
instead of deleting (video hero mode, Cinzel woff2 files, glow tokens). The
"keep capability, change presentation" discipline is what made a same-day
full re-theme possible. Also: dark + orange clears WCAG AA almost everywhere
by construction (6.9–16.7:1), where light + orange needed shade surgery.

### 2026-08-10 — two agents, one checkout, one test DB

_(factory)_ Two Claude sessions worked this repo at the same time. The other
one committed its theme chunk and switched the shared working copy back to
`master`, moving this session off its feature branch mid-edit; worse, both ran
`npm test` against the same `orangesmiley_test`, and `globalSetup` drops and
recreates that database on every run. The result was 21 red suites and 218 red
tests that had nothing to do with either change — the exact race the comment in
`tests/globalSetup.js` predicts, but at a scale that reads convincingly like a
real regression. It cost a full baseline re-run to disprove.

Two habits close it: take the worktree *before* the first edit rather than
branching in the shared checkout (a worktree needs only a `node_modules`
junction and a copied `.env`), and give the run its own database —
`TEST_DATABASE_URL=…/orangesmiley_<chunk>_test`. Same suite, 72/72 and 2055/2055
green. Worth making the per-worktree test DB the factory default rather than a
thing you remember after being burned.

### 2026-08-09 — "port a feature from the sibling instance" is mostly a delta hunt

_(factory)_ Halli asked to copy icelandicstore's landing-background admin into
Orange Smiley. Orange Smiley already HAD the whole feature — same controller,
same `landing_background` site_content key — inherited from the base and
preserved only because `/strip-base` was never run. The real difference was
placement (icelandicstore mounts it inside ProfileView; the base put it on a
standalone `/admin/background` page) and one extra layer (sections + bilingual
captions + reorder). Lesson for `/clone-ui` and any future port: diff the two
instances BEFORE writing code — schema entry, controller exports, route table,
component — and port only the delta. Here that turned "copy 900 lines" into
"extract a shared component, add one migration and one component".

Two traps the delta hunt exposed: the destination table already existed with a
different shape, so the new migration had to `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` rather than `CREATE` (never edit the applied entry); and the source's
"enable library" flag gates a public /gallery page that does not exist here, so
copying it faithfully would have shipped a switch that visibly does nothing.
Ported features need a "what does this control HERE?" pass, not just a port.

### 2026-08-10 — the plan assumed a mechanism that did not exist

_(base)_ SELF-UPDATE-PLAN phase 2 said to send the manifest fetch "through the
existing SSRF-allowlist mechanism — add the release host to the allowlist
explicitly". There is no such mechanism. Grepping `server/` for it returns
nothing, and the reason is sound: every other outbound call in this codebase
goes to a hardcoded provider URL (Resend, Stripe, IndexNow, Anthropic), so
nothing ever needed one. The update checker is the first outbound fetch whose
URL comes from *configuration*, which is exactly the shape that needs a gate —
"fetch this URL and act on what it says" is the SSRF template.

The lesson is about how plans get written, not about the gap: a plan that says
"reuse the existing X" is asserting X exists, and that assertion deserves one
grep before the phase is scoped. Here it turned a one-line change into
`server/services/outboundAllowlist.js`. Worth checking whether the base wants
that module generally — the moment any customer instance fetches a
customer-configured URL, it does.

### 2026-08-10 — a security helper that ate its own code spans

_(project)_ `renderChangelog` applies inline Markdown to already-escaped text,
in order: code, bold, italic. Ordering it that way is the obvious defence
("code first, so its content is not re-read") and it is wrong — a later
`replace` runs over the whole string, including the `<code>` element the earlier
one just produced, so `` `a * b * c` `` came out as `<code>a <em> b </em> c</code>`.
Fixed by lifting code spans out to placeholders and restoring them last; the
placeholder is unforgeable because escaping strips null bytes first.

Two things generalise. Sequential regex passes over one string are not
composable — each one sees the previous one's output, so "do X first" does not
protect X. And the test that caught it was the one asserting a *product*
property (code stays code) rather than a security property; the security tests
all passed, because the bug was never exploitable, only wrong.

### 2026-08-10 — assert the property, not the substring

_(project)_ The first XSS tests for the changelog renderer asserted the output
did not contain `onerror` or `javascript:`. They failed on correct output:
`&lt;img src=x onerror=alert(1)&gt;` is escaped text and completely inert, and
`[click](javascript:alert(1))` is a non-link that stays literal. Both are the
sanitizer working. Rewritten to pull the actual `<…>` tags out of the output and
assert none is a script/img/iframe, carries an `on*=` attribute, or has a
`javascript:` attribute value — which is the property that matters and which a
substring check both over- and under-approximates.

### 2026-08-19 — an appended CSS hunk silently escapes its media query

_(factory)_ Wave 6D ported the icelandicstore row-tint CSS by appending the
new blocks to `admin-shell.css`. One of the "new" blocks was actually an
*edit inside* `@media (max-width: 640px)` (mobile `.admin-sidebar`
positioning, `static` → `relative`); appended at top level it became an
unconditional `.admin-sidebar { display: none }` and hid the admin sidebar at
every viewport width — in the base branch AND here. Two generalizations:
port CSS by *diffing rule-for-rule inside the selector's scope*, never by
appending anything that repeats an existing selector; and a quick brace-depth
check (count `{`/`}` up to the rule) catches an orphaned media rule in one
line of node.

### 2026-08-19 — a rotted fixture role masks the real failure

_(project)_ The same suite's failure had TWO stacked causes and the louder one
was the boring one: the dev DB's `testadmin` had been left demoted to role
`user` by some earlier run, so every admin spec died at the login/permission
layer — which read exactly like the CSS bug it was hiding. `setup-admin.js`
deliberately never updates `role` on conflict (so a prod-like DB can't be
escalated by re-running it), meaning fixture rot is permanent until repaired
by hand. When an admin e2e fails at *entry* (login, first admin click), check
the fixture row's role before reading any further into the diff.

### 2026-08-20 — a ported token set is only as right as the surface under it

_(factory)_ The nav-tint port carried two value sets — dark-on-light under
`:root`, light-on-dark under `html[data-theme]`. That mapping is correct in
icelandicstore, whose `:root` **is** a white Shopify-Dawn surface. Both
destinations invert it: the base's `:root` is charcoal and every one of its six
themes is dark; here `:root` is Ash dark and the only `data-theme` is `light`.
So each repo shipped its tints on the wrong surface and the feature was inert —
the default theme worst of all, because `classic` carries no attribute and
therefore silently takes whatever `:root` holds. Generalization: **when porting
theme tokens, port the surface assumption too.** The check is one line of
arithmetic (composite the wash, measure contrast against `--bg-surface` and
`--bg-hover`), and it is worth running for any ported design token, because CSS
never errors — it just renders something plausible and wrong.

### 2026-08-20 — a renamed test is not a ported test

_(project)_ Adapting the inherited theme suites from six themes to two by
substituting `'light'` everywhere left four tests asserting `'light' === 'light'`
in three different files: both logout-revert tests, the write-serialisation test
(whose slow/fast timing split also collapsed to slow/slow), and the social
kill-switch "switched ON" case, which set the flag to `'false'` and asserted 404
while claiming to cover the ON path. All four passed, so nothing looked wrong —
deleting the entire logout-revert block from `themePrefs.js` kept the suite
green. Generalization: after any bulk rename inside tests, **mutate the code the
test guards and confirm it fails.** A test whose two sides were distinct values
before the rename and equal after it has stopped testing anything, and the CI
badge cannot tell you that.

### 2026-08-20 — a hidden browser pane freezes CSS transitions mid-flight

_(factory)_ Verifying the five-theme set meant flipping `html[data-theme]` in
the page and measuring contrast from `getComputedStyle`. Three surfaces came
back wrong — the hero CTA stuck on `#9A3412` under every theme, the active nav
link at **1.03 : 1** against its own navbar — while surfaces one DOM node away
reported correct per-theme values. The tokens themselves were right on the
failing elements (`getPropertyValue('--accent-ink')` returned the ember value
while `color` returned the classic one), which is impossible for a plain
cascade bug and is what eventually gave it away.

The failing elements were exactly the ones carrying `transition: color`. The
Browser pane was not displayed, so the compositor produced no frames, `rAF`
never fired, and every running transition sat frozen at its *start* value —
which `getComputedStyle` faithfully reports, because the animated value is the
computed value. Injecting `* { transition: none !important }` before measuring
returned all five themes to sane numbers (min 5.01 : 1).

Generalization: **when scripting visual measurements, disable transitions and
animations first** — a transition mid-flight is indistinguishable from a
cascade bug in a computed-style readout, and a headless or hidden pane keeps it
mid-flight forever. Corollary for triage: if a token resolves correctly on an
element but the property that consumes it does not, suspect animation state
before you suspect specificity.

### 2026-08-21 — a detached <img> still downloads, so "it loaded" proves nothing

_(project)_ The scene engine built its `<picture>`, configured the `<img>`
(srcset, priority, load handler) — and never appended it. Nothing looked
broken from the inside: browsers fetch images the moment `src`/`srcset` is
set, connected to the DOM or not, so the photo downloaded, `load` fired, and
the `is-loaded` class lit. Every signal derived from the element itself was
green while the page showed only the blurred LQIP. The e2e caught it because
it asserted on the QUERIED element (`.ice-scene__img` attached, then
`naturalWidth > 0`), not on the class the engine sets for itself.
Generalization: **assert on what the DOM serves, never on the flags your own
code raises** — an implementation can satisfy its own bookkeeping while
delivering nothing.

### 2026-08-21 — computed-style tests race everything that repaints

_(project)_ Three Playwright failures in the new scene spec had one shape:
reading computed styles at a moment something else owned the pixels. Axe
flagged 10 contrast violations in the footer because the session-restore
`authchange` re-renders the view and axe sampled MID-fadeIn (opacity ~0.5
composites #4B4B50 ink to #a8a8aa); setting `data-theme` via
`page.evaluate` lost a race with `themePrefs.applyTheme()` on that same
authchange, silently reverting to classic. Fixes that hold: measure after the
page settles (the existing no-JS-errors spec already waited 2s — same
reason), and install state the way the app persists it (`ws_theme` in
localStorage before load, so theme-boot applies it pre-paint) instead of
poking the DOM from outside. Corollary of the 2026-08-20 lesson: a hidden
browser pane freezes transitions; a VISIBLE one still repaints on its own
schedule.

### 2026-08-22 — check a ported view's import graph before anything else

_(factory)_ Twice in one harvest, a copied admin view imported a service
module that didn't make the copy list (`adminEvents.js`, then
`adminMcp.js`). The failure is nothing like "one admin page broken": the
router imports every view eagerly, so ONE missing module kills the whole
SPA at load — which presents as ~150 e2e tests timing out on locators,
plus worker crashes once enough zombie browsers pile up. Fifteen-minute
suite runs, zero pointing at the actual file. The check that catches it
is ten lines: walk `from './…'` edges from main.js + router.js and stat
each target. Generalization: **after any multi-file port, verify the
full import graph mechanically before running anything expensive** — and
when a suite's character changes from "failures" to "everything slow",
suspect module load, not the tests.

### 2026-08-22 — don't edit the tree a suite is reading

_(project)_ A full Jest run was started in the background and the next
chunk's edits continued in the same working tree. Jest loads each suite
lazily, so later suites required half-edited modules: 64 failures across
six suites, none reproducible afterwards. The two fixes are discipline,
not code: park edits until the run lands, or run the suite from a
worktree snapshot. (The per-branch e2e databases from this same harvest
solve the DB half of this; the FILE half stays on the operator.)

## 2026-08-22 — project — full-bleed photo bands between themed sections read as "cutovers"

The Iceland home used alternating photographic bands (hero photo → frosted
cards on photo → next photo). Each band was individually polished, but
scrolling the seams between two unrelated photographs reads as a hard cut —
Halli rejected it the day after shipping ("I dont like how the cuttover
between background") and reverted the home page to the single-canvas
hallismiley composition. Lesson: stacked full-bleed imagery needs a shared
continuum (one photo, one gradient, or real transitions between bands) — a
sequence of beautiful-but-unrelated backdrops is experienced as seams, not
scenery. Inner pages with ONE band each survived the same review.

### 2026-08-22 — check the base before porting: our upstream docs were stale _(base)_ _(factory)_

Planned "port self-update to the base" as the first step of the product-repo
program — and found the base had already done it itself (its PR #134), with
the exact migration number (082_system_updates) our CLAUDE.md warned it would
use, while docs/UPSTREAM-SELF-UPDATE.md and CLAUDE.md here still said
"deliberately NOT performed". The base is an actively developed repo; a
read-only rule does not mean a frozen one. Lesson: before porting anything
base-ward (or claiming a gap), diff the actual trees — the whole "port" turned
out to be one workflow file (promote.yml). Corollary for the factory: the
scaffolder's generated setup.ps1 hangs on bare `createdb` when PG wants a
password, and a fresh repo has no git identity — both bit the rekstrarkerfid
scaffold and are noted in site-factory/BASE-SYNC.md.

### 2026-08-27 — RICH_TEXT_FIELDS misses secondary-locale bodies: body_is HTML was stripped on save

_(base)_ `server/middleware/sanitize.js` RICH_TEXT_FIELDS was `{body, content}` only, but the news CMS also submits `body_is` — so any Icelandic article body saved through the API had ALL its tags stripped by the global sanitizer (the seeded IS bodies only kept their HTML because migrations bypass Express). Found while building the sales handbook (whose EN sibling `body_en` would have hit the same wall). Fixed here by adding `body_is` + `body_en` to the set. Base fix: same addition upstream, plus a test that posts rich HTML in every `_is`/`_en` body field and asserts the tags survive.

### 2026-08-27 — the intermittent Jest flake IS the archive-pagination bug (ENHANCEMENTS #3)

_(base)_ **Superseded 2026-08-28** — the flake's actual cause turned out to be the `verify()` failure-line shape (see the "identified and fixed" entry below), NOT this pagination defect. The pagination defect itself (`ORDER BY created_at` without a tiebreaker) is still real and still ENHANCEMENTS #3, still awaiting Halli. Original diagnosis kept for the trail: **Identified.** It is `tests/integration/booksReports.test.js › archive export › writes every file, and a manifest that verifies against them` (line 433: a `documents/…` file that failed verification is not flagged `verified:false` in the manifest). That is exactly the defect already written up as **ENHANCEMENTS proposal #3**: `server/scripts/books-archive-export.js` pages with `ORDER BY created_at LIMIT/OFFSET`, and `created_at` is not unique — when two documents land in the same millisecond (which fast test inserts do intermittently, hence the flake), a row repeats across a page boundary, two manifest entries claim the same `documents/<id>` path, the second copy overwrites the first, and `verify()` then disagrees with a manifest that called the file verified. Fix is `ORDER BY created_at, id` (or keyset pagination) — **not implemented: ENHANCEMENTS items need Halli's approval before the fact.** Every instance inherits the bug, so it back-ports to the base. Method note that finally caught it: pipe the whole run to a file FIRST (`npm test *> jest.log`) and grep for `FAIL` / `●`; trimming the stream with `Select-Object -Last N` keeps the summary and drops the failure block, which is why six earlier runs left it anonymous.

### 2026-08-27 — an intermittent one-test Jest flake (superseded by the entry above)

_(project)_ During the sales-handbook program the full Jest suite reported `1 failed, 2567 passed` on two of six full runs; the other four were `2568 passed`, including immediate reruns with no code change in between. The failing test's NAME was never captured (the runs were piped through `Select-Object -Last N`, which kept the summary and dropped the `●` failure block). It is not related to the handbook work — one of the two failures happened on a content-only commit that the Jest suite never executes. Next time: pipe the whole run to a file FIRST (`npm test *> jest.log`) and grep the log, rather than trimming the stream. Prófari (qa-engineer) should hunt it with `--runInBand` + repeated runs; the suspects are the tests that share the single test DB and the in-process 30s role/user caches.

### 2026-08-27 — a stale e2e server on port 3000 makes the suite test the wrong database

_(base)_ `playwright.config.js` sets `reuseExistingServer: !CI`, and the per-branch e2e database name comes from the branch (`e2e/lib/dbUrl.js`). If a server from an EARLIER run is still listening on port 3000 — a run that was killed, or whose shutdown was missed — Playwright silently reuses it. Two things then go wrong at once: the `node e2e/global-setup.js && node server/server.js` command prefix never runs, so the current branch's database is never created; and the reused server is still connected to the PREVIOUS branch's database, so fixtures the specs seed are invisible to the app under test. The symptom is not "wrong database" — it is every spec timing out on `nav-user-btn` after login, which reads exactly like a broken login modal. Cost ~20 minutes chasing a non-existent regression. Check `Get-NetTCPConnection -LocalPort 3000 -State Listen` before believing a full-suite login failure. Base fix worth considering: have the webServer command fail fast when the server it would reuse reports a different `DATABASE_URL` (a `/health` field would do), rather than silently reusing it. Note the port that matters is 3000 — the dev/preview server on 3001 is unrelated.

### 2026-08-27 — the intermittent one-test Jest flake: a verify() failure line the test could not parse _(base)_

**Identified and fixed.** The flake was `booksReports.test.js › archive export ›
writes every file, and a manifest that verifies against them`. Nothing was wrong
with the archive: `verify()` in `server/scripts/books-archive-export.js` wrote
CSV failures as `<path>: <reason>` but document failures as
`<path> (<original_name>): <reason>`, and the test classifies failures by
splitting on the first colon — so a mismatched document's "path" came out as
`documents/<id>.pdf (reikningur.pdf)` and never matched the manifest entry the
archive had correctly flagged. The assertion therefore fails **whenever a
document whose bytes no longer match its upload checksum is present at export
time** — which is `booksExpenses.test.js`'s deliberately-tampered fixture, and
it is present only when that suite runs after the last `cleanTables()` before
`booksReports`. Jest orders suites by cached duration, so that neighbourhood
shifts run to run: one run in three. Fixed by giving every failure line the same
`<path>: <reason>` shape (name moved into the reason) + a regression test that
tampers a document and asserts `failure.split(':')[0] === entry.archived_as`.

Three method notes worth keeping:

- **Capture the whole run to a file** (`npm test *> jest.log`) — the original
  hunt was blind because `Select-Object -Last N` kept the summary and dropped
  the `●` block.
- **The Postgres server log is a run oracle.** `C:/Program Files/PostgreSQL/17/data/log/postgresql-*.log`
  still held both failing runs from that night: identical expected-error profiles
  and *no* database error at all, which killed the deadlock, connection-exhaustion
  and constraint theories before any code was read. Run boundaries are visible as
  bursts of "could not receive data from client" (Jest's `forceExit`).
- **Force the order to reproduce.** A 6-line custom `--testSequencer` that sorts
  by an env var turned "one run in three, eight minutes each" into a
  90-second deterministic repro (`booksExpenses.test.js` then
  `booksReports.test.js`). Keep that trick for the next order-dependent flake.

Also found while hunting, NOT the cause and NOT fixed: a fire-and-forget insert
that carries an FK to `users` (`EventLog.record` from the 5xx path and the
beacon) can deadlock against the next test's
`TRUNCATE … users … CASCADE` in `cleanTables()` — the insert holds
`event_logs` and wants `users`, the truncate holds `users` and wants
`event_logs` (CASCADE pulls it in). A 40-round probe hit it 4 times; the victim
is sometimes the test, which fails with `deadlock detected` in `beforeEach`.
It did not happen in the runs under investigation (the Postgres log has no
deadlock before this session), but it is a real single-test flake waiting to
happen if any test stops awaiting one of those writes.

### 2026-09-01 — a base security fix sat unsynced for two weeks because it landed on a harvest day _(base)_

Base commit `2b6842c` (2026-08-22, "fix(rate-limit): exempt static asset GETs
from the global limiter") reached `rekstrarkerfid` but never reached here.
Öryggisvörður's weekly SDL sweep flagged it twice — 2026-08-24 and 2026-08-31 —
before it was ported (this chunk). Two things are worth keeping:

- **Same-day commits fall between two ledgers.** 2026-08-22 is the date of the
  icelandicstore→here+base harvest (five chunks + base PRs #136–#140, ledger in
  `site-factory/BASE-SYNC.md`). `2b6842c` is a *base-only* fix that landed the
  same day, outside that fan-out, so both ledgers read as complete while a
  commit sat between them. Do not sync by date range or by "the program is
  closed" — diff by identifier: grep the new symbol (`STATIC_ASSET_RE`) in every
  live repo. That is exactly the check that caught it, and it is cheap enough to
  run for every base commit that introduces a named constant.
- **The fix has two halves that must move together.** The limiter exemption
  (`skip:` on the global limiter) and the `/{*splat}` catch-all's asset 404 are
  one change. `ssrMeta` only skips paths that carry a file extension, so porting
  the exemption alone would leave `/assets/<anything-without-a-dot>` with an
  HTML `Accept` header reaching the DB-backed meta renderer *outside* the rate
  limiter — a strictly worse posture than before the "fix". Anything that widens
  a limiter exemption needs the matching narrowing on the path the exemption
  opens, in the same commit, with the comment on each half pointing at the other.

### 2026-09-01 — uploads: alert, never block (and two ways the test lies)

_(base)_ Halli's standing product decision: **a large upload must always be
allowed to finish.** Throttling one is a broken-product experience — an admin
drops a folder of stills and the batch dies half-way through with a 429 that
looks like the product is broken. So `POST /api/v1/admin/background/media` is
carved out of the global limiter and the blocking backstop is replaced by
detection: `services/uploadVolumeAlert.js` writes a `warn` row into
`event_logs` when a burst is large, and the upload still completes.

This is base-tagged because it is a product rule, not a site rule — the same
carve-out belongs in every instance, and `rekstrarkerfid` currently has the
opposite shape (a blocking `backgroundUploadLimiter`, 1000/15 min) that
contradicts it.

Three things that cost time and generalize:

- **`skip:` chains are joined with `||`, not commas.** Appending
  `(req.method === 'POST' && …),` under the last clause terminates the arrow
  body and the object literal, so the file stops parsing. A `grep` for the new
  constant "verified" the patch and said nothing — greping for a symbol proves
  presence, not syntax. `node --check` on every file you machine-edit, before
  running anything slower.
- **`event_logs.user_id` is `TEXT REFERENCES users(id)`, and `EventLog.record`
  swallows its own errors by design.** So a test that alerts against a made-up
  user id gets its row dropped by the FK, silently — and any assertion of the
  form "no row appeared" then passes for entirely the wrong reason. When
  testing a fire-and-forget writer, always assert the positive case against a
  real FK row first, or the negative cases are worthless.
- **`UPLOAD_ROOT` resolves to the COMMITTED `public/assets/` tree under
  `NODE_ENV=test`.** An upload test that does not clean up leaves real binaries
  in the repo — three PNGs made it into the working tree here. Clean up by
  diffing the directory before/after, never by parsing the handler's response
  for a path: the payload key is not part of the test's contract, and guessing
  it wrong fails silently and litters every single run.

## 2026-09-01 — a content pass that edits code changes nothing (project)

R1 rewrote the homepage and contact-page fallback constants in the view files,
and the site kept showing carpentry copy. `home_skills`, `home_stats` and all
six `contact_*` keys are **seeded by applied migrations** (007, 017, 030,
036–038), so `site_content` always has a row, the API never 404s, and the code
fallback is dead code on any instance that has ever run migrations. The
fallbacks are only reached on a database that predates the seed — which is no
database.

The tell: the exploration pass reported "no seed migrations exist for home_*",
which was true for `home_hero` and `home_discipline` (they 404 in dev) and
false for the two beside them. Per-key, not per-prefix.

The fix pattern, now in migrations 091 and 092: update the rows, guarded on
`updated_by IS NULL`. Seeds and migrations leave that column null;
`contentController` stamps the admin's id on every save. So the migration
replaces only copy nobody has edited, an instance where the customer wrote
their own text keeps it, and re-running is a no-op — idempotent without a
version flag.

Also worth remembering: JSON going into a migration's SQL string passes
through a JS template literal first, so `\n` inside a JSON value must be
written `\n` (migration 030 already did this). Written as `\n` it becomes a
real newline inside a JSON string literal and Postgres rejects the jsonb cast
— caught here by parsing every generated statement back before committing.

### 2026-09-01 — a scripted splice into schema.js ate `$'` out of a CHECK regex _(project)_

Migration 093 was spliced into `server/config/schema.js` by a node script that
derived the statements from the reference `.sql` and then did
`js.replace(marker, entry + marker)`. JavaScript's `String.prototype.replace`
treats `$'` inside a *string* replacement as a pattern — "the text after the
match" — so the kennitala CHECK `'^[0-9]{10}$'` came out as `'^[0-9]{10}`
followed by the tail of the file. The `.sql` reference copy was correct, the
transactional runner rolled the migration back cleanly on both DBs, and the
error ("syntax error at or near annad") pointed at the next token, not at the
damage — which is why it took a JSON.stringify of the stored statement to see it.

Fix: a function replacer, `js.replace(marker, () => entry + marker)`. The same
trap covers `$&`, `` $` ``, `$1`… Rule: when generated text goes through
`replace()`, pass a function, never a string — a regex literal in SQL is
exactly the kind of content that contains `$'`.

### 2026-09-02 — CI never ran: the workflow triggered on `main`, the repo's branch is `master` _(factory)_

Three weeks of "CI green" were local runs. `ci.yml` (scaffolded from the base, which uses `main`) listened on `branches: [main]`; this repo was initialised on `master`, so GitHub showed 0 Actions runs while every ledger entry recorded green suites. Found while planning the icelandicstore harvest. Fixing the trigger to `master` and pushing produced… still no run: **GitHub Actions is disabled on the repository** (`actions/permissions` → `enabled:false`), which only an owner can flip in Settings → Actions. Dependabot's "Dependabot Updates" runs exist regardless, which is what made the Actions tab look alive. Fix here: trigger on `master` (done) + Halli enables Actions. Template fix: `setup.ps1` should write the trigger from the branch it actually creates (or create `main`), and `/status` should compare the workflow's branch filter with `git symbolic-ref refs/remotes/origin/HEAD`.

### 2026-09-02 — a ported view without its stylesheet _(factory)_

The 08-22 H4 harvest ported `AdminMonitoringView.js` and its i18n but not `admin-monitoring.css`: every `mon-*` class rendered unstyled for eleven days and nobody noticed because the page still worked. The 08-22 lesson said "check the import graph of a ported view FIRST" — that graph is JS-only. Add the CSS side: grep the ported view's class prefixes against `public/css/` and the `@import` list in `main.css` before calling the port done.

### 2026-09-02 — per-worker Jest databases: the name must keep the `_test` suffix, and the migration must be a child process _(base)_

Ported from ice #225/#233. Two traps that would each have cost a run: (1) `globalSetup` refuses to drop anything not ending in `_test`, so the worker id goes BEFORE the suffix (`orangesmiley_w2_test`, template `orangesmiley_tmpl_test`), never after; (2) `CREATE DATABASE … TEMPLATE` refuses while any session holds the template, so migrating in-process (the old globalSetup did) would hang the clone — the migration runs as a child `node server/scripts/migrate.js` that has fully exited before the clone starts. And the ice warning that the first parallel validation lost 16 suites to a well-meant `afterAll pool.end()` still applies: the app has fire-and-forget writes that land after the last test. Result here: 2595 tests in 112 s (4 workers) vs 8m20s serial.

### 2026-09-02 — this repo stores several files as CRLF; textual anchors written with \n silently miss _(project)_

The first harvest edit script failed on `server/config/database.js` because the file is CRLF on disk (so are `tests/helpers.js`, `ci.yml`, most of `server/`); git normalises on commit, so diffs never show it. Any scripted edit must normalise on read and restore on write, or it reports "anchor not found" on text that is visibly there. Shell heredocs were worse: Git Bash on Windows mangled quoting in three different ways. Ports now go through a node script with count-asserted anchors.
## 2026-09-02 — an inverted default theme leaves every hardcoded colour pointing the wrong way (project)

Halli: "Bjart has white fonts, that makes no sense." He was right, and it
was wider than one font. When `:root` flipped from Ash (dark) to Bjart
(light) on 2026-08-20, the token VALUES flipped with it — but `home.css`
still carried literal colours for the skills, stats, contact and
"browse by discipline" sections (`#FFFFFF` titles, a cool `#A9B4C0` grey,
`#1E2328` ink on a fixed `#EDEBE5` band), written for a charcoal page.
White on cream: 1.0 : 1. Nobody saw it because the copy under those
titles was the carpentry portfolio and nobody looked at the section.

Two more of the same shape, exposed by the brown re-hue rather than the
inversion: the project-card badges took `--gold` / `--teal` as text on a
fixed-dark pill (bright on Ash, brown / brown-black now — 1.04 : 1), and
the um-okkur email link used `--gold-dark` as text, which ember documents
as "gradient tail and border only".

The tool that found them, now `scripts/audit-text-contrast.js`: walk the
DOM, composite each text node's background through its ancestors, WCAG
AA per node, per page, per theme. It reported 28 failing rows; a grep for
hardcoded hex would have found the same lines but not told me which ones
mattered. Its blind spot is worth knowing: it sees ancestor backgrounds
only, so text over the scene engine's photo (a *sibling* layer) reports as
cream-on-cream. Those are judged by screenshot, and the contact hero is
fine.

The rule that falls out: **no literal text colour outside a fixed-surface
context**. A fixed-dark surface (the video hero, a badge pill over a
photo) may carry a fixed-light label — that is the media-hero pattern and
it is correct by construction. Everything else is a token, or it breaks
the next time a theme flips.

## 2026-09-02 — the e2e suite quietly tested the other repo (factory)

`npx playwright test` reported 104 failures, every one a `waitForSelector`
timeout on a login. The CSS was innocent: `playwright.config.js` reuses an
existing server on port 3000 locally, and 3000 had a 13-hour-old
`node server/server.js` on it — the **rekstrarkerfid** dev server, whose
launch.json owns that port. The suite ran this repo's specs against the
product site's routes and database. The config's own comment predicts
exactly this; the estate now has two base-scaffolded repos, so it is no
longer hypothetical.

Do not change the default: CI pins `ALLOWED_ORIGINS` to `localhost:3000`
for the e2e job. Locally, whenever the sibling is up:

    E2E_PORT=3011 npx playwright test

That boots this repo's own server against its isolated e2e database
(162 passed, 1.4 min — the reused run took 5.6 min to time out). A run
that is suddenly slow and fails only on auth is this trap, not a bug.

## 2026-09-02 — the contrast audit sampled mid-transition, and only a theme reorder exposed it (factory)

`scripts/audit-text-contrast.js` loads each page once and switches themes by
flipping `data-theme` live, sampling 140 ms later. The site's controls carry
`transition: all 300ms`, so a sample taken after a switch read interpolation
frames between two themes' colours — values that matched no token and that
came and went between runs (a button at 4.33 : 1 in one run, a different
button at 3.94 in the next). It never showed while `classic` was sampled
first, on a freshly loaded page; the day Glóð became the default and moved to
the front of the list, Bjart was suddenly the one sampled mid-transition.
Fix: the audit injects `transition: none; animation: none` before sampling.
Lesson: an audit that mutates the page must freeze motion first, and a
non-deterministic finding is a finding about the tool, not the page.
