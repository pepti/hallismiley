---
id: email
name: {is: "Tölvupóstur", en: Email}
domain: 19
owner: engine
status: live
flag: null
paths:
  - server/services/emailService.js
  - server/services/outboundAllowlist.js
  - tests/unit/outboundAllowlist.test.js
  - tests/unit/emailReplyTo.test.js
migrations: []
since: 2026-08-09
origin: null
history: [harvest-1, r1, go-live]
---

Transactional email over SMTP: `emailShell` wraps every template, `EMAIL_FROM` / `EMAIL_REPLY_TO` come from env, and `EMAIL_ALLOWLIST` limits recipients outside production. Templates read `server/i18n`.

**Rules**
- Sender is `EMAIL_FROM`; never the base's address; mail failures are loud.
- `emailShell` escapes its `<title>`.
- Full rules: [../docs/ARCHITECTURE.md#19-email](../docs/ARCHITECTURE.md#19-email).
