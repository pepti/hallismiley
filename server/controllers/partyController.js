const fs   = require('fs');
const path = require('path');
const db   = require('../config/database');
const logger = require('../logger');
const { UPLOAD_ROOT } = require('../config/paths');
const emailService = require('../services/emailService');
const { t }        = require('../i18n');
const { DEFAULT_LOCALE, PARTY_DEFAULT_LOCALE } = require('../config/i18n');

// The /party page is Icelandic-primary: admins edit the IS content and the EN
// content auto-follows (the reverse of every other content type, which is
// EN-primary). Saving IS translates IS → EN; saving EN leaves IS untouched.
const PARTY_PRIMARY_LOCALE   = PARTY_DEFAULT_LOCALE; // 'is' — source of truth
const PARTY_SECONDARY_LOCALE = DEFAULT_LOCALE;       // 'en' — auto-translated follower
const { isEnabled: translatorEnabled } = require('../services/translator');
const {
  SITE_CONTENT_TRANSLATE_SKIP,
  runAutoTranslateSideEffect,
} = require('../services/siteContentTranslate');
const { AnalyticsEvent } = require('../models/Analytics');
const { makeToken, hashToken, generateGuestUsername } = require('../auth/tokens');
const { approveGuest, declineGuest, grantInstantAccess, sendWelcome } = require('../services/partyApproval');
const { DEFAULT_PARTY_INFO, LOCALE_NEUTRAL_INFO_KEYS, readPartyInfo } = require('../services/partyInfo');

// Base URL for links embedded in emails (mirrors emailService).
const APP_URL = process.env.APP_URL || 'https://www.hallismiley.is';
// One-click email-approval token lifetime. Short by design — the owner acts soon
// after the request; the magic link issued on approval is the long-lived one.
const APPROVAL_ACTION_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
// Email shape check for owner-entered invite addresses (mirrors validate.js).
const PARTY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Recipients for the owner "new request" notification. Always includes the
// configured owner address (default halli@hallismiley.is) so the notification
// reaches Halli even when no admin account happens to be email-verified, PLUS
// every verified + enabled admin account. Deduped and lower-cased.
function _partyNotifyRecipients(adminEmails) {
  const owner = (process.env.PARTY_NOTIFY_EMAIL || 'halli@hallismiley.is').trim();
  return [...new Set(
    [owner, ...(adminEmails || [])]
      .filter(Boolean)
      .map(e => String(e).trim().toLowerCase())
      .filter(Boolean)
  )];
}

const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10 MB

// DEFAULT_PARTY_INFO / LOCALE_NEUTRAL_INFO_KEYS / readPartyInfo moved to
// services/partyInfo.js so the welcome email (services/partyApproval.js) can
// pull live schedule/venue/activities without a circular require.

// ── Helpers ────────────────────────────────────────────────────────────────────

// URLs look like `/assets/party/foo.jpg` but the bytes live at
// `UPLOAD_ROOT/party/foo.jpg` — strip the `/assets` prefix when resolving.
function _diskPath(filePath) {
  return path.join(UPLOAD_ROOT, filePath.replace(/^\/assets\//, ''));
}

function _tryUnlink(filePath) {
  if (!filePath || !filePath.startsWith('/assets/party/')) return;
  try { fs.unlinkSync(_diskPath(filePath)); } catch { /* ignore */ }
}

async function _sendRsvpEmails({ userId, answers, isUpdate }) {
  const [userRes, adminsRes, formRes, partyInfo] = await Promise.all([
    db.query(
      'SELECT id, username, display_name, email, preferred_locale FROM users WHERE id = $1',
      [userId]
    ),
    db.query(
      `SELECT email FROM users
        WHERE id IN (SELECT user_id FROM user_roles WHERE role_name = 'admin') AND email_verified = TRUE AND disabled = FALSE`
    ),
    db.query(
      `SELECT value FROM site_content WHERE key = 'party_rsvp_form'
        ORDER BY (locale = $1) DESC LIMIT 1`,
      [DEFAULT_LOCALE]
    ),
    readPartyInfo(DEFAULT_LOCALE, { anyLocaleFallback: true }),
  ]);

  const user = userRes.rows[0];
  if (!user) return;

  let rsvpForm = [];
  const rawForm = formRes.rows[0]?.value;
  if (Array.isArray(rawForm)) rsvpForm = rawForm;
  else if (typeof rawForm === 'string') {
    try { rsvpForm = JSON.parse(rawForm); } catch { /* ignore */ }
  }

  const adminEmails = adminsRes.rows.map(r => r.email).filter(Boolean);

  // Fire admin notification + guest confirmation in parallel. Failures are
  // isolated: one failing email never blocks the other from sending.
  await Promise.allSettled([
    adminEmails.length
      ? emailService.sendRsvpNotification({ user, answers, rsvpForm, isUpdate, adminEmails })
      : Promise.resolve(),
    user.email
      ? emailService.sendRsvpConfirmation({ user, answers, rsvpForm, isUpdate, partyInfo })
      : Promise.resolve(),
  ]);
}

const VALID_RSVP_STATUSES = new Set(['going', 'maybe', 'declined']);

/** Build a Map<label, 'going'|'maybe'|'declined'> across every locale of the
 *  current admin-edited RSVP form. The admin marks each radio option with a
 *  status in the form editor; we use those declarations to bucket each guest
 *  rather than guessing from the label text. Both EN and IS rows are folded
 *  in because a user may have RSVP'd in one locale while the admin views the
 *  other (the auto-translate flow keeps `status` constant per option pair,
 *  since `status` is in the translator's BLOCK_KEYS).
 *
 *  Returns an empty Map when the form table is missing or unparseable —
 *  callers always have the regex fallback in _deriveRsvpStatus for that.    */
async function _loadRsvpStatusMap() {
  const map = new Map();
  let rows;
  try {
    ({ rows } = await db.query(
      `SELECT value FROM site_content WHERE key = 'party_rsvp_form'`
    ));
  } catch (_err) {
    return map;
  }
  for (const row of rows) {
    const fields = row?.value;
    if (!Array.isArray(fields)) continue;
    for (const field of fields) {
      if (field?.type !== 'radio-group' || !Array.isArray(field.options)) continue;
      for (const opt of field.options) {
        if (typeof opt === 'string') continue;             // legacy string options default to 'going'
        const label  = typeof opt?.label === 'string' ? opt.label : null;
        const status = VALID_RSVP_STATUSES.has(opt?.status) ? opt.status : null;
        if (!label || !status) continue;
        map.set(label, status);
      }
    }
  }
  return map;
}

/** Derive an RSVP status bucket from the user's answers.
 *
 *  Preferred path: look up `answers.attend_when` in the admin-curated map
 *  (label → status) built by _loadRsvpStatusMap. Falls back to a regex over
 *  the free-text answer when there's no match (legacy data, options removed
 *  since RSVP, or no map provided in unit tests). The regex preserves the
 *  original behaviour for pre-existing rows. Order matters in the fallback —
 *  decline phrases are checked first so "I'm definitely not going maybe"
 *  classifies as declined rather than maybe. Patterns cover English + Icelandic.
 *  Returns 'waiting' (no RSVP), 'declined', 'maybe', or 'going'.            */
function _deriveRsvpStatus(answers, optionLabelToStatus) {
  if (!answers) return 'waiting';
  const a = typeof answers.attend_when === 'string' ? answers.attend_when : '';
  if (optionLabelToStatus && optionLabelToStatus.has(a)) {
    return optionLabelToStatus.get(a);
  }
  if (/can'?t|sorry|kemst ekki|afþakka|kem ekki/i.test(a)) return 'declined';
  if (/\bmaybe\b|kannski|óvíst/i.test(a))                  return 'maybe';
  return 'going';
}

/** Check party access via the users.party_access flag.
 *  The email-invite pathway (party_invites table) was removed with the old
 *  party scope; access is now granted purely by the admin-toggleable flag. */
async function _checkInviteAccess(email) {
  const { rows } = await db.query(
    `SELECT 1 FROM users WHERE LOWER(email) = $1 AND party_access = TRUE LIMIT 1`,
    [email.toLowerCase()]
  );
  return rows.length > 0;
}

// Logistics categories — the three grouped tables on the planner page. Stored
// in party_logistics_items.category and mirrored by a CHECK constraint (058).
const LOGISTICS_CATEGORIES = ['food', 'drinks', 'other'];

// ── To-do list validation helpers ─────────────────────────────────────────────
const TODO_MAX_ASSIGNEES = 25;

// Normalize an optional due date to a 'YYYY-MM-DD' string or null. Accepts the
// bare ISO date that <input type="date"> submits and rejects anything else
// (including impossible dates like 2026-02-31 that Date would silently roll).
function _normalizeDueDate(v) {
  if (v == null || v === '') return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false };
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { ok: false };
  return { ok: true, value: s };
}

// ── Cost validation helpers (063) ─────────────────────────────────────────────
// Sanity ceiling for quantities and ISK amounts — generous for a party budget
// while rejecting nonsense that would overflow the display.
const MAX_ISK = 100_000_000;

// Logistics quantity: null/'' clears; otherwise a finite number ≥ 0 (decimals
// allowed — "2.5 kg" is a real quantity).
function _normalizeQuantity(v) {
  if (v == null || v === '') return { ok: true, value: null };
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_ISK) return { ok: false };
  return { ok: true, value: v };
}

// Whole-ISK amount (logistics unit_price, todo cost): null/'' clears;
// otherwise an integer ≥ 0 — ISK has no subunit.
function _normalizeIskAmount(v) {
  if (v == null || v === '') return { ok: true, value: null };
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_ISK) return { ok: false };
  return { ok: true, value: v };
}

