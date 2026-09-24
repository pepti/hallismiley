// Stale-release guard. A tab left open across a deploy keeps running the code it
// loaded — the admin is a single-page app and in-app clicks never reload it — and
// keeps showing whatever it last fetched. On 2026-09-15 that let an order page
// show "not sent to Regla" and open the line editor on an order invoiced in
// Regla the day before (docs/HISTORY.md, 2026-09-15).
//
// How it works:
//   • The shell carries <meta name="app-build"> — the release it was served by
//     (server/middleware/ssrMeta.js). That is this page's baseline.
//   • Every response carries X-App-Build (server/app.js). A fetch wrapper reads
//     it; a real build that differs from the baseline marks the page stale.
//   • Before every in-app navigation (Router._navigate awaits
//     shouldReloadOnNavigate): if nothing has told us the server's release for a
//     minute, ask GET /health first — admin pages do not poll, so a deploy that
//     lands while the user reads a page is otherwise invisible until the NEXT
//     click, and the click in between renders on old code (TEST report
//     2026-09-16, M1). Stale → reload instead of switching views; the URL has
//     already moved, so the reload lands where they were going.
//   • Stale + the tab comes back into focus → same probe, then reload straight
//     away if nothing has been entered since the last navigation; otherwise show
//     UpdateBanner and leave their input alone (the next navigation still reloads).
//
// A reload is only useful because a reload always fetches one release. A
// stamped release loads its code from /js/_<tag>/… (the shell's tags, set by
// server/middleware/ssrMeta.js): those URLs belong to one release only, are
// cached immutable, and answer 404 once another release is serving
// (server/middleware/versionedStatic.js) — so an old tab can never pull a new
// module in beside its old ones. The unstamped /js/… tree is still served
// `no-cache` (server/utils/staticCacheControl.js) for a local checkout.
// Mirrors installSessionGuard()'s fetch-wrapper pattern.
import {
  isRealBuild, isStale, isQuiet, decideOnFocus, reloadBlocked,
} from '../utils/buildCheck.js';
import { reportError } from './errorReporter.js';
import { mountUpdateRegion, showUpdateBanner } from '../components/UpdateBanner.js';

const RELOAD_KEY = 'build_reload_attempt';
// A probe that has not answered by now is not worth holding a navigation for.
const PROBE_TIMEOUT_MS = 2_000;
// A native file chooser closing fires window `focus` BEFORE the input's
// `change`; wait this long before deciding so the choice is counted as work.
const FOCUS_SETTLE_MS = 250;

let _active = false;       // a real baseline exists — otherwise the guard is inert
let _pageBuild = null;     // the release this page booted from
let _serverBuild = null;   // the newest real release seen in a response
let _lastSeenAt = 0;       // when a response last told us the server's build
let _editedSinceNav = false;
let _reportedLoop = false;
let _probe = null;         // the in-flight /health probe, shared by every caller

function sameOrigin(res) {
  try { return !res.url || new URL(res.url).origin === window.location.origin; }
  catch { return false; }
}

function observe(res) {
  if (!res || !res.headers || !sameOrigin(res)) return;
  const build = res.headers.get('X-App-Build');
  if (!isRealBuild(build)) return;
  _lastSeenAt = Date.now();
  _serverBuild = build.trim();
}

// Ask the server which release it is, once, however many callers ask at the same
// moment (a refocus fires visibilitychange AND focus; a click can land during a
// focus probe). The fetch wrapper records the answer; a timeout or failure just
// leaves what we already knew.
function probeServerBuild() {
  if (_probe) return _probe;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS) : null;
  _probe = fetch('/health', { cache: 'no-store', credentials: 'same-origin', signal: ctrl?.signal })
    .catch(() => { /* offline or timed out: decide on what we already know */ })
    .finally(() => { if (timer) clearTimeout(timer); _probe = null; });
  return _probe;
}

async function refreshIfQuiet() {
  if (isQuiet(_lastSeenAt, Date.now())) await probeServerBuild();
}

function readAttempt() {
  try { return JSON.parse(sessionStorage.getItem(RELOAD_KEY) || 'null'); } catch { return null; }
}
function writeAttempt(build) {
  try { sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ build, at: Date.now() })); } catch { /* private mode */ }
}

