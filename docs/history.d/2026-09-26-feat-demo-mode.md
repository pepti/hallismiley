<a id="demo-instance-2026-09-26"></a>
## 2026-09-26 — The demo instance: sample data, reset every night

Roadmap R2b step 3 (D-020): demo.rekstrarkerfi.is, the system sellers demo
and prospects later sign in to. Halli, 2026-09-26: "Build 1-3". A demo is not
rekstrarkerfid's idea only (any product can want one), so the machinery is the
engine's and the sample data is the product's.

**The switch, and where it may be on.** `DEMO_INSTANCE=true`
(`server/config/demoInstance.js`, read per call like `instanceRole.js`). The
name is deliberate: the TEST chrome already has a per-browser "demo mode"
(`services/themePrefs.js` `getDemoMode`, which hides the TEST badge for a
screen-share). That one is cosmetic; this one owns the data. The flag is only
accepted on a demo ENVIRONMENT: `APP_ENV=demo` exactly (an unset APP_ENV reads
as production in `config/appEnv.js`), `DEMO_DATABASE_NAME` set and equal to
the connected database, and that name carrying "demo" as a word. `server.js`
checks this before migrations and exits if it fails, so a flag set on the
wrong stack is a failed deploy, not a silently de-indexed site that sends no
email.

**While on:**
- **Nothing leaves.** `emailService.deliver` returns "not sent" and
  `isConfigured()` is false. `config/stripe`'s `isConfigured()` is false and
  `getStripe()` throws, which covers the books' Stripe sync too. The three MCP
  gates (`mcpRoutes`, `mcpAdminController`, `mcpOAuthRoutes`) answer 404, and
  IndexNow pings nothing. All of it holds even if a key or `MCP_ENABLED` is set
  by mistake.
- **Nothing is indexed.** `robots.txt` is `Disallow: /`, and every response
  from the demo gate on carries `X-Robots-Tag: noindex, nofollow`. Before this,
  only the `*.azurewebsites.net` host got the header (Ský, reading `app.js`).
- **A banner.** ssrMeta adds `data-demo-instance` and `data-demo-reset-hour` to
  `<html>`; `components/DemoBanner.js` puts a slim line above the nav (a
  warning wash in body ink, tokens only).
- **An admin card** on `/admin/general` shows the last reset, the next reset and
  "reset now" (`/api/v1/admin/demo`: session + `admin`, CSRF on the POST, 404
  unless a demo instance). The POST runs every check first and answers
  409/429 in the envelope when one fails (the environment, an interrupted
  reset, a 15-minute cooldown after an admin reset, the lock). Only then does
  it answer 202 and start the reset.

**The reset rebuilds, it does not delete.** The books are append-only by
design: gapless invoice numbers, posted journals, triggers that refuse hand
edits. So `services/demoReset.js`:
1. snapshots the kept accounts as JSON into ONE table in a schema of its own
   (`demo_keep.demo_keep_snapshot`) and commits, before anything is dropped;
2. drops `public`, recreates it empty and runs the whole migration chain.
   That is exactly what a first boot does, and what the boot smoke test proves
   on every release;
3. restores with one `INSERT … SELECT FROM jsonb_populate_recordset` per table,
   all in one transaction. A foreign key is checked per statement, so the
   order the rows come back in does not matter. A reference to a user who did
   not survive (`approved_by`, `granted_by`) becomes NULL;
4. runs the product's seed, `server/demo/seed.js`, which is PRODUCT-OWNED (the
   engine ships a stub that seeds nothing);
5. only then drops the snapshot, empties the upload folders, records
   `demo.last_reset`, and exits so the platform starts a clean container
   (module switches, settings and pool state were built over the old schema).

While it runs, `app.js` answers 503 + `Retry-After: 60` to everything but
`/health`, and keeps these 503s out of `event_logs`. A failure after step 1
keeps the snapshot and the 503, sends a critical alert and exits. The next
boot's `recoverInterruptedReset()` restores the accounts from the snapshot and
seeds. A first boot on an empty database seeds without a rebuild
(`seedIfFresh`). The nightly run is at `DEMO_RESET_HOUR_UTC`, default 02: the
self-update window defaults to 03–05, and a reset must never race an image
swap (Efnishöfundur spotted the clash while writing the labels).

