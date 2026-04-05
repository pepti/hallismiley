const fs   = require('fs');
const path = require('path');
const db   = require('../config/database');
const crypto = require('crypto');

const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10 MB

// Default party info stored in site_content under key 'party_info'
const DEFAULT_PARTY_INFO = {
  date: 'July 25, 2026',
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
  games: JSON.stringify([
    {
      name: '40 Things About Halli',
      description: 'Trivia quiz about the birthday person.',
      rules: 'Answer questions about Halli — most correct answers wins!',
    },
    {
      name: 'Decades Dance-Off',
      description: "Dance to hits from each decade Halli has lived through.",
      rules: "80s, 90s, 00s, 10s, 20s — best dancer in each round wins a point.",
    },
    {
      name: 'Photo Scavenger Hunt',
      description: 'Complete a list of fun photo challenges.',
      rules: 'Most photos completed on the list by midnight wins.',
    },
    {
      name: 'Musical Chairs: Adult Edition',
      description: 'Classic musical chairs, but with a grown-up twist.',
      rules: 'Last one standing takes the prize.',
    },
    {
      name: 'Best Birthday Wish',
      description: 'Most creative toast wins a prize.',
      rules: 'Guests vote for their favourite toast — winner gets a special prize.',
    },
  ]),
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function _diskPath(filePath) {
  return path.join(__dirname, '../../public', filePath);
}

function _tryUnlink(filePath) {
  if (!filePath || !filePath.startsWith('/assets/party/')) return;
  try { fs.unlinkSync(_diskPath(filePath)); } catch { /* ignore */ }
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

  async addInvites(req, res, next) {
    try {
      const { emails } = req.body;
      if (!Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: 'emails must be a non-empty array', code: 400 });
      }

      const results = [];
      for (const rawEmail of emails) {
        if (typeof rawEmail !== 'string') continue;
        const email = rawEmail.trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;

        const token = crypto.randomBytes(24).toString('hex');
        const { rows } = await db.query(
          `INSERT INTO party_invites (email, invite_token, invited_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE
             SET invited_by = EXCLUDED.invited_by,
                 updated_at = NOW()
           RETURNING id, email, invite_token, status, created_at`,
          [email, token, req.user.id]
        );
        results.push(rows[0]);
      }

      res.status(201).json(results);
    } catch (err) { next(err); }
  },

  async listInvites(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT pi.id, pi.email, pi.invite_token, pi.status, pi.created_at, pi.updated_at,
                u.username AS invited_by_username
         FROM party_invites pi
         LEFT JOIN users u ON u.id = pi.invited_by
         ORDER BY pi.created_at DESC`
      );
      res.json(rows);
    } catch (err) { next(err); }
  },

  async deleteInvite(req, res, next) {
    try {
      const { rows } = await db.query(
        'DELETE FROM party_invites WHERE id = $1 RETURNING id',
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Invite not found', code: 404 });
      res.status(204).send();
    } catch (err) { next(err); }
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
      const { attending, dietary_needs, plus_one, plus_one_name, plus_one_dietary, message } = req.body;

      if (typeof attending !== 'boolean') {
        return res.status(400).json({ error: 'attending must be a boolean', code: 400 });
      }

      const { rows } = await db.query(
        `INSERT INTO party_rsvps
           (user_id, attending, dietary_needs, plus_one, plus_one_name, plus_one_dietary, message)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE SET
           attending        = EXCLUDED.attending,
           dietary_needs    = EXCLUDED.dietary_needs,
           plus_one         = EXCLUDED.plus_one,
           plus_one_name    = EXCLUDED.plus_one_name,
           plus_one_dietary = EXCLUDED.plus_one_dietary,
           message          = EXCLUDED.message,
           updated_at       = NOW()
         RETURNING *`,
        [
          req.user.id,
          attending,
          dietary_needs   || null,
          plus_one        ?? false,
          plus_one_name   || null,
          plus_one_dietary || null,
          message         || null,
        ]
      );

      // Update invite status
      await db.query(
        `UPDATE party_invites SET status = $1, updated_at = NOW() WHERE email = $2`,
        [attending ? 'accepted' : 'declined', req.user.email.toLowerCase()]
      );

      res.json(rows[0]);
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

  // ── Guestbook ─────────────────────────────────────────────────────────────────

  async postGuestbook(req, res, next) {
    try {
      const { message } = req.body;
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'message is required', code: 400 });
      }
      if (message.length > 1000) {
        return res.status(400).json({ error: 'message must not exceed 1000 characters', code: 400 });
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
      if (!rows[0]) return res.status(404).json({ error: 'Entry not found', code: 404 });

      if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden', code: 403 });
      }

      await db.query('DELETE FROM party_guestbook WHERE id = $1', [req.params.id]);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // ── Photos ────────────────────────────────────────────────────────────────────

  async uploadPhoto(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded', code: 400 });
      }

      if (req.file.size > MAX_PHOTO_SIZE) {
        _tryUnlink(`/assets/party/${req.file.filename}`);
        return res.status(400).json({ error: 'Photo must not exceed 10 MB', code: 400 });
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
      if (!rows[0]) return res.status(404).json({ error: 'Photo not found', code: 404 });

      if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden', code: 403 });
      }

      await db.query('DELETE FROM party_photos WHERE id = $1', [req.params.id]);
      _tryUnlink(rows[0].file_path);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // ── Party info (site_content) ─────────────────────────────────────────────────

  async getInfo(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT key, value FROM site_content WHERE key LIKE 'party_%'`
      );
      const info = { ...DEFAULT_PARTY_INFO };
      for (const row of rows) {
        info[row.key.replace(/^party_/, '')] = row.value;
      }
      res.json(info);
    } catch (err) { next(err); }
  },

  async updateInfo(req, res, next) {
    try {
      const allowed = ['venue_name', 'venue_address', 'venue_link', 'venue_maps_link', 'venue_rating', 'venue_details', 'schedule', 'games'];
      const updates = req.body;

      if (typeof updates !== 'object' || Array.isArray(updates) || updates === null) {
        return res.status(400).json({ error: 'Body must be a plain object', code: 400 });
      }

      for (const [key, value] of Object.entries(updates)) {
        if (!allowed.includes(key)) {
          return res.status(400).json({ error: `Invalid field: ${key}`, code: 400 });
        }
        if (typeof value !== 'string') {
          return res.status(400).json({ error: `${key} must be a string`, code: 400 });
        }
        await db.query(
          `INSERT INTO site_content (key, value, updated_by) VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [`party_${key}`, value, req.user.id]
        );
      }

      // Return the merged result
      const { rows } = await db.query(
        `SELECT key, value FROM site_content WHERE key LIKE 'party_%'`
      );
      const info = { ...DEFAULT_PARTY_INFO };
      for (const row of rows) {
        info[row.key.replace(/^party_/, '')] = row.value;
      }
      res.json(info);
    } catch (err) { next(err); }
  },
};

module.exports = partyController;
module.exports._checkInviteAccess = _checkInviteAccess;
