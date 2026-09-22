---
description: Review pending changes against this project's security invariants
---

You are reviewing the currently pending changes (uncommitted + committed-but-unpushed on the current branch) against the security invariants of the Halli Smiley portfolio site.

## Step 1 — Gather the diff

Run, in order:
```bash
git status
git diff --stat
git diff
git log --oneline @{upstream}..HEAD 2>/dev/null || git log --oneline -10
```

## Step 2 — Check against these invariants

For each, report **PASS / CONCERN / VIOLATION** with file:line evidence.

1. **CSRF.** Any new state-changing route (POST/PUT/PATCH/DELETE) is behind `csrf-csrf` middleware. No per-route disable without a comment explaining why.
2. **CSP / helmet.** Any new external script/style/image/font source has been added to the helmet CSP allowlist explicitly — not via `unsafe-inline`, `unsafe-eval`, or wildcard.
3. **Rate limits.** No existing limit has been raised. New endpoints that accept user input have a limit (or are clearly behind one already).
4. **Input handling.** Any string that flows to the DB uses parameterized queries (no string concatenation into SQL). Any string that flows to HTML uses `sanitize-html` or is rendered as text, never raw.
5. **Authn/Authz.** New protected routes verify the Lucia session AND check authorization (not just authentication). Admin-only routes are gated.
6. **Secrets.** No private keys, passwords, tokens, or `.env` content in the diff. No `console.log` of credentials, session tokens, JWTs, or PII.
7. **Logging.** New logs use `pino`, not `console.log`. Nothing sensitive is logged.
8. **Dependencies.** Any new dependency in `package.json` is justified — note the package, why it's needed, and whether it's actively maintained.
9. **Migrations.** No edits to already-applied migrations. New migrations are sequential and reversible-in-principle (or the irreversibility is documented).
10. **Error envelope.** New error responses follow the shape documented in `docs/API.md`.

## Step 3 — Output

A short report with:
- **Summary line** (e.g. "3 PASS, 1 CONCERN, 0 VIOLATION — safe to push after fixing #4")
- One section per CONCERN / VIOLATION with file:line and the suggested fix
- PASS items as a single line each, not a section

Reference: `SECURITY_AUDIT_2026-04-16.md` at the repo root for the full posture if anything is ambiguous.
