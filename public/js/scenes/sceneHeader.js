// mountSceneHeader — the inner pages' shared entry to the scene engine: a
// full-bleed landscape band at the top of `.main`, with the page's existing
// header markup (eyebrow / h1 / lede) on a frosted panel. Keeping the header
// INSIDE #main-content preserves the skip-nav target and heading order; the
// band only breaks out visually (.ice-scene--bleed's negative margins).
//
//   this._scene = mountSceneHeader(main, 'thjonusta', `…header html…`);
//   …and this._scene.destroy() from the view's destroy().
import { SceneStage } from './SceneStage.js';

export function mountSceneHeader(mainEl, defKey, headerHtml) {
  const stage = new SceneStage(defKey, { variant: 'band' });
  const el = stage.el();
  if (el.classList.contains('ice-scene--empty')) return stage; // no manifest → flat header keeps working
  el.classList.add('ice-scene--bleed');
  const panel = document.createElement('div');
  panel.className = 'ice-frost ice-band-panel';
  panel.innerHTML = headerHtml;
  stage.contentEl().appendChild(panel);
  mainEl.prepend(el);
  stage.mount();
  return stage;
}
