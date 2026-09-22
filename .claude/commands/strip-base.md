---
description: Remove the HalliProjects portfolio modules from this scaffolded project, keeping the commerce + admin platform, and get it booting clean
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

Strip the **portfolio**-specific parts of the base from this project. The base is now a full e-commerce + admin platform (shop/cart/checkout/orders + a large admin surface: products, collections, discounts, orders, roles/RBAC, bins, customers, analytics, change-requests, background, general-settings) sitting **interleaved** with the old portfolio site. **Keep all commerce and admin by default** — most customers are shops. Remove only portfolio.

Portfolio = projects, news, party, the Halli bio/about page, and the portfolio-style contact page. Work in this order and **inventory before deleting**.

> **The party module has grown a lot** in the base (guest approval, magic-link login, to-dos, cost tracking). The lists below were refreshed against base `b9c3b4d` — but **inventory first anyway**: if you find party files not named here, the base has moved again. Note them in `LESSONS.md` (tag `factory`) so `/retro` folds them back.

1. **Inventory first.** Grep routes/controllers/models/views/i18n for the portfolio modules and print the exact list you'll touch before changing anything:
   - `grep -rn "project\|news\|party\|halli\|/about" server/routes server/controllers server/services public/js/router.js public/js/components/NavBar.js`
   - Confirm which views in `public/js/views/` are portfolio (`Projects*`, `News*`/`Article*`, `Party*`, `Halli*`/`About*`) vs commerce/admin (keep `Shop*`, `Product*`, `Cart*`, `Checkout*`, `Order*`, `Admin*`, auth views).

2. **Delete** (portfolio only): the portfolio route files (`projectRoutes`, `newsRoutes`, `partyRoutes` + any party-admin route) and their controllers/models/seeds; the portfolio views and any portfolio-only CSS/assets. The current party surface:
   - Views: `PartyView.js`, `PartyAdminView.js`, **`PartyApproveView.js`**, **`PartyMagicLoginView.js`**; component `PartyAdminStatModal.js`.
   - Services: **`server/services/partyApproval.js`**, **`server/services/partyInfo.js`**.
   - Controller/routes: `server/controllers/partyController.js`, `server/routes/partyRoutes.js`.
   - CSS/assets: `public/css/party.css`, `public/assets/party/**`, `public/assets/projects/portfolio/screenshot-party.jpg`.
   - Script: **`scripts/retranslate-party-en.js`** (party-specific; the `server/services/translator` it calls is core — keep that).

   **Keep** auth, shop, all `admin*` routes, the generic contact mechanism, middleware, the migrations runner, and observability.

3. **Edit (not delete) the shared files** — portfolio is interleaved with commerce here, so surgically remove only the portfolio lines and keep the rest:
   - `server/app.js` — drop the portfolio `require`s, route mounts, per-route guards, and the `/assets/{news,party,projects}` static mounts. **Keep** shop + admin route mounts/guards and product/content statics.
   - `server/middleware/ssrMeta.js` — remove `/projects`, `/news`, `/party` from the route→meta map (EN + IS) and their JSON-LD branches. Keep `/shop/*` and admin meta.
   - `server/routes/sitemapRoutes.js` — drop the portfolio entries from the static URL list and remove the `projects`/`news_articles` DB queries. Keep the `products` query.
   - `public/js/router.js` — remove the portfolio view imports and route entries, including **`/party/login`** and **`/party/approve`** alongside `/party` and `/party/admin`.
   - `public/js/components/NavBar.js` — remove portfolio nav links and any party-admin dropdown item (`#nav-party-link`, i18n `nav.party*`). Keep shop/cart/account/admin nav.

4. **KEEP — these look adjacent to party but are core.** Do not strip:
   - **Multi-role RBAC**: migration `061_user_roles`, `server/models/UserRole.js` + `Role.js`, `server/controllers/adminRolesController.js`, `server/routes/adminRolesRoutes.js`, `public/js/views/AdminRolesView.js`, `public/js/services/adminRoles.js`, `public/css/admin-roles.css`. Party's approval flow uses roles; roles are not party.
   - `server/auth/tokens.js` — token hashing, shared with the magic-link flow but core auth.
   - `server/services/emailService.js` — keep the machinery; **set `EMAIL_FROM` in `.env`** rather than editing the default sender in code.
   - The i18n framework and the **`locale_choice`** cookie (renamed from `preferred_locale` in the base — if you carried any code or docs referencing the old name, update it).
   - Sortable/searchable Manage Users, `public/js/utils/csv.js`.

5. **Do NOT touch applied migrations.** The authoritative migration list is the array in **`server/config/schema.js`** (applied by `npm run migrate` / at boot); the `.sql` files under `server/migrations/` are human-reference copies and are an incomplete subset. Never edit an applied entry.

   Inherited portfolio tables stay until a **new appended** migration drops them in Phase 2 — note this in `PLAN.md`. That drop must cover: `projects`, `news_articles`, `party_rsvps`, `party_guestbook`, `party_photos`, `party_logistics_items`, **`party_todos`**, **`party_todo_subtasks`**, **`party_logistics_categories`**, plus the party columns on `users` (`party_access`, `approval_status`, `requested_at`, `approved_at`/`approved_by`, `magic_login_token_hash`/`_created_at`, `approval_action_token_hash`/`_expires`, `welcome_email_sent_at`/`_by`). Re-read `schema.js` before writing it — the list moves.

6. **i18n:** remove orphaned portfolio keys from **both** EN and IS locale files; run `npm run check:i18n`.

7. **Tests:** delete portfolio test files; inherited shop/auth/admin tests stay (adapted in Phase 5).

8. **Stale inherited docs.** The base ships its own root docs describing the *portfolio* site. Delete or rewrite for this customer — a stale doc is worse than a missing one, and these get read during an incident: `RUNBOOK.md`, `SECURE_SDLC.md`, `PRE_LAUNCH_AUDIT.md`, `SECURITY_AUDIT_*.md`, `CHANGELOG.md` (and `docs/SHOP_REDESIGN.md` where the base still ships it — orangesmiley deleted its copy 2026-09-11). (`CLAUDE.md` and `AGENTS.md` were already replaced at scaffold time.)

9. **Verify — loop until green, don't just report:**
   - `npm run lint` passes.
   - `npm run migrate` then `npm run dev` boots serving the landing page with an **empty catalog and the admin intact**.
   - Assert no dead links in the rendered nav, and that `/projects`, `/news`, `/party`, `/party/login`, `/party/approve` no longer return 200 (curl or a quick check).
   - Sign in as an admin and confirm **Roles/RBAC admin still works** — it is the piece most likely to be stripped by mistake.
   - If any step fails, fix and re-run before declaring done.

10. Update the `CLAUDE.md` Status checklist (Phase 1) and `PLAN.md` with anything deferred (e.g. the table-drop migration).
