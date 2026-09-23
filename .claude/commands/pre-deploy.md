---
description: Pre-deploy verification — CI status, migrations, env vars, rollback plan
---

You are running a pre-deploy check before merging to `master`. Nothing auto-deploys in this repo: `Deploy to Azure` is `workflow_dispatch` only and fails at its guard until the `vars.*` exist (docs/DEPLOYMENT.md §3), so this check precedes a deliberate dispatch.

## Step 1 — Branch and CI state

```bash
git status
git rev-parse --abbrev-ref HEAD
git log --oneline @{upstream}..HEAD 2>/dev/null
gh pr status 2>/dev/null
gh run list --branch $(git rev-parse --abbrev-ref HEAD) --limit 5 2>/dev/null
```

Report: current branch, commits ahead of upstream, latest CI run status.

## Step 2 — Migrations

```bash
git diff master...HEAD -- server/config/schema.js server/migrations/
```

For each new migration file:
- Confirm it's additive or has a clear rollback plan
- Flag any `DROP`, `ALTER ... DROP COLUMN`, `TRUNCATE`, or column type narrowing
- Confirm sequence numbering doesn't collide with anything already applied

If a migration is destructive, **say so loudly** and recommend a two-deploy plan (deploy code that tolerates both old & new schema → migrate → deploy code that depends on new schema).

## Step 3 — Env / config

```bash
git diff master...HEAD -- .env.example Dockerfile .github/workflows/
```

Flag:
- New required env vars added to `.env.example` that probably need to be set in the Azure App Service config
- Dockerfile changes that affect image size, startup, or healthchecks
- Workflow changes (CI, deploy)

## Step 4 — Run `/security-check`

Invoke the security-check command's checklist or summarize: any unresolved CONCERN/VIOLATION blocks the deploy.

## Step 5 — Rollback plan

State the rollback procedure in one paragraph: which ACR image tag to roll back to, how to revert the App Service container reference, and whether the migration is reversible. If not reversible, what's the manual recovery?

## Output

A go/no-go recommendation with:
- one of OK / WARN / BLOCK per section
- One-paragraph rollback plan
- Explicit "ship it" or "do not ship — fix X first"

Reference: `docs/DEPLOYMENT.md` and `RUNBOOK.md` for the full procedures.
