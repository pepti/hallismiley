// Admin Customers API — list shop customers (users + order aggregates), add a
// single passwordless customer (with an optional "set your password" invite),
// and bulk-import customers from CSV. Role/approval are server-set, never taken
// from the request body.
const crypto       = require('crypto');
const { t }        = require('../i18n');
const logger       = require('../logger');
const emailService = require('../services/emailService');
const Customer     = require('../models/Customer');
const Setting      = require('../models/Setting');
const { query: dbQuery } = require('../config/database');

const MAX_IMPORT_ROWS = 1000;
// Bulk delete is bounded so one request can't fan out across the whole base.
const MAX_DELETE = 100;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ── Welcome-invite helpers (shared by the bulk send + the preview endpoints) ──
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_LOCALES = ['en', 'is'];
const inviteLocale = (loc) => (INVITE_LOCALES.includes(loc) ? loc : 'en');
// One send run is bounded, and consecutive Resend calls are spaced out to stay
// under its ~2 req/s rate limit.
const INVITE_MAX_PER_RUN = 500;
const INVITE_SEND_GAP_MS = 600;

// Candidates = approved, passwordless, not-yet-invited, enabled customers.
// Party guests are customers too (role='user') but sign in via magic link and
// never set a password — exclude them so a shop invite blast can't email the
// party list.
const INVITE_CANDIDATES_WHERE = `
  role = 'user'
  AND approval_status = 'approved'
  AND password_hash IS NULL
  AND invited_at IS NULL
  AND disabled = FALSE
  AND party_access = FALSE
  AND magic_login_token_hash IS NULL`;

const INVITE_CANDIDATES_SQL = `
  SELECT id, email, display_name, preferred_locale
  FROM users
  WHERE ${INVITE_CANDIDATES_WHERE}
  ORDER BY created_at`;

// Same candidates, narrowed to an explicit include-list (the admin can remove
// individual recipients with the per-row ✕). Intersecting with the live
// candidate set means a stale/forged id can never be emailed.
const INVITE_CANDIDATES_BY_IDS_SQL = `
  SELECT id, email, display_name, preferred_locale
  FROM users
  WHERE ${INVITE_CANDIDATES_WHERE}
    AND id = ANY($1)
  ORDER BY created_at`;

const inviteResetLink = (token, locale) => {
  const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  return `${appUrl}/#/reset-password?token=${token}&locale=${encodeURIComponent(locale)}`;
};

// Effective copy per locale = admin override (Setting.getInviteEmail) or the
// i18n default (email.invite.*). Returns both so the editor can offer "reset".
function effectiveInviteTemplate(overrides) {
  const template = {}, defaults = {};
  for (const loc of INVITE_LOCALES) {
    defaults[loc] = {
      subject: t(loc, 'email.invite.subject'),
      heading: t(loc, 'email.invite.heading'),
      body:    t(loc, 'email.invite.body'),
    };
    const ov = (overrides && overrides[loc]) || {};
    template[loc] = {
      subject: ov.subject || defaults[loc].subject,
      heading: ov.heading || defaults[loc].heading,
      body:    ov.body    || defaults[loc].body,
    };
  }
  return { template, defaults };
}

function cleanRow(r) {
  return {
    email:        String((r && r.email) || '').trim().toLowerCase(),
    display_name: r && r.display_name ? String(r.display_name).trim().slice(0, 200) : null,
    phone:        r && r.phone ? String(r.phone).trim().slice(0, 40) : null,
  };
}

