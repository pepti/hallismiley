<a id="harvest2-lane3-2026-09-26"></a>
## 2026-09-26 — Harvest 2 lane 3: roles by name, one permissions grid, edit one customer

Lane 3 of the approved "Harvest 2" programme (Halli approved the scope 2026-09-26): the users,
permissions and customers work that icelandicstore built for ITS customer-side company roles and
customer page, ported into the engine's admin roles and Customers screen. Harvested from
`ice@941cf51d`; the ice PRs read first were #421 (`86ebab5d`, the company-roles page rebuilt),
#416 (`c05ce2bb`, customer access hardening — the 409-with-count on a role in use) and #336
(`e14441e9`, working contact/address edit and invite-on-request). Code carries
"Ported from icelandicstore #NNN" where it was ported; #421's grid is on company PERMISSIONS, so
its pattern was ported, not its data.

### What shipped

- **G1 — create a role by its display name.** `server/utils/roleName.js` (from ice
  `companyRoleName.js`, on the engine's `foldSlug`/`foldIcelandic`): `cleanLabel` (NFKC, control
  and bidi characters dropped, whitespace collapsed), `labelProblem` (Latin script, 2–30 chars,
  a letter required; reserved → 409), `slugCandidates` (`bokari`, `bokari-2`, …), `labelKey`.
  Migration **`116_role_label`**: `roles.label TEXT NOT NULL DEFAULT ''` plus a partial unique
  index on `lower(label)`; the backfill (only `WHERE label = ''`) takes the text before " — " in
  each role's own description (`Sölufólk — aðgangur…` → `Sölufólk`) or the title-cased name
  (`admin` → `Admin`), skipping a candidate another role already holds — derived from each
  database's rows, so no product copy is written by an engine migration (invariant 4).
  `adminRolesController.create` takes `{ label }` and inserts-and-retries through the slug
  candidates (a PK collision takes the next; a label-index collision is 409); `{ name }` alone
  still works. `PATCH { label }` renames a custom role; the slug never changes.
- **G2 — one roles × permissions grid** in `AdminRolesView` (the cards and the modal are gone):
  rows = the server's offered grantable views grouped by sidebar group, columns = roles
  (administrator, moderator, the named roles alphabetically, User last). The administrator column
  is all-on and locked; **User is all-off and locked, and the server now refuses to ADD a view to
  `user`** (every account holds it — one tick there would have made every customer staff; found
  while building the grid, the old modal allowed it). A sticky save bar says how many changes,
  on how many roles, reaching how many DISTINCT people (from `GET /admin/roles/members`), and saves
  with one PATCH per changed role through the audited update endpoint — sending the full set, so a
  held view of a switched-off module survives. ≤ 600px: one role column at a time, picked with the
  kit Combobox. The editor (new / rename / describe / delete) is an inline panel; delete is
  disabled with a count when anyone holds the role. The Members board is unchanged apart from
  showing labels.
- **G3 — the Profile badge names the roles the session holds** (`GET /api/v1/users/me` →
  `roles: [{ name, label, is_system }]` from `req.user.roles`, after the 2FA withholding), by
  label, `user` only when it is the only one. It used to read "Stilla hlutverk — admin/user".
  The badges are tokenised (`--accent-ink`, `--gold`; the rgba literals went).
- **G4 — reserved names** are compared folded, for the label and the slug: the built-ins plus
  ice's deny-list widened for the engine (anything starting `admin`, administrator, staff, system,
  sysadmin, root, superuser, owner, support, kerfi, kerfisstjóri, stjórnandi, stjórnendur,
  starfsmaður, starfsfólk, eigandi, aðstoð, notandi…).
- **G7 — deleting a role in use** is 409 `roleInUse` with `count` and `reason: 'role_in_use'`
  (`UserRole.holderCount`, memberships + primaries); the message says how many.
