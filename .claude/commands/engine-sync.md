---
description: Bring this downstream repo up to the engine — runs site-factory/engine-sync.js (branch, merge upstream/master, verify, record in engine.json)
allowed-tools: Read, Bash, Glob, Grep
---

Thin wrapper around `node C:\Users\Notandi\claude\Projects\site-factory\engine-sync.js`. The rules are in `docs/ENGINE-SYNC.md`; this command only runs the tool and reads its exit code.

1. **Refuse in the engine itself**: read `engine.json`; if `role` is `engine`, say "this IS the engine — engine-sync runs in downstreams only" and stop.
2. **Refuse a dirty or parked checkout**: `git status --porcelain` must be empty and the checkout must be a fresh clone or worktree of `origin/<default branch>` (§3). Never the parked hallismiley or icelandicstore checkouts on this disk.
3. **Run the tool** with the flags the user asked for:
   - default — `git fetch upstream`, branch `engine-sync/<date>`, `git merge --no-ff upstream/<upstreamBranch>`, `package-lock.json` taken from upstream + `npm install --package-lock-only`, then `npm ci` → lint → `check:i18n` → `test:ci` → boot smoke, and `engine.json` (`rev`, `syncedAt`, `history`) committed with the merge. It never pushes; it prints the push + PR commands.
   - `--dry-run` — fetch and preview conflicts only (exit 2 = conflicts listed). Use it before opening the PR and in `/engine-diff`.
   - `--graft --scaffold-rev <sha>` — the ONE-TIME history graft for a repo that shares no history with the engine yet: temporary `git replace --graft` refs hang both roots onto the common hallismiley ancestor (`fdf9581`), one ordinary merge, refs deleted on every exit path. Never `--allow-unrelated-histories`. Run once per repo, on a fresh clone.
   - `--continue` — after the operator resolved conflicts and `git add`-ed them: finishes the merge, the verification chain and the `engine.json` commit.
   - `--no-tests` — skip the verification chain (only for a dry rehearsal; NEVER for a security sync, §5).
   - `--to <rev>` — merge up to a chosen engine commit instead of the branch tip.
4. **Exit codes**: `0` done — push the branch and open the PR titled `engine-sync: <short sha> (<date>)` with `git log --oneline <old rev>..upstream/master` in the body; `1` refused or failed — report the reason, do not retry blindly; `2` dry-run found conflicts — list them; **`3` the merge left conflicts** — resolve them per `docs/ENGINE-SYNC.md` §6 (engine files win unless product-owned; lock file = theirs + `npm install --package-lock-only`; migrations: engine array verbatim, product array local, never renumber; i18n by key), `git add`, then rerun with `--continue`.
5. **After exit 0**: run `node server/scripts/migrate.js --plan` against a restored copy of each live database of this product and paste the output into the PR. Merging is per the roles table in `docs/ENGINE-SYNC.md` §2 — where merging deploys (hallismiley, icelandicstore) the PR is handed to Halli.