const adminCustomerController = {
  // GET /api/v1/admin/customers?q=
  async listCustomers(req, res, next) {
    try {
      const data = await Customer.list({
        q:      String(req.query.q || '').trim().slice(0, 100),
        limit:  req.query.limit,
        offset: req.query.offset,
      });
      return res.json(data);
    } catch (err) { next(err); }
  },

  // POST /api/v1/admin/customers  { email, display_name?, phone? }
  async createCustomer(req, res, next) {
    try {
      const c = cleanRow(req.body || {});
      if (!EMAIL_RE.test(c.email)) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.emailInvalid'), code: 400 });
      }
      const existing = await Customer.findExistingEmails([c.email]);
      if (existing.has(c.email)) {
        return res.status(409).json({ error: t(req.locale, 'errors.auth.emailRegistered'), code: 409 });
      }
      const { user, resetToken } = await Customer.create(c);

      // Invite = the existing password-reset flow as a "set your password" link.
      let invited = false;
      let resetUrl = null;
      if (emailService.isConfigured()) {
        try {
          await emailService.sendPasswordResetEmail(c.email, resetToken, req.locale);
          invited = true;
        } catch (err) {
          logger.warn({ err }, 'customer invite email failed');
        }
      } else {
        // No mail transport (dev/test) — hand the admin the link to pass on.
        resetUrl = `/#/reset-password?token=${resetToken}`;
      }
      return res.status(201).json({ customer: user, invited, resetUrl });
    } catch (err) {
      if (err && err.code === '23505') {
        return res.status(409).json({ error: t(req.locale, 'errors.auth.emailRegistered'), code: 409 });
      }
      return next(err);
    }
  },

  // POST /api/v1/admin/customers/import/preview  { rows } — read-only classify.
  async previewImport(req, res, next) {
    try {
      const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
      if (!rows) return res.status(400).json({ error: t(req.locale, 'errors.admin.importRowsRequired'), code: 400 });
      if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: t(req.locale, 'errors.admin.importTooManyRows'), code: 400 });

      const prepared = rows.map(cleanRow);
      const existing = await Customer.findExistingEmails(
        prepared.filter(p => EMAIL_RE.test(p.email)).map(p => p.email)
      );
      const seen   = new Set();
      const counts = { new: 0, existing: 0, duplicate: 0, invalid: 0 };
      for (const p of prepared) {
        if (!EMAIL_RE.test(p.email)) { counts.invalid += 1; continue; }
        if (seen.has(p.email))       { counts.duplicate += 1; continue; }
        seen.add(p.email);
        if (existing.has(p.email))   { counts.existing += 1; continue; }
        counts.new += 1;
      }
      return res.json({ counts });
    } catch (err) { next(err); }
  },

  // POST /api/v1/admin/customers/import  { rows } — bulk-create NEW rows only.
  async applyImport(req, res, next) {
    try {
      const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
      if (!rows) return res.status(400).json({ error: t(req.locale, 'errors.admin.importRowsRequired'), code: 400 });
      if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: t(req.locale, 'errors.admin.importTooManyRows'), code: 400 });

      const seen     = new Set();
      const toCreate = [];
      for (const p of rows.map(cleanRow)) {
        if (!EMAIL_RE.test(p.email) || seen.has(p.email)) continue;
        seen.add(p.email);
        toCreate.push(p);
      }
      const created = await Customer.bulkCreate(toCreate); // ON CONFLICT skips existing
      return res.json({ created, total: rows.length });
    } catch (err) { next(err); }
  },

  // POST /api/v1/admin/customers/delete  { userIds: [] }
  // Bulk-delete from the Customers list. Hard-guarded server-side to role='user'
  // (never staff/admin, never a multi-role holder) and the acting admin is
  // skipped. Orders are kept as guest records (FK SET NULL + identity snapshot).
  // Admin-only + CSRF (route middleware). Returns counts; the client reloads.
  async deleteCustomers(req, res, next) {
    try {
      const userIds = Array.isArray(req.body && req.body.userIds)
        ? req.body.userIds.filter(id => typeof id === 'string' && id.trim())
        : [];
      if (userIds.length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.idsRequired'), code: 400 });
      }
      if (userIds.length > MAX_DELETE) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.idsTooMany'), code: 400 });
      }
      const r = await Customer.deleteCustomers({ userIds, excludeId: req.user.id });
      return res.json({ accounts: r.deletedAccounts.length, deletedAccounts: r.deletedAccounts });
    } catch (err) { next(err); }
  },

  // POST /api/v1/admin/customers/send-invites  { recipientIds?: [] }
  // Bulk-send set-password welcome invites to the candidate customers. The
  // optional include-list comes from the confirm panel (each row has a remove ✕).
  // Absent → all candidates; present-but-empty → send to nobody.
  async sendBulkInvites(req, res, next) {
    try {
      const hasList = Array.isArray(req.body && req.body.recipientIds);
      const idList = hasList ? req.body.recipientIds.filter(id => typeof id === 'string') : null;
      let rows;
      if (hasList) {
        rows = idList.length ? (await dbQuery(INVITE_CANDIDATES_BY_IDS_SQL, [idList])).rows : [];
      } else {
        rows = (await dbQuery(INVITE_CANDIDATES_SQL)).rows;
      }
      rows = rows.slice(0, INVITE_MAX_PER_RUN);

      const overrides = await Setting.getInviteEmail(); // saved per-locale copy (the editable "default")
      const configured = emailService.isConfigured();
      const devLinks = [];
      let sent = 0, failed = 0;
      for (const user of rows) {
        const token  = crypto.randomBytes(32).toString('hex');
        const expiry = new Date(Date.now() + INVITE_TTL_MS);
        // Set token + expiry first; stamp invited_at only after a successful send
        // so a Resend error doesn't permanently lock the user out of future retries.
        await dbQuery(
          `UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3`,
          [token, expiry, user.id]
        );
        const locale = inviteLocale(user.preferred_locale || 'en');
        try {
          const emailId = await emailService.sendWelcomeInviteEmail(user.email, token, locale, overrides[locale]);
          await dbQuery(`UPDATE users SET invited_at = NOW() WHERE id = $1`, [user.id]);
          sent++;
          if (!emailId && process.env.NODE_ENV !== 'production') {
            // Dev path — Resend not configured; invited_at is stamped so this run
            // is idempotent, and the link is returned for copy-paste.
            devLinks.push({ email: user.email, link: inviteResetLink(token, locale) });
          }
          // Space out real sends to respect Resend's rate limit.
          if (configured && sent < rows.length) {
            await new Promise(r => setTimeout(r, INVITE_SEND_GAP_MS));
          }
        } catch (emailErr) {
          // Resend threw — leave invited_at NULL so the user can be retried.
          failed++;
          logger.warn({ userId: user.id, err: emailErr }, 'sendWelcomeInviteEmail failed');
        }
      }
      const payload = { sent, failed };
      if (devLinks.length) payload.devLinks = devLinks;
      return res.json(payload);
    } catch (err) { next(err); }
  },

  // GET /api/v1/admin/customers/send-invites/preview
  // Read-only: who would be emailed (name + email + language) + how many + whether
  // email is actually configured (so the UI can warn that a real send may not
  // deliver) + the editable template (saved override or i18n default) and the
  // pure i18n defaults (for the editor's "reset to default").
  async getInvitePreview(req, res, next) {
    try {
      const { rows: candidates } = await dbQuery(INVITE_CANDIDATES_SQL);
      const overrides = await Setting.getInviteEmail();
      const { template, defaults } = effectiveInviteTemplate(overrides);
      return res.json({
        count: candidates.length,
        candidates: candidates.map(c => ({
          id:               c.id,
          email:            c.email,
          display_name:     c.display_name || null,
          preferred_locale: inviteLocale(c.preferred_locale || req.locale),
        })),
        emailConfigured: emailService.isConfigured(),
        template,
        defaults,
      });
    } catch (err) { next(err); }
  },

  // POST /api/v1/admin/customers/send-invites/render { locale, subject, heading, body }
  // Renders the demo email with a SAMPLE token (never a real one). The body is
  // already sanitised by sanitizeBody (subject/heading tag-stripped, body
  // allowlisted) so the preview matches exactly what would be stored + sent.
  renderInvitePreviewHtml(req, res, next) {
    try {
      const b = req.body || {};
      const locale = inviteLocale(b.locale);
      const pick = (v, key) => (typeof v === 'string' && v.trim() !== '') ? v.trim() : t(locale, key);
      const html = emailService.buildInviteEmailHtml({
        subject: pick(b.subject, 'email.invite.subject'),
        heading: pick(b.heading, 'email.invite.heading'),
        body:    pick(b.body,    'email.invite.body'),
        link:    inviteResetLink('SAMPLE-PREVIEW-TOKEN', locale),
        locale,
      });
      return res.json({ html });
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/customers/invite-template { en?, is? }
  // Persist the edited copy as the new default invite template (per locale). Body
  // is already sanitised; Setting validates types/lengths and throws → 400.
  async updateInviteTemplate(req, res, next) {
    try {
      const b = req.body || {};
      const patch = {};
      for (const loc of INVITE_LOCALES) {
        if (loc in b) patch[loc] = b[loc]; // pass through; Setting validates the shape (→ 400 on bad input)
      }
      try {
        await Setting.updateInviteEmail(patch);
      } catch (e) {
        return res.status(400).json({ error: e.message, code: 400 });
      }
      const { template } = effectiveInviteTemplate(await Setting.getInviteEmail());
      return res.json({ template });
    } catch (err) { next(err); }
  },
};

module.exports = adminCustomerController;
