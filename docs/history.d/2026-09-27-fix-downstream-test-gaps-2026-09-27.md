<a id="downstream-test-gaps-2026-09-27"></a>
## 2026-09-27 — What the hallismiley sync found: the expenses page overflowed on phones, and three engine tests assumed Orange Smiley's config

Halli delegated this on 2026-09-27 ("You decide the rest"). The hallismiley engine-sync (pepti/hallismiley#174, onto `cbee076`) came back green except for four engine bugs. Three of them passed in the engine only because Orange Smiley hides what hallismiley shows. The hallismiley branch carries them as marked re-applies (`067c405`), to drop at its next sync. This chunk takes them upstream.

- **`/admin/books/expenses` scrolled sideways on a phone.** This is the bug that kept engine master's e2e red since harvest 2 lane 9's role × route harness landed: 379–402 px on a 375 px screen, on CI's Linux fonts.
  - The expenses intake puts an `<input type="file">` inside `label.books-check`, which was `white-space: nowrap`.
  - A new `books-check--file` variant (on that one label) lets its items wrap and caps the label and the file input at the container width (`public/css/admin-bookkeeping.css`). The four checkbox labels are unchanged.
  - The role × route specs pass locally: 228 of 228.
- **The role × route harness threw on a product's own routes.** `e2e/lib/routes.js` and `tests/unit/roleRoutes.test.js` now make the same `identity.routes` exemption that `tests/unit/routePatterns.test.js` already made. Example: hallismiley's `/aron13ara`, which reaches the server through ssrMeta, not `routePatterns.json`.
- **MCP "names exactly the system tools"** now derives the expected list from the seam. Lane 5's `recent_orders` and `sales_report` are listed wherever the shop module is on and the owner's admin sees `orders`/`sales`.
- **adminHome "an all-clear instance"** parks active products as inactive for its one request, then restores them.
  - Earlier suites on the same worker leave products behind: adminSalesReport, booksInvoice, orderVatSnapshot, productMerge.
  - An admin who sees `bins` and `inventory` gets those products as to-dos.
  - Deleting them in those suites is not an option, because orders and the append-only books reference them.

**Downstream:** hallismiley drops its three re-apply hunks at its next sync onto this. LedgerLink and rekstrarkerfid get the fixes with theirs.

**Review pass (invariant-reviewer): PASS.** Its three optional hardenings are all taken:
- the CSS is scoped to a `books-check--file` modifier;
- `mcp.test.js` also pins the engine literally (`[environment_info, updates_status]` when `engine.json.role` is `engine`);
- the harness comments are cleaned up.
