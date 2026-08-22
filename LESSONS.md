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