function pageIsStale() {
  return isStale(_pageBuild, _serverBuild);
}

// Reload onto the new release, unless a reload for this very build was just
// tried and did not take — then say so instead of looping.
function reloadOrBanner() {
  if (reloadBlocked(readAttempt(), _serverBuild, Date.now())) {
    if (!_reportedLoop) {
      _reportedLoop = true;
      // Its own kind, not 'uncaught': this is a deploy that did not take hold in
      // this tab, not a crash, and Monitoring labels it as such.
      reportError(`Stale release persisted after reload (page ${_pageBuild}, server ${_serverBuild})`, { kind: 'stale_release' });
    }
    showUpdateBanner();
    return false;
  }
  writeAttempt(_serverBuild);
  window.location.reload();
  return true;
}

// Awaited at the top of every Router._navigate(). True → the router must stop:
// the page is reloading onto the new release.
export async function shouldReloadOnNavigate() {
  _editedSinceNav = false;
  if (!_active) return false;
  await refreshIfQuiet();
  if (!pageIsStale()) return false;
  return reloadOrBanner();
}

// A file of this page's own release failed to load — a locale file (i18n.js
// raises 'app:asset-load-failed') or a lazily loaded view (router.js). Under
// release-stamped URLs the usual cause is a new release: once it serves, this
// page's /js/_<tag>/… tree answers 404 (server/middleware/versionedStatic.js).
// Ask the server which release it is. Resolves to what happened:
//   'reloading' — stale, and the page is reloading onto the new release;
//   'banner'    — stale, but a reload for it already failed: UpdateBanner shown;
//   'current'   — this page IS the current release, so it was the network:
//                 reported, and the caller decides what to tell the user.
export async function recoverFromAssetFailure(err) {
  if (_active) {
    await probeServerBuild();
    if (pageIsStale()) return reloadOrBanner() ? 'reloading' : 'banner';
  }
  reportError(`Page code failed to load: ${(err && err.message) || err}`, { kind: 'asset_load' });
  return 'current';
}

// A file input is still focused when its chooser closes; whatever it picked
// counts as work even if its `change` has not been dispatched yet.
function fileChoiceInProgress() {
  const el = document.activeElement;
  return Boolean(el && el.matches && el.matches('input[type="file"]'));
}

let _checking = false;

async function onFocus() {
  if (_checking) return;
  _checking = true;
  try {
    await new Promise((r) => setTimeout(r, FOCUS_SETTLE_MS));
    await refreshIfQuiet();
    const decision = decideOnFocus({
      stale: pageIsStale(),
      edited: _editedSinceNav || fileChoiceInProgress(),
      reloadBlocked: reloadBlocked(readAttempt(), _serverBuild, Date.now()),
    });
    if (decision === 'reload') reloadOrBanner();
    else if (decision === 'banner') showUpdateBanner();
  } finally {
    _checking = false;
  }
}

// Anything entered since the last navigation is work a reload would throw away.
// Both events, not just `input`: a file picker and a <select> driven by the
// keyboard emit `change` only. isContentEditable covers every editable region
// (contenteditable="", "plaintext-only", inherited), not just ="true".
function markEdited(e) {
  const t = e.target;
  if (!t) return;
  if (t.isContentEditable || (t.matches && t.matches('input, textarea, select'))) {
    _editedSinceNav = true;
  }
}

export function installBuildGuard() {
  if (typeof window === 'undefined' || !window.fetch) return;
  if (window.__buildGuardInstalled) return;
  window.__buildGuardInstalled = true;

  _pageBuild = document.querySelector('meta[name="app-build"]')?.content || null;
  // A checkout or an unstamped image names no release: nothing to compare.
  if (!isRealBuild(_pageBuild)) return;
  _active = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await originalFetch(...args);
    try { observe(res); } catch { /* never break the caller */ }
    return res;
  };

  // The banner's live region exists (empty) from the start, so a screen reader
  // announces the message when it is filled in.
  mountUpdateRegion();

  document.addEventListener('input', markEdited, true);
  document.addEventListener('change', markEdited, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onFocus();
  });
  window.addEventListener('focus', () => { onFocus(); });
  window.addEventListener('app:asset-load-failed', (e) => { recoverFromAssetFailure(e.detail && e.detail.error); });
}
