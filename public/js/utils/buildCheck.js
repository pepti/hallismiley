// Pure decisions behind services/buildGuard.js — no DOM, no fetch, so they can
// be unit-tested directly (tests/unit/buildCheck.client.test.js).

// A build id we can compare. `dev` is a checkout with no stamp and `unknown` an
// image built without the build-args (server/config/version.js); neither names a
// release, so neither may trigger a reload.
export function isRealBuild(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s !== '' && s !== 'dev' && s !== 'unknown';
}

// The page is stale when both sides name a real release and they differ.
export function isStale(pageBuild, serverBuild) {
  return isRealBuild(pageBuild) && isRealBuild(serverBuild) && pageBuild.trim() !== serverBuild.trim();
}

// Nothing has told us the server's release for a while — so a deploy may have
// happened unseen, and the page must ask before trusting its own code.
// lastSeenAt 0 = never heard (e.g. every response so far carried no real build).
export const QUIET_AFTER_MS = 60_000;

export function isQuiet(lastSeenAt, now, windowMs = QUIET_AFTER_MS) {
  return !Number.isFinite(lastSeenAt) || now - lastSeenAt > windowMs;
}

// When the tab comes back into focus and a newer release is known:
//   'none'   — nothing to do (not stale)
//   'reload' — nobody has typed anything since the last navigation, so reloading
//              loses nothing
//   'banner' — something was typed, or a reload for this build was just tried
//              (reloadBlocked): tell the user instead of throwing their input away
export function decideOnFocus({ stale, edited, reloadBlocked }) {
  if (!stale) return 'none';
  if (edited || reloadBlocked) return 'banner';
  return 'reload';
}

// Loop guard. A reload for build X that happened under `windowMs` ago and still
// left the page stale means reloading again will not help (e.g. old and new
// instances answering in turn during a slot swap) — stop and show the banner.
export const RELOAD_WINDOW_MS = 60_000;

export function reloadBlocked(lastAttempt, serverBuild, now, windowMs = RELOAD_WINDOW_MS) {
  if (!lastAttempt || typeof lastAttempt !== 'object') return false;
  return lastAttempt.build === serverBuild
    && Number.isFinite(lastAttempt.at)
    && now - lastAttempt.at < windowMs;
}
