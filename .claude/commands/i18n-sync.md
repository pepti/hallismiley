---
description: Reconcile EN + IS locale keys so both stay in sync
allowed-tools: Read, Edit, Bash, Glob, Grep
---

Keep the two locale files (EN + IS) in sync.

1. Run `npm run check:i18n` (the base ships `scripts/check-i18n-keys.js`). It lists keys present in one locale but missing in the other.
2. For each missing key, add it to the locale that lacks it: translate EN→IS properly (never leave English in the IS file); for IS→EN, mirror the meaning. Keep the flat dot-key structure the base uses.
3. Remove keys orphaned by `/strip-base` (no longer referenced anywhere) from both files.
4. Re-run `npm run check:i18n` until it passes. Report what was added/removed.
