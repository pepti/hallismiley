// Session notification log — the backing store behind every toast.
//
// Toasts linger 20s and only the latest few stay on screen, so the log is what
// makes a message that scrolled past still readable: clicking any toast opens it
// (components/ToastLog.js) and Admin → Monitoring renders the same list inline.
//
// sessionStorage rather than a module-level array: the SPA does full page loads
// on the OAuth bounce and on F5, and losing the history there is exactly when a
// user wants to re-read what an error said. Every access is guarded — Safari
// private mode and storage-quota failures must not take a toast down with them.

import { getUser } from './auth.js';
import { reportError } from './errorReporter.js';

const KEY = 'toastLog';
const MAX_ENTRIES = 200;

// In-memory mirror, so the log still works (for this page load) when
// sessionStorage is unavailable, and so reads don't re-parse on every render.
let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(entries) {
  cache = entries;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* private mode / quota — the in-memory mirror carries this page load */
  }
}

/**
 * Record a toast. Oldest entries fall off once the cap is reached.
 *
 * The signed-in user is stamped at write time, not read time: one session can
 * span a sign-in, a sign-out and a second sign-in, and the useful question of a
 * line is "who was this shown to", which only the moment of the toast answers.
 * null = nobody was signed in (the sign-in toast itself lands this way).
 */
export function logToast(message, type = 'success') {
  const entries = read();
  entries.push({
    message: String(message ?? ''),
    type:    String(type || 'success'),
    user:    getUser()?.username || null,
    ts:      Date.now(),
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  write(entries);

  // Report ERROR toasts to the server so Admin → Monitoring can show failures
  // across all users, not just this tab. Errors only, by design: success/info
  // toasts are mostly "Saved successfully" and would bury the signal (and log
  // every customer's screen activity for no diagnostic gain).
  if (type === 'error') reportError(message, { kind: 'toast' });
}

/** Every notification from this session, newest first. */
export function getToastLog() {
  return read().slice().reverse();
}

export function clearToastLog() {
  write([]);
}
