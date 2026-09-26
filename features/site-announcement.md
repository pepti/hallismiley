---
id: site-announcement
name: {is: "Tímabundin tilkynning", en: "Site announcement"}
domain: 17
owner: engine
status: live
flag: null
paths:
  - server/routes/announcementRoutes.js
  - server/controllers/announcementController.js
  - server/routes/adminAnnouncementRoutes.js
  - server/controllers/adminAnnouncementController.js
  - server/utils/announcementWindow.js
  - public/js/views/AdminAnnouncementView.js
  - public/js/services/adminAnnouncement.js
  - public/js/components/CutoverNotice.js
  - public/js/utils/focusTrap.js
  - public/css/site-announcement.css
  - tests/integration/siteAnnouncement.test.js
  - tests/unit/announcementWindow.test.js
  - e2e/site-announcement.spec.js
migrations: []
since: 2026-09-26
origin: null
history: [harvest2-lane7a-2026-09-26]
---

A time-limited announcement for signed-out visitors (Admin → Tilkynning, `/admin/announcement`, admin view `announcement`; ported from icelandicstore #200): on/off, a start and an end date-time in Reykjavík time, IS + EN heading and message, an optional in-site link. The first visit gets a focus-trapped dialog; closing it leaves a slim, fixed-height banner above the nav until the visitor hides it. See [the history](../docs/history.d/2026-09-26-harvest2-lane7a-checkout-settings.md#harvest2-lane7a-2026-09-26).

**Rules**
- The window is decided on the server (`utils/announcementWindow.js`): live iff switched on AND start <= now < end (half-open), a blank bound open, a bound that does not parse fails closed. Outside it `GET /api/v1/announcement` answers exactly `{ active: false }` — no dates, no wording — and never an error.
- The dismissal is remembered per browser under `site_announcement`, keyed on the announcement's `id` (a hash of the window and the wording), so a changed announcement is shown again. Every storage access is in try/catch.
- No layout shift: the dialog is an overlay; the banner has a fixed height and its slot is reserved at boot on a return visit. Tokens only.
- Full rules: [../docs/ARCHITECTURE.md#17-content-settings-background](../docs/ARCHITECTURE.md#17-content-settings-background).
