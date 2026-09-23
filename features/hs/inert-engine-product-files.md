---
id: inert-engine-product-files
name: {is: "Óvirkar vöruskrár vélarinnar", en: "The engine's own product files (inert here)"}
domain: 20
owner: hs
status: dormant
flag: null
paths: []
migrations: []
since: 2026-09-22
origin: null
history: [engine-graft]
---

Orange Smiley's product-owned files that the engine tree carries and every
merge delivers: its migration array (`os.js` — never loaded here,
`migrationSet.js` requires only `<engine.json.product>.js`), the seed script
for its sales handbook (company copy; `features/local.json` hides the
handbook), its product migration `os_001` and its two tests. They are KEPT,
unmodified, because deleting them would turn every later sync into a
delete/modify conflict no merge driver can resolve.

Since the engine sync of 2026-09-23 this entry claims NO paths: the engine's
own rule owns them — `features/os/*.md` loads as a *foreign* feature
(`scripts/features-index.js`), its files stay claimed so the coverage check
never reads them as unclaimed, and the feature gate (`tests/lib/featureGate.js`)
skips its suites as "belongs to product os". A second claim from here would
read as double-claimed. This file remains as the record of why the files exist.

**Rules**
- Never edit these to make them "fit" hallismiley; never run `os.js`'s
  migrations here. See [engine-graft](../../docs/HISTORY.md#engine-graft) and
  [engine-sync-2026-09-23](../../docs/HISTORY.md#engine-sync-2026-09-23).
- Engine context: [../../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting](../../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting).
