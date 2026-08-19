'use strict';

// Maintenance-window arithmetic for auto-mode updates: "3–5 on Tue/Wed/Thu,
// Reykjavík time" → a concrete UTC instant.
//
// Everything here works by asking Intl what the wall clock reads in the target
// zone for a given UTC instant, then stepping forward. That is why it is
// correct across DST without a tz database of its own and without a dependency:
// Intl already ships the rules, and "03:00 local" is exactly what the operator
// meant, whatever the offset happens to be that week.
//
// A window whose fromHour is greater than toHour WRAPS midnight (23→02 is a
// three-hour window starting on the named day). The window is half-open,
// [fromHour, toHour): a 3–5 window includes 03:00 and 04:59, not 05:00.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const HOUR_MS  = 3600_000;

/** Wall-clock parts in `tz` for a UTC instant. */
function partsIn(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    // 'Tue' → 'tue'. hour '24' happens in hour12:false formats at midnight.
    day:  String(parts.weekday || '').toLowerCase(),
    hour: Number(parts.hour) % 24,
  };
}

/** Is this instant inside the window? */
function isWithinWindow(date, window) {
  const { days, fromHour, toHour, tz } = window;
  if (!Array.isArray(days) || !days.length) return false;
  if (fromHour === toHour) return false;              // zero-length, never open
  const { day, hour } = partsIn(date, tz);
  const wraps = fromHour > toHour;
  const inHours = wraps ? (hour >= fromHour || hour < toHour) : (hour >= fromHour && hour < toHour);
  if (!inHours) return false;
  // For a wrapping window the DAY is the day the window OPENED, so the small
  // hours after midnight belong to the previous day's window.
  if (wraps && hour < toHour) {
    const prev = partsIn(new Date(date.getTime() - 24 * HOUR_MS), tz);
    return days.includes(prev.day);
  }
  return days.includes(day);
}

/**
 * Next instant at which the window is open, searching forward hour by hour.
 * Returns `now` itself when the window is already open.
 *
 * Hour-granular by design: the window is expressed in whole hours, so landing
 * on the top of the hour is the honest answer. Capped at 8 days of search — a
 * window that no day matches (bad config) returns null rather than spinning.
 *
 * @returns {Date|null}
 */
function nextWindowStart(now, window) {
  const { days, fromHour, toHour } = window;
  if (!Array.isArray(days) || !days.length) return null;
  if (fromHour === toHour) return null;
  if (!days.every(d => DAY_KEYS.includes(d))) return null;
  if (isWithinWindow(now, window)) return new Date(now.getTime());

  // Start at the top of the next hour, then walk. 8 days covers any weekly
  // pattern plus a DST-shifted edge.
  const start = new Date(now.getTime());
  start.setUTCMinutes(0, 0, 0);
  for (let i = 1; i <= 8 * 24 + 1; i++) {
    const candidate = new Date(start.getTime() + i * HOUR_MS);
    if (isWithinWindow(candidate, window)) return candidate;
  }
  return null;
}

module.exports = { isWithinWindow, nextWindowStart, DAY_KEYS };
