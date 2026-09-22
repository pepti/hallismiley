---
description: Report which ENGINE (orangesmiley) commits this repo is missing since engine.json.rev
allowed-tools: Read, Bash, Glob, Grep
---

Report how far this repo has drifted from the engine (`orange-smiley/orangesmiley`, D-021). **READ-ONLY — never applies anything, never writes to any repo.** The runbook is `docs/ENGINE-SYNC.md`.

1. **Read `engine.json`** at the repo root: `rev` (the engine commit last merged in), `upstream`, `upstreamBranch`, `role`. If `role` is `engine`, say "this IS the engine — nothing to diff" and stop. If `rev` is null the repo has never been synced: say so, and recommend the one-time graft (`/engine-sync` with `--graft --scaffold-rev <sha>`) instead of a diff.
2. **Fetch**: `git fetch upstream` (add the remote from `engine.json.upstream` if it is missing — that is the one write this command may do, and only to the local remote list). Confirm the graft: `git merge-base HEAD upstream/<branch>` must resolve; if it does not, report "not grafted" and stop.
3. **List the gap**: `git log --oneline <rev>..upstream/<upstreamBranch>`. If empty → "up to date (0 behind)" and stop.
4. **Categorise** by subject prefix and touched paths (`git log --name-only` when the subject is ambiguous):
   - **High (sync this week; critical within 48 h):** `fix`, `security`, `chore(deps)` / dependency bumps, and anything touching auth / CSRF / CSP / rate limits / `server/config/schema.js` (engine migrations).
   - **Review:** `feat` — new engine capability; the sync takes it, the product decides what to expose.
   - **Low:** `docs`, `ci`, `style`, `test`.
5. **Conflict preview**: `node C:\Users\Notandi\claude\Projects\site-factory\engine-sync.js --dry-run` (exit 2 = conflicts found; it lists the paths). Nothing is merged.
6. **Report**: N commits behind and the date of `engine.json.syncedAt`; the High list with a one-line rationale each; the Review list; the conflict preview; and the recommendation — normally "open an engine-sync PR (`/engine-sync`)", with a note when merging that PR deploys (hallismiley, icelandicstore → Halli merges). Advisory only.
