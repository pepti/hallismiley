---
id: books-replay
name: {is: "Endurspilun bókhalds", en: "Books replay"}
domain: 9
owner: engine
status: live
flag: modules.books.enabled
paths:
  - server/services/bookkeeping/replay.js
  - server/services/bookkeeping/replayCase.js
  - server/scripts/books-replay.js
  - tests/integration/booksReplay.test.js
  - tests/unit/booksReplay.test.js
  - tests/fixtures/replay/**
migrations: []
since: 2026-09-06
origin: null
history: []
---

`npm run books:replay`: rebuilds a period from source documents into a scratch database and diffs it against the filed figures — the parallel-run tool behind `docs/BOOKS-PARALLEL-RUN.md`.

**Rules**
- The replay target DB must end `_replay`.
- Full rules: [../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll](../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll).
