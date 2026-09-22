// Staggered scroll-reveal — the generalization of HalliView's page-local
// `_initScrollReveal` (the bio page keeps its own; new code uses this).
// Marks `.ice-reveal` elements `.is-visible` as they approach the viewport;
// CSS in iceland-scene.css does the rest and reduced-motion neutralizes it
// there, so this helper never needs to ask.
//
//   this._reveal = initReveal(view);
//   …and this._reveal.destroy() from the view's destroy().
export function initReveal(rootEl) {
  const els = rootEl.querySelectorAll('.ice-reveal');
  if (!els.length || !('IntersectionObserver' in window)) {
    // No observer support → show everything; motion was optional anyway.
    els.forEach((el) => el.classList.add('is-visible'));
    return { destroy() {} };
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach((el) => io.observe(el));
  return { destroy: () => io.disconnect() };
}
