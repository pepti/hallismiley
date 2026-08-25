# Halli Smiley — Portfolio Site

**Read `CLAUDE.md` in this directory before doing anything — it is the single
authoritative instruction file for AI agents working in this repo.** This file
exists only so tools that look for `AGENTS.md` find their way there; it carries
no rules of its own and is intentionally kept near-empty so it cannot drift
again (a previous full copy went stale and taught agents a wrong stack and a
wrong migration mechanism).

The two rules worth restating for any tool that reads no further:

1. **Migrations are entries appended to the array in `server/config/schema.js`**
   — not SQL files. Never edit a migration that has already been applied;
   always add a new one.
2. **Never commit secrets or keys.** `.env` and `keys/` are gitignored and must
   stay that way.

Everything else — stack, invariants, security rules, conventions, deployment,
incident history — lives in `CLAUDE.md` and the docs it links.
