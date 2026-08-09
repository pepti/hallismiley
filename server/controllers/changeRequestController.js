// Controller for the in-app change-request (feedback) tool (non-prod only).
// Submit is public (test-env gated at the route) so logged-out testers can file
// requests; the admin list/status routes are admin-gated.
// (The upstream store also emailed a digest per batch + a reminder; deferred
// here — the admin inbox is the source of truth. See the feature-port notes.)
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ChangeRequest = require('../models/ChangeRequest');
const { changeRequestUploadDir } = require('../config/paths');

const MAX_ITEMS            = 100;
const MAX_NOTE_LEN         = 4000;
const MAX_URL_LEN          = 2000;
const MAX_LABEL_LEN        = 300;
const MAX_SELECTOR_LEN     = 2000;
const SCREENSHOT_MAX_BYTES = 4 * 1024 * 1024; // 4 MB decoded
const EMAIL_RE             = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(s, max) {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= max;
}
function isOptionalString(s, max) {
  return s == null || (typeof s === 'string' && s.length <= max);
}

// Decode an inline base64 screenshot to a file and return its public path.
// Returns null (drop the image, keep the note) on anything unexpected — never
// trusts a client-supplied filename or content type beyond the data-URL prefix.
function persistScreenshot(dataUrl) {
  try {
    if (typeof dataUrl !== 'string') return null;
    const m = dataUrl.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return null;
    const ext = m[1] === 'jpeg' ? 'jpg' : 'png';
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length === 0 || buf.length > SCREENSHOT_MAX_BYTES) return null;
    const dir = changeRequestUploadDir();
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dir, name), buf);
    return `/assets/change-requests/${name}`;
  } catch {
    return null;
  }
}

const changeRequestController = {
  // POST /api/v1/change-requests  (test-env gated, softAuth, CSRF, rate-limited)
  async createBatch(req, res, next) {
    try {
      const body = req.body || {};
      const rawItems = Array.isArray(body.items) ? body.items : null;
      if (!rawItems || rawItems.length === 0) {
        return res.status(400).json({ error: 'At least one change request is required', code: 400 });
      }
      if (rawItems.length > MAX_ITEMS) {
        return res.status(400).json({ error: `Too many items (max ${MAX_ITEMS})`, code: 400 });
      }

      const items = [];
      for (const raw of rawItems) {
        if (!raw || typeof raw !== 'object') {
          return res.status(400).json({ error: 'Invalid change request item', code: 400 });
        }
        if (!isNonEmptyString(raw.note, MAX_NOTE_LEN)) {
          return res.status(400).json({ error: 'Each change request needs a note', code: 400 });
        }
        if (!isNonEmptyString(raw.page_url, MAX_URL_LEN)) {
          return res.status(400).json({ error: 'Each change request needs a page', code: 400 });
        }
        if (!isOptionalString(raw.page_label, MAX_LABEL_LEN) ||
            !isOptionalString(raw.element_selector, MAX_SELECTOR_LEN) ||
            !isOptionalString(raw.element_label, MAX_LABEL_LEN)) {
          return res.status(400).json({ error: 'Change request field too long', code: 400 });
        }
        items.push({
          pageUrl:         raw.page_url,
          pageLabel:       raw.page_label ?? null,
          elementSelector: raw.element_selector ?? null,
          elementLabel:    raw.element_label ?? null,
          note:            raw.note,
          screenshotPath:  raw.screenshot ? persistScreenshot(raw.screenshot) : null,
        });
      }

      // softAuth populated req.user when a session cookie was present.
      const submitterUserId = req.user?.id ?? null;
      const bodyEmail = typeof body.email === 'string' && EMAIL_RE.test(body.email) ? body.email : null;
      const submitterEmail = req.user?.email ?? bodyEmail;

      const { batch, items: savedItems } = await ChangeRequest.createBatchWithItems({
        submitterUserId,
        submitterEmail,
        userAgent: (req.headers['user-agent'] || '').slice(0, 500) || null,
        items,
      });

      return res.status(201).json({ ok: true, batchId: batch.id, count: savedItems.length });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/admin/change-requests  (admin only)
  async listBatches(req, res, next) {
    try {
      const { status = null, limit = 50, offset = 0 } = req.query;
      const safeStatus = status === 'open' || status === 'resolved' ? status : null;
      const batches = await ChangeRequest.listBatches({ status: safeStatus, limit, offset });
      return res.json({ batches });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/admin/change-requests/items/:itemId/status  (admin only)
  async updateItemStatus(req, res, next) {
    try {
      const { status } = req.body || {};
      if (status !== 'open' && status !== 'resolved') {
        return res.status(400).json({ error: 'status must be "open" or "resolved"', code: 400 });
      }
      const item = await ChangeRequest.setItemStatus(req.params.itemId, status);
      if (!item) return res.status(404).json({ error: 'Not found', code: 404 });
      return res.json({ item });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = changeRequestController;
