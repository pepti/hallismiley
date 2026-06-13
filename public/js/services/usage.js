// First-party, cookieless page-view beacon. Fired on every committed SPA
// navigation (wired from Router._navigate). No cookies, no client IDs, no
// libraries. The server derives an anonymous daily visitor token from IP+UA;
// we send only the locale-stripped path, the referrer, and the viewport width.

const ENDPOINT = '/api/v1/analytics/collect';
const LOCALES  = ['en', 'is'];

// '/en/projects/3' → '/projects/3'  (locale prefix removed; query string is
// never part of window.location.pathname so nothing else to strip).
function appPath() {
  const raw = window.location.pathname || '/';
  const parts = raw.split('/').filter(Boolean);
  if (parts.length && LOCALES.includes(parts[0])) {
    return '/' + parts.slice(1).join('/');
  }
  return raw;
}

function dntEnabled() {
  const v = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
  return v === '1' || v === 'yes';
}

export function trackPageView() {
  // Respect Do-Not-Track. The data is anonymous regardless, but honoring DNT
  // is cheap goodwill and strengthens the no-consent-needed posture.
  if (dntEnabled()) return;

  const body = JSON.stringify({
    path:   appPath() || '/',
    ref:    document.referrer || '',
    locale: window.__locale || 'en',
    screen: window.innerWidth || 0,
  });

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    } else {
      // keepalive lets the request survive a page unload.
      fetch(ENDPOINT, {
        method: 'POST',
        body,
        keepalive: true,
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {});
    }
  } catch {
    /* analytics must never throw into the navigation path */
  }
}
