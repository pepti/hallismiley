---
description: Re-theme this project to match the customer's existing site using the Phase 0 frontend audit
argument-hint: <customer-site-url>
allowed-tools: Read, Edit, Write, Bash, Glob, Grep, WebFetch
---

Re-skin this project to match the customer's site: $ARGUMENTS

Use the **ui-cloner** subagent for the analysis, then apply its theme spec.

1. **Source of truth:** `docs/frontend-audit.md` (written during Cowork discovery). If it doesn't exist, WebFetch the URL for whatever is public and ask the user to run the Cowork audit for gated pages — do not guess gated UX.
2. **Theme tokens:** produce/update a single CSS variables block (colors, font family + import, radii, spacing scale) in the project's root stylesheet. Match the customer's fonts and palette exactly; note the source values as comments.
3. **Re-skin, don't redesign:** keep base component structure (NavBar, cards, forms, admin) and only restyle. Page set and section order should mirror the customer's site (hero, sections, footer content like address/terms).
4. **Improve deliberately:** the audit lists missing UX (e.g. no reorder, no running total). Implement improvements that are in PLAN.md scope; list the rest as PLAN.md TODOs.
5. **i18n:** every new string gets EN + IS keys; run `npm run check:i18n`.
6. **Verify — loop until green:** `npm run dev` boots and `npm run lint` passes; compare against the audit's screenshots/notes section by section and confirm the theme tokens actually applied (no leftover base palette). Keep the `html[data-theme]` machinery intact — re-hue token values, don't delete `theme-boot.js`. Don't report done until boot + lint pass; fix and re-run on any failure.
