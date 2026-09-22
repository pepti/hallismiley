---
id: admin-ui-kit
name: {is: "Stjórnborðs-íhlutasafn", en: "Admin UI kit"}
domain: 2
owner: engine
status: live
flag: null
paths:
  - public/js/components/adminTable.js
  - public/js/components/adminPager.js
  - public/js/components/FilterBar.js
  - public/js/components/Toast.js
  - public/js/components/ToastLog.js
  - public/js/components/Lightbox.js
  - public/js/services/toastLog.js
  - public/js/utils/listState.js
  - public/js/utils/localPref.js
  - public/js/utils/debounce.js
  - public/js/utils/format.js
  - public/js/utils/pageTitle.js
  - public/js/utils/downloadCsv.js
  - public/js/utils/csv.js
  - public/js/utils/escHtml.js
  - public/js/utils/api.js
  - public/css/admin-kit.css
  - public/css/layout.css
  - public/css/components.css
  - public/css/variables.css
  - public/css/reset.css
  - tests/unit/adminTableKit.test.js
  - tests/unit/kitFormatters.test.js
  - tests/unit/pageTitle.test.js
  - tests/unit/debounce.test.js
  - tests/unit/csvClientParity.test.js
  - e2e/admin-list-kit.spec.js
migrations: []
since: 2026-09-08
origin: null
history: [ui-kit, review-099]
---

The shared admin list kit (ENHANCEMENTS #21): `adminTable` (sortable headers, row rendering), `adminPager`, `FilterBar`, `listState` (URL-synced filters), toasts and the CSV writer, plus the base CSS layers every screen builds on. Kit modules are pure string functions plus one `bind*()` with a delegated listener, so they are node-testable without jsdom.

**Rules**
- `listState` uses `replaceState` only; page size is NOT in the URL; `PAGE_SIZES` tops out at 200 (the leads controller clamp).
- `sortableTh` emits a real `<button>` inside the `<th>` with `aria-sort` on the `th`; `admin-kit.css` carries zero colour literals.
- The client CSV writer tracks the server's `PLAIN_NUMBER` exemption (`csvClientParity.test.js`); `pageTitle.js` mirrors `ssrMeta.js`.
- Full rules: [../docs/ARCHITECTURE.md#2-admin-shell--sidebar-dashboard-surface-hiding-ui-kit](../docs/ARCHITECTURE.md#2-admin-shell--sidebar-dashboard-surface-hiding-ui-kit).