// Normalize an assignees value to a deduped array of trimmed name strings.
// Accepts an array of strings; each ≤ 100 chars; caps the list length. Mirrors
// the free-text philosophy of logistics.assigned_to (non-guests allowed).
function _normalizeAssignees(v) {
  if (v == null) return { ok: true, value: [] };
  if (!Array.isArray(v)) return { ok: false };
  const out = [];
  const seen = new Set();
  for (const item of v) {
    if (typeof item !== 'string') return { ok: false };
    const name = item.trim();
    if (!name) continue;
    if (name.length > 100) return { ok: false, tooLong: true };
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  if (out.length > TODO_MAX_ASSIGNEES) return { ok: false, tooMany: true };
  return { ok: true, value: out };
}

// ── Invite management (admin only) ────────────────────────────────────────────

const partyController = {

  async addInvites(req, res, _next) {
    // party_invites table removed — access is managed via users.party_access flag in Manage Users
    return res.status(410).json({ error: t(req.locale, 'errors.party.inviteEndpointRemoved'), code: 410 });
  },

  async listInvites(req, res, _next) {
    // party_invites table removed — return empty list so admin panel renders without error
    res.json([]);
  },

  async deleteInvite(req, res, _next) {
    // party_invites table removed
    return res.status(410).json({ error: t(req.locale, 'errors.party.inviteEndpointRemovedShort'), code: 410 });
  },

  // ── Access check ─────────────────────────────────────────────────────────────

  async checkAccess(req, res, next) {
    try {
      const hasAccess = await _checkInviteAccess(req.user.email);
      res.json({ hasAccess });
    } catch (err) { next(err); }
  },

  // ── Access requests + approval (invite-code replacement) ──────────────────────

  // POST /api/v1/party/request-access  { name, email }
  // PUBLIC. Someone with only the party URL signs up. The default path grants
  // access IMMEDIATELY: the account is created/approved and the non-expiring
  // magic sign-in link is emailed right away — clicking it is inherent proof of
  // inbox control, so no session is ever minted from this POST (if the typed
  // email belonged to someone else's existing account, auto-login would be an
  // account takeover). The owner is notified and can later send the party-info
  // email via the one-click link or the admin queue, or remove the guest.
  //
  // Guests the owner previously declined or revoked do NOT get auto-access —
  // they fall back to the old pending/manual-review flow, otherwise "Remove"
  // would be meaningless (they could re-admit themselves with the same form).
  // Always responds with a generic status so the endpoint can't be used to
  // enumerate which emails already have accounts.
  async requestAccess(req, res, next) {
    try {
      const name  = String(req.body.name  || '').trim().slice(0, 100);
      const email = String(req.body.email || '').trim().toLowerCase();

      const { rows } = await db.query(
        `SELECT id, party_access, approval_status, magic_login_token_created_at,
                preferred_locale, disabled
           FROM users WHERE LOWER(email) = $1 LIMIT 1`,
        [email]
      );
      const existing = rows[0] || null;

      // Disabled accounts: respond generically and change NOTHING — no state
      // flip, no tokens, no emails. Auto-granting here would silently plant a
      // live magic credential that activates if the account is ever re-enabled.
      if (existing && existing.disabled) {
        return res.json({ status: 'pending' });
      }

      // Already has access — nothing to do.
      if (existing && existing.party_access) {
        return res.json({ status: 'already_member' });
      }

      // Single-use approval-action token for the owner's one-click email link
      // (which now sends the party-info email; for the manual path below it
      // still gates access).
      const actionToken = makeToken();
      const actionHash  = hashToken(actionToken);
      const actionExp   = new Date(Date.now() + APPROVAL_ACTION_TTL_MS);

      // Manual-review path: the owner declined them, they're already awaiting
      // review, or they once held a magic link and access was later revoked
      // (revoke nulls only the token HASH — adminController/declineGuest keep
      // magic_login_token_created_at as the evidence this rule relies on; keep
      // it that way). 'pending' MUST be sticky here: the branch below rewrites
      // 'declined' to 'pending', so if 'pending' didn't also require review, a
      // declined guest with no magic-token history could launder their state
      // and self-admit on the second form submission.
      const requiresReview = existing && (
        existing.approval_status === 'declined' ||
        existing.approval_status === 'pending' ||
        (existing.magic_login_token_created_at != null && !existing.party_access)
      );

      let invite = null; // { to, name, token, locale } when auto-granted
      if (requiresReview) {
        await db.query(
          `UPDATE users
              SET approval_status            = 'pending',
                  requested_at               = NOW(),
                  display_name               = COALESCE(NULLIF(display_name, ''), $2),
                  approval_action_token_hash = $3,
                  approval_action_expires    = $4
            WHERE id = $1`,
          [existing.id, name || null, actionHash, actionExp]
        );
      } else if (existing) {
        // Existing account with no party history — grant instantly.
        const result = await grantInstantAccess(existing.id, {
          name: name || null, actionTokenHash: actionHash, actionExpires: actionExp,
        });
        if (result) {
          invite = {
            to:     result.user.email,
            name:   result.user.display_name,
            token:  result.magicToken,
            locale: result.user.preferred_locale || 'is',
          };
        }
      } else {
        // Brand-new guest: a passwordless, pre-approved account with an
        // auto-generated username (username is UNIQUE NOT NULL) and a magic
        // login token issued up front. preferred_locale comes from the request
        // — on party routes that's the guest's explicit choice or the party
        // default 'is' (see middleware/locale.js).
        const username   = await generateGuestUsername(email, name);
        const magicToken = makeToken();
        const locale     = req.locale || 'is';
        await db.query(
          `INSERT INTO users
             (username, email, password_hash, role, display_name, preferred_locale,
              email_verified, party_access, approval_status, requested_at, approved_at,
              magic_login_token_hash, magic_login_token_created_at,
              approval_action_token_hash, approval_action_expires)
           VALUES ($1, $2, NULL, 'user', $3, $4, FALSE, TRUE, 'approved', NOW(), NOW(),
                   $5, NOW(), $6, $7)`,
          [username, email, name || null, locale, hashToken(magicToken), actionHash, actionExp]
        );
        invite = { to: email, name: name || null, token: magicToken, locale };
      }

      // Generic response — never reveal whether the email already existed or
      // which path was taken.
      res.json({ status: 'pending' });

      // Magic sign-in link to the guest (fire-and-forget).
      if (invite) {
        emailService.sendPartyInviteEmail(invite)
          .catch(err => logger.error({ err }, 'party invite email failed (request-access)'));
      }

      // Notify the owner (fire-and-forget). The link opens the SPA confirm page,
      // which GETs the request details then POSTs the approve action — now
      // "send the party info email" for auto-granted guests.
      const approveUrl = `${APP_URL}/is/party/approve?token=${actionToken}`;
      db.query(
        `SELECT email FROM users
          WHERE id IN (SELECT user_id FROM user_roles WHERE role_name = 'admin') AND email_verified = TRUE AND disabled = FALSE`
      ).then(adminsRes => {
        const recipients = _partyNotifyRecipients(adminsRes.rows.map(r => r.email));
        return emailService.sendPartyRequestNotification({
          request: { name, email }, adminEmails: recipients, approveUrl,
          granted: !requiresReview,
        });
      }).catch(err => logger.error({ err }, 'party request-access notification failed'));
    } catch (err) { next(err); }
  },

  // GET /api/v1/party/approval/:token — PUBLIC, read-only.
  // Backs the owner's one-click approval confirm page. Returns the pending
  // request's details when the single-use, time-limited token is valid; a generic
  // { valid:false } otherwise. Read-only, so safe against link prefetching.
  async getApprovalRequest(req, res, next) {
    try {
      const token = String(req.params.token || '');
      if (!token) return res.json({ valid: false });
      const { rows } = await db.query(
        `SELECT display_name, email, approval_status, approval_action_expires,
                party_access, welcome_email_sent_at
           FROM users WHERE approval_action_token_hash = $1 LIMIT 1`,
        [hashToken(token)]
      );
      const r = rows[0];
      if (!r || !r.approval_action_expires || new Date(r.approval_action_expires) < new Date()) {
        return res.json({ valid: false });
      }
      res.json({
        valid: true, name: r.display_name || '', email: r.email, status: r.approval_status,
        party_access: r.party_access, welcome_email_sent_at: r.welcome_email_sent_at,
      });
    } catch (err) { next(err); }
  },

  // POST /api/v1/party/approval/:token  { action: 'approve' | 'decline' }
  // PUBLIC but guarded by the unguessable single-use token — the owner is logged
  // out when clicking from the email, so double-submit CSRF can't apply; the token
  // IS the auth. 'approve' now means "send the party-info email" (sendWelcome —
  // which also re-grants access first for manual-review guests); 'decline'
  // removes the guest. Both clear the token, so a replay 404s.
  async actOnApproval(req, res, next) {
    try {
      const token  = String(req.params.token || '');
      const action = req.body?.action;
      if (action !== 'approve' && action !== 'decline') {
        return res.status(400).json({ error: t(req.locale, 'errors.party.invalidAction'), code: 400 });
      }

      const { rows } = await db.query(
        `SELECT id, approval_action_expires FROM users
          WHERE approval_action_token_hash = $1 LIMIT 1`,
        [hashToken(token)]
      );
      const target = rows[0];
      if (!target || !target.approval_action_expires || new Date(target.approval_action_expires) < new Date()) {
        return res.status(404).json({ error: t(req.locale, 'errors.party.approvalTokenInvalid'), code: 404 });
      }

      if (action === 'decline') {
        await declineGuest(target.id, { approvedBy: null });
        return res.json({ status: 'declined' });
      }

      await sendWelcome(target.id, { sentBy: null });
      res.json({ status: 'approved' });
    } catch (err) { next(err); }
  },

  // POST /api/v1/party/owner-invite  { invites: [{ email, name? }] }
  // Admin-only. Pre-approves the given emails (creating passwordless accounts as
  // needed) and emails each a magic link immediately — the owner vouches for
  // people they already have. Reuses approveGuest so existing accounts also get
  // access + a fresh magic token. Responds with the count; emails fan out in the
  // background so a slow Resend call never blocks the admin UI.
  async ownerInvite(req, res, next) {
    try {
      const list = req.body?.invites;
      if (!Array.isArray(list) || list.length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.invitesRequired'), code: 400 });
      }
      if (list.length > 100) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.invitesTooMany', { n: 100 }), code: 400 });
      }

      // Validate + normalize the whole batch first; reject on a bad email so the
      // admin sees the problem rather than silent drops.
      const entries = [];
      for (const item of list) {
        const email = String(item?.email || '').trim().toLowerCase();
        const name  = String(item?.name  || '').trim().slice(0, 100);
        if (!PARTY_EMAIL_RE.test(email)) {
          return res.status(400).json({ error: t(req.locale, 'errors.party.inviteEmailInvalid', { email }), code: 400 });
        }
        entries.push({ email, name });
      }

      // De-dupe by email within the batch.
      const seen = new Set();
      const unique = entries.filter(e => (seen.has(e.email) ? false : (seen.add(e.email), true)));

      const sends = [];
      for (const { email, name } of unique) {
        const ex = await db.query(`SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`, [email]);
        let userId;
        if (ex.rows[0]) {
          userId = ex.rows[0].id;
        } else {
          const username = await generateGuestUsername(email, name);
          const ins = await db.query(
            `INSERT INTO users
               (username, email, password_hash, role, display_name,
                email_verified, party_access, approval_status)
             VALUES ($1, $2, NULL, 'user', $3, FALSE, FALSE, 'pending')
             RETURNING id`,
            [username, email, name || null]
          );
          userId = ins.rows[0].id;
        }
        const result = await approveGuest(userId, { approvedBy: req.user.id });
        if (result) {
          sends.push({
            to:     result.user.email,
            name:   result.user.display_name || name,
            token:  result.magicToken,
            locale: result.user.preferred_locale || 'is',
          });
        }
      }

      res.json({ invited: sends.length });

      Promise.allSettled(sends.map(s => emailService.sendPartyInviteEmail(s))).then(results => {
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed) logger.error({ failed, total: sends.length }, 'owner-invite: some invite emails failed');
      });
    } catch (err) { next(err); }
  },

  // GET /api/v1/party/pending-requests — admin/moderator only.
  // The owner's "send the party info email" queue: auto-granted guests who
  // haven't received the welcome email yet (the magic-token guard keeps
  // admins/owner — party_access but no magic link — out of the list), plus
  // manual-review re-requests (declined/revoked guests) still awaiting a
  // decision.
  async listPendingRequests(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT id, username, display_name, email, avatar, requested_at,
                party_access, approval_status, welcome_email_sent_at
           FROM users
          WHERE disabled = FALSE
            AND ((party_access = TRUE AND welcome_email_sent_at IS NULL
                  AND magic_login_token_created_at IS NOT NULL)
                 OR approval_status = 'pending')
          ORDER BY requested_at ASC NULLS LAST`
      );
      res.json(rows);
    } catch (err) { next(err); }
  },

  // ── RSVP ─────────────────────────────────────────────────────────────────────

  async upsertRsvp(req, res, next) {
    try {
      const { answers } = req.body;

      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.answersObject'), code: 400 });
      }

      const existing = await db.query(
        'SELECT 1 FROM party_rsvps WHERE user_id = $1',
        [req.user.id]
      );
      const isUpdate = existing.rows.length > 0;

      // Store `attending=true` on the legacy column so headcount queries keep working.
      // Real data lives in `answers` (keyed by field id chosen by the admin).
      const { rows } = await db.query(
        `INSERT INTO party_rsvps (user_id, attending, answers)
         VALUES ($1, TRUE, $2::jsonb)
         ON CONFLICT (user_id) DO UPDATE SET
           answers    = EXCLUDED.answers,
           updated_at = NOW()
         RETURNING *`,
        [req.user.id, JSON.stringify(answers)]
      );

      res.json(rows[0]);

      // Fire-and-forget: admin notification + guest confirmation. Never fail
      // the request on email failure.
      _sendRsvpEmails({ userId: req.user.id, answers, isUpdate })
        .catch(err => console.error(`[partyController] RSVP emails failed: ${err.message}`));

      // Count only NEW RSVPs as conversions, not edits to an existing one.
      if (!isUpdate) {
        AnalyticsEvent.record({ event_type: 'party_rsvp', locale: req.locale }).catch(() => {});
      }
    } catch (err) { next(err); }
  },

  async getMyRsvp(req, res, next) {
    try {
      const { rows } = await db.query(
        'SELECT * FROM party_rsvps WHERE user_id = $1',
        [req.user.id]
      );
      res.json(rows[0] || null);
    } catch (err) { next(err); }
  },

  async getAllRsvps(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT r.*, u.username, u.display_name, u.email, u.avatar
         FROM party_rsvps r
         JOIN users u ON u.id = r.user_id
         ORDER BY r.created_at ASC`
      );
      res.json(rows);
    } catch (err) { next(err); }
  },

  // GET /api/v1/party/invited-guests — admin/moderator only.
  // Returns every user with party_access=true, LEFT JOINed with their RSVP
  // row so the UI can show "✅ Going / 🤔 Maybe / ⏳ Pending / ❌ Declined"
  // at a glance. Status is derived from the free-text `attend_when` answer:
  // explicit decline phrases first, then "maybe", otherwise "going". The
  // patterns cover English + Icelandic so localized forms classify correctly.
  async listInvitedGuests(req, res, next) {
    try {
      // Load the admin-curated label→status map alongside the guest list so
      // we can bucket each guest by their selected option rather than by
      // regex-matching the label. Both queries run in parallel — the map
      // query touches a tiny table (one row per locale).
      const [guestsRes, statusMap] = await Promise.all([
        db.query(
          `SELECT
             u.id, u.username, u.display_name, u.email, u.avatar, u.role,
             r.answers      AS rsvp_answers,
             r.admin_status AS rsvp_admin_status,
             r.created_at   AS rsvp_created_at,
             r.updated_at   AS rsvp_updated_at
           FROM users u
           LEFT JOIN party_rsvps r ON r.user_id = u.id
           WHERE u.party_access = TRUE AND u.disabled = FALSE
           ORDER BY COALESCE(u.display_name, u.username) ASC`
        ),
        _loadRsvpStatusMap(),
      ]);

      const shaped = guestsRes.rows.map(r => ({
        id:              r.id,
        username:        r.username,
        display_name:    r.display_name,
        email:           r.email,
        avatar:          r.avatar,
        role:            r.role,
        // An admin override (set from the attendance table) wins over the
        // status derived from the guest's own answer.
        rsvp_status:     r.rsvp_admin_status || _deriveRsvpStatus(r.rsvp_answers, statusMap),
        rsvp_answers:    r.rsvp_answers || null,
        rsvp_created_at: r.rsvp_created_at,
        rsvp_updated_at: r.rsvp_updated_at,
      }));
      res.json(shaped);
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/party/guests/:id/rsvp-status — admin only.
  // Lets the host set or correct a guest's RSVP bucket straight from the
  // attendance table (e.g. someone who replied by text). Body: { status } where
  // status is 'going' | 'maybe' | 'declined' | 'waiting'.
  //
  //   going/maybe/declined → store an explicit admin override on the guest's
  //     party_rsvps row (upserting the row if they hadn't RSVP'd yet). The
  //     override wins over their derived status in listInvitedGuests. The legacy
  //     `attending` column is kept in sync (false only for declined) so the
  //     headcount stat stays correct.
  //   waiting → clear the override, reverting to the guest's own answer (or
  //     "no reply" when they never RSVP'd). Their answers are left untouched.
  async setGuestRsvpStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const VALID = new Set(['going', 'maybe', 'declined', 'waiting']);
      if (typeof status !== 'string' || !VALID.has(status)) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.invalidRsvpStatus'), code: 400 });
      }

      // Only real, active party guests can be edited — never an arbitrary user id.
      const guest = await db.query(
        `SELECT 1 FROM users WHERE id = $1 AND party_access = TRUE AND disabled = FALSE`,
        [id]
      );
      if (guest.rows.length === 0) {
        return res.status(404).json({ error: t(req.locale, 'errors.party.guestNotFound'), code: 404 });
      }

      if (status === 'waiting') {
        // Clear the override (no-op if the guest has no RSVP row yet).
        await db.query(
          `UPDATE party_rsvps SET admin_status = NULL, updated_at = NOW() WHERE user_id = $1`,
          [id]
        );
      } else {
        const attending = status !== 'declined';
        await db.query(
          `INSERT INTO party_rsvps (user_id, attending, answers, admin_status)
           VALUES ($1, $2, '{}'::jsonb, $3)
           ON CONFLICT (user_id) DO UPDATE SET
             admin_status = EXCLUDED.admin_status,
             attending    = EXCLUDED.attending,
             updated_at   = NOW()`,
          [id, attending, status]
        );
      }

      res.json({ ok: true, status });
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/party/guests/:id/profile — admin only.
  // Edit a guest's editable profile fields from the attendance table. Currently
  // just the display name (email is deliberately read-only — it's the login
  // identity). Body { display_name } where '' / null clears it back to the
  // username fallback.
  async setGuestProfile(req, res, next) {
    try {
      const { id } = req.params;
      let { display_name: name } = req.body;

      if (name != null && typeof name !== 'string') {
        return res.status(400).json({ error: t(req.locale, 'errors.party.invalidName'), code: 400 });
      }
      if (typeof name === 'string') {
        name = name.trim();
        if (name.length > 100) {
          return res.status(400).json({ error: t(req.locale, 'errors.party.invalidName'), code: 400 });
        }
        if (name === '') name = null;   // fall back to the username
      }

      const result = await db.query(
        `UPDATE users SET display_name = $2
          WHERE id = $1 AND party_access = TRUE AND disabled = FALSE
        RETURNING id, display_name`,
        [id, name ?? null]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: t(req.locale, 'errors.party.guestNotFound'), code: 404 });
      }
      res.json({ ok: true, display_name: result.rows[0].display_name });
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/party/guests/:id/answers — admin only.
  // Edit a guest's RSVP answers from the attendance table (e.g. the host filling
  // in / correcting what a guest told them in person). Minus the notification /
  // confirmation emails — an admin edit shouldn't fire "thanks for your RSVP"
  // mail at the guest. Upserts the row when the guest hadn't RSVP'd yet; an
  // existing admin_status override is preserved.
  //
  // Body { answers, clear? }. The update is a NON-DESTRUCTIVE MERGE, not a
  // replace: `answers` (object keyed by field id) is merged over the guest's
  // existing answers and `clear` (array of field ids) removes keys. This is
  // deliberate — the client omits fields it can't safely represent (answers a
  // guest gave in another locale, or under a since-renamed option), so a merge
  // preserves them instead of the editor silently wiping them on save.
  async setGuestAnswers(req, res, next) {
    try {
      const { id } = req.params;
      const { answers, clear } = req.body;

      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.answersObject'), code: 400 });
      }
      if (clear != null && !Array.isArray(clear)) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.answersObject'), code: 400 });
      }
      const clearKeys = Array.isArray(clear) ? clear.filter(k => typeof k === 'string') : [];

      const guest = await db.query(
        `SELECT 1 FROM users WHERE id = $1 AND party_access = TRUE AND disabled = FALSE`,
        [id]
      );
      if (guest.rows.length === 0) {
        return res.status(404).json({ error: t(req.locale, 'errors.party.guestNotFound'), code: 404 });
      }

      // Merge `answers` over the guest's existing answers and drop the `clear`
      // keys — done in a single statement (jsonb `||` then `-`) so a concurrent
      // edit can't clobber a JS read-modify-write.
      await db.query(
        `INSERT INTO party_rsvps (user_id, attending, answers)
         VALUES ($1, TRUE, ($2::jsonb - $3::text[]))
         ON CONFLICT (user_id) DO UPDATE SET
           answers    = (COALESCE(party_rsvps.answers, '{}'::jsonb) || $2::jsonb) - $3::text[],
           updated_at = NOW()`,
        [id, JSON.stringify(answers), clearKeys]
      );

      res.json({ ok: true });
    } catch (err) { next(err); }
  },

  // POST /api/v1/party/email-going — admin only.
  // Sends one email per recipient (see emailService.sendPartyAnnouncement —
  // recipients never see each other's addresses) to going (+ optionally
  // maybe) guests, so the host can blast reminders / venue updates without
  // copy-pasting addresses. Body: { subject?, body?, includeMaybe? }.
  // Returns immediately with the recipient count; the actual fan-out is
  // fire-and-forget so a slow Resend call never blocks the admin UI.
  async emailGoingGuests(req, res, next) {
    try {
      const { subject, body, includeMaybe = true } = req.body || {};

      if (subject != null && (typeof subject !== 'string' || subject.length > 200)) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.emailSubjectInvalid'), code: 400 });
      }
      if (body != null && (typeof body !== 'string' || body.length > 5000)) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.emailBodyInvalid'), code: 400 });
      }

      const allowedStatuses = includeMaybe ? ['going', 'maybe'] : ['going'];
      const [guestsRes, statusMap] = await Promise.all([
        db.query(
          `SELECT u.id, u.email, u.display_name, u.username, u.preferred_locale,
                  r.answers AS rsvp_answers
             FROM users u
             LEFT JOIN party_rsvps r ON r.user_id = u.id
            WHERE u.party_access = TRUE AND u.disabled = FALSE AND u.email IS NOT NULL`
        ),
        _loadRsvpStatusMap(),
      ]);

      const recipients = guestsRes.rows
        .filter(r => allowedStatuses.includes(_deriveRsvpStatus(r.rsvp_answers, statusMap)))
        .filter(r => r.email)
        .map(r => ({ email: r.email, locale: r.preferred_locale || 'is' }));

      // Respond first; email send happens in the background.
      res.json({ sent: recipients.length });

      if (recipients.length === 0) return;

      // Pull party info for the venue/date block at the bottom of the email.
      const partyInfo = await readPartyInfo(DEFAULT_LOCALE, { anyLocaleFallback: true });

      // One Resend call per recipient (see emailService.sendPartyAnnouncement)
      // so guests can't see each other's addresses. Partial failures are
      // logged but never surfaced to the admin — by the time we get here the
      // response has already been sent.
      emailService.sendPartyAnnouncement({
        recipients,
        subject: subject?.trim() || null,
        body:    body?.trim()    || null,
        partyInfo,
      }).catch(err => console.error(`[partyController] Party announcement failed: ${err.message}`));
    } catch (err) { next(err); }
  },

  // ── Logistics (admin/moderator) ──────────────────────────────────────────────
  // Items the planner needs to buy and bring to the venue. Two independent
  // boolean flags so "bought" and "at venue" can be ticked in either order.

  async listLogistics(_req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT id, name, quantity::float8 AS quantity, quantity_note, unit_price,
                assigned_to, category, bought, at_venue,
                sort_order, created_by, created_at, updated_at
           FROM party_logistics_items
          ORDER BY sort_order ASC, id ASC`
      );
      res.json(rows);
    } catch (err) { next(err); }
  },

  async addLogisticsItem(req, res, next) {
    try {
      const {
        name, quantity = null, quantity_note = null, unit_price = null,
        assigned_to = null, category = 'other',
      } = req.body || {};
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsNameRequired'), code: 400 });
      }
      if (name.length > 200) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsNameTooLong', { n: 200 }), code: 400 });
      }
      const qty = _normalizeQuantity(quantity);
      if (!qty.ok) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsQtyInvalid'), code: 400 });
      }
      if (quantity_note != null && (typeof quantity_note !== 'string' || quantity_note.length > 100)) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsUnitTooLong', { n: 100 }), code: 400 });
      }
      const price = _normalizeIskAmount(unit_price);
      if (!price.ok) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsPriceInvalid'), code: 400 });
      }
      if (assigned_to != null && (typeof assigned_to !== 'string' || assigned_to.length > 100)) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsAssignedTooLong', { n: 100 }), code: 400 });
      }
      if (!LOGISTICS_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsCategoryInvalid'), code: 400 });
      }

      const { rows } = await db.query(
        `INSERT INTO party_logistics_items (name, quantity, quantity_note, unit_price, assigned_to, category, sort_order, created_by)
         VALUES (
           $1, $2, $3, $4, $5, $6,
           COALESCE((SELECT MAX(sort_order) FROM party_logistics_items), 0) + 1,
           $7
         )
         RETURNING id, name, quantity::float8 AS quantity, quantity_note, unit_price,
                   assigned_to, category, bought, at_venue,
                   sort_order, created_by, created_at, updated_at`,
        [name.trim(), qty.value, quantity_note ? quantity_note.trim() || null : null, price.value,
         assigned_to ? assigned_to.trim() : null, category, req.user.id]
      );
      res.status(201).json(rows[0]);
    } catch (err) { next(err); }
  },

  async updateLogisticsItem(req, res, next) {
    try {
      const id = req.params.id;
      const allowed = ['name', 'quantity', 'quantity_note', 'unit_price', 'assigned_to', 'category', 'bought', 'at_venue'];
      const sets = [];
      const values = [];
      let idx = 1;

      for (const key of allowed) {
        if (!Object.prototype.hasOwnProperty.call(req.body || {}, key)) continue;
        let v = req.body[key];

        if (key === 'name') {
          if (typeof v !== 'string' || v.trim().length === 0) {
            return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsNameRequired'), code: 400 });
          }
          if (v.length > 200) {
            return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsNameTooLong', { n: 200 }), code: 400 });
          }
          v = v.trim();
        } else if (key === 'quantity') {
          const qty = _normalizeQuantity(v);
          if (!qty.ok) {
            return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsQtyInvalid'), code: 400 });
          }
          v = qty.value;
        } else if (key === 'unit_price') {
          const price = _normalizeIskAmount(v);
          if (!price.ok) {
            return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsPriceInvalid'), code: 400 });
          }
          v = price.value;
        } else if (key === 'quantity_note' || key === 'assigned_to') {
          if (v != null && typeof v !== 'string') {
            return res.status(400).json({ error: t(req.locale, 'errors.party.fieldMustBeString', { name: key }), code: 400 });
          }
          if (typeof v === 'string') {
            const max = 100;
            if (v.length > max) {
              const errKey = key === 'quantity_note' ? 'errors.party.logisticsUnitTooLong' : 'errors.party.logisticsAssignedTooLong';
              return res.status(400).json({ error: t(req.locale, errKey, { n: max }), code: 400 });
            }
            v = v.trim() || null;
          }
        } else if (key === 'category') {
          if (!LOGISTICS_CATEGORIES.includes(v)) {
            return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsCategoryInvalid'), code: 400 });
          }
        } else if (key === 'bought' || key === 'at_venue') {
          if (typeof v !== 'boolean') {
            return res.status(400).json({ error: t(req.locale, 'errors.party.fieldMustBeBoolean', { name: key }), code: 400 });
          }
        }

        sets.push(`${key} = $${idx++}`);
        values.push(v);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsNoFields'), code: 400 });
      }

      values.push(id);
      const { rows } = await db.query(
        `UPDATE party_logistics_items
            SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${idx}
          RETURNING id, name, quantity::float8 AS quantity, quantity_note, unit_price,
                    assigned_to, category, bought, at_venue,
                    sort_order, created_by, created_at, updated_at`,
        values
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.party.logisticsItemNotFound'), code: 404 });
      res.json(rows[0]);
    } catch (err) { next(err); }
  },

  async deleteLogisticsItem(req, res, next) {
    try {
      const { rows } = await db.query(
        `DELETE FROM party_logistics_items WHERE id = $1 RETURNING id`,
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.party.logisticsItemNotFound'), code: 404 });
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // Apply a new sort order. Body: { ids: [n, n, n, ...] }. Sequential
  // sort_order values are written 1..N in array order, inside a single
  // transaction so a partial failure can't leave the list half-reordered.
  async reorderLogistics(req, res, next) {
    try {
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.reorderIdsRequired'), code: 400 });
      }
      if (!ids.every(n => Number.isInteger(n))) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.reorderIdsIntegers'), code: 400 });
      }

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < ids.length; i++) {
          await client.query(
            `UPDATE party_logistics_items SET sort_order = $1, updated_at = NOW() WHERE id = $2`,
            [i + 1, ids[i]]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // Day-of-party convenience: flip every item to at_venue=true in one shot.
  // Idempotent — running twice is a no-op for already-true rows.
  async markAllAtVenue(_req, res, next) {
    try {
      await db.query(
        `UPDATE party_logistics_items SET at_venue = TRUE, updated_at = NOW() WHERE at_venue = FALSE`
      );
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // ── To-do list (admin/moderator) ─────────────────────────────────────────────
  // A collaborative planning checklist. Each TODO has free-form notes plus an
  // optional due date + assignees, and breaks down into subtasks that carry
  // their own due date + assignees. Assignees are stored as a JSONB array of
  // name strings (see _normalizeAssignees); due dates are returned as plain
  // 'YYYY-MM-DD' strings via to_char so the <input type="date"> round-trips.

  async listTodos(_req, res, next) {
    try {
      const { rows: todos } = await db.query(
        `SELECT id, title, notes, done, to_char(due_date, 'YYYY-MM-DD') AS due_date,
                cost, assignees, sort_order, created_by, created_at, updated_at
           FROM party_todos
          ORDER BY sort_order ASC, id ASC`
      );
      const { rows: subs } = await db.query(
        `SELECT id, todo_id, title, done, to_char(due_date, 'YYYY-MM-DD') AS due_date,
                assignees, sort_order, created_at, updated_at
           FROM party_todo_subtasks
          ORDER BY todo_id ASC, sort_order ASC, id ASC`
      );
      const byTodo = new Map();
      for (const s of subs) {
        if (!byTodo.has(s.todo_id)) byTodo.set(s.todo_id, []);
        byTodo.get(s.todo_id).push(s);
      }
      res.json(todos.map(todo => ({ ...todo, subtasks: byTodo.get(todo.id) || [] })));
    } catch (err) { next(err); }
  },

  async addTodo(req, res, next) {
    try {
      const { title, notes = null, due_date = null, cost = null, assignees = [] } = req.body || {};
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.todoTitleRequired'), code: 400 });
      }
      if (title.length > 200) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.todoTitleTooLong', { n: 200 }), code: 400 });
      }
      if (notes != null && (typeof notes !== 'string' || notes.length > 2000)) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.todoNotesTooLong', { n: 2000 }), code: 400 });
      }
      const due = _normalizeDueDate(due_date);
      if (!due.ok) return res.status(400).json({ error: t(req.locale, 'errors.party.todoDueDateInvalid'), code: 400 });
      const costVal = _normalizeIskAmount(cost);
      if (!costVal.ok) return res.status(400).json({ error: t(req.locale, 'errors.party.todoCostInvalid'), code: 400 });
      const asg = _normalizeAssignees(assignees);
      if (!asg.ok) {
        const key = asg.tooMany ? 'errors.party.todoTooManyAssignees' : 'errors.party.todoAssigneeInvalid';
        return res.status(400).json({ error: t(req.locale, key, { n: TODO_MAX_ASSIGNEES }), code: 400 });
      }

      const { rows } = await db.query(
        `INSERT INTO party_todos (title, notes, due_date, cost, assignees, sort_order, created_by)
         VALUES (
           $1, $2, $3, $4, $5::jsonb,
           COALESCE((SELECT MAX(sort_order) FROM party_todos), 0) + 1,
           $6
         )
         RETURNING id, title, notes, done, to_char(due_date, 'YYYY-MM-DD') AS due_date,
                   cost, assignees, sort_order, created_by, created_at, updated_at`,
        [title.trim(), notes ? notes.trim() : null, due.value, costVal.value, JSON.stringify(asg.value), req.user.id]
      );
      res.status(201).json({ ...rows[0], subtasks: [] });
    } catch (err) { next(err); }
  },

  async updateTodo(req, res, next) {
    try {
      const body = req.body || {};
      const sets = [];
      const values = [];
      let idx = 1;

      if (Object.prototype.hasOwnProperty.call(body, 'title')) {
        const v = body.title;
        if (typeof v !== 'string' || v.trim().length === 0) {
          return res.status(400).json({ error: t(req.locale, 'errors.party.todoTitleRequired'), code: 400 });
        }
        if (v.length > 200) {
          return res.status(400).json({ error: t(req.locale, 'errors.party.todoTitleTooLong', { n: 200 }), code: 400 });
        }
        sets.push(`title = $${idx++}`); values.push(v.trim());
      }
      if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
        const v = body.notes;
        if (v != null && (typeof v !== 'string' || v.length > 2000)) {
          return res.status(400).json({ error: t(req.locale, 'errors.party.todoNotesTooLong', { n: 2000 }), code: 400 });
        }
        sets.push(`notes = $${idx++}`); values.push(v ? v.trim() : null);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'done')) {
        if (typeof body.done !== 'boolean') {
          return res.status(400).json({ error: t(req.locale, 'errors.party.fieldMustBeBoolean', { name: 'done' }), code: 400 });
        }
        sets.push(`done = $${idx++}`); values.push(body.done);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'due_date')) {
        const due = _normalizeDueDate(body.due_date);
        if (!due.ok) return res.status(400).json({ error: t(req.locale, 'errors.party.todoDueDateInvalid'), code: 400 });
        sets.push(`due_date = $${idx++}`); values.push(due.value);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'assignees')) {
        const asg = _normalizeAssignees(body.assignees);
        if (!asg.ok) {
          const key = asg.tooMany ? 'errors.party.todoTooManyAssignees' : 'errors.party.todoAssigneeInvalid';
          return res.status(400).json({ error: t(req.locale, key, { n: TODO_MAX_ASSIGNEES }), code: 400 });
        }
        sets.push(`assignees = $${idx++}::jsonb`); values.push(JSON.stringify(asg.value));
      }
      if (Object.prototype.hasOwnProperty.call(body, 'cost')) {
        const costVal = _normalizeIskAmount(body.cost);
        if (!costVal.ok) return res.status(400).json({ error: t(req.locale, 'errors.party.todoCostInvalid'), code: 400 });
        sets.push(`cost = $${idx++}`); values.push(costVal.value);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.todoNoFields'), code: 400 });
      }

      values.push(req.params.id);
      const { rows } = await db.query(
        `UPDATE party_todos SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${idx}
          RETURNING id, title, notes, done, to_char(due_date, 'YYYY-MM-DD') AS due_date,
                    cost, assignees, sort_order, created_by, created_at, updated_at`,
        values
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.party.todoNotFound'), code: 404 });
      res.json(rows[0]);
    } catch (err) { next(err); }
  },

  async deleteTodo(req, res, next) {
    try {
      const { rows } = await db.query(
        `DELETE FROM party_todos WHERE id = $1 RETURNING id`,
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.party.todoNotFound'), code: 404 });
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // Reorder top-level TODOs. Body { ids: [...] }; sequential sort_order 1..N
  // written in a single transaction (mirrors reorderLogistics).
  async reorderTodos(req, res, next) {
    try {
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.reorderIdsRequired'), code: 400 });
      }
      if (!ids.every(n => Number.isInteger(n))) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.reorderIdsIntegers'), code: 400 });
      }
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < ids.length; i++) {
          await client.query(
            `UPDATE party_todos SET sort_order = $1, updated_at = NOW() WHERE id = $2`,
            [i + 1, ids[i]]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async addSubtask(req, res, next) {
    try {
      const todoId = req.params.id;
      const { title, due_date = null, assignees = [] } = req.body || {};
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.todoTitleRequired'), code: 400 });
      }
      if (title.length > 200) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.todoTitleTooLong', { n: 200 }), code: 400 });
      }
      const due = _normalizeDueDate(due_date);
      if (!due.ok) return res.status(400).json({ error: t(req.locale, 'errors.party.todoDueDateInvalid'), code: 400 });
      const asg = _normalizeAssignees(assignees);
      if (!asg.ok) {
        const key = asg.tooMany ? 'errors.party.todoTooManyAssignees' : 'errors.party.todoAssigneeInvalid';
        return res.status(400).json({ error: t(req.locale, key, { n: TODO_MAX_ASSIGNEES }), code: 400 });
      }

      const parent = await db.query(`SELECT 1 FROM party_todos WHERE id = $1`, [todoId]);
      if (!parent.rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.party.todoNotFound'), code: 404 });

      const { rows } = await db.query(
        `INSERT INTO party_todo_subtasks (todo_id, title, due_date, assignees, sort_order)
         VALUES (
           $1, $2, $3, $4::jsonb,
           COALESCE((SELECT MAX(sort_order) FROM party_todo_subtasks WHERE todo_id = $1), 0) + 1
         )
         RETURNING id, todo_id, title, done, to_char(due_date, 'YYYY-MM-DD') AS due_date,
                   assignees, sort_order, created_at, updated_at`,
        [todoId, title.trim(), due.value, JSON.stringify(asg.value)]
      );
      res.status(201).json(rows[0]);
    } catch (err) { next(err); }
  },

  async updateSubtask(req, res, next) {
    try {
      const { todoId, id } = req.params;
      const body = req.body || {};
      const sets = [];
      const values = [];
      let idx = 1;

      if (Object.prototype.hasOwnProperty.call(body, 'title')) {
        const v = body.title;
        if (typeof v !== 'string' || v.trim().length === 0) {
          return res.status(400).json({ error: t(req.locale, 'errors.party.todoTitleRequired'), code: 400 });
        }
        if (v.length > 200) {
          return res.status(400).json({ error: t(req.locale, 'errors.party.todoTitleTooLong', { n: 200 }), code: 400 });
        }
        sets.push(`title = $${idx++}`); values.push(v.trim());
      }
      if (Object.prototype.hasOwnProperty.call(body, 'done')) {
        if (typeof body.done !== 'boolean') {
          return res.status(400).json({ error: t(req.locale, 'errors.party.fieldMustBeBoolean', { name: 'done' }), code: 400 });
        }
        sets.push(`done = $${idx++}`); values.push(body.done);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'due_date')) {
        const due = _normalizeDueDate(body.due_date);
        if (!due.ok) return res.status(400).json({ error: t(req.locale, 'errors.party.todoDueDateInvalid'), code: 400 });
        sets.push(`due_date = $${idx++}`); values.push(due.value);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'assignees')) {
        const asg = _normalizeAssignees(body.assignees);
        if (!asg.ok) {
          const key = asg.tooMany ? 'errors.party.todoTooManyAssignees' : 'errors.party.todoAssigneeInvalid';
          return res.status(400).json({ error: t(req.locale, key, { n: TODO_MAX_ASSIGNEES }), code: 400 });
        }
        sets.push(`assignees = $${idx++}::jsonb`); values.push(JSON.stringify(asg.value));
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.todoNoFields'), code: 400 });
      }

      values.push(id);
      values.push(todoId);
      const { rows } = await db.query(
        `UPDATE party_todo_subtasks SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${idx++} AND todo_id = $${idx}
          RETURNING id, todo_id, title, done, to_char(due_date, 'YYYY-MM-DD') AS due_date,
                    assignees, sort_order, created_at, updated_at`,
        values
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.party.subtaskNotFound'), code: 404 });
      res.json(rows[0]);
    } catch (err) { next(err); }
  },

  async deleteSubtask(req, res, next) {
    try {
      const { todoId, id } = req.params;
      const { rows } = await db.query(
        `DELETE FROM party_todo_subtasks WHERE id = $1 AND todo_id = $2 RETURNING id`,
        [id, todoId]
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.party.subtaskNotFound'), code: 404 });
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // Reorder subtasks within one TODO. Body { ids: [...] }; scoped by todo_id so
  // a stray id from another TODO can't be reordered through this endpoint.
  async reorderSubtasks(req, res, next) {
    try {
      const todoId = req.params.id;
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.reorderIdsRequired'), code: 400 });
      }
      if (!ids.every(n => Number.isInteger(n))) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.reorderIdsIntegers'), code: 400 });
      }
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < ids.length; i++) {
          await client.query(
            `UPDATE party_todo_subtasks SET sort_order = $1, updated_at = NOW()
              WHERE id = $2 AND todo_id = $3`,
            [i + 1, ids[i], todoId]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // ── Guestbook ─────────────────────────────────────────────────────────────────

  async postGuestbook(req, res, next) {
    try {
      const { message } = req.body;
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.messageRequired'), code: 400 });
      }
      if (message.length > 1000) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.messageTooLong', { n: 1000 }), code: 400 });
      }

      const { rows } = await db.query(
        `INSERT INTO party_guestbook (user_id, message) VALUES ($1, $2)
         RETURNING id, user_id, message, created_at`,
        [req.user.id, message.trim()]
      );
      res.status(201).json(rows[0]);
    } catch (err) { next(err); }
  },

  async getGuestbook(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT g.id, g.message, g.created_at,
                u.username, u.display_name, u.avatar
         FROM party_guestbook g
         JOIN users u ON u.id = g.user_id
         ORDER BY g.created_at DESC`
      );
      res.json(rows);
    } catch (err) { next(err); }
  },

  async deleteGuestbookEntry(req, res, next) {
    try {
      const { rows } = await db.query(
        'SELECT user_id FROM party_guestbook WHERE id = $1',
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.party.entryNotFound'), code: 404 });

      const isEditor = (req.user.roles || [req.user.role]).some(r => r === 'admin' || r === 'moderator');
      if (rows[0].user_id !== req.user.id && !isEditor) {
        return res.status(403).json({ error: t(req.locale, 'errors.party.forbidden'), code: 403 });
      }

      await db.query('DELETE FROM party_guestbook WHERE id = $1', [req.params.id]);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // ── Photos ────────────────────────────────────────────────────────────────────

  async uploadPhoto(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: t(req.locale, 'errors.user.noFileUploaded'), code: 400 });
      }

      if (req.file.size > MAX_PHOTO_SIZE) {
        _tryUnlink(`/assets/party/${req.file.filename}`);
        return res.status(400).json({ error: t(req.locale, 'errors.party.photoTooLarge'), code: 400 });
      }

      const caption  = req.body.caption || null;
      const filePath = `/assets/party/${req.file.filename}`;

      const { rows } = await db.query(
        `INSERT INTO party_photos (user_id, file_path, caption) VALUES ($1, $2, $3)
         RETURNING *`,
        [req.user.id, filePath, caption]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (req.file) _tryUnlink(`/assets/party/${req.file.filename}`);
      next(err);
    }
  },

  async getPhotos(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT p.id, p.file_path, p.caption, p.created_at,
                u.username, u.display_name, u.avatar,
                p.user_id
         FROM party_photos p
         JOIN users u ON u.id = p.user_id
         ORDER BY p.created_at DESC`
      );
      res.json(rows);
    } catch (err) { next(err); }
  },

  async deletePhoto(req, res, next) {
    try {
      const { rows } = await db.query(
        'SELECT user_id, file_path FROM party_photos WHERE id = $1',
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.party.photoNotFound'), code: 404 });

      const isEditor = (req.user.roles || [req.user.role]).some(r => r === 'admin' || r === 'moderator');
      if (rows[0].user_id !== req.user.id && !isEditor) {
        return res.status(403).json({ error: t(req.locale, 'errors.party.forbidden'), code: 403 });
      }

      await db.query('DELETE FROM party_photos WHERE id = $1', [req.params.id]);
      _tryUnlink(rows[0].file_path);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // ── Hero cover image (admin-only) ─────────────────────────────────────────────
  // Stored under DEFAULT_LOCALE so a single image is shared across all locales.

  async uploadCoverImage(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: t(req.locale, 'errors.user.noFileUploaded'), code: 400 });
      }

      if (req.file.size > MAX_PHOTO_SIZE) {
        _tryUnlink(`/assets/party/${req.file.filename}`);
        return res.status(400).json({ error: t(req.locale, 'errors.party.photoTooLarge'), code: 400 });
      }

      const filePath = `/assets/party/${req.file.filename}`;

      // Read previous cover so we can unlink the orphaned file after replacing it.
      const { rows: prev } = await db.query(
        `SELECT value FROM site_content WHERE key = 'party_cover_image' AND locale = $1`,
        [DEFAULT_LOCALE]
      );

      await db.query(
        `INSERT INTO site_content (key, locale, value, updated_by) VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (key, locale) DO UPDATE SET value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        ['party_cover_image', DEFAULT_LOCALE, JSON.stringify(filePath), req.user.id]
      );

      const oldPath = typeof prev[0]?.value === 'string' ? prev[0].value : null;
      if (oldPath && oldPath !== filePath) _tryUnlink(oldPath);

      // Return the merged party info (mirrors updateInfo's response shape).
      const locale = req.locale || DEFAULT_LOCALE;
      const { rows } = await db.query(
        `SELECT DISTINCT ON (key) key, value FROM site_content
          WHERE key LIKE 'party_%' AND key <> 'party_invite_code'
            AND (locale = $1 OR locale = $2)
          ORDER BY key, (locale = $1) DESC`,
        [locale, DEFAULT_LOCALE]
      );
      const info = { ...DEFAULT_PARTY_INFO };
      for (const row of rows) {
        const k = row.key.replace(/^party_/, '');
        info[k] = typeof row.value === 'object' ? JSON.stringify(row.value) : row.value;
      }
      res.json(info);
    } catch (err) {
      if (req.file) _tryUnlink(`/assets/party/${req.file.filename}`);
      next(err);
    }
  },

  // ── Party info (site_content) ─────────────────────────────────────────────────

  async getInfo(req, res, next) {
    try {
      // Prefer the request's locale; fall back to DEFAULT_LOCALE per key if
      // missing. Shared logic lives in services/partyInfo.js (the welcome
      // email renders from the same read).
      const info = await readPartyInfo(req.locale || DEFAULT_LOCALE);
      res.json(info);
    } catch (err) { next(err); }
  },

  async updateInfo(req, res, next) {
    try {
      const allowed = ['venue_name', 'venue_address', 'venue_link', 'venue_maps_link', 'venue_rating', 'venue_details', 'schedule', 'activities', 'food_options', 'rsvp_questions', 'rsvp_form', 'cover_image', 'rsvp_message'];
      const updates = req.body;

      if (typeof updates !== 'object' || Array.isArray(updates) || updates === null) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.bodyPlainObject'), code: 400 });
      }

      // Consume and strip the auto-translate opt-out flag so it never reaches
      // the jsonb column or the translator prompt. Mirrors contentController.
      const wantsAutoTranslate = !Object.prototype.hasOwnProperty.call(updates, '__autoTranslate')
        || updates.__autoTranslate !== false;
      delete updates.__autoTranslate;

      // Write to the request's locale — admins switching languages edit per-locale content.
      const locale = req.locale || DEFAULT_LOCALE;

      // Captured per-key so the IS→EN background translate can detect which
      // leaves the admin just changed and overwrite stale EN translations.
      // Only populated when writing the primary (IS) locale; for EN writes
      // we never run a side effect, so we never need the previous source.
      const previousPrimaryByKey = {};
      const parsedByKey          = {};

      for (const [key, value] of Object.entries(updates)) {
        if (!allowed.includes(key)) {
          return res.status(400).json({ error: t(req.locale, 'errors.party.invalidField', { name: key }), code: 400 });
        }
        if (typeof value !== 'string') {
          return res.status(400).json({ error: t(req.locale, 'errors.party.fieldMustBeString', { name: key }), code: 400 });
        }
        // value is always a string (validated above); structured fields arrive
        // pre-JSON-stringified from the frontend.  Parse first so we store the
        // real JSON type (object/array/string) rather than a double-encoded
        // JSON string.  If parsing fails the value is a plain string, so wrap
        // it as a JSON string.
        let jsonb;
        try { jsonb = JSON.parse(value); } catch { jsonb = value; }
        parsedByKey[key] = jsonb;

        // rsvp_message is a free-form paragraph. Cap length so the row stays
        // sane and prevent an admin from accidentally pasting a novel.
        if (key === 'rsvp_message') {
          if (typeof jsonb !== 'string') {
            return res.status(400).json({ error: t(req.locale, 'errors.party.fieldMustBeString', { name: key }), code: 400 });
          }
          if (jsonb.length > 2000) {
            return res.status(400).json({ error: t(req.locale, 'errors.party.invalidField', { name: key }), code: 400 });
          }
        }

        // Locale-neutral keys (see LOCALE_NEUTRAL_INFO_KEYS) always write to
        // DEFAULT_LOCALE no matter which locale the admin is editing on, so a
        // single Save populates both /en/party and /is/party. We also sweep
        // any pre-existing non-default-locale row for that key so it can't
        // shadow the canonical value on the request-locale read below.
        const isLocaleNeutral = LOCALE_NEUTRAL_INFO_KEYS.has(key);
        const targetLocale    = isLocaleNeutral ? DEFAULT_LOCALE : locale;

        // Capture the prior IS row BEFORE the upsert so the merge logic can
        // detect "IS leaf changed since last save" and overwrite stale EN
        // translations that no longer match the new IS value.
        if (!isLocaleNeutral && locale === PARTY_PRIMARY_LOCALE) {
          const prev = await db.query(
            `SELECT value FROM site_content WHERE key = $1 AND locale = $2`,
            [`party_${key}`, PARTY_PRIMARY_LOCALE]
          );
          previousPrimaryByKey[key] = prev.rows[0] ? prev.rows[0].value : null;
        }

        await db.query(
          `INSERT INTO site_content (key, locale, value, updated_by) VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (key, locale) DO UPDATE SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [`party_${key}`, targetLocale, JSON.stringify(jsonb), req.user.id]
        );

        if (isLocaleNeutral) {
          await db.query(
            `DELETE FROM site_content WHERE key = $1 AND locale <> $2`,
            [`party_${key}`, DEFAULT_LOCALE]
          );
        }
      }

      // Return the merged result (for the request's locale, falling back to default)
      const { rows } = await db.query(
        `SELECT DISTINCT ON (key) key, locale, value FROM site_content
          WHERE key LIKE 'party_%' AND (locale = $1 OR locale = $2)
          ORDER BY key, (locale = $1) DESC`,
        [locale, DEFAULT_LOCALE]
      );
      const info = { ...DEFAULT_PARTY_INFO };
      for (const row of rows) {
        const k = row.key.replace(/^party_/, '');
        // Locale-neutral keys only ever take DEFAULT_LOCALE — sweep above
        // should have removed any stale per-locale row, but guard the read
        // path too in case a legacy row survives.
        if (LOCALE_NEUTRAL_INFO_KEYS.has(k) && row.locale !== DEFAULT_LOCALE) continue;
        info[k] = typeof row.value === 'object' ? JSON.stringify(row.value) : row.value;
      }
      // Respond first — the IS auto-fill below runs in the background so the
      // browser does not sit on "Saving…" while the LLM translates large
      // jsonb blobs (e.g. activities with many entries).
      res.json(info);

      // Party is Icelandic-primary (unlike contentController, which is EN
      // -primary): saving the IS locale translates IS → EN in the background.
      // Saving EN runs no side effect, so IS is never overwritten by an EN
      // edit. Runs only when the translator is enabled and the caller did not
      // opt out via __autoTranslate: false. Per-key so a single bulk patch can
      // fan out into multiple background translates.
      if (locale === PARTY_PRIMARY_LOCALE && wantsAutoTranslate && translatorEnabled()) {
        for (const key of Object.keys(parsedByKey)) {
          const fullKey = `party_${key}`;
          if (SITE_CONTENT_TRANSLATE_SKIP.has(fullKey)) continue;
          if (LOCALE_NEUTRAL_INFO_KEYS.has(key)) continue;
          const sourceIs = parsedByKey[key];
          if (sourceIs === null || sourceIs === undefined) continue;
          runAutoTranslateSideEffect(
            fullKey, sourceIs, previousPrimaryByKey[key], req.user.id,
            { from: PARTY_PRIMARY_LOCALE, to: PARTY_SECONDARY_LOCALE }
          ).catch(err => logger.error(
            { err, key: fullKey },
            'partyController.updateInfo EN auto-fill failed (background)'
          ));
        }
      }
    } catch (err) { next(err); }
  },
};

module.exports = partyController;
module.exports._checkInviteAccess = _checkInviteAccess;
module.exports._deriveRsvpStatus  = _deriveRsvpStatus;
module.exports._loadRsvpStatusMap = _loadRsvpStatusMap;
module.exports._partyNotifyRecipients = _partyNotifyRecipients;
