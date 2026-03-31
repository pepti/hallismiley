import { projectApi } from '../api/projectApi.js';
import { escHtml }    from '../utils/escHtml.js';
import { Lightbox }   from '../components/Lightbox.js';

const CATEGORY_HERO = {
  tech:        'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=1920&h=1080&fit=crop&q=80&auto=format',
  carpentry:   'https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?w=1920&h=1080&fit=crop&q=80&auto=format',
  remodelling: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1920&h=1080&fit=crop&q=80&auto=format',
  tools:       'https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=1920&h=1080&fit=crop&q=80&auto=format',
};

export class ProjectDetailView {
  constructor(id) {
    this.id       = id;
    this._lb      = null;
    this._media   = [];
  }

  async render() {
    const view = document.createElement('div');
    view.className = 'view';

    try {
      const [project, media] = await Promise.all([
        projectApi.getOne(this.id),
        projectApi.getMedia(this.id).catch(() => []),
      ]);
      if (!project) throw new Error('Not found');

      this._media = media || [];
      view.innerHTML = this._buildPage(project);
      this._attachGallery(view);
    } catch {
      view.innerHTML = `
        <div class="pd-error">
          <p>Project not found.</p>
          <a href="#/projects" class="pd-back-btn">← Back to Projects</a>
        </div>`;
    }

    return view;
  }

  _buildPage(p) {
    const heroImg = p.image_url || CATEGORY_HERO[p.category] || CATEGORY_HERO.tech;
    const hasMedia = this._media.length > 0;

    return `
      <div class="pd-hero">
        <div class="pd-hero__bg" style="background-image:url('${escHtml(heroImg)}')"></div>
        <div class="pd-hero__overlay"></div>
        <div class="pd-hero__content">
          <a href="#/projects" class="pd-back-link">← All Projects</a>
          <div class="pd-hero__meta">
            <span class="badge badge--${escHtml(p.category)}">${escHtml(p.category)}</span>
            <span class="pd-hero__year">${p.year}</span>
            ${p.featured ? '<span class="pd-hero__featured">★ Featured</span>' : ''}
          </div>
          <h1 class="pd-hero__title">${escHtml(p.title)}</h1>
        </div>
      </div>

      <div class="pd-body">
        <div class="pd-body__inner">

          <section class="pd-section" aria-label="Project description">
            <p class="pd-lead">${escHtml(p.description)}</p>
            <p class="pd-para">
              Every detail was approached with the same care applied across all work at
              Halli Smiley — whether hand-selecting timber grain for a cabinet face or
              architecting a database schema built to survive years of production traffic
              without a rewrite.
            </p>
            <p class="pd-para">
              The result is a finished piece that balances function and aesthetic, built
              to outlast trends and hold up under real-world use.
            </p>
          </section>

          ${p.tools_used && p.tools_used.length ? `
          <section class="pd-section" aria-label="Tools used">
            <h2 class="pd-section__heading">Tools &amp; Technologies</h2>
            <div class="pd-tools">
              ${p.tools_used.map(t => `<span class="tool-tag tool-tag--large">${escHtml(t)}</span>`).join('')}
            </div>
          </section>` : ''}

          ${hasMedia ? `
          <section class="pd-section pd-gallery-section" aria-label="Project gallery">
            <h2 class="pd-section__heading">Project Gallery</h2>
            <div class="gallery-grid" role="list">
              ${this._media.map((item, i) => this._buildGridItem(item, i)).join('')}
            </div>
          </section>` : ''}

          <div class="pd-back-wrap">
            <a href="#/projects" class="pd-back-btn">← Back to All Projects</a>
          </div>

        </div>
      </div>
    `;
  }

  _buildGridItem(item, index) {
    const isVideo = item.media_type === 'video';
    const thumb   = isVideo
      ? ''
      : `<img
           class="gallery-grid__img"
           src="${escHtml(item.file_path)}"
           alt="${item.caption ? escHtml(item.caption) : `Photo ${index + 1}`}"
           loading="lazy"
         >`;

    return `
      <div
        class="gallery-grid__item${isVideo ? ' gallery-grid__item--video' : ''}"
        role="listitem"
        data-gallery-index="${index}"
        tabindex="0"
        aria-label="${isVideo ? 'Play video' : `Open photo ${index + 1}`}"
      >
        ${thumb}
        ${isVideo ? `
        <div class="gallery-grid__video-thumb" aria-hidden="true">
          <svg class="gallery-grid__play" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="38" fill="rgba(1,10,19,0.7)" stroke="rgba(200,170,110,0.5)" stroke-width="1.5"/>
            <polygon points="32,24 60,40 32,56" fill="#C8AA6E"/>
          </svg>
          <span class="gallery-grid__video-label">Video</span>
        </div>` : `
        <div class="gallery-grid__overlay" aria-hidden="true">
          <svg class="gallery-grid__zoom" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </div>`}
        ${item.caption ? `<figcaption class="gallery-grid__caption">${escHtml(item.caption)}</figcaption>` : ''}
      </div>`;
  }

  _attachGallery(view) {
    if (!this._media.length) return;

    this._lb = new Lightbox(this._media);
    this._lb.mount();

    view.querySelectorAll('[data-gallery-index]').forEach(el => {
      const open = () => {
        const idx = parseInt(el.dataset.galleryIndex, 10);
        this._lb.open(idx);
      };
      el.addEventListener('click',   open);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  // Called by the router when navigating away, to clean up the lightbox
  destroy() {
    if (this._lb) {
      this._lb.destroy();
      this._lb = null;
    }
  }
}
