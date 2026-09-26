<a id="harvest2-lane1a-2026-09-26"></a>
## 2026-09-26 — Harvest 2, lane 1a: security fixes from icelandicstore

Branch `harvest2/lane1a-security`, from icelandicstore `941cf51d`. Halli approved the scope on 2026-09-26. Seven items were ported from ice into the engine, each rewritten for the engine's own shape. Every ported block carries a "Ported from icelandicstore #NNN" comment. No migration. The nine new `errors.upload.*` strings are DRAFT until Halli approves them.

**1. Destructive scripts check their target first (ice #370, #427).** The engine had a `seed:books -- --wipe` that ran `DELETE FROM` on every books table: invoices, payments, credit notes, expenses, journal entries, VAT returns and the audit log. It also reset the invoice counter to 1001. Its only guard was `NODE_ENV === 'production'`. A shell holding the private books instance's `DATABASE_URL` has `NODE_ENV` unset. `docs/BOOKS-PARALLEL-RUN.md` §0 already named this "the single largest risk to the figure".

- **The guard.** The new `server/scripts/targetGuard.js` generalises ice's e2e-fixtures guard into one allow-list that every destructive script calls before its first query:
  - every host must be local (a `?host=` override is checked too, and an Azure Flexible Server host is named in the refusal);
  - every database name must match the caller's pattern (`_test`, or `_replay` for books:replay);
  - with an explicit `--allow-dev-db`, a plain dev database is allowed too, but never one whose name is reserved for real records (`*_books`, `*_books_restore`, `*_ops`, `*_prod`, `*_production`, `*_live`);
  - the run is refused under `NODE_ENV=production`, `APP_ENV=production|staging`, or inside App Service.
- **Where it applies.** `seed-books-demo.js`, `seed-shop.js --reset`, `cleanup-duplicates.js`, `books-replay.js` (on top of its `_replay` rule), `tests/globalSetup.js`, `scripts/drop-test-dbs.js` and `e2e/global-setup.js`.
- **One exemption.** `reset-admin-totp.js` is exempt, and its header says so: it is the break-glass script, meant to run against the real instance.
- **Where it departs from ice.** ice refuses `APP_ENV=test`; the engine allows it, because a downstream's dev `.env` sets it. The Azure TEST stack is still refused, by the App Service markers and the non-local host.
- **The wipe.** `--wipe` now finds exactly the rows the seed created:
  - the demo orders, and their invoices, payments, credit notes and journal entries;
  - the demo expenses, matched by supplier, invoice number, description and amount (the stored net under reverse charge);
  - the `demo/demo-*` receipts.

  If any other books row, VAT return or intake item exists, it refuses with `UNSEEDED_BOOKS` and deletes nothing. Otherwise it deletes those ids, and nothing else, in one transaction. Doing the trigger switch inside that transaction means a crash can no longer leave the immutability triggers disabled. `SET CONSTRAINTS ALL IMMEDIATE` fires the ledger's deferred checks before the triggers are re-enabled.
- **The script is now a module.** It exports `main()` and its steps instead of running as an IIFE, so it can be tested.

**2. The public catalogue carries no warehouse codes (ice #62).** `stripStockInternals` in `shopController` already removed the raw stock figures. It now also removes `bin` (the shelf location), `sku` and `barcode` from every product and variant. The storefront reads none of them: ShopView, ProductView and the cart were checked. The public routes attach no session, so every caller is a visitor. Staff read these fields through `/api/v1/admin/shop`. ice keeps the barcode and shows SKUs to approved customers. The engine has no approved-customer tier, and nothing in the storefront needs either field.

**3. Non-production instances are not indexable (ice #123, the indexability half).** A new `server/utils/indexability.js` decides whether a request is indexable. It is not when `APP_ENV` is set to anything other than `production`, or when the request Host is `*.azurewebsites.net`, localhost or a bare IP. For those requests:
- `/robots.txt` answers `Disallow: /`;
- every page's robots meta is `noindex, nofollow`;
- `/sitemap.xml` is an empty urlset (ice answers 404 there).

All three send `Vary: Host`. Production on the public domain is unchanged. Supertest sends `127.0.0.1`, so four existing suites that assert indexability now send the public Host (APP_URL's).

**4. One upload wrapper (ice #141, #142, #150, #314).**
- **`ensureDestination()`.** Multer calls `destination()` inside busboy's handler, so a throwing `fs.mkdirSync` (ENOSPC or EACCES on the uploads mount) was an uncaught exception that exits the process. `ensureDestination()` passes the error to multer's callback instead. It is now used by every disk storage: project, news, product, background, avatar, the party photos and the books documents.
- **`uploadSingle(builder, errorKeys, { tooLargeStatus })`.** It replaces the hand-rolled wrappers in `adminShopRoutes.js` (product images and the product import), `userRoutes.js` (the avatar builder moved into `upload.js`) and `adminBackgroundRoutes.js`. Errors are handled like this:
  - a rejected file gets a translated `errors.upload.*` message in the standard envelope, instead of raw multer English;
  - the product import keeps its 413 for an oversized file;
  - infrastructure faults go to the central handler as a 500;
  - a client that hangs up mid-upload ends with 499, logged at info.
- **`requireProduct`.** It runs before the product-image upload. An unknown, path-shaped or NUL-bearing id now answers 404 before anything is written. Before, the file was written and then the request 404'd. The controller also unlinks the file if the row insert fails.

**5. pino redacts top-level credentials (ice #382, the logger half).** pino's `*` wildcard matches exactly one level, so `*.password` never covered `logger.info({ password })`. The exported `REDACT` config in `logger.js` now lists each credential field twice: at the top level and one level down. The fields are password, password_hash, the password-change pair in both spellings, token, secret, the TOTP secret columns and kennitala. It also covers `req.body.code`. A bare `code` stays visible, because everywhere else it is an error code.

**6. A customer's order list is an allow-list (ice #416 G5).** `GET /api/v1/shop/orders/mine` returned the whole staff row, including the Stripe session and payment-intent ids, `stock_deducted_at` and the staff `tags`. It now returns the `CUSTOMER_ORDER_FIELDS` allow-list. OrderHistoryView reads only order_number, created_at, status, total and currency.

**7. The staff route matrix (ice #416 G6).** `tests/integration/adminRouteMatrix.test.js` builds its route list from the code:
- it reads every `app.use('/api/v1/admin…')` and `/api/v1/system` mount in `server/app.js` (23 mounts);
- it walks each router's stack for method and path, which gives 223 routes.

On every route it asserts 403 for a signed-in plain `user`, and 401 or 403 for an anonymous caller. **No route leaked.** The outer guard (`requireAuth` plus `requireStaff` on `/api/v1/admin`) holds, and every router also has its own `requireView` or `requireRole`. Any exemption has to go into the `EXEMPT` map with a reason. The only automatic one is a module the instance has switched off (a 404 before auth).

**Behaviour changes to know**
- Against the dev database, `seed:books`, `seed-shop --reset` and `cleanup-duplicates` now need `--allow-dev-db`.
- `--wipe` refuses when the books hold real rows.
- A stack reached on its Azure default hostname is now noindex. That includes a pre-cutover production and LedgerLink's demo.
- The upload error text is now translated.

**Tests.**
- New unit suites: `targetGuard.test.js`, `indexability.test.js`, `loggerRedact.test.js` and `uploadSingle.test.js`.
- New integration suites: `seedBooksDemo.test.js`, `indexability.test.js`, `uploadWrapper.test.js`, `shopPublicPrivacy.test.js` and `adminRouteMatrix.test.js`.
- Six existing suites now send the public Host: `ssrMeta`, `sitemap`, `moduleFlags`, `identityDownstream`, `llms` and (after the second master merge) `demoInstance`'s non-demo robots check.

**Review pass (before merge).** The branch was reviewed against the stack invariants (`invariant-reviewer`, on `git diff master...HEAD`). What changed as a result:
- **Must-fix, fixed: a malformed multipart body was a 500.** Busboy's parse errors (`Malformed part header`, `Unexpected end of form` / `of file`) and the errors thrown when the parser cannot start (`Multipart: Boundary not found`, `Malformed content type`, …) are plain Errors, not MulterErrors, so `uploadSingle` sent them to the central handler as a server fault. They now answer the translated 400 `errors.upload.failed`. Covered in `uploadSingle.test.js` (unit) and `uploadWrapper.test.js` (a boundary-less body, a cut-off body and a malformed part header over HTTP).
- **Nit, corrected in the wording: "every upload route uses `uploadSingle`" was not true.** News, projects, party photos, site-content images, books documents and goods receiving (lane 6a) still hand-roll their wrapper, and still answer multer's raw text. They are hidden or admin-only surfaces, and their disk builders already use `ensureDestination`. ARCHITECTURE §18, the feature file, `upload.js` and API.md now name the four routes that use it. Moving the rest is deliberately left for when each is next touched.
- **Nit, fixed: `vat_total` was in `CUSTOMER_ORDER_FIELDS`**, but `Order.COLUMNS` does not select it. It is dropped from the list and from API.md until harvest 2 lane 5 adds the column.
- **Nit, fixed: `/llms.txt` was not gated.** It enumerates every advertised page, like the sitemap. A non-indexable instance now answers it with a 404 envelope (`Vary: Host`).
- **Nit, fixed: a product deleted between `requireProduct` and the image insert was a 500.** The FK violation (23503) is now the same 404 `errors.admin.productNotFound`, and the written file is still unlinked.

**Merged master twice** (lane 0, lane 1b, login-expiry, then lanes 3, 4a, 4b, 6a and 6b). robots.txt now shuts crawlers out on a demo instance (master) or a non-indexable request (this lane). The target guard runs beside master's test-server seam and database sweep. The route matrix covers the new admin routes, including login-expiry's `PATCH /api/v1/admin/users/:id/expiry` and the lane 3/6 routes, and still finds no leak.
