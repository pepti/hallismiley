// Admin Customers API — list shop customers (users + order aggregates), add a
// single passwordless customer (with an optional "set your password" invite),
// and bulk-import customers from CSV. Role/approval are server-set, never taken
// from the request body.
const { t }        = require('../i18n');
const logger       = require('../logger');
const emailService = require('../services/emailService');
const Customer     = require('../models/Customer');

const MAX_IMPORT_ROWS = 1000;
// Bulk delete is bounded so one request can't fan out across the whole base.
const MAX_DELETE = 100;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
};

module.exports = adminCustomerController;
