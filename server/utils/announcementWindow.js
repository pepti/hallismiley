'use strict';

// Is the site announcement live right now? (Admin → Tilkynning,
// views/AdminAnnouncementView.js; the public GET /api/v1/announcement.)
//
// Ported from icelandicstore #200 (server/utils/announcementWindow.js) and
// changed on the way in (harvest2-lane7a-2026-09-26):
//   • the bounds are DATE-TIMES, not dates: 'YYYY-MM-DDTHH:mm' as an
//     <input type="datetime-local"> hands it over (a bare 'YYYY-MM-DD' reads
//     as 00:00 that day), read as wall-clock time in Atlantic/Reykjavik;
//   • the window is HALF-OPEN, [start, end): live from the start minute, gone
//     at the end minute — "until 17:00 on the 14th" means it is off at 17:00;
//   • a stored bound that does not parse FAILS CLOSED (not live). ice widened
//     it to "no bound"; here the announcement's copy is withheld from the
//     public endpoint whenever the window cannot be decided, which is the
//     safer side for unpublished wording.
// A blank bound is open-ended on that side, as in ice: an admin can start a
// notice now with no end and switch it off by hand.
//
// Pure, no database: the rule is unit-tested on its edges
// (tests/unit/announcementWindow.test.js). The zone conversion asks Intl what
// the wall clock reads there (the utils/maintenanceWindow.js method), so it
// stays correct if an instance ever runs in a zone with DST — Reykjavík itself
// is UTC+0 all year.

const TZ = 'Atlantic/Reykjavik';
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/** Wall-clock offset (ms) of `tz` from UTC at the instant `ms`. */
function offsetAt(ms, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - (ms - (ms % 1000));
}

/**
 * 'YYYY-MM-DDTHH:mm' (or 'YYYY-MM-DD') as wall-clock time in `tz` → epoch ms.
 * Null for anything else, including impossible calendar dates (2026-02-31)
 * and times (24:00, 12:60) — the model validates on write with this.
 */
function parseLocalDateTime(value, tz = TZ) {
  if (typeof value !== 'string') return null;
  const m = LOCAL_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [h, mi] = [m[4] === undefined ? 0 : Number(m[4]), m[5] === undefined ? 0 : Number(m[5])];
  if (h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(naive);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  // Two passes: the offset at the naive instant, then at the corrected one
  // (they differ only across a DST switch).
  const first = naive - offsetAt(naive, tz);
  return naive - offsetAt(first, tz);
}

/**
 * { enabled, starts_at, ends_at } → boolean. `now` (Date or ms) is injectable.
 * Live iff enabled AND start <= now < end, each bound optional when blank.
 */
function isAnnouncementActive(settings, now = new Date(), tz = TZ) {
  if (!settings || settings.enabled !== true) return false;
  const at = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(at)) return false;
  const bound = (v) => {
    if (v == null || v === '') return { open: true };
    const ms = parseLocalDateTime(v, tz);
    return ms === null ? { bad: true } : { ms };
  };
  const start = bound(settings.starts_at);
  const end = bound(settings.ends_at);
  if (start.bad || end.bad) return false;
  if (!start.open && at < start.ms) return false;
  if (!end.open && at >= end.ms) return false;
  return true;
}

/**
 * What the PUBLIC endpoint may say (GET /api/v1/announcement): the copy while
 * the announcement is live and has a title in some language, and nothing but
 * `{ active: false }` otherwise — no dates, no draft wording. `id` changes
 * whenever the window or the wording does, so a visitor who dismissed one
 * announcement is shown the next (CutoverNotice keys its storage on it).
 */
function publicAnnouncement(settings, now = new Date(), tz = TZ) {
  if (!isAnnouncementActive(settings, now, tz)) return { active: false };
  const title = settings.title || {};
  if (!['en', 'is'].some(l => typeof title[l] === 'string' && title[l].trim())) return { active: false };
  const pick = (o) => ({ en: (o && o.en) || '', is: (o && o.is) || '' });
  const out = {
    title: pick(settings.title),
    message: pick(settings.message),
    link: settings.link_path ? { path: settings.link_path, label: pick(settings.link_label) } : null,
  };
  const id = require('crypto').createHash('sha256')
    .update(JSON.stringify([settings.starts_at || '', settings.ends_at || '', out]))
    .digest('hex').slice(0, 16);
  return { active: true, id, ...out };
}

module.exports = { isAnnouncementActive, publicAnnouncement, parseLocalDateTime, TZ };