**Who survives.** Users holding a role in `DEMO_KEEP_ROLES` (default `admin`;
rekstrarkerfid's demo sets `admin,kynning`: sellers and prospect logins),
unless their login has expired (`users.expires_at`, login expiry). They keep
their memberships and recovery codes. Live sessions are kept only for kept users
whose login never expires. Every role definition survives. The uploads are
emptied (`UPLOAD_ROOT`, `BOOKS_UPLOAD_ROOT`), but only when set explicitly,
absolute, not a filesystem root and not inside the app: in development
`UPLOAD_ROOT` falls back to `public/assets`.

**The reviews shaped it.**
- **First version.** It dropped `public` and restored accounts row by row from
  memory. Both invariant-reviewer and Öryggisvörður (FAIL) found that an
  approver stored after the seller it approved broke the restore on a foreign
  key AFTER the drop. The staff were lost and the site was left half-built.
- **Second version.** It renamed `public` to `demo_prev` and copied back with
  INSERT … SELECT. It broke on migration 045: several migrations ask
  `information_schema` whether a column exists without naming the schema, so
  a renamed copy of the old tables makes them skip work and then fail.
- **The JSON snapshot** looks like nothing to a migration.
- **Also from the reviews:**
  - the environment pin and the boot check (the APP_ENV guard had failed open);
  - checks before the 202;
  - the admin cooldown;
  - `getStripe()`, IndexNow, the uploads and the explicit keep list;
  - no `allowTestDatabase` in the in-process tests.
- **The branch name itself was a hazard.** `feat/demo-mode` gives the Jest
  worker databases "demo" as a word, so a `*_test` database is refused unless
  the caller passes `allowTestDatabase`. Only the reset test's child process
  does, on a database it creates and drops.

**Tests:**
- `tests/integration/demoInstance.test.js` (11):
  - off changes nothing;
  - robots and noindex;
  - the `<html>` hand-off with the hour;
  - email, payments and MCP off with keys set;
  - the status route and its refusal for others;
  - the POST refusing with 409 outside a demo environment, changing nothing and
    leaving no 503;
  - APP_ENV unset/production/test all refused;
  - the database pin;
  - the boot check refusing a misplaced flag, and a no-op without it;
  - `getStripe()` refusing.
- `tests/integration/demoReset.test.js` (7), a child process
  (`tests/fixtures/demoResetRun.js`) on a throwaway database:
  - the boot check and the first seed;
  - the approver-after-seller order (asserted on `ctid`) restoring correctly;
  - the kept roles, and the expired prospect and the customer gone;
  - only the permanent seller's live session kept;
  - the sample data and both upload folders emptied;
  - an upload root inside the app refused;
  - the admin cooldown;
  - an interrupted reset blocking new ones until the boot recovery restores
    the accounts and clears the snapshot.

**Copy (DRÖG).** The `demo.*` keys in `public/js/i18n/{is,en}.json` use
Efnishöfundur's wording made generic; the `errors.demo.*` keys are in
`server/i18n`. A product can override the banner with its own story in
`product.<lang>.json`.

**Open (PLAN):**
- rekstrarkerfid's seed (the Glóð business, from its
  `scripts/seed-demo-glod.js`) and the `kynning` prospect role;
- its `client.demo.json`, so the demo shows the shop, orders and till that the
  shop window hides;
- `deploy.yml` with a `demo` environment (the lookup gate becomes "not
  test");
- provisioning (Ský's plan, plus these app settings: `APP_ENV=demo`,
  `DEMO_INSTANCE=true`, `DEMO_DATABASE_NAME=rekstrarkerfid_demo`,
  `DEMO_KEEP_ROLES=admin,kynning`, a single instance, the health check on
  `/health`, the database role owning only its own database);
- a check on TEST that the exit-and-restart is not counted as a crash loop.

**Re-review (Öryggisvörður, after the rewrite): PASS.** Every earlier finding
is closed, except the two below, which are provisioning conditions. The
re-review's new findings were fixed on this branch:
- **N-1 (medium).** Boot recovery and the first-boot seed took no reset
  lock, so a second process booting mid-reset could consume the snapshot and
  lose the accounts after all. Both now take the lock and skip while it is
  held. The first-boot seed also skips while an unrecovered snapshot exists.
  The fixture tests this with the lock held on another connection.
- **N-2.** `DROP SCHEMA public` and `CREATE SCHEMA public` now run in one
  transaction, and a boot that finds a snapshot but no `public` recreates it.
- **N-3.** A failed boot recovery raises a critical alert, not just a log line.
- **N-4.** The roles restore is `DO NOTHING`: a reset returns the system roles
  to their migrated definition, and a custom role comes back as saved (the
  product seed may re-assert it).

**Provisioning conditions (Ský), from the review:**
- a single instance, with the health check on `/health` (`/ready` answers 503
  during a reset);
- the app role owns the database and every object in `public`, and no
  extension is owned by another role (otherwise the nightly DROP fails);
- `BOOKS_UPLOAD_ROOT` set outside the app (unset, it is refused and never
  wiped);
- no Anthropic key, managed-identity federation or Google/Facebook client ids
  on the demo app, since the translator and social login have no demo guard;
- `DEMO_KEEP_ROLES` exactly `admin,kynning`, and `kynning` never holds the
  `users`/`roles` views.

Still to check on TEST: that App Service restarts the container after the
reset's exit rather than counting a crash loop.
