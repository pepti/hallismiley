// Client-side error reporting — the browser half of the server event log
// (Admin → Monitoring). Three things feed it:
//   • error TOASTS (via services/toastLog.js) — failures the app chose to show.
//   • UNCAUGHT exceptions and unhandled promise rejections — failures nobody
//     showed, which are precisely the ones that would otherwise go unseen.
//
// Everything here is silent by construction: no toast, no retry, no throw. It
// runs on paths that are already failing, and a reporter that could raise its
// own error toast would feed itself.

import { getCSRFToken } from './auth.js';

const BEACON_URL = '/api/v1/events/collect';

// A broken page can throw the same error hundreds of times (a render loop, a
// bad interval). Two limits stop one visitor flooding the table: an identical
// message is sent at most once per DEDUP_MS, and a page load sends at most
// MAX_PER_PAGE in total. Both reset on reload — deliberately, since a reload is
// the user telling us the problem is worth looking at again.
//
// `recent` needs no size bound of its own: an entry is only added on the same
// path that increments sentThisPage, so it can never hold more than
// MAX_PER_PAGE messages.
const DEDUP_MS = 60_000;
const MAX_PER_PAGE = 25;

const recent = new Map();   // message → last-sent timestamp
let sentThisPage = 0;

// Exported for tests — a page load is otherwise the only way to reset.
export function _resetReporter() {
  recent.clear();
  sentThisPage = 0;
}

function shouldSend(message, now = Date.now()) {
  if (sentThisPage >= MAX_PER_PAGE) return false;
  const last = recent.get(message);
  if (last != null && now - last < DEDUP_MS) return false;
  recent.set(message, now);
  sentThisPage++;
  return true;
}

function trimStack(stack) {
  if (typeof stack !== 'string' || !stack) return null;
  return stack.split('\n').slice(0, 6).join('\n').slice(0, 1200);
}

/**
 * Report one client-side failure. Fire-and-forget by design — callers must
 * never await it, and it never rejects.
 */
export function reportError(message, context = {}) {
  const msg = String(message ?? '').trim();
  if (!msg || !shouldSend(msg)) return;

  (async () => {
    try {
      const token = await getCSRFToken();
      if (!token) return;                 // no token → drop it, never retry
      await fetch(BEACON_URL, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,                  // survives the navigation an error often triggers
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({
          message: msg.slice(0, 1000),
          level: 'error',
          path: window.location.pathname,
          locale: document.documentElement.lang || null,
          context,
        }),
      });
    } catch {
      /* offline, blocked, rate-limited — nothing useful left to do */
    }
  })();
}

let installed = false;

/** Capture failures the app never surfaced. Idempotent. */
export function installGlobalErrorReporting() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e) => {
    // Two things arrive here that aren't actionable JS exceptions:
    //   • resource load failures (a 404 image/script) — no `message` at all.
    //   • cross-origin script errors — a bare "Script error." with no file,
    //     line or stack. A row saying only that helps nobody.
    const msg = e.message || '';
    if (!msg || msg === 'Script error.') return;
    reportError(msg, {
      kind:  'uncaught',
      where: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null,
      stack: trimStack(e.error && e.error.stack),
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const msg = (reason && (reason.message || String(reason))) || 'Unhandled promise rejection';
    reportError(msg, {
      kind:  'unhandledrejection',
      stack: trimStack(reason && reason.stack),
    });
  });
}
