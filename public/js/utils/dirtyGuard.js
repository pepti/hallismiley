// Global unsaved-changes guard.
// Watches any `contentEditable` element that becomes dirty (input event fires)
// and warns the user if they try to leave the page before the page reloads
// them. Cleared automatically when:
//   - The element's contentEditable flips back to 'false' (edit mode exited)
//   - A hashchange is fired (SPA navigation — router clears mountEl, so the
//     dirty node is detached)
//   - The page is actually unloaded
//
// Zero changes required in views. Wire once from main.js / consent.js.

const dirtyElements = new WeakSet();
let listenersInstalled = false;

function anyDirty() {
  // WeakSet doesn't expose membership iteration. Walk the current DOM for
  // contentEditable nodes that still read as dirty — if any match, the guard
  // stays active. This is cheap because modal/edit UIs rarely have >10 such
  // nodes.
  const nodes = document.querySelectorAll('[contenteditable="true"]');
  for (const n of nodes) if (dirtyElements.has(n)) return true;
  return false;
}

function onBeforeUnload(e) {
  if (!anyDirty()) return;
  e.preventDefault();
  // Modern browsers ignore the returned string but require setting returnValue
  // to trigger the native confirmation dialog.
  e.returnValue = '';
}

function onHashChange() {
  // SPA navigation — mountEl is about to be cleared; forget all tracked nodes.
  // (WeakSet auto-clears once GC collects the detached nodes.)
  dirtyCleared();
}

function onInput(e) {
  const t = e.target;
  if (t && t.nodeType === 1 && t.isContentEditable) {
    dirtyElements.add(t);
  }
}

function dirtyCleared() {
  // Fire a lightweight event so any UI badges can react. Not used today.
  document.dispatchEvent(new CustomEvent('dirty-cleared'));
}

export function installDirtyGuard() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  document.addEventListener('input', onInput, true);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('hashchange',   onHashChange);
}

/** Manually mark an element as clean (e.g. after a successful save). */
export function markClean(el) {
  if (el) dirtyElements.delete(el);
}

/** Manually mark the whole page as clean. */
export function clearAllDirty() {
  const nodes = document.querySelectorAll('[contenteditable="true"]');
  for (const n of nodes) dirtyElements.delete(n);
  dirtyCleared();
}
