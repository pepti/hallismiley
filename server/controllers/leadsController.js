// Leads inbox — /api/v1/admin/leads (migration 097).
//
// Access model (server/routes/leadsRoutes.js):
//   READ + workflow writes (status / note / owner) → requireView('leads') —
//     the `solufolk` role works its own queue; the submission fields are
//     immutable, so the grant exposes nothing beyond what reading exposes.
//   DELETE (PII erasure) + CSV export (bulk PII) → hard admin.
// Every response is Cache-Control: no-store — personal data never lands in a
// shared cache. Field values never reach the log (ids only).

const Lead = require('../models/Lead');
const db   = require('../config/database');
const { t } = require('../i18n');
const { toCsv, csvHeaders } = require('../utils/csv');
const { RETENTION_DAYS } = require('../services/leadsCleanup');

function _noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}

function _id(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function _listParams(req) {
  const status = Lead.STATUSES.includes(req.query.status) ? req.query.status : null;
  const q = (req.query.q && String(req.query.q).trim().slice(0, 100)) || null;
  const ownerId = req.query.owner === 'me' ? req.user.id : null;
  const limit  = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const page   = Math.max(Number(req.query.page) || 1, 1);
  return { status, q, ownerId, limit, offset: (page - 1) * limit, page };
}

const leadsController = {

  // GET /api/v1/admin/leads?status=&q=&owner=me&page=&limit=
  async list(req, res, next) {
    _noStore(res);
    try {
      const p = _listParams(req);
      const [leads, total, counts] = await Promise.all([
        Lead.list(p), Lead.count(p), Lead.countsByStatus(),
      ]);
      return res.json({
        leads, total, counts, page: p.page, limit: p.limit,
        statuses: Lead.STATUSES, retentionDays: RETENTION_DAYS,
      });
    } catch (err) { next(err); }
  },

  // GET /api/v1/admin/leads/:id
  async getOne(req, res, next) {
    _noStore(res);
    try {
      const id = _id(req);
      if (!id) return res.status(400).json({ error: t(req.locale, 'errors.leads.invalidId'), code: 400 });
      const lead = await Lead.findById(id);
      if (!lead) return res.status(404).json({ error: t(req.locale, 'errors.leads.notFound'), code: 404 });
      return res.json({ lead });
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/leads/:id — status / note / owner (validateLeadUpdate
  // has already whitelisted the body).
  async update(req, res, next) {
    _noStore(res);
    try {
      const id = _id(req);
      if (!id) return res.status(400).json({ error: t(req.locale, 'errors.leads.invalidId'), code: 400 });
      const { status, note, owner_user_id: ownerUserId } = req.body;
      if (ownerUserId) {
        const { rows } = await db.query(`SELECT id FROM users WHERE id = $1`, [String(ownerUserId)]);
        if (!rows[0]) return res.status(400).json({ error: t(req.locale, 'errors.leads.ownerNotFound'), code: 400 });
      }
      const lead = await Lead.update(id, { status, note, owner_user_id: ownerUserId }, req.user.id);
      if (!lead) return res.status(404).json({ error: t(req.locale, 'errors.leads.notFound'), code: 404 });
      return res.json({ lead });
    } catch (err) { next(err); }
  },

  // DELETE /api/v1/admin/leads/:id — admin only; this IS the erasure path.
  async remove(req, res, next) {
    _noStore(res);
    try {
      const id = _id(req);
      if (!id) return res.status(400).json({ error: t(req.locale, 'errors.leads.invalidId'), code: 400 });
      const gone = await Lead.remove(id);
      if (!gone) return res.status(404).json({ error: t(req.locale, 'errors.leads.notFound'), code: 404 });
      return res.status(204).end();
    } catch (err) { next(err); }
  },

  // GET /api/v1/admin/leads/export.csv — admin only; the current filter,
  // uncapped. csvCell (inside toCsv) neutralises formula triggers in the
  // visitor-supplied text, so a message starting with "=" cannot execute in
  // a spreadsheet.
  async exportCsv(req, res, next) {
    _noStore(res);
    try {
      const p = _listParams(req);
      // Page to the end rather than silently truncating: this export backs
      // retention and erasure work, where a partial file with no signal is
      // worse than a slow one. Mirrors exportInvoicesCsv.
      const PAGE = 200;
      const leads = [];
      for (let offset = 0; ; offset += PAGE) {
        const batch = await Lead.list({ ...p, limit: PAGE, offset });
        leads.push(...batch);
        if (batch.length < PAGE) break;
      }
      const header = [
        'id', 'received', 'status', 'name', 'email', 'phone', 'company',
        'current_platform', 'locale', 'owner', 'contacted_at', 'contacted_by', 'note', 'message',
      ];
      const rows = leads.map(l => [
        l.id, l.created_at, l.status, l.name, l.email, l.phone, l.company,
        l.current_platform, l.locale, l.owner_name, l.contacted_at, l.contacted_by_name, l.note, l.message,
      ]);
      csvHeaders(res, `fyrirspurnir-${new Date().toISOString().slice(0, 10)}.csv`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(toCsv(header, rows));
    } catch (err) { next(err); }
  },
};

module.exports = leadsController;
