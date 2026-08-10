// Build identity for the admin chrome — "which release is this instance?".
//
// One request per page load, shared by every caller (the sidebar stamp today,
// the updates view in Phase 4). The endpoint is admin-gated, so a 401/403 is an
// ordinary outcome, not an error: callers get null and render nothing.

let pending = null;

export function getBuildInfo() {
  if (!pending) {
    pending = fetch('/api/v1/system/version', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return pending;
}

/** Test seam + logout hook: drop the cached answer so the next call refetches. */
export function resetBuildInfo() { pending = null; }
