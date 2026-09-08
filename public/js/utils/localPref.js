// Small, always-safe localStorage wrapper for per-viewer UI preferences —
// a remembered page size, a collapsed panel, a chosen tab.
//
// Every read and write is guarded because localStorage is not merely "sometimes
// empty": in a private window, with site data blocked, or over quota, the
// ACCESSOR ITSELF THROWS. An unguarded read is enough to take a whole admin view
// down. The existing call sites (adminNavLayout.js, toastLog.js, themePrefs.js)
// each wrote their own try/catch; this is that pattern, once.
//
// Scope: conveniences only. Anything that must survive a different browser, be
// shared between people, or be read back by the server belongs in the database.

const PREFIX = 'halli.';

/** Read a JSON-encoded preference. Returns `fallback` on absence or any failure. */
export function readPref(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    // Unavailable, blocked, or corrupt — an unreadable preference is not an error.
    return fallback;
  }
}

/** Write a JSON-encodable preference. Returns true when it actually stored. */
export function writePref(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Forget a preference. Never throws. */
export function removePref(key) {
  try {
    window.localStorage.removeItem(PREFIX + key);
    return true;
  } catch {
    return false;
  }
}
