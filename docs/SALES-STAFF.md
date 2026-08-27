# Sales staff — accounts, role, and the handbook

The sales-staff program (Halli, 2026-08-27): human salespeople log in on the
public site and work from **Handbók sölufólks** at `/admin/handbok` — internal
guides on selling Rekstrarkerfið and servicing its customers. This doc is the
operator's guide; the architecture notes live in the migration (090) and
`server/routes/salesGuidesRoutes.js`.

## The pieces

| Piece | Where |
|---|---|
| Role | `solufolk` — seeded by migration 090, `view_access: ["handbok"]`, non-system (editable in `/admin/roles`) |
| View id | `handbok` (`server/auth/adminViews.js`) — grants READ of published guides only |
| Data | `sales_guides` table: sections `grunnur` / `sala` / `thjonusta` / `vara`, Icelandic-canonical columns with optional `_en` siblings |
| API | `/api/v1/admin/handbok` — every route authenticated, every response `Cache-Control: no-store` |
| UI | `/admin/handbok` (library + read); editors additionally get the overlay editor, reorder arrows, drafts |

Access model: **read** = any role holding the `handbok` view; **edit/drafts** =
admin or moderator; **delete** = admin only (moderators unpublish instead).
A `solufolk` user who logs in and opens Admin is forwarded straight to the
handbook and sees a one-item sidebar; every other admin API answers 403
(verified in `tests/integration/salesGuides.test.js` and
`e2e/sales-handbook.spec.js`).

## Onboarding a new salesperson (2 steps, no code)

1. **Create the account** — `/admin/customers` → Add customer (name + email).
   This creates an approved, passwordless user and emails them a set-password
   link (`invited_at` is stamped; in dev the link is returned on screen).
2. **Grant the role** — `/admin/roles` → members board → add the user to
   **solufolk**.

The hire sets their password, logs in on the site, and the user menu shows
"Admin" → they land on the handbook. To verify: their sidebar must show ONLY
Handbók.

Offboarding: `/admin/users` → disable the account (sessions die on next
check); optionally remove the `solufolk` membership.

## Content workflow

- Guides are written/edited in the overlay editor on `/admin/handbok`
  (admin/moderator). Icelandic is the canonical text; the EN fields are
  optional — blank EN falls back to Icelandic.
- **Drafts (`published = false`) are invisible to sales staff** — publishing
  is the approval act, so per the house rule all drafting (including the
  Söluþjálfari agent's) lands as drafts and **only Halli publishes**.
- The seed script `scripts/seed-sales-guides.js` inserts the initial guide set
  as drafts; it is idempotent (`ON CONFLICT (slug) DO NOTHING`) and never
  overwrites edited guides.
- Keep guides consistent with the live `/thjonusta` tier matrix and the
  company plans; prices in guides stay DRAFT-marked until Halli confirms
  pricing. The Söluþjálfari agent owns this consistency sweep.

## Related proposals (ENHANCEMENTS.md — not implemented)

- **#2 addendum** — leads inbox grantable to `solufolk`.
- **#14** — in-app AI assistant grounded in the published guides.
- **#15** — images/screenshots in guide bodies (auth-served media).