- **#336 — edit one customer.** `GET`/`PATCH /api/v1/admin/customers/:id` and
  `POST /:id/invite`, gated on the `customers` view, target held to a plain customer
  (`Customer.findEditable`; staff, multi-role holders and party guests are 404). Migration
  **`117_user_address`** — ice's `114_user_address` statements verbatim (`address1`, `address2`,
  `city`, `zip`, `country`), so ice aliases it. `validateCustomerContact` (from ice, on the
  engine's `isEmail`/`PHONE_RE`). An email change un-verifies the address and clears any reset
  token in flight. The invite mints a fresh token and sends through `sendWelcomeInvite`; its answer
  never carries the set-password link. On Add, "Senda boðspóst núna" is off by default
  (`send_invite: false` → nothing mailed, no link, audited `user.created`). New audit actions:
  `user.updated` (field names only), `user.created`.

### Tests

`tests/unit/roleName.test.js` (12, ported from ice's `companyRoleName.test.js`);
`adminRoles.test.js` +11 (create by label, `-2` on a slug collision, folded label collision,
reserved labels and slugs, label edit + audit, built-in label refused, `user` never widened,
labels on the list and the board, the 116 backfill, `/users/me` roles; the in-use test now checks
`count`); `adminCustomers.test.js` +10 (create without invite, GET, PATCH shaping, audit field
names, validation, email conflict, staff/multi-role 404, the IDOR/role gate — plain user and a
`leads`-only staff role 403, a `customers` role 200 but still 403 on admin-only writes — invite
without link, invite 409/404).

### DRAFT strings (Halli approves)

Client (`public/js/i18n/*.json`), IS / EN:
- `adminRoles.hint` — "Hakaðu í reitina til að velja hvaða stjórnborðssíður hvert hlutverk sér. Breytingar vistast saman úr stikunni neðst. Stjórnandi hefur alltaf allt." / "Tick the boxes to choose which admin screens each role sees. Changes are saved together from the bar at the bottom. The administrator always has everything."
- `adminRoles.namePlaceholder` — "t.d. Bókari" / "e.g. Bookkeeper"
- `adminRoles.nameHint` — "Skrifaðu heitið eins og fólk á að lesa það. Kerfið býr til auðkenni úr því, og auðkennið breytist aldrei." / "Type the name as people should read it. The system derives an id from it, and the id never changes."
- `adminRoles.editTitle` — "Breyta „{name}“" / "Edit “{name}”"
- `adminRoles.builtInNameNote` — "Innbyggð hlutverk halda heiti sínu." / "Built-in roles keep their name."
- `adminRoles.builtin.admin` / `.moderator` / `.user` — "Stjórnandi" / "Umsjón" / "Notandi" · "Administrator" / "Moderator" / "User"
- `adminRoles.viewColumn` — "Síða" / "Screen"
- `adminRoles.cellLabel` — "{role}: {view}" (both)
- `adminRoles.lockedOn` — "Alltaf með: Stjórnandi hefur allar síður" / "Always on: the administrator has every screen"
- `adminRoles.lockedOff` — "Alltaf án: allir aðgangar hafa þetta hlutverk" / "Always off: every account holds this role"
- `adminRoles.lockFootnote` — "Læst: Stjórnandi sér alltaf allar síður, og Notandi, sem allir aðgangar hafa, fær aldrei stjórnborðssíðu. Síðan Hlutverk og aðgangur er aðeins fyrir stjórnendur og er aldrei veitt." / "Locked: the administrator always sees every screen, and User, which every account holds, never gets an admin screen. The Roles and access screen is for administrators only and is never granted."
- `adminRoles.nMembersOne` / `nMembers` — "{n} manneskja" / "{n} manns" · "{n} person" / "{n} people"
- `adminRoles.nChangesOne` / `nChanges` — "{n} breyting" / "{n} breytingar" · "{n} change" / "{n} changes"
- `adminRoles.nPeopleOne` / `nPeople` — "{n} manneskju" / "{n} manns" · "{n} person" / "{n} people"
- `adminRoles.saveBarOne` — "{changes} á „{role}“, nær til {people}" / "{changes} to “{role}”, reaching {people}"
- `adminRoles.saveBar` — "{changes} á {roles} hlutverkum, nær til {people}" / "{changes} to {roles} roles, reaching {people}"
- `adminRoles.discard` — "Hætta við breytingar" / "Discard changes"
- `adminRoles.saveChanges` — "Vista breytingar" / "Save changes"
- `adminRoles.saveFailed` — "„{role}“ vistaðist ekki: {error}" / "“{role}” was not saved: {error}"
- `adminRoles.unsavedLeave` — "Óvistaðar breytingar á hlutverkum tapast. Halda áfram?" / "Unsaved changes to roles will be lost. Continue?"
- `adminRoles.showRole` — "Sýna hlutverk" / "Show role"
- `adminRoles.editRole` — "Breyta {name}" / "Edit {name}"
- `adminRoles.deleteBlocked` — "{n} hafa þetta hlutverk. Færðu þau í annað hlutverk (flipinn Meðlimir) áður en því er eytt." / "{n} hold this role. Move them to another role (Members tab) before deleting it."
- `adminRoles.created` — "Hlutverkið „{name}“ var stofnað" / "Created the role “{name}”"
- `adminRoles.create` — "Stofna hlutverk" / "Create role"
- `profile.roles` — "Hlutverk" / "Roles"
- `adminCustomers.addHint` (reworded) — "Býr til aðgang án lykilorðs. Hakaðu við til að senda boðspóst strax; annars sendirðu hann síðar úr „Breyta“." / "Creates a passwordless account. Tick the box to email the invite now; otherwise send it later from “Edit”."
- `adminCustomers.addSubmit` (reworded) — "Búa til" / "Create"
- `adminCustomers.sendInviteNow` — "Senda boðspóst núna" / "Send the invite email now"
- `adminCustomers.createdNotInvited` — "Viðskiptavinur stofnaður. Ekkert boð var sent; sendu það síðar úr „Breyta“." / "Customer created. No invite was sent; send it later from “Edit”."
- `adminCustomers.edit` / `editRow` / `editTitle` — "Breyta" / "Breyta {name}" / "Breyta viðskiptavini" · "Edit" / "Edit {name}" / "Edit customer"
- `adminCustomers.address1` / `address2` / `zip` / `city` / `country` — "Heimilisfang" / "Heimilisfang, lína 2" / "Póstnúmer" / "Staður" / "Land (tveggja stafa kóði, t.d. IS)" · "Address" / "Address line 2" / "Postcode" / "City" / "Country (two-letter code, e.g. IS)"
- `adminCustomers.saved` — "Viðskiptavinur vistaður" / "Customer saved"
- `adminCustomers.inviteSection` — "Boð um innskráningu" / "Sign-in invite"
- `adminCustomers.inviteHint` — "Sendir boðspóst með hlekk til að velja lykilorð. Hlekkurinn birtist aldrei hér." / "Emails the invite with a link to choose a password. The link is never shown here."
- `adminCustomers.sendInvite` — "Senda boð" / "Send invite"
- `adminCustomers.inviteSentOk` — "Boðið var sent." / "The invite was sent."
- `adminCustomers.inviteNotSent` — "Boðið var ekki sent: engin póstþjónusta tók við því. Reyndu aftur síðar." / "The invite was not sent: no mail service accepted it. Try again later."
- `adminCustomers.inviteRedirectedNoLink` — "Boðið fór á prófunarlistann, ekki til viðskiptavinarins." / "The invite went to the test allowlist, not to the customer."
- `adminCustomers.hasPasswordNote` — "Þessi viðskiptavinur er þegar með lykilorð og þarf ekki boð." / "This customer already has a password and needs no invite."
- `adminCustomers.noEmailNoInvite` — "Ekkert netfang, svo ekki er hægt að senda boð." / "No email address, so no invite can be sent."
- `adminCustomers.emailAdminOnly` — "Aðeins stjórnandi getur breytt netfanginu, því innskráning viðskiptavinarins byggir á því." / "Only an administrator can change the email: the customer's login lives on it."

Server (`server/i18n/*.json`), IS / EN:
- `errors.admin.roleNameReserved` (reworded) — "Þetta heiti tilheyrir innbyggðu hlutverki eða hljómar eins og kerfisstjórn (t.d. admin, Stjórnandi, Kerfi). Veldu annað." / "That name belongs to a built-in role or reads as running the system (e.g. admin, Stjórnandi, Kerfi). Choose another."
- `errors.admin.roleInUse` (reworded, `{count}`) — "Fólk með þetta hlutverk: {count}. Færðu það fyrst í annað hlutverk (flipinn Meðlimir) og eyddu hlutverkinu svo." / "People with this role: {count}. Move them to another role first (Members tab), then delete it."
- `errors.admin.roleLabelInvalid` — "Gefðu hlutverkinu heiti, 2–30 stafir: bókstafir (líka íslenskir), tölustafir, bil og . , & ' ( ) / + -" / "Give the role a name of 2–30 characters: letters (Icelandic ones too), digits, spaces and . , & ' ( ) / + -"
- `errors.admin.roleSystemLabel` — "Innbyggð hlutverk halda heitum sínum; aðeins öðrum hlutverkum má gefa nýtt heiti." / "Built-in roles keep their names; only the other roles can be renamed."
- `errors.admin.cannotGrantUserRole` — "Allir aðgangar hafa hlutverkið Notandi, svo það getur ekki fengið stjórnborðssíður. Stofnaðu hlutverk fyrir þá sem þurfa þær." / "Every account holds the User role, so it can't be given admin screens. Create a role for the people who need them."
- `errors.admin.customerNotFound` — "Viðskiptavinur fannst ekki" / "Customer not found"
- `errors.admin.inviteHasPassword` — "Þessi viðskiptavinur er þegar með lykilorð — sendu lykilorðshlekk í staðinn." / "This customer already has a password — send them a set-password link instead." (ice's text)
- `errors.admin.inviteNoEmail` — "Þessi viðskiptavinur er ekki með netfang til að senda boð á." / "This customer has no email address to send an invite to."
- `errors.admin.customerEmailAdminOnly` — "Aðeins stjórnandi getur breytt netfangi viðskiptavinar, því innskráningin hans byggir á því." / "Only an administrator can change a customer's email address: it is the address their login lives on."
- `validation.address.maxLength` — "Heimilisfangsreitir mega að hámarki vera {n} stafir" / "Address fields can be at most {n} characters"
- `validation.country.invalid` — "Land verður að vera tveggja stafa kóði, t.d. IS" / "Country must be a two-letter code, e.g. IS"

### Migrations

- `116_role_label` — engine, expand-only. ice's `134_company_role_label` is on `company_roles`, a
  different table: NOT an alias. On ice this entry simply runs (its `roles` table gets `label`).
- `117_user_address` — engine, expand-only, `IF NOT EXISTS`, statements identical to ice's
  `114_user_address` (#336): ice's product file should alias `117_user_address` →
  `['114_user_address']` in its next engine sync.
- Numbers are provisional (master ended at 114; 115 is reserved by lane 4b) and may be renumbered
  at merge.

### Review pass (invariant-reviewer on `git diff master...HEAD`)

Verdict FAIL on one finding, fixed on the branch:

- **H1 (fixed).** An email change kept `invited_at`, which `auth/publishedSeller.js` reads as
  proof that an address is real — so re-pointing an invited customer's email at a published
  seller's address could open that seller's area on the public instance. `Customer.updateContact`
  now clears `invited_at`, `password_reset_token`/`_expires` and `email_verified` in the SAME
  UPDATE whenever the address really changes (`CASE WHEN email IS DISTINCT FROM …`), which also
  fixes **L4** (the reset used to be a second statement). Test extended.
- **M1 (fixed after the review).** The `customers` view could change a customer's email; that
  change is now admin-only (next section).
- **L1 (fixed).** Reference copies `server/migrations/116_role_label.sql`, `117_user_address.sql`.
- **L2 (won't fix).** 116's backfill writes data in an engine migration; it derives each label from
  that database's own row (no product copy), so it stays within invariant 4.
- **L3 (fixed).** `docs/API.md` rows for `/admin/roles` and `/admin/customers`.
- **L5 (fixed).** The list returns `editable` (the same `EDITABLE` guard), and Edit shows only there.

Other checks in the review passed: SQL built from fixed column lists only, every new route CSRF +
`requireView('customers')`, `escHtml` on every interpolated value, no colour literal added (the old
`#5cb5e0` and the badges' `rgba()` are gone), every audit action in `ACTIONS`.

Also seen in passing: the Customers LIST table is wider than a 375px phone (about 500px of
sideways page scroll) — pre-existing, not this lane's dialog.

### The email change is admin-only (the default taken)

After the review the coordinator took the tighter default (tighten, never loosen — M1 above is
closed by it): a new email plus the public forgot-password flow is a takeover of the customer's
login, so **changing a customer's EMAIL through `PATCH /admin/customers/:id` needs admin**
(`hasRole(req.user, 'admin')` — the session's role set after the 2FA withholding, what
`requireRole('admin')` reads on the other customer writes). A `customers`-view holder who sends a
CHANGED email gets 403 `errors.admin.customerEmailAdminOnly` (`reason: 'email_admin_only'`) and
nothing in the request is written; name, phone and address stay editable with the view, and
re-sending the same address is not a change. The dialog shows the email read-only to a non-admin,
with a hint, and never sends it. **Halli can loosen this** (drop the check in
`adminCustomerController.updateCustomer`) if sellers should correct emails themselves.

### Still owed / for Halli

- Whether to loosen the admin-only email change (above).
- All strings above are DRAFT.
