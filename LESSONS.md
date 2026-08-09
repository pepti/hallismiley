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
