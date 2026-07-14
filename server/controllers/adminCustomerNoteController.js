// Staff "customer notes" — CRUD over a categorized, staff-authored note LOG
// about a shop customer (order preferences, how they order, special needs,
// general). Per-note visibility: 'admin' = admins only, 'staff' = anyone holding
// the grantable 'customers' view (the route gate). Enforced here AND in the
// model; customers themselves never reach this router.
const CustomerNote = require('../models/CustomerNote');
const { t } = require('../i18n');

const CATEGORIES   = ['order_prefs', 'ordering', 'special_needs', 'general'];
const VISIBILITIES = ['admin', 'staff'];
const MAX_BODY = 5000;

const rolesOf = (req) => (Array.isArray(req.user.roles) ? req.user.roles : [req.user.role]);
const isAdminViewer = (req) => rolesOf(req).includes('admin');

const adminCustomerNoteController = {
  // GET /?customerId=  → { notes } (filtered to the viewer's visibility scope)
  async list(req, res, next) {
    try {
      const owner = req.query.customerId
        ? await CustomerNote.ownerForCustomer(req.query.customerId)
        : null;
      if (!owner) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.noteOwnerRequired'), code: 400 });
      }
      const notes = await CustomerNote.listForOwner(owner, rolesOf(req));
      return res.json({ notes });
    } catch (err) { next(err); }
  },

  // POST /  { customerId, category?, body, visibility? } → 201 { note }
  async create(req, res, next) {
    try {
      const owner = req.body.customerId
        ? await CustomerNote.ownerForCustomer(req.body.customerId)
        : null;
      if (!owner) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.noteOwnerRequired'), code: 400 });
      }
      const body = (typeof req.body.body === 'string') ? req.body.body.trim() : '';
      if (!body) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.noteBodyRequired'), code: 400 });
      }
      const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'general';
      // Visibility is constrained to what the author may grant: a non-admin can
      // only create 'staff' notes; an admin defaults to 'admin' but may pick
      // 'staff'. (The client never offers a visibility a non-admin can't use,
      // but this is the server-side guarantee.)
      let visibility;
      if (!isAdminViewer(req)) {
        visibility = 'staff';
      } else {
        visibility = VISIBILITIES.includes(req.body.visibility) ? req.body.visibility : 'admin';
      }
      const note = await CustomerNote.create({
        userId:     owner.userId,
        category,
        body:       body.slice(0, MAX_BODY),
        visibility,
        authorId:   req.user.id,
        authorName: req.user.display_name || req.user.email || null,
      });
      return res.status(201).json({ note });
    } catch (err) { next(err); }
  },

  // PATCH /:id  { category?, body?, visibility? } → { note }
  async update(req, res, next) {
    try {
      const roles = rolesOf(req);
      // Pre-check: a note the viewer can't see returns 404 (not 403) so we don't
      // leak that an admin-only note exists.
      const existing = await CustomerNote.findById(req.params.id);
      if (!existing || !CustomerNote.visibilitiesForRoles(roles).includes(existing.visibility)) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.noteNotFound'), code: 404 });
      }

      const fields = {};
      if (req.body.category !== undefined) {
        if (!CATEGORIES.includes(req.body.category)) {
          return res.status(400).json({ error: t(req.locale, 'errors.admin.noteCategoryInvalid'), code: 400 });
        }
        fields.category = req.body.category;
      }
      if (req.body.body !== undefined) {
        const b = (typeof req.body.body === 'string') ? req.body.body.trim() : '';
        if (!b) {
          return res.status(400).json({ error: t(req.locale, 'errors.admin.noteBodyRequired'), code: 400 });
        }
        fields.body = b.slice(0, MAX_BODY);
      }
      if (req.body.visibility !== undefined) {
        if (!VISIBILITIES.includes(req.body.visibility)) {
          return res.status(400).json({ error: t(req.locale, 'errors.admin.noteVisibilityForbidden'), code: 400 });
        }
        // A non-admin can't promote a note to admin-only.
        if (!isAdminViewer(req) && req.body.visibility === 'admin') {
          return res.status(403).json({ error: t(req.locale, 'errors.admin.noteVisibilityForbidden'), code: 403 });
        }
        fields.visibility = req.body.visibility;
      }

      const note = await CustomerNote.update(req.params.id, fields, roles);
      if (!note) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.noteNotFound'), code: 404 });
      }
      return res.json({ note });
    } catch (err) { next(err); }
  },

  // DELETE /:id → { ok:true }
  async remove(req, res, next) {
    try {
      const roles = rolesOf(req);
      const existing = await CustomerNote.findById(req.params.id);
      if (!existing || !CustomerNote.visibilitiesForRoles(roles).includes(existing.visibility)) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.noteNotFound'), code: 404 });
      }
      const removed = await CustomerNote.remove(req.params.id, roles);
      if (!removed) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.noteNotFound'), code: 404 });
      }
      return res.json({ ok: true });
    } catch (err) { next(err); }
  },
};

module.exports = adminCustomerNoteController;
