/**
 * Lightbox — reusable media viewer component.
 *
 * Usage:
 *   const lb = new Lightbox(mediaItems);  // [{ file_path, media_type, caption }]
 *   lb.mount();
 *   lb.open(index);
 *   lb.destroy();  // when the containing view is torn down
 */
export class Lightbox {
  constructor(items = []) {
    this._items   = items;
    this._index   = 0;
    this._el      = null;
    this._onKey   = this._onKey.bind(this);
    this._onTouch = { startX: 0, startY: 0 };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  mount() {
    if (this._el) return;

    this._el = document.createElement('div');
    this._el.className      = 'lb-overlay';
    this._el.setAttribute('role', 'dialog');
    this._el.setAttribute('aria-modal', 'true');
    this._el.setAttribute('aria-label', 'Media lightbox');
    this._el.hidden = true;

    this._el.innerHTML = `
      <div class="lb-backdrop"></div>
      <div class="lb-container">
        <button class="lb-close" aria-label="Close lightbox">&#x2715;</button>
        <button class="lb-arrow lb-arrow--prev" aria-label="Previous image">&#x2039;</button>
        <div class="lb-media-wrap">
          <img class="lb-img" src="" alt="" draggable="false">
          <video class="lb-video" controls playsinline></video>
          <p class="lb-caption"></p>
        </div>
        <button class="lb-arrow lb-arrow--next" aria-label="Next image">&#x203A;</button>
        <div class="lb-counter" aria-live="polite"></div>
      </div>
    `;

    document.body.appendChild(this._el);

    // Cache DOM references
    this._backdrop  = this._el.querySelector('.lb-backdrop');
    this._img       = this._el.querySelector('.lb-img');
    this._video     = this._el.querySelector('.lb-video');
    this._caption   = this._el.querySelector('.lb-caption');
    this._counter   = this._el.querySelector('.lb-counter');
    this._prevBtn   = this._el.querySelector('.lb-arrow--prev');
    this._nextBtn   = this._el.querySelector('.lb-arrow--next');
    this._closeBtn  = this._el.querySelector('.lb-close');

    // Event listeners
    this._closeBtn.addEventListener('click', () => this.close());
    this._backdrop.addEventListener('click', () => this.close());
    this._prevBtn.addEventListener('click',  () => this._go(-1));
    this._nextBtn.addEventListener('click',  () => this._go(1));

    // Touch / swipe support
    this._el.addEventListener('touchstart', e => {
      this._onTouch.startX = e.touches[0].clientX;
      this._onTouch.startY = e.touches[0].clientY;
    }, { passive: true });
    this._el.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - this._onTouch.startX;
      const dy = e.changedTouches[0].clientY - this._onTouch.startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
        this._go(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  open(index) {
    if (!this._el) this.mount();
    this._index = Math.max(0, Math.min(index, this._items.length - 1));
    this._render();
    this._el.hidden = false;
    document.body.classList.add('lb-open');
    document.addEventListener('keydown', this._onKey);
    this._closeBtn.focus();
    this._preloadAdjacent();
  }

  close() {
    if (!this._el || this._el.hidden) return;
    this._el.hidden = true;
    document.body.classList.remove('lb-open');
    document.removeEventListener('keydown', this._onKey);
    // Pause any playing video
    if (this._video) this._video.pause();
  }

  destroy() {
    this.close();
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _go(delta) {
    const next = this._index + delta;
    if (next < 0 || next >= this._items.length) return;
    this._index = next;
    this._render();
    this._preloadAdjacent();
  }

  _render() {
    const item  = this._items[this._index];
    const total = this._items.length;

    this._counter.textContent = `${this._index + 1} / ${total}`;
    this._prevBtn.disabled    = this._index === 0;
    this._nextBtn.disabled    = this._index === total - 1;
    this._caption.textContent = item.caption || '';
    this._caption.hidden      = !item.caption;

    if (item.media_type === 'video') {
      this._img.hidden   = true;
      this._video.hidden = false;
      this._video.pause();
      this._video.src    = item.file_path;
      this._video.load();
    } else {
      this._video.hidden = true;
      this._video.pause();
      this._video.src    = '';
      this._img.hidden   = false;
      this._img.src      = item.file_path;
      this._img.alt      = item.caption || `Photo ${this._index + 1}`;
    }
  }

  _onKey(e) {
    switch (e.key) {
      case 'ArrowLeft':  this._go(-1); break;
      case 'ArrowRight': this._go(1);  break;
      case 'Escape':     this.close(); break;
    }
  }

  _preloadAdjacent() {
    [-1, 1].forEach(delta => {
      const i    = this._index + delta;
      const item = this._items[i];
      if (item && item.media_type === 'image') {
        const img = new Image();
        img.src   = item.file_path;
      }
    });
  }
}
