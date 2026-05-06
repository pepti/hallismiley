const fs   = require('fs');
const path = require('path');
const db   = require('../config/database');
const { UPLOAD_ROOT } = require('../config/paths');
const emailService = require('../services/emailService');
const { t }        = require('../i18n');
const { DEFAULT_LOCALE } = require('../config/i18n');

const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10 MB

// Default party info stored in site_content under key 'party_info'
const DEFAULT_PARTY_INFO = {
  date: 'July 25, 2026',
  cover_image: '',
  venue_name: 'Mýrarkot og SPA',
  venue_address: 'Lambhagavegi 23, 113 Reykjavík',
  venue_link: 'https://www.salir.is/index.php/is/skoda/1169',
  venue_maps_link: 'https://www.google.com/maps/search/Mýrarkot+Lambhagavegi+23+Reykjavik',
  venue_rating: '4.3/5 on Google (20 reviews)',
  venue_details: JSON.stringify({
    hall: [
      'Veisluskáli seats 40 at 6 long tables, romantic atmosphere with Bluetooth speaker',
      'Small kitchen inside, two large outdoor grills + fridge',
      'Guests bring own food, drinks, and tableware',
      '15 min drive from downtown Reykjavík, near Bauhaus by Úlfarsfell',
      'Hall rental: 100,000 ISK (including cleaning)',
      'Venue closes at 22:00',
    ],
    spa: [
      'Sauna (barrel-shaped, heated stones)',
      '2 hot tubs (7 tons each)',
      'Cold plunge pool',
      'Outdoor shower',
      'Covered veranda with tables/chairs for 20',
      'New changing rooms with 7 showers',
      'Towels, hairdryers, shampoo, shoes included',
      'Max 20 per group, 4-hour sessions — 100,000 ISK',
      'Sheltered veranda surrounded by trees, great for northern lights viewing',
    ],
  }),
  schedule: JSON.stringify([
    { time: '14:00', event: 'Doors Open & Welcome Drinks' },
    { time: '14:30', event: 'SPA Session (Group 1) / Outdoor Games' },
    { time: '15:30', event: 'SPA Session (Group 2) / Lawn Games' },
    { time: '16:30', event: 'BBQ Grill Starts' },
    { time: '17:30', event: 'Dinner at the Long Tables' },
    { time: '18:30', event: 'Speeches & Toasts' },
    { time: '19:00', event: 'Birthday Cake' },
    { time: '19:30', event: 'Party Games' },
    { time: '20:30', event: 'Music & Dancing' },
    { time: '21:30', event: 'Last Round & Farewells' },
    { time: '22:00', event: 'Venue Closes' },
  ]),
  activities: JSON.stringify({
    daytime: [
      { name: 'TBD', description: 'TBD', rules: 'TBD' },
    ],
    evening: [
      { name: 'TBD', description: 'TBD', rules: 'TBD' },
    ],
  }),
};

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
  const [userRes, adminsRes, formRes, infoRes] = await Promise.all([
    db.query(
      'SELECT id, username, display_name, email FROM users WHERE id = $1',
      [userId]
    ),
    db.query(
      `SELECT email FROM users
        WHERE role = 'admin' AND email_verified = TRUE AND disabled = FALSE`
    ),
    db.query(
      `SELECT value FROM site_content WHERE key = 'party_rsvp_form'
        ORDER BY (locale = $1) DESC LIMIT 1`,
      [DEFAULT_LOCALE]
    ),
    db.query(
      `SELECT DISTINCT ON (key) key, value FROM site_content
        WHERE key LIKE 'party_%' AND key <> 'party_invite_code'
        ORDER BY key, (locale = $1) DESC`,
      [DEFAULT_LOCALE]
    ),
  ]);

  const user = userRes.rows[0];
  if (!user) return;

  let rsvpForm = [];
  const rawForm = formRes.rows[0]?.value;
  if (Array.isArray(rawForm)) rsvpForm = rawForm;
  else if (typeof rawForm === 'string') {
    try { rsvpForm = JSON.parse(rawForm); } catch { /* ignore */ }
  }

  const partyInfo = { ...DEFAULT_PARTY_INFO };
  for (const row of infoRes.rows) {
    const k = row.key.replace(/^party_/, '');
    partyInfo[k] = typeof row.value === 'object' ? JSON.stringify(row.value) : row.value;
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
  // row so the UI can show "✅ Going / ⏳ Waiting / ❌ Can't make it" at a
  // glance. The `attend_when` sentinel that marks a decline is derived from
  // the site's default RSVP form; callers should match against it loosely.
  async listInvitedGuests(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT
           u.id, u.username, u.display_name, u.email, u.avatar, u.role,
           r.answers    AS rsvp_answers,
           r.created_at AS rsvp_created_at,
           r.updated_at AS rsvp_updated_at
         FROM users u
         LEFT JOIN party_rsvps r ON r.user_id = u.id
         WHERE u.party_access = TRUE AND u.disabled = FALSE
         ORDER BY COALESCE(u.display_name, u.username) ASC`
      );

      const shaped = rows.map(r => {
        const answers   = r.rsvp_answers || null;
        const attendAns = answers?.attend_when;
        let status = 'waiting';
        if (answers) {
          status = (typeof attendAns === 'string' && /can'?t|sorry|no/i.test(attendAns))
            ? 'declined'
            : 'rsvpd';
        }
        return {
          id:              r.id,
          username:        r.username,
          display_name:    r.display_name,
          email:           r.email,
          avatar:          r.avatar,
          role:            r.role,
          rsvp_status:     status,
          rsvp_answers:    answers,
          rsvp_created_at: r.rsvp_created_at,
          rsvp_updated_at: r.rsvp_updated_at,
        };
      });
      res.json(shaped);
    } catch (err) { next(err); }
  },

  // ── Logistics (admin/moderator) ──────────────────────────────────────────────
  // Items the planner needs to buy and bring to the venue. Two independent
  // boolean flags so "bought" and "at venue" can be ticked in either order.

  async listLogistics(_req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT id, name, quantity, assigned_to, bought, at_venue,
                sort_order, created_by, created_at, updated_at
           FROM party_logistics_items
          ORDER BY sort_order ASC, id ASC`
      );
      res.json(rows);
    } catch (err) { next(err); }
  },

  async addLogisticsItem(req, res, next) {
    try {
      const { name, quantity = null, assigned_to = null } = req.body || {};
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsNameRequired'), code: 400 });
      }
      if (name.length > 200) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsNameTooLong', { n: 200 }), code: 400 });
      }
      if (quantity != null && (typeof quantity !== 'string' || quantity.length > 100)) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsQtyTooLong', { n: 100 }), code: 400 });
      }
      if (assigned_to != null && (typeof assigned_to !== 'string' || assigned_to.length > 100)) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.logisticsAssignedTooLong', { n: 100 }), code: 400 });
      }

      const { rows } = await db.query(
        `INSERT INTO party_logistics_items (name, quantity, assigned_to, sort_order, created_by)
         VALUES (
           $1, $2, $3,
           COALESCE((SELECT MAX(sort_order) FROM party_logistics_items), 0) + 1,
           $4
         )
         RETURNING id, name, quantity, assigned_to, bought, at_venue,
                   sort_order, created_by, created_at, updated_at`,
        [name.trim(), quantity ? quantity.trim() : null, assigned_to ? assigned_to.trim() : null, req.user.id]
      );
      res.status(201).json(rows[0]);
    } catch (err) { next(err); }
  },

  async updateLogisticsItem(req, res, next) {
    try {
      const id = req.params.id;
      const allowed = ['name', 'quantity', 'assigned_to', 'bought', 'at_venue'];
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
        } else if (key === 'quantity' || key === 'assigned_to') {
          if (v != null && typeof v !== 'string') {
            return res.status(400).json({ error: t(req.locale, 'errors.party.fieldMustBeString', { name: key }), code: 400 });
          }
          if (typeof v === 'string') {
            const max = 100;
            if (v.length > max) {
              const errKey = key === 'quantity' ? 'errors.party.logisticsQtyTooLong' : 'errors.party.logisticsAssignedTooLong';
              return res.status(400).json({ error: t(req.locale, errKey, { n: max }), code: 400 });
            }
            v = v.trim() || null;
          }
        } else if (key === 'bought' || key === 'at_venue') {
          if (typeof v !== 'boolean') {
            return res.status(400).json({ error: t(req.locale, 'errors.party.fieldMustBeString', { name: key }), code: 400 });
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
          RETURNING id, name, quantity, assigned_to, bought, at_venue,
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

      const isEditor = req.user.role === 'admin' || req.user.role === 'moderator';
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

      const isEditor = req.user.role === 'admin' || req.user.role === 'moderator';
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
      // Prefer the request's locale; fall back to DEFAULT_LOCALE per key if missing.
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
      // Backward compat: migrate legacy flat games array → activities object
      if (info.games && !info.activities) {
        const games = typeof info.games === 'string' ? JSON.parse(info.games) : info.games;
        if (Array.isArray(games)) {
          const half = Math.ceil(games.length / 2);
          info.activities = JSON.stringify({ daytime: games.slice(0, half), evening: games.slice(half) });
        }
      }
      delete info.games;
      res.json(info);
    } catch (err) { next(err); }
  },

  // GET /api/v1/party/invite-code — admin/moderator only. Returns the current
  // shared invite code so it can be displayed + rotated from Party Admin UI.
  async getInviteCode(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT value FROM site_content WHERE key = 'party_invite_code' LIMIT 1`
      );
      const raw = rows[0]?.value;
      const code = typeof raw === 'string' ? raw : (raw == null ? '' : String(raw));
      res.json({ code });
    } catch (err) { next(err); }
  },

  // POST /api/v1/party/redeem-invite-code  { code }
  // Any authenticated user. If the code matches site_content.party_invite_code
  // (case-insensitive, trimmed), flip the user's party_access flag and return
  // the updated user shape. Rate-limited upstream to deter brute force.
  async redeemInviteCode(req, res, next) {
    try {
      const { code } = req.body || {};
      if (typeof code !== 'string' || !code.trim()) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.codeRequired'), code: 400 });
      }

      const { rows } = await db.query(
        `SELECT value FROM site_content WHERE key = 'party_invite_code' LIMIT 1`
      );
      const raw = rows[0]?.value;
      const expected = typeof raw === 'string' ? raw : '';
      if (!expected) {
        return res.status(503).json({ error: t(req.locale, 'errors.party.inviteCodeNotConfigured'), code: 503 });
      }

      if (code.trim().toLowerCase() !== expected.trim().toLowerCase()) {
        return res.status(403).json({ error: t(req.locale, 'errors.party.codeMismatch'), code: 403 });
      }

      const { rows: uRows } = await db.query(
        `UPDATE users SET party_access = TRUE WHERE id = $1
         RETURNING id, username, email, role, avatar, display_name, phone, email_verified, party_access`,
        [req.user.id]
      );
      res.json({ user: uRows[0] });
    } catch (err) { next(err); }
  },

  async updateInfo(req, res, next) {
    try {
      const allowed = ['venue_name', 'venue_address', 'venue_link', 'venue_maps_link', 'venue_rating', 'venue_details', 'schedule', 'activities', 'food_options', 'rsvp_questions', 'rsvp_form', 'invite_code', 'cover_image'];
      const updates = req.body;

      if (typeof updates !== 'object' || Array.isArray(updates) || updates === null) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.bodyPlainObject'), code: 400 });
      }

      // Write to the request's locale — admins switching languages edit per-locale content.
      const locale = req.locale || DEFAULT_LOCALE;

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
        await db.query(
          `INSERT INTO site_content (key, locale, value, updated_by) VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (key, locale) DO UPDATE SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [`party_${key}`, locale, JSON.stringify(jsonb), req.user.id]
        );
      }

      // Return the merged result (for the request's locale, falling back to default)
      const { rows } = await db.query(
        `SELECT DISTINCT ON (key) key, value FROM site_content
          WHERE key LIKE 'party_%' AND (locale = $1 OR locale = $2)
          ORDER BY key, (locale = $1) DESC`,
        [locale, DEFAULT_LOCALE]
      );
      const info = { ...DEFAULT_PARTY_INFO };
      for (const row of rows) {
        const k = row.key.replace(/^party_/, '');
        info[k] = typeof row.value === 'object' ? JSON.stringify(row.value) : row.value;
      }
      res.json(info);
    } catch (err) { next(err); }
  },
};

module.exports = partyController;
module.exports._checkInviteAccess = _checkInviteAccess;
