<a id="security-hygiene-2026-09-26"></a>
## 2026-09-26 — Security hygiene: the TOTP exemption fails closed, test uploads leave the working tree, the published hash is redacted

Halli approved this on 2026-09-26 ("Implement all findings and fixes"). It follows Öryggisvörður's review of the security findings from the day's estate cleanup (`Projects\ORYGGIS-LOG.md`). Its verdict: **no live secret was exposed, and nothing needs rotating.** This chunk is the engine part of that review. The local parts (a dead launch entry, the CV folder, a sync clone's `.env`) and Halli's own actions are listed in `Projects\cleanup-2026-09-26\README.md`.

- **`ADMIN_TOTP_EXEMPT` fails closed (N-5).**
  - `mfaPolicy.isExempt` used to honour the exemption whenever `NODE_ENV` was not exactly `production`. A stack started with `NODE_ENV=staging`, or any other label, would have skipped the second factor.
  - It is now an allow-list: only `development` and `test` honour it.
  - `server.js` warns at boot whenever it is set outside those two.
  - Nothing changes for the environments that use it: Jest and both e2e servers run `NODE_ENV=test`, local dev runs `development`, and the server refuses to boot without `NODE_ENV`.
  - A new unit test covers `staging`, `Production`, `dev`, empty and unset.
- **Test uploads leave the working tree (finding 6).**
  - Without `UPLOAD_ROOT`, the app falls back to the committed `public/assets` tree. Every integration run therefore left party photos, avatars, content images and backgrounds in the repo: about 1,330 gitignored stub files per repo, plus 53 real-sized media files carried over from the old scaffold copy.
  - globalSetup now gives each run a temp base (`tests/lib/testUploads.js`).
  - `tests/env.js` points `UPLOAD_ROOT` and `BOOKS_UPLOAD_ROOT` at a per-worker folder under it.
  - Teardown removes the base, and the next setup sweeps any base whose run died.
  - The five upload suites derive their disk paths from `server/config/paths` instead of `public/assets`.
- **The e2e servers too.** `playwright.config.js` `SERVER_ENV` sets `UPLOAD_ROOT` and `BOOKS_UPLOAD_ROOT` under the same prefix (`<base>/e2e/`). The next Jest setup sweeps the folder once the Playwright process is gone. Before this, `e2e/news-editor.spec.js` wrote into `public/assets/news/<id>/` and `e2e/profile-background.spec.js` into `public/assets/backgrounds/`. The two committed files in `backgrounds/` look like exactly such uploads, but they stay, because the image needs them.
  - A full run now leaves 0 files under `public/assets` and `private-uploads`, and 0 upload bases in the temp dir.
- **`.dockerignore` mirrors `.gitignore`'s local-only paths:** `company/`, `keys/`, `**/*.pem` (dockerignore patterns are anchored at the context root), `private-uploads/`, `assets-src/`, `Claude outputs/`, and the runtime upload patterns.
  - CI builds from a clean checkout, so its images never had these files. A local `docker build .` (`COPY public/`) would have included them.
  - `public/assets/backgrounds/` is deliberately NOT listed, because it holds two committed files the image needs.
- **The old admin password hash is redacted (N-1).**
  - `PRE_LAUNCH_AUDIT.md` quoted the March 2026 prototype's admin bcrypt hash.
  - It sits in two public repos (hallismiley and FerdaBox) and in every private one, and it guards nothing live.
  - The line is redacted here, and the change reaches the downstreams by engine-sync. Git history is not rewritten: the hash has been public since April, so a rewrite gains nothing.
  - What remains is Halli's check that the password is not reused anywhere.

**Not in this chunk, and why:**
- **Theme contrast failures in LedgerLink (#14) and hallismiley (#174):** new colour choices, which belong to Halli and Eva.
- **LedgerLink's admin home versus the engine's "Í dag":** a product decision.
- **The `adminHome`/`booksPos` test-isolation leak** the sync found: a separate chunk.

**Review pass (invariant-reviewer): PASS.** All its findings are fixed on the branch:
- **e2e uploads** (above).
- **The sweep unit test** could delete the live run's own base when Jest runs in band. It now uses a spawned live process.
- **The pid suffix** must be all digits, so a folder named `0x1F` is never read as a pid.
- **`.dockerignore`:** `**/*.pem`.
- **Six comments** still described the old "ignored in production" rule. They now say development/test only.
