// mountSceneHeader — the inner pages' shared entry to the scene engine: a
// full-bleed landscape band at the top of `.main`, with the page's existing
// header markup (eyebrow / h1 / lede) set directly on the photograph — the
// frosted plate it used to sit on went on 2026-09-02 (Halli: no boxes behind
// the headers, text only; iceland-scene.css lights the copy). Keeping the header
// INSIDE #main-content preserves the skip-nav target and heading order; the
// band only breaks out visually (.ice-scene--bleed's negative margins).
//
//   this._scene = mountSceneHeader(main, 'thjonusta', `…header html…`);
//   …and this._scene.destroy() from the view's destroy().
//
// `header` may also be a live Node (ProfileView moves its bound header in, so
// the listeners it already carries survive). With no manifest entry nothing is
// inserted — callers that moved their header here put it back themselves
// (`main.contains(stage.el())` is false in that case).
import { SceneStage } from './SceneStage.js';

export function mountSceneHeader(mainEl, defKey, header) {
  const stage = new SceneStage(defKey, { variant: 'band' });
  const el = stage.el();
  if (el.classList.contains('ice-scene--empty')) return stage; // no manifest → flat header keeps working
  el.classList.add('ice-scene--bleed');
  const panel = document.createElement('div');
  panel.className = 'ice-band-panel';
  if (typeof header === 'string') panel.innerHTML = header;
  else if (header) panel.appendChild(header);
  stage.contentEl().appendChild(panel);
  mainEl.prepend(el);
  stage.mount();
  return stage;
}

// mountSceneBackdrop — the card pages' entry (signup, forgot/reset password,
// verify email; 2026-09-22): the landscape fills the whole page behind the
// centred card, and the card goes frosted so the scene reads through without
// costing contrast (iceland-scene.css, `.scene-page`). The card keeps its
// solid --bg-surface wherever backdrop-filter is unsupported.
//
//   this._scene = mountSceneBackdrop(pageEl, 'signup');
//   …and this._scene.destroy() from the view's destroy().
export function mountSceneBackdrop(pageEl, defKey) {
  const stage = new SceneStage(defKey, { variant: 'band' });
  const el = stage.el();
  if (el.classList.contains('ice-scene--empty')) return stage; // no manifest → the flat page
  el.classList.add('ice-scene--backdrop');
  pageEl.classList.add('scene-page');
  pageEl.prepend(el);
  stage.mount();
  return stage;
}
