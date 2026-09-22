---
description: Scaffold a new migration entry — engine array or this product's array
argument-hint: <short_snake_case_name> [--engine|--product]
---

You are creating a new database migration. The migration name (snake_case) is: $ARGUMENTS

Migrations in this repo are NOT SQL files. They are entries in one of TWO arrays (stack invariant #4, D-021), concatenated by `server/config/migrationSet.js` and applied by `npm run migrate` (and at container boot) — one transaction per migration, advisory-locked against concurrent booters:

- **Engine array** — `server/config/schema.js`, names `NNN_snake`. Authored in the upstream engine repo (**orangesmiley**) only; every downstream receives it by `git merge upstream/master`.
- **Product array** — `server/config/product-migrations/<id>.js` (`<id>` = `product` in `engine.json`), names `<id>_NNN_snake`, numbered from 001 per product. Owned by this repo; a sync never touches it.

## Step 1 — Decide the array

Read `engine.json`:

- If `product` is `os` (this is the engine): default to **engine**, BUT ask first when the change sounds like content or a seed — "is this Orange Smiley company data, or platform schema?" Company copy (`site_content`, seeded guides, seeded settings values) is a **product** migration even here: an engine migration never UPDATEs product-editable content and never depends on a product table.
- Any other id: default to **product**. `--engine` is refused: "engine migrations are authored in orangesmiley and arrive by merge." A GENERIC feature born here that needs schema is the one exception — author it as an engine entry with the next engine number, mark the commit `Feature: <engine feature id>`, and expect the upward PR (`engine-harvest.js`) to renumber it if the engine took that number meanwhile (the product file's `aliases` then maps the engine name to the name this database applied). Never give a generic feature a `<id>_` name — an applied name can never be renamed.

## Step 2 — Find the next number

- Engine: read the last entry of the array in `server/config/schema.js`; next `NNN`.
- Product: read `migrations` in `server/config/product-migrations/<id>.js`; next `<id>_NNN` (001 if empty). The `legacy` section is frozen — never append there.

Numbers are per array; the prefix is the namespace, so an engine `093_x` and a legacy `093_y` coexist.

## Step 3 — Confirm the plan with Halli

Before writing anything, briefly state:
- The array, the number and the entry name
- A one-sentence summary of what the migration will do
- Whether it's destructive (DROP / ALTER DROP COLUMN / TRUNCATE / NOT NULL on populated column)

Wait for confirmation if anything is destructive.

## Step 4 — Append the entry

Append to the END of the chosen array:
- A comment: purpose, date, reversibility notes, `Reference copy: server/migrations/<name>.sql`
- The forward SQL as `statements: [ … ]`
- A manual rollback comment if non-trivial (there are no automatic down migrations)
- The reference copy under `server/migrations/` (engine: `NNN_name.sql`; product: `<id>_NNN_name.sql`)
- Claim the name in the owning feature's `migrations:` list under `features/` (the registry test fails otherwise)

## Step 5 — Update related code (if needed)

If the migration adds a column the application needs to read/write, list the files that will need updating (models, routes, validators) — but do not edit them in this command unless Halli asks. Surface them as a follow-up checklist.

## Step 6 — Prove it

`npm test` builds the test template from scratch through BOTH arrays, so it proves the concatenation. Before a downstream boots a merged engine for the first time, run `node server/scripts/migrate.js --plan` against a copy of its database: it prints RUN / ALIAS / SUPERSEDED / applied per entry and executes nothing.

## Rules

- **Never edit or rename a migration that has already been applied anywhere (prod OR a dev database).** Always add a new one — editing an applied entry is what caused the 2026-08-07 dev-database rebuild.
- **Check whether a table already exists before declaring one** — `CREATE TABLE IF NOT EXISTS` on an existing table silently no-ops your columns (migration 076 incident); use ALTERs on existing tables.
- A product migration may depend on engine tables; an engine migration never depends on product tables or product data.
- New migrations must be additive or have a documented manual rollback. For destructive changes, recommend a two-deploy plan: expand (write both) → migrate → contract (drop) in N+1, per `.claude/rules/stack-invariants.md` #14 — it applies to both arrays.
- Match the style of the most recent few entries in the array.
