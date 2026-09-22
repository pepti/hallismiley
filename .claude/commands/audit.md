---
description: Pre-cutover audit — parallel read-only agents grade code, process and ops, then issue a GO / NO-GO
allowed-tools: Read, Bash, Glob, Grep, Task, Write
---

Run the pre-cutover audit for this project and write the result to `AUDIT-<YYYY-MM-DD>.md` at the repo root. This is the gate before a customer goes live: it is **read-only reconnaissance plus a verdict**, not a fixing session. Fixes come after, from the findings table.

## Method

1. **Partition the surface, then fan out.** Launch parallel **read-only** subagents (Explore/general-purpose), one per area, each returning findings as `severity · finding · evidence (file:line or command output)`. Suggested partitions — merge or split to fit this project:
   - **Server code** — routes/controllers/models, the money path (orders, payments, discounts, stock), transactions and locking, error handling.
   - **Frontend** — the SPA router, views, access gating, XSS-prone render paths, dead links.
   - **Schema & migrations** — the migration list in `server/config/schema.js`, per-migration transactionality, destructive statements, index coverage.
   - **Tests** — real coverage vs claimed, Jest against real Postgres, Playwright e2e, what is untested on the critical journeys.
   - **Process / DevOps / SDL** — the rubric in §Scorecard below.
2. **Cross-verify before publishing.** Every finding an agent reports must be re-checked against the actual source by you (or a second agent) before it enters the document. An audit that cries wolf is worse than none — drop anything you could not confirm, and say what you could not check.
3. **Grade, then decide.** Fill the scorecard, then state one of **GO**, **CONDITIONAL GO** (with the explicit conditions), or **NO-GO**. The verdict must follow from the P0 list, not from vibes.

## Scorecard rubric

Grade each dimension A–F with a one-line rationale. These are the dimensions that mattered on the Icelandic Store engagement — the audit that produced them is the reason this command exists.

| Dimension | What to check |
|---|---|
| Dev workflow (branch→merge) | Is `main` protected? Are PRs required, or does code land by direct push? Is review real? Worktree/branch hygiene. |
| CI pipeline | Do checks actually **block** merge, or just run? Is lint + tests + `check:i18n` + a **container boot smoke** in CI? Are actions SHA-pinned, with `permissions:`, `concurrency:` and `timeout-minutes:` set? |
| CD / promotion | Build-once/promote-the-artifact? Immutable per-SHA tags? Is the production approval gate **real** (protection rules present) or an empty shell? Is rollback documented and one-command? |
| Operations | Does anything alert on a 5xx or a failed deploy? Availability test? Backups and a tested restore? Is the detection mechanism "the customer notices"? |
| SDL — secrets | Key Vault or plaintext settings? Any secret that has passed through a chat transcript, screenshot, or commit (**rotate, always**)? `.env` ignored, `.env.example` placeholder-only, clean git-history scan? |
| SDL — identity & platform | Deploy identity scope (least privilege, not Contributor-on-resource-group); OIDC vs stored creds; HTTPS-only, TLS floor, basic-auth/FTP disabled; DB firewall scope. |
| SDL — in-repo practice | Middleware stack (helmet/CSP, CSRF, rate limits, sanitize, hpp), RBAC checks server-side, security-specific tests, pre-commit/pre-push hooks. |

## Output shape (`AUDIT-<date>.md`)

1. **Header** — date, scope, method (which agents, what they read), and what this audit does *not* cover.
2. **Executive summary** — the handful of things that actually matter, stated plainly. If the application is strong but the pipeline around it is weak (a common split), say exactly that.
3. **Scorecard** — the table above. If you fix anything same-day, add an "after fixes" column and mark it ✅ rather than rewriting history.
4. **Findings** — numbered, severity-tagged (`Critical` / `High` / `Medium` / `Info`), each with evidence and a state (`P0` / `P1` / `P2` / `✅ fixed`). Include a **Strengths** row — an audit that lists only problems misleads the reader about the whole.
5. **Verdict** — GO / CONDITIONAL GO / NO-GO, with the P0 conditions spelled out as a checklist the owner can work through.

Keep findings stated **as found**, with the fix state noted separately. Do not silently rewrite a finding because you fixed it five minutes later.
