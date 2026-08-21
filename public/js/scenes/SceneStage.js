// SceneStage — one photographic Iceland scene: LQIP blur-up, responsive
// <picture>, per-theme grading (CSS tokens), scrim, place chip, and (chunk 3)
// the ambience canvas. Views own an instance per band:
//
//   this._scene = new SceneStage('home', { variant: 'hero' });
//   slot.appendChild(this._scene.el());
//   this._scene.mount();
//   …and this._scene.destroy() from the view's destroy().
//
// The DOM contract (stacking inside `isolation: isolate`, see
// iceland-scene.css):
//   .ice-scene__lqip   z0  inline data-URI, blurred, never removed (it is the
//                          fallback if the network image dies)
//   picture/__img      z1  AVIF/WebP/JPEG srcset, graded by --scene-filter
//   .ice-scene__fx     z2  particle/aurora canvas (hidden until chunk 3)
//   .ice-scene__scrim  z3  per-theme gradient that buys text contrast
//   .ice-scene__content z5 caller's slot (hero copy / page header)
//   .ice-scene__chip   z6  "Skógafoss — Suðurland"
import { SCENE_IMAGES } from './manifest.js';
import { SCENE_DEFS } from './sceneDefs.js';
import { t } from '../i18n/i18n.js';
import { escHtml } from '../utils/escHtml.js';
import { saveData } from '../utils/motion.js';

export class SceneStage {
  /**
   * @param {string} defKey key into SCENE_DEFS
   * @param {object} [opts]
   * @param {'hero'|'band'} [opts.variant] hero = full-viewport home hero
   *   (eager, preloaded by ssrMeta); band = page-header / section band
   *   (lazy via IntersectionObserver).
   * @param {boolean} [opts.chip] show the place chip.
   */
  constructor(defKey, { variant = 'band', chip = true } = {}) {
    this.def = SCENE_DEFS[defKey];
    this.img = this.def && SCENE_IMAGES[this.def.image];
    this.variant = variant;
    this.chip = chip;
    this.root = null;
    this._io = null;
  }

  // Build (idempotent) and return the scene subtree. Safe to call before
  // mount(); does no network work in band variant until mount() decides to.
  el() {
    if (this.root) return this.root;
    // Missing def/manifest entry (bad key, pruned photo): render nothing
    // rather than a broken band — callers keep their solid-color fallback.
    if (!this.def || !this.img) {
      this.root = document.createElement('div');
      this.root.className = 'ice-scene ice-scene--empty';
      return this.root;
    }

    const root = document.createElement('div');
    // Assigned before children build: the hero variant calls _buildPicture()
    // during this method, and that needs this.root (load handler, chip).
    this.root = root;
    root.className = `ice-scene ice-scene--${this.variant}`;
    root.dataset.scene = this.def.image;
    root.style.setProperty('--focal', this.img.focal);
    // The media box keeps the photo's ratio available to CSS; bands clamp
    // height in CSS regardless, so this only prevents pre-CSS jank.
    root.style.setProperty('--scene-ratio', `${this.img.width} / ${this.img.height}`);

    const media = document.createElement('div');
    media.className = 'ice-scene__media';
    media.setAttribute('aria-hidden', 'true');

    const lqip = document.createElement('div');
    lqip.className = 'ice-scene__lqip';
    lqip.style.backgroundImage = `url('${this.img.lqip}')`;
    media.appendChild(lqip);

    // Hero loads eagerly (it IS the LCP; ssrMeta preloads it). Bands defer the
    // <picture> insert to mount()+IO so below-fold photos cost nothing.
    if (this.variant === 'hero') media.appendChild(this._buildPicture());

    const fx = document.createElement('canvas');
    fx.className = 'ice-scene__fx';
    fx.hidden = true; // chunk 3 (ambience) reveals it
    media.appendChild(fx);

    const scrim = document.createElement('div');
    scrim.className = 'ice-scene__scrim';
    media.appendChild(scrim);

    root.appendChild(media);

    const content = document.createElement('div');
    content.className = 'ice-scene__content';
    root.appendChild(content);

    if (this.chip) {
      const chip = document.createElement('span');
      chip.className = 'ice-scene__chip';
      chip.textContent = `${this.def.place} — ${this.def.region}`;
      root.appendChild(chip);
    }

    this.root = root;
    return root;
  }

  // Where callers put their heading / hero copy.
  contentEl() {
    return this.el().querySelector('.ice-scene__content');
  }

  mount() {
    if (!this.root || this.root.classList.contains('ice-scene--empty')) return;
    if (this.variant === 'hero') return; // picture already in the DOM
    // Bands: insert the real photo when the band approaches the viewport.
    // Generous rootMargin so the blur-up usually finishes before arrival.
    if (!('IntersectionObserver' in window)) {
      this._insertPicture();
      return;
    }
    this._io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        this._insertPicture();
        this._io.disconnect();
        this._io = null;
      }
    }, { rootMargin: '200% 0px' });
    this._io.observe(this.root);
  }

  destroy() {
    if (this._io) { this._io.disconnect(); this._io = null; }
  }

  _insertPicture() {
    const media = this.root.querySelector('.ice-scene__media');
    if (!media || media.querySelector('picture')) return;
    media.insertBefore(this._buildPicture(), media.querySelector('.ice-scene__fx'));
  }

  _buildPicture() {
    const { sources } = this.img;
    const pic = document.createElement('picture');
    const srcset = (list) => list.map((s) => `${s.src} ${s.w}w`).join(', ');
    // Save-Data: cap the candidates the browser sees at 960w — same photo,
    // a third of the bytes. (sizes tricks are less reliable than just not
    // offering the big files.)
    const cap = saveData() ? (l) => l.filter((s) => s.w <= 960) : (l) => l;
    const sizes = this.variant === 'hero' ? '100vw' : '(min-width: 1600px) 1600px, 100vw';

    for (const fmt of ['avif', 'webp']) {
      if (!sources[fmt]?.length) continue;
      const s = document.createElement('source');
      s.type = `image/${fmt}`;
      s.srcset = srcset(cap(sources[fmt]));
      s.sizes = sizes;
      pic.appendChild(s);
    }

    const img = document.createElement('img');
    img.className = 'ice-scene__img';
    const jpegs = cap(sources.jpeg);
    img.src = (jpegs.find((s) => s.w === 1600) || jpegs[jpegs.length - 1]).src;
    img.srcset = srcset(jpegs);
    img.sizes = sizes;
    img.alt = ''; // decorative — the page's real heading carries the meaning
    img.decoding = 'async';
    if (this.variant !== 'hero') img.loading = 'lazy';
    else img.fetchPriority = 'high';
    // title on the chip, not the img: alt-text i18n key is used by the chip's
    // aria-label instead so screen readers hear the place once, not twice.
    img.addEventListener('load', () => this.root.classList.add('is-loaded'), { once: true });
    if (img.complete && img.naturalWidth > 0) this.root.classList.add('is-loaded');
    pic.appendChild(img);

    // Chip aria-label (the localized scene description) — deferred a tick
    // because during the hero's eager build the chip hasn't been appended yet.
    const label = t(this.def.altKey);
    if (this.chip && label && label !== this.def.altKey) {
      queueMicrotask(() => {
        const chip = this.root?.querySelector('.ice-scene__chip');
        if (chip) chip.setAttribute('aria-label', escHtml(label));
      });
    }
    return pic;
  }
}
