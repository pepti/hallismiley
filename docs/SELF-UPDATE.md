# Self-update

How a deployed instance of this engine learns that a newer release exists, and
how it gets there.

This exists because of the fan-out problem: one engine, many instances
(`ORANGE-SMILEY-PLAN.md` §4). Without it, shipping a security fix to N customers
is N manual deploys, and the honest answer to "is customer X patched?" is "let
me look". With it, every instance knows what it is, what it could be, and who
decides.

---

## The shape of it

```
  CI (deploy.yml)                  promote.yml                  release host
  build → scan → push       ──►    retag by digest       ──►    stable.json
  :sha-<gitSha>                    regenerate manifest          canary.json
                                                                     │
                                                                     │ hourly, jittered
                                                                     ▼
                                                             ┌───────────────┐
                                                             │  an instance  │
  platform pulls the digest  ◄── deployment webhook  ◄────── │ updateChecker │
             │                                               │ system_updates│
             ▼                                               └───────────────┘
        container swap  ──► new container boots ──► post-boot verification
                                                    (applied / failed)
```

Five pieces, each with one job:

| Piece | File | Job |
|---|---|---|
| Build identity | `server/config/version.js`, `scripts/generate-version.js` | "which release am I?" — stamped at image build, never at runtime |
| Checker | `server/services/updateChecker.js` | fetch the channel manifest, compare, record |
| Ledger | `server/models/SystemUpdate.js`, migration 081 | one row per release this instance has heard about |
| Applier | `server/services/updateApplier.js` | trigger the platform, record what was running, verify afterwards |
| Screen | `public/js/views/AdminUpdatesView.js` | show it, and let the right person decide |

Config lives in `config/client.json` under `modules.selfUpdate`, resolved by
`server/config/clientConfig.js` (defaults < file < `CLIENT_CONFIG_*` env).

---

## Modes

The mode is the answer to "who decides when this instance restarts?".

| Mode | The checker | The admin sees | Applies |
|---|---|---|---|
| `managed` | checks, records | a sentence: Orange Smiley drives | never from inside |
| `manual` | checks, records | the update, and an install button | when a human presses it |
| `auto` | checks, records, schedules | the update, and when it will install | itself, in the maintenance window |

`managed` is the default, and it is the safe one: an instance that has been
misconfigured, or whose config file is corrupt, lands there.

The mode has two layers. `config/client.json` is the **instance contract**, set
at provisioning by whoever operates the deployment. `app_settings` rows are what
the instance's own admin has chosen since. The contract wins where it must: an
instance provisioned `managed` ignores its admin entirely, because otherwise the
arrangement the customer bought would be cancellable from inside the product. An
instance provisioned `auto`/`manual` lets its admin move between those two,
choose a channel, and edit the window — see `server/services/selfUpdateSettings.js`.

---

## The manifest

Published per channel, public, unauthenticated:

```json
{
  "version": "1.4.2",
  "imageDigest": "sha256:0123…",
  "publishedAt": "2026-08-10T03:00:00.000Z",
  "minCompatibleVersion": "1.3.0",
  "changelogMd": "## [1.4.2] — 2026-08-10\n\n- Fixed the thing\n",
  "critical": false
}
```

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | semver. Compared against the running build |
| `imageDigest` | yes | `sha256:` + 64 hex. The bytes the platform will pull |
| `publishedAt` | yes | ISO 8601 |
| `minCompatibleVersion` | no | oldest version that can upgrade *from* directly. Absent = reachable from anything |
| `changelogMd` | no | Markdown, ≤ 64 KB. Rendered through a 12-tag allowlist |
| `critical` | no | a security release. May install outside the maintenance window |

**Why unauthenticated is fine.** Nothing trusts the manifest's *content* with
anything dangerous. The only value that reaches a deployment is `imageDigest`,
and a digest is self-verifying — the registry cannot hand back different bytes
for it. What needs protecting is *who we ask*, so the URL goes through
`server/services/outboundAllowlist.js` (https only, exact host match, no IP
literals, no credentials, default port) and redirects are never followed.

Build one with `scripts/build-manifest.js`; validate with
`scripts/check-manifest.js`, which imports the *same* validator every instance
runs. CI does both on every run.

---

## The state machine

```
available ──apply──► applying ──verify: running version matches──► applied
     │                   │
     │ auto: window       └── grace period expired, version unchanged ──► failed
     ▼                                                                     │
 scheduled ──window opens──► applying                                      │
     │                                                                     ▼
     └── admin dismisses ──► dismissed                                  rollback
```

Transitions are guarded **in SQL** (`WHERE status = …`), not in JavaScript. Two
requests racing to apply the same update must produce one deployment trigger,
not two; the second gets no row back and stops.

**Order matters at apply time.** The row moves to `applying` and captures
`previous_digest` *before* the trigger fires, because once the trigger succeeds
the platform can kill this process mid-response. Anything not written before the
trigger is never written at all.

**Post-boot verification** runs after migrations and before `listen()` — a
verdict recorded before migrations ran would say the container started, not that
the release works. It *also* runs on every checker tick, because on an instance
whose new image never booted, the old container is still serving and will never
see another boot; that tick is the only thing that will ever expire the grace
period (15 minutes) and mark the update `failed`.

