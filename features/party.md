---
id: party
name: {is: Veisla, en: "Party (RSVP)"}
domain: 12
owner: engine
status: hidden
flag: modules.party.enabled
paths:
  - server/routes/partyRoutes.js
  - server/controllers/partyController.js
  - server/services/partyApproval.js
  - server/services/partyInfo.js
  - public/js/views/PartyView.js
  - public/js/views/PartyAdminView.js
  - public/js/views/PartyMagicLoginView.js
  - public/js/views/PartyApproveView.js
  - public/js/components/PartyAdminStatModal.js
  - public/css/party.css
  - tests/integration/party.test.js
  - tests/integration/content.partyRsvpForm.test.js
  - tests/unit/partyRsvpStatus.test.js
  - tests/unit/partyNotifyRecipients.test.js
  - tests/unit/partyTimingBucket.test.js
migrations: [009_user_party_access, 010_party_tables, 018_rsvp_custom_fields, 019_rsvp_form_builder, 026_party_invite_code, 027_party_rsvp_form_patch_helper_fields, 042_party_logistics_items, 058_party_logistics_category, 059_party_todos, 060_party_access_requests, 062_party_welcome_email, 063_party_costs, 066_party_rsvp_admin_status, 067_party_rsvp_admin_companions, 068_party_logistics_categories, 069_party_plan, 070_party_photo_album, 071_party_photos_public]
since: 2026-08-09
origin: null
history: []
---

The event module from the base: invite codes, magic-link login, an RSVP form builder, guest approval, logistics, costs, to-dos and a photo album. Hidden here (`/party` in `publicSurface.js`); the party module is why `DEFAULT_LOCALE='en'` stays the storage dimension.

**Rules**
- Full rules: [../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio](../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio).
