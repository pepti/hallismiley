---
description: At engagement end, harvest this project's improvements back into the site-factory template
allowed-tools: Read, Bash, Glob, Grep
---

Fold what we learned on this customer back into the factory so the next engagement starts smarter. **READ-ONLY analysis — draft the changes, don't apply them to the factory.**

1. **Diff this project's `.claude/` against the template.** Compare `.claude/commands`, `.claude/agents`, `.claude/rules`, `.claude/hooks`, `.claude/settings.json` here against the factory template at the site-factory repo (the dir holding `scaffold.js`, e.g. `C:\Users\Notandi\claude\Projects\site-factory\template\dot-claude`). Surface every command/agent/rule/hook that was customized or added during this build.
2. **Harvest `LESSONS.md`.** Scaffolded at project creation — read it. Entries are already tagged **factory** / **base** / **project**; the first two are the prime candidates to generalize, and the tags feed straight into step 4. If it was never filled in beyond the seed entry, say so plainly rather than inventing lessons.
3. **Scan for repeated manual work:** `PLAN.md` "deferred"/"TODO" notes and the git log for fixes that recurred — those should become a command step, a rule, or a base change.
4. **Draft the fold-back:** a short list of concrete edits, each tagged with its home per WORKFLOW.md's maintenance rule — **factory** (`site-factory/template/…` — benefits every customer) vs **base** (`hallismiley` engine — a platform improvement). For each: target file, the change, and why it generalizes beyond this customer.
5. Output the draft only. The operator reviews and applies it in the factory/base repos.
