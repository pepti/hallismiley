// Motion / data-saving gates — the ONE place the scene engine (and anything
// else animated) asks "may I move?". Until this file, reduced-motion handling
// was CSS-only; canvas/rAF/View-Transition work needs the same answer in JS,
// and Save-Data has no CSS query at all.
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');

export function prefersReducedMotion() {
  return mq.matches;
}

// Chromium-only API; absence means "no signal", not "no saving".
export function saveData() {
  return navigator.connection?.saveData === true;
}

// The composite gate: animation, particles, parallax, view transitions.
export function motionAllowed() {
  return !prefersReducedMotion() && !saveData();
}

// Live changes (user flips the OS setting mid-visit). Returns an unsubscribe.
export function onMotionChange(cb) {
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

// CSS scroll-driven animations (the band parallax). No JS fallback for bands
// by design — unsupporting browsers get a beautiful static scene, not a
// scroll listener.
export function supportsScrollTimeline() {
  return CSS.supports('animation-timeline: view()');
}
