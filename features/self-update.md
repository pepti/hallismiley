---
id: self-update
name: {is: "Sjálfvirk uppfærsla", en: Self-update}
domain: 14
owner: engine
status: live
flag: modules.selfUpdate.enabled
paths:
  - server/routes/systemRoutes.js
  - server/models/SystemUpdate.js
  - server/services/updateChecker.js
  - server/services/updateApplier.js
  - server/services/selfUpdateSettings.js
  - server/services/changelogRender.js
  - server/utils/semver.js
  - server/utils/maintenanceWindow.js
  - server/config/version.js
  - public/js/views/AdminUpdatesView.js
  - public/js/components/ChangesList.js
  - public/css/admin-updates.css
  - server/scripts/generate-changes.js
  - scripts/build-manifest.js
  - scripts/check-manifest.js
  - scripts/generate-version.js
  - tests/integration/systemUpdatesApi.test.js
  - tests/integration/systemUpdatesRoutes.test.js
  - tests/integration/systemChanges.test.js
  - tests/integration/systemChangesGate.test.js
  - tests/integration/systemVersion.test.js
  - tests/integration/updateApplier.test.js
  - tests/integration/updateChecker.test.js
  - tests/integration/selfUpdateSettings.test.js
  - tests/integration/selfUpdateDisabled.test.js
  - tests/unit/changelogRender.test.js
  - tests/unit/generateChanges.test.js
  - tests/unit/semver.test.js
  - tests/unit/maintenanceWindow.test.js
  - tests/unit/version.test.js
  - tests/unit/buildManifest.test.js
  - e2e/admin-updates.spec.js
migrations: [081_system_updates]
since: 2026-08-10
origin: null
history: [self-update, harvest-2]
---

The fleet update mechanism: a release manifest per channel, the checker, the applier (managed / manual / auto within a maintenance window), rollback, the build identity (`version.js`, `build-manifest.js`) and the `/admin/updates` screen with the latest-changes card. Gated by `modules.selfUpdate.enabled` in `config/client.json`; `GET /system/changes` sits above the gate.

**Rules**
- Migrations are expand/contract across releases (invariant 14); an update is never applied from inside boot migrations.
- `CHANGELOG.md` must keep a `## [0.1.0]` section — `build-manifest.js` parses it.
- `[internal]` / `Customer-visible: no` opt a commit out of the changes card.
- Full rules: [../docs/ARCHITECTURE.md#14-self-update](../docs/ARCHITECTURE.md#14-self-update).