---

## Rollback is assisted, not automatic

An image that fails to **boot** cannot roll itself back, because it is not
running to do so. Nothing in this repo changes that, and a mechanism that
claimed otherwise would be worse than none.

What is covered: the new image boots, is wrong, and someone wants the previous
digest back. `POST /api/v1/system/updates/:id/rollback` re-triggers the
deployment pinned to `previous_digest`. When no previous digest was recorded,
the endpoint returns the exact operator command instead of pretending.

**The real safety net for a non-booting image is a platform guard** — a
staging-slot swap (App Service S1+) or last-known-good — and it belongs to
provisioning, not to this repo. See below.

---

## Migrations: expand/contract is mandatory

This is stack invariant #14, and self-update is why it exists.

An instance can pull a new image at 03:00 with nobody watching. During the swap
the **old** container is still serving requests against the **new** schema. A
`DROP COLUMN` in the same release that stops writing to it takes the site down
for the length of the swap, and makes a rollback to the previous digest
impossible.

- Release N: **expand** — add the column/table, write both, read new-with-fallback.
- Release N+1 or later: **contract** — drop the old.

A release that genuinely cannot satisfy this declares `minCompatibleVersion`.
The checker records such an update, shows it, and refuses to auto-apply it from
an older instance.

---

## Releasing

```
merge to main → CI → deploy.yml pushes :sha-<gitSha>, prints the digest
              → promote.yml: that sha → canary
              → Orange Smiley's own instances soak 24–48 h
              → promote.yml: the SAME sha → stable
```

`promote.yml` retags an existing digest with `az acr import` and **never
builds**. Rebuilding the same commit produces different bytes (timestamps, base
image drift) and silently discards the soak. We are the canary; customers are
not.

---

## What is NOT code — the provisioning checklist

None of the following lives in this repo, and an instance without it is one that
can see updates but not install them. **The site-factory provisioning playbook
owns these** (see the factory's `RECOMMENDATIONS.md`).

Per **fleet** (once):

- [ ] A container registry for release images.
- [ ] A release host serving `stable.json` / `canary.json` over https — an
      Azure Storage static site or equivalent. Short cache TTL (~5 min): an
      instance polls hourly, so a stale edge copy delays a security release.
- [ ] Repository variables for `promote.yml`: `ACR_NAME`, `IMAGE_NAME`,
      `RELEASE_STORAGE_ACCOUNT`, `RELEASE_CONTAINER`.

Per **instance**:

- [ ] **Registry pull credentials** scoped to that instance. A shared
      registry-wide credential on every customer's App Service means one
      compromised instance can pull every customer's images.
- [ ] **A deployment webhook** — the App Service CD hook or a pipeline dispatch
      URL — stored as the `SELF_UPDATE_TRIGGER_URL` app setting, sourced from
      Key Vault. Without it the admin screen says so and disables the button.
- [ ] **`RUNNING_IMAGE_DIGEST`**, or an image reference pinned by digest, so
      `previous_digest` is recorded and rollback can name bytes rather than a
      version. Optional but it is the difference between a rollback button and
      a rollback instruction.
- [ ] **A platform rollback guard** — staging-slot swap on S1+, or
      last-known-good. This is the only real protection against an image that
      does not boot.
- [ ] **`config/client.json`** with the right `mode` for what the customer
      bought, and `manifestUrl` pointing at the fleet's release host.
- [ ] The release host on the outbound allowlist — automatic when it is the
      configured `manifestUrl` host; otherwise `OUTBOUND_ALLOWED_HOSTS`.

---

## Endpoints

| Method | Path | Gate |
|---|---|---|
| GET | `/api/v1/system/version` | `updates` view |
| GET | `/api/v1/system/updates` | `updates` view |
| PATCH | `/api/v1/system/settings` | admin + CSRF |
| POST | `/api/v1/system/updates/:id/apply` | admin + CSRF + rate limit |
| POST | `/api/v1/system/updates/:id/rollback` | admin + CSRF + rate limit |

Reads are delegable — an ops role can watch a fleet. Writes are hard admin:
applying an update restarts the instance, and so does changing how updates
arrive. Nothing here is public: "which version" is also "which published CVEs
apply to me".

---

## Operating it

**"Is this instance patched?"** → the admin screen, or
`GET /api/v1/system/version`.

**"An update says failed."** → `detail.failureReason` on the row says which
stage. `stage: trigger` means the platform was never asked (check
`SELF_UPDATE_TRIGGER_URL`); `stage: verify` means it was asked and the running
version never changed — look at the platform's own deployment log, then roll
back.

**"Auto mode never fires."** → check the window actually opens: the settings
card shows the next opening as a wall-clock time, computed server-side. A
zero-length window or an empty day list never opens, and `clientConfig` warns
about both at boot.

**"A dev build says nothing."** → correct. A build with no stamped identity
reports version `dev`, which is not comparable to a release, so it never checks
and never decides it is out of date.

---

## Out of scope (v1)

Automatic unattended rollback of a non-booting image (platform concern); delta
updates; multi-region orchestration; updating infrastructure — env vars, Azure
resources — which stays provisioning and contract territory.
