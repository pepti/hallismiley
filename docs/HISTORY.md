# History — HalliProjects base (hallismiley.is)

The dated record of what happened to this engine and why: incidents, programmes,
decisions. Moved out of `CLAUDE.md` on 2026-09-22 so the rules file stays rules;
the six "things that have bitten us" entries below are the original text with
a date-prefixed heading and an anchor added.

**How to use this file.** Append-only. When something lands or breaks: the
write-up goes here (a `## YYYY-MM-DD — title` section preceded by
`<a id="…"></a>`, plus a row in the index below); the rule it establishes goes
into the domain's "Rules that must hold" block in `docs/ARCHITECTURE.md`,
linking back here; `CLAUDE.md` changes only when a rule changes.
`tests/unit/architectureIndex.test.js` checks that every link between the two
files resolves and that the index table lists exactly the anchored entries.

Scaffolded repos get a fresh, empty copy of this file from site-factory
(`template/docs/HISTORY.md.tpl`); the base's incidents are the base's.

## Index

| Date | Entry | Headline |
|---|---|---|
| 2026-08-07 | [Edited migration after it was applied](#edited-applied-migration) | Migration 072 edited after the dev DB had applied it; never edit an applied migration |
| 2026-08-07 | [CREATE TABLE IF NOT EXISTS was a no-op](#create-if-not-exists-noop) | Migration 076 re-declared `employees`; columns never added; rewritten as ALTERs |
| 2026-08-07 | [`journal_lines.vat_rate` never written](#vat-rate-never-written) | `postEntry` left the value out of the INSERT; nothing failed |
| 2026-08-08 | [Payroll tax bands collapsed to 0 kr.](#payroll-bands-bounds) | 072 seeded upper bounds, loader read lower bounds; `normaliseBands()` accepts either |
| 2026-08-07 | [Shared test database dropped mid-run](#shared-test-db) | Two sessions on `hallismiley_test`; always a private `TEST_DATABASE_URL` |
| 2026-08-07 | [`gh pr checks` green for a stale head](#stale-pr-checks) | Verify with the commit's check-runs, not the PR |
| 2026-09-22 | [Docs restructure: ARCHITECTURE, HISTORY, parity test](#docs-restructure) | Per-domain index + this file + `architectureIndex.test.js`; scaffolds inherit them |

---

<a id="edited-applied-migration"></a>
## 2026-08-07 — dev AR page 500s after a schema edit

Migration 072 was edited AFTER the dev database had applied it, so the column
existed in `schema.js` and not in Postgres — dropped the ~21 books tables and
the `schema_migrations` rows, re-migrated. **Never edit an applied migration;
add a new one.**

<a id="create-if-not-exists-noop"></a>
## 2026-08-07 — new payroll columns silently absent

Migration 076 used `CREATE TABLE IF NOT EXISTS employees`, but 072 already
created that table, so the statement was a no-op and the service queried
columns that were never added — rewrote 076 as ALTERs on 072's tables.
**Check whether a table already exists before declaring one.**

<a id="vat-rate-never-written"></a>
## 2026-08-07 — `journal_lines.vat_rate` NULL on every row ever written

`postEntry` prepared the value and left it out of the INSERT; nothing failed
because the VSK return derives from each account's `vat_code` — added the
column to both inserts.

<a id="payroll-bands-bounds"></a>
## 2026-08-08 — payroll tax bands all started at 0 kr.

Migration 072 seeded 2026 as UPPER bounds (`{"upTo":498122}`, how Skatturinn
prints it) while the loader read LOWER bounds and defaulted a missing one to 0,
collapsing the slicing so nearly the whole salary would have been taxed at the
top rate — `normaliseBands()` now accepts either shape and refuses one that
states neither. **Found by looking at the screen, not by a test.**

<a id="shared-test-db"></a>
## 2026-08-07 — 100+ nondeterministic test failures across unrelated suites

Two sessions shared `hallismiley_test`, which jest globalSetup DROPs — always
set `TEST_DATABASE_URL` to a private database name.

<a id="stale-pr-checks"></a>
## 2026-08-07 — `gh pr checks` reported green for a stale head

It was reading a merged PR's old commit — verify with
`gh api repos/:owner/:repo/commits/$(git rev-parse HEAD)/check-runs`
and require `total_count > 0`.

<a id="docs-restructure"></a>
## 2026-09-22 — Docs restructure: ARCHITECTURE index, HISTORY, parity test

Halli asked whether the estate's markdown was structured so a new feature
request is fast to locate. In the base it was not: `CLAUDE.md` was rules with
an append-only incident list growing inside it, there was no map from a
feature to the files that implement it (only `/admin/books` was discoverable,
through `docs/BOOKKEEPING-SYSTEM.md`), `CHANGELOG.md` had stopped on
2026-03-30, and nothing in the tree read any markdown file, so drift was
silent. The same shape had already been fixed in orangesmiley
(2026-09-17) and icelandicstore.

Why the base and not only the instances: site-factory copies the base's
whole working tree, every markdown file and all of `tests/`, and renders only
CLAUDE, PLAN, LESSONS and SLO from templates. Anything placed here reaches
every future scaffold for free; anything placed only in an instance never
does — the gap that produced base PR #153.

- **`docs/ARCHITECTURE.md`** — the engine's domains, each with its files, a
  "Rules that must hold" block linking the entry here that explains each
  rule, and its history entries.
- **This file** — the incident list moved verbatim; scaffolds get an empty
  copy from `site-factory/template/docs/HISTORY.md.tpl`.
- **`tests/unit/architectureIndex.test.js`** — every path the index names
  exists; every routes/controller/model/service/middleware/auth/util/view/
  component/client-service file is in the index; the migrations it cites are
  exactly the ones `schema.js` applies; every history link and domain-map
  link resolves. Set-difference assertions, so a failure names every
  offender in one message, and the message says what to add. Note this test
  gates the base's CI and therefore its auto-deploy: adding a router without
  an index row is a red build on purpose.
- `CLAUDE.md` gained the domain map and the "recording a change" rule;
  `site-factory/test/scaffold.smoke.js` asserts the three files survive a
  scaffold.
