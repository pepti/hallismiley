---
description: Report which base ("hallismiley" engine) commits this project is missing since its recorded base SHA
allowed-tools: Read, Bash, Glob, Grep
---

Report how far this project's engine has drifted from the base. **READ-ONLY — never modify the base repo.**

1. **Find the recorded base SHA + path.** Read `CLAUDE.md`/`PLAN.md` for the base rev (short SHA) and the base path. If the path isn't recorded, use the scaffolder default `C:\Users\Notandi\claude\Projects\HalliProjects`.
2. **Confirm the base is a git repo and get HEAD:** `git -C <basePath> rev-parse --short HEAD`. If it equals the recorded SHA → report "up to date (0 behind)" and stop.
3. **List the gap:** `git -C <basePath> log --oneline <recordedSHA>..HEAD`. Run nothing that writes to the base.
4. **Categorize** the missing commits by message prefix:
   - **High (apply soon):** `fix`, `security`, `chore(deps)`/dependency bumps, and anything touching auth / CSRF / CSP / migrations.
   - **Review:** `feat` — new capability the customer may or may not want.
   - **Low:** `docs`, `ci`, `style`, `test`.
5. **Report:** N commits behind; the High list with a one-line rationale each; the Review list; and a recommended action (e.g. "cherry-pick the 3 security fixes; skip the new BIN admin feature unless the customer needs it"). Advisory only — do not apply anything.
