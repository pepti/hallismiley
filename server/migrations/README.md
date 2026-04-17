# Migrations

## Source of truth

The **authoritative migration list lives in [`../config/schema.js`](../config/schema.js)**. The `.sql` files in this directory are historical artifacts from an earlier migration structure and are kept only because they show the original DDL in a readable form. They are **not** executed by `migrate.js` and do not need to exist for the database to be current.

## How migrations run

- `server/scripts/migrate.js` iterates the `migrations` array in `schema.js` and applies each entry whose `name` is not yet recorded in the `schema_migrations` table.
- Each migration is either fully applied or not applied — there is no partial state, and `schema_migrations` is inserted only after every statement in the migration has succeeded.
- On production boot, `server.js` calls `migrate()` before `app.listen(...)`, so new migrations always run before the container starts accepting traffic.
- Tests run the same `migrations` array via `tests/globalSetup.js`, so prod and test schemas cannot drift.

## Adding a new migration

1. Open `server/config/schema.js`.
2. Append a new object to the `migrations` array:
   ```js
   {
     name: '022_your_change',
     statements: [
       `ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar TEXT`,
       // ...one statement per array entry
     ],
   },
   ```
3. **Never edit an existing entry.** Once a migration's name is recorded in `schema_migrations`, any later edits to its `statements` will not re-run.
4. Prefer idempotent statements (`IF NOT EXISTS`, `DROP ... IF EXISTS`) so the migration can be re-applied safely against a partially-migrated DB.

## Numbering

Numbers are sequential but not every number is used — the current set is `001-005, 008-021`. Keep new entries in ascending order and pick the next unused three-digit number after the highest applied one. There is no constraint that requires contiguous numbering; `schema_migrations` keys on `name` and does not care about gaps.

## Rollback policy

Migrations are **forward-only**. To undo a schema change, write a new compensating migration rather than editing or removing the existing entry. For data recovery, use the Azure PostgreSQL point-in-time restore documented in `RUNBOOK.md`.

## Previewing changes

```bash
node server/scripts/migrate.js --dry-run
```

Lists the pending migrations that would be applied against `$DATABASE_URL` without running any DDL. Useful before a staging/production deploy to confirm which statements are about to execute.

## Legacy SQL files

The `.sql` files in this directory (`001_initial_schema.sql`, etc.) correspond to the first six entries in `schema.js` and were the previous runtime format. They are not deleted because they serve as readable reference DDL for code review. New migrations should only be added to `schema.js` — not as new `.sql` files.
