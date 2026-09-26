---
description: Report project phase status from CLAUDE.md/PLAN.md vs the actual codebase
allowed-tools: Read, Bash, Glob, Grep
---

Produce a short status report:

1. Read the `## Status` section in `CLAUDE.md` and the `## Status` section at the end of `PLAN.md` (the dated programme write-ups are in `docs/history.d/`, one file per branch since 2026-09-26, and the frozen archive `docs/HISTORY.md` before that; the per-domain map in `docs/ARCHITECTURE.md`).
2. Verify claims against reality: do the routes/migrations/scripts they mention exist? Does `npm run lint` pass? (Don't run the dev server.)
3. Report: phase checklist with ✅/🔶/❌, discrepancies between docs and code, and the single most valuable next action.
4. If docs are stale, update the checklists to match reality.
