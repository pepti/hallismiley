---
id: app-settings
name: {is: "Almennar stillingar", en: "General settings"}
domain: 17
owner: engine
status: live
flag: null
paths:
  - server/routes/adminGeneralSettingsRoutes.js
  - server/controllers/adminGeneralSettingsController.js
  - server/models/Setting.js
  - public/js/views/AdminGeneralSettingsView.js
  - public/js/services/adminGeneralSettings.js
  - public/css/admin-general-settings.css
migrations: [047_app_settings]
since: 2026-08-09
origin: null
history: []
---

The `app_settings` table (047) and the `/admin/settings` screen: runtime switches such as `change_requests.enabled` and the landing background mode, read by other features through `Setting.js`.

**Rules**
- Full rules: [../docs/ARCHITECTURE.md#17-content-settings-background](../docs/ARCHITECTURE.md#17-content-settings-background).
