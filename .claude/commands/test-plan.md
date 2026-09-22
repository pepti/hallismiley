---
description: Generate TEST-PLAN.md — a role x route click-driven walkthrough, automated in Playwright plus manual checklists
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

Produce `TEST-PLAN.md` at the repo root plus the Playwright specs that back it: a **repeatable walkthrough of every user type through every workflow**. Run this in Phase 5, after `/strip-base` and the customer's workflows exist — the roles and routes are derived from this project, not assumed.

The plan covers **breadth** (every route a role can reach renders cleanly, and every route they can't is denied) and **depth** (the critical money/stock journeys end-to-end).

## 1. Derive the matrix — don't invent it

- **Roles**: read the RBAC tables and role checks (`server/auth/roles.js`, the `user_roles`/`roles` tables, `requireView`/middleware guards). Include the un-authenticated and not-yet-approved states — they are user types too.
- **Routes**: read `public/js/router.js` for SPA routes and `server/app.js` for mounts. Build the full role × route grid, marking each cell **reachable** or **denied**.

## 2. Click-driven, not URL-driven

Pages must be reached by **clicking real nav / footer / sidebar / user-menu links**, exactly as a user would. This catches dead links and missing nav entries that URL-typing tests sail straight past.

The only URL navigations allowed are (a) initial site entry and (b) **deny checks** — a forbidden role has no link to click, so simulate a typed/bookmarked URL and assert the UI denies it (renders home, or the sign-in / pending gate).

## 3. Automated backbone

Author specs under `e2e/`, following the layout that worked:

- `e2e/roles/<role>.spec.js` — one per role: breadth sweep by clicking, plus the denials that role must hit.
- `e2e/access-control.spec.js` — **UI-observable** access control: forbidden roles see no admin links; a restricted staff role's sidebar shows *only* its allowed tools; direct admin URLs render home.
- `e2e/journeys/*.spec.js` — the deep flows (the order loop, checkout variants, an approval journey, any staff/POS/inventory flow, profile self-service).
- Shared harness: `e2e/helpers.js` (`loginAs`, `goto`) and route tables + `smokeRoute`/`expectDeniedHome`/`expectGate` helpers under `e2e/lib/`.

**Fixtures must be idempotent.** Provision one login per role from a script (`server/scripts/setup-e2e-fixtures.js`) invoked by `e2e/global-setup.js`: ensure DB → migrate → create admin → seed demo products → provision role logins. Use an **isolated throwaway test database** (derive it from `.env`'s `DATABASE_URL` by swapping the db name; allow an `E2E_DATABASE_URL` override) — **never the dev DB**, since these journeys write orders.

Set `reuseExistingServer: false` so a stray server on the Playwright port fails loudly instead of silently running order-writing tests against the wrong database.

Wire an npm script: `test:walkthrough` (roles + access-control + journeys), plus piecemeal `test:e2e:roles` / `:access` / `:journeys`.

## 4. The document

`TEST-PLAN.md` sections: what's covered (the role × route table with breadth/depth/denials per role) · prerequisites · the auto-provisioned logins table · how to run · a **spec ↔ workflow map** (which file covers which flow) · **manual per-role checklists** mirroring the specs, for eyes-on verification · and an explicit **what is not automated** section.

## 5. Prove repeatability

Run `npm run test:walkthrough` **twice with no DB reset** — it must pass both times. That is the real assertion: idempotent fixtures, non-destructive journeys, fresh browser context per test (so a localStorage cart starts empty), unique account per signup journey, unique order numbers. A suite that only passes on a clean database is not a walkthrough you can run before a deploy.

Report the pass count and runtime in the document, and fix red tests rather than documenting them as known-failing.
