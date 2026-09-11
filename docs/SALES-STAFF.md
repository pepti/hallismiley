# Sales staff — accounts, role, and the handbook

The sales-staff program (Halli, 2026-08-27): human salespeople log in on the
public site and work from **Handbók sölufólks** at `/admin/handbok` — internal
guides on selling Rekstrarkerfið and servicing its customers. This doc is the
operator's guide; the architecture notes live in the migration (090) and
`server/routes/salesGuidesRoutes.js`.

## The pieces

| Piece | Where |
|---|---|
| Roles | `solufolk` — trainee / handbook + inbox (migration 090; `["handbok", "leads"]`, leads appended by 097) · `solumadur` — owns customer accounts and earns commission (098; `["handbok", "leads", "accounts", "commission"]`) · `verktaki` — services every account, no commission (098; `["handbok", "accounts", "allaccounts"]`). All non-system, editable in `/admin/roles`. |
| View ids | `handbok` — READ of published guides only · `leads` — the inbox: read + the workflow writes · `accounts` — the seller's OWN customer accounts (row-scoped; also puts the account behind 2FA) · `commission` — their own commission statement · `allaccounts` — permission only: widens `accounts` to every account; all in `server/auth/adminViews.js` |
| Data | `sales_guides` (sections `grunnur` / `sala` / `thjonusta` / `vara`, IS-canonical + `_en` siblings) · `leads` (migration 097 — every /hafa-samband enquiry; PII, pruned after `LEAD_RETENTION_DAYS` = 730) |
| API | `/api/v1/admin/handbok` and `/api/v1/admin/leads` — every route authenticated, every response `Cache-Control: no-store` |
| UI | `/admin/handbok` (library + read; editors get the overlay editor, reorder arrows, drafts) · `/admin/leads` (Fyrirspurnir: filter chips, search, "Mínar", row → message + actions) |

Access model: **read** = any role holding the `handbok` view; **edit/drafts** =
admin or moderator; **delete** = admin only (moderators unpublish instead).
A `solufolk` user who logs in and opens Admin is forwarded straight to the
handbook and sees a two-item sidebar (Handbók + Fyrirspurnir, since migration
097 appended `leads` to the role); every other admin API answers 403
(verified in `tests/integration/salesGuides.test.js` and
`e2e/sales-handbook.spec.js`).

## Onboarding a new salesperson (2 steps, no code)

1. **Create the account** — `/admin/customers` → Add customer (name + email).
   This creates an approved, passwordless user and emails them a set-password
   link (`invited_at` is stamped; in dev the link is returned on screen).
2. **Grant the role** — `/admin/roles` → members board → add the user to
   **solufolk**. Optionally tick the **markadur** view on the role so the
   team also sees the prospect shortlist at `/admin/markadur` (not granted
   by default — Halli's call).

The hire sets their password, logs in on the site, and the user menu shows
"Admin" → they land on the handbook. To verify: their sidebar must show ONLY
Handbók and Fyrirspurnir.

Offboarding: `/admin/users` → disable the account (sessions die on next
check); optionally remove the `solufolk` membership. Leads they own keep
`owner_user_id` pointing at the disabled account until someone reassigns
them (the "Mínar" filter of the next owner will not show them until then).

## Working the lead inbox (`/admin/leads`)

- Every `/hafa-samband` submission lands here the moment it is sent — the
  notification email still goes to `LEAD_NOTIFY_EMAIL`, the row is the copy
  that cannot be missed. Newest first; a **new** lead is bold.
- **Statuses**: Ný → Haft samband → Unnin / Töpuð. The first move out of Ný
  stamps *who* made contact and *when* (`contacted_at`/`contacted_by`) and is
  never restamped — it records the first human touch, not the latest.
- **Ábyrgð (owner)**: "Taka að mér" claims the lead; "Mínar" filters to your
  own. One owner per lead; nothing routes automatically yet (per-seller
  routing is a known gap until customer accounts, ENHANCEMENTS #17).
- **Minnispunktar**: free text per lead, saved with Vista. Plain text only.
- **Who may do what**: anyone with the `leads` view reads and works the
  queue; **delete** (which IS the personal-data erasure path) and **CSV
  export** are admin-only. Every response is `no-store`.
- **Retention**: rows are deleted automatically 24 months after receipt
  (`LEAD_RETENTION_DAYS`, `server/services/leadsCleanup.js`) — the promise
  in `/personuvernd` §6. A visitor's erasure request = delete the row in the
  inbox (admin) and the email in the mailbox.

## Content workflow

- Guides are written/edited in the overlay editor on `/admin/handbok`
  (admin/moderator). Icelandic is the canonical text; the EN fields are
  optional — blank EN falls back to Icelandic.
- **Drafts (`published = false`) are invisible to sales staff** — publishing
  is the approval act, so per the house rule all drafting (including the
  Söluþjálfari agent's) lands as drafts and **only Halli publishes**.
- The seed script `server/scripts/seed-sales-guides.js` inserts the initial guide set
  as drafts; it is idempotent (`ON CONFLICT (slug) DO NOTHING`) and never
  overwrites edited guides.
- Keep guides consistent with the live `/thjonusta` tier matrix and the
  company plans; prices in guides stay DRAFT-marked until Halli confirms
  pricing. The Söluþjálfari agent owns this consistency sweep.

## Related proposals (ENHANCEMENTS.md — not implemented)

- **#2 + addendum** — DONE 2026-09-07 (the inbox above).
- **#14** — in-app AI assistant grounded in the published guides.
- **#15** — images/screenshots in guide bodies (auth-served media).
