# Migrations — two arrays, one runner

Stack invariant #4 since D-021 (2026-09-22). The story: [HISTORY → engine-upstream-2026-09-22](HISTORY.md#engine-upstream-2026-09-22).

## The shape

| Array | File | Owner | Names |
|---|---|---|---|
| Engine | `server/config/schema.js` | the upstream engine repo (`orangesmiley`) — a downstream never appends | `NNN_snake`, append-only, strictly increasing |
| Product | `server/config/product-migrations/<id>.js` (`<id>` = `product` in `engine.json`) | this repo | `legacy`: pre-split unprefixed names, frozen · `migrations`: `<id>_NNN_snake` from 001 |

`server/config/migrationSet.js` assembles `[...engine, ...legacy, ...migrations]` and is the only module the runner (`server/scripts/migrate.js`) requires. Identity is the `name` string: the runner records applied names in `schema_migrations` and skips by name, so order only matters for entries not yet applied. The product array comes after the engine array, which is why a product migration may depend on engine tables and an engine migration never depends on a product table or product data.

Product ids in the estate: `os` (orangesmiley, the engine's own company instance) · `hs` (hallismiley) · `rk` (rekstrarkerfid) · `ll` (LedgerLink) · `ice` (icelandicstore). The runner refuses to start when the product file's `product` field disagrees with `engine.json`.

## Engine or product?

- Schema that engine code reads or writes → engine. Company-specific copy, seeds and settings values → product, even in the engine repo. That is why `091_home_content_company`, `092_contact_content_company` and `104_sales_guides_services_page` live in `product-migrations/os.js`: they `UPDATE site_content` / `sales_guides` with Orange Smiley text that every product seeds with its own.
- In a downstream, `/migration-new` defaults to the product array. The exception is a generic feature born there (icelandicstore is the current source of new features): author its migration as an ENGINE entry with the next engine number, mark the commit `Feature: <engine feature id>`, and let the upward PR renumber it if the engine took that number meanwhile — the product file's `aliases` then maps the engine name to the name the downstream's databases already applied, and that name LEAVES `legacy` (an alias value may name nothing in any array — `tests/unit/migrationSet.test.js`; rekstrarkerfid's `093_totp_secret_enc` → engine `107` is the worked case). Never give a generic feature a `<id>_` name; an applied name can never be renamed. When the downstream's migration did MORE than the engine's (rk's `092_leads` created the leads table with the columns the engine's `108_leads_notification` adds), there is no alias: the engine entry is written `IF NOT EXISTS` and runs as a no-op there, and its comment says so.

## Aliases and superseded

Downstream databases predate the shared history: the same DDL was applied under different names (the base's `080_admin_totp` is the engine's `082_admin_totp`), and some entries are same-intent/different-content (each repo's `081_user_theme` CHECK set). The product file declares both cases and the runner records rather than runs:

```js
aliases: {
  '082_admin_totp': ['080_admin_totp'],        // recorded as applied via 080_admin_totp
},
superseded: {
  '091_home_content_company': 'Orange Smiley company copy',   // never executed here
},
```

**Superseding a table means superseding what alters it.** If a product supersedes the engine migration that CREATES a table (rekstrarkerfid supersedes `097_leads` because its own `092_leads` made that table first), it must also supersede every later engine migration that ALTERS it (`108_leads_notification`). On an existing database the ALTER would be a harmless no-op, but on a FRESH one the engine list runs before the product list, so the table does not exist yet and the ALTER fails (`relation "leads" does not exist` — found by rekstrarkerfid's fourth sync, 2026-09-23). `npm test` builds a fresh template, so it catches this; an engine migration that ALTERs a table some product owns should say so in its comment.

`schema_migrations.resolved_from` keeps the reason (`<alias name>` or `superseded: <reason>`); it is NULL for an entry the runner executed. Aliases resolve only when one of the listed names is already applied — on a fresh database the engine entry simply runs. A legacy entry that has an engine equivalent must be REMOVED from `legacy` and listed under `aliases`, or a fresh database runs the DDL twice.

## The pre-flight

```bash
node server/scripts/migrate.js --plan
```

prints one line per entry — `applied`, `RUN`, `ALIAS <name> via <old>`, `SUPERSEDED <name> (<reason>)` — and executes nothing. Run it against a restored copy of a live database before a downstream boots a merged engine for the first time, and against the dev database before merging any migration.

## Downstream graft checklist

1. Land the engine's two-array runner in the downstream (it arrives with the graft merge).
2. Write `product-migrations/<id>.js`: `legacy` = every entry the downstream applied that has NO engine equivalent (moved verbatim, unrenamed); `aliases` = engine name → downstream names with identical DDL; `superseded` = engine entries the downstream must never run, each with a reason.
3. `npm test` (the test template is built from scratch through both arrays), then `--plan` against a dump of each live environment: the RUN list must be exactly the engine entries that are new to that database.
4. Boot dev, then Azure test, then prod. The aliases and superseded rows are written under the same advisory lock as real migrations, so the first boot is legible in the log.

## Rules that must hold

- Never edit or rename an applied entry, in either array. Append.
- Engine numbers strictly increase; product numbers per product from 001; numbers are per array and the prefix is the namespace.
- Expand/contract (invariant #14) applies to both arrays.
- Every migration name is claimed by exactly one feature in `features/` (`tests/unit/featureRegistry.test.js`); engine names by engine features, prefixed names by that product's.
- `tests/unit/migrationSet.test.js` pins the naming rules; `tests/integration/migrateRunner.test.js` pins the alias, superseded and `--plan` behaviour.
