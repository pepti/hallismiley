import { projectApi } from '../api/projectApi.js';
import { escHtml } from '../utils/escHtml.js';

// Iceland placeholder images rotated per-project
const DETAIL_IMAGES = [
  'https://images.unsplash.com/photo-1477346611705-65d1883cee1e?w=1200&h=800&fit=crop&q=80&auto=format',
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&h=800&fit=crop&q=80&auto=format',
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&h=800&fit=crop&q=80&auto=format',
  'https://images.unsplash.com/photo-1562529074-e3ec282e9b60?w=1200&h=800&fit=crop&q=80&auto=format',
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200&h=800&fit=crop&q=80&auto=format',
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&h=800&fit=crop&q=80&auto=format',
  'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?w=1200&h=800&fit=crop&q=80&auto=format',
  'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=1200&h=800&fit=crop&q=80&auto=format',
];

const CATEGORY_HERO = {
  tech:        'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=1920&h=1080&fit=crop&q=80&auto=format',
  carpentry:   'https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?w=1920&h=1080&fit=crop&q=80&auto=format',
  remodelling: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1920&h=1080&fit=crop&q=80&auto=format',
  tools:       'https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=1920&h=1080&fit=crop&q=80&auto=format',
};

export class ProjectDetailView {
  constructor(id) {
    this.id = id;
  }

  async render() {
    const view = document.createElement('div');
    view.className = 'view';

    try {
      const project = await projectApi.getOne(this.id);
      if (!project) throw new Error('Not found');
      view.innerHTML = this._buildPage(project);
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
    const photos  = this._pickImages(p.id, 4);

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

          <section class="pd-section" aria-label="Tools used">
            <h2 class="pd-section__heading">Tools &amp; Technologies</h2>
            <div class="pd-tools">
              ${p.tools_used.map(t => `<span class="tool-tag tool-tag--large">${escHtml(t)}</span>`).join('')}
            </div>
          </section>

          <section class="pd-section" aria-label="Project videos">
            <h2 class="pd-section__heading">Process Videos</h2>
            <div class="pd-video-grid">
              ${this._videoPlaceholder('Build walkthrough')}
              ${this._videoPlaceholder('Final reveal')}
            </div>
          </section>

          <section class="pd-section" aria-label="Project photos">
            <h2 class="pd-section__heading">Project Photos</h2>
            <div class="pd-photo-grid">
              ${photos.map((url, i) => `
                <figure class="pd-photo">
                  <img src="${url}" alt="Project photo ${i + 1}" loading="lazy">
                </figure>
              `).join('')}
            </div>
          </section>

          <div class="pd-back-wrap">
            <a href="#/projects" class="pd-back-btn">← Back to All Projects</a>
          </div>

        </div>
      </div>
    `;
  }

  _videoPlaceholder(label) {
    return `
      <div class="pd-video-placeholder" aria-label="${escHtml(label)}">
        <div class="pd-video-placeholder__inner">
          <svg class="pd-video-placeholder__play" viewBox="0 0 80 80" aria-hidden="true">
            <circle cx="40" cy="40" r="38" fill="rgba(1,10,19,0.6)" stroke="rgba(200,170,110,0.5)" stroke-width="1.5"/>
            <polygon points="32,24 60,40 32,56" fill="#C8AA6E"/>
          </svg>
          <p class="pd-video-placeholder__label">${escHtml(label)}</p>
          <p class="pd-video-placeholder__note">Video coming soon</p>
        </div>
      </div>`;
  }

  // Rotate through DETAIL_IMAGES starting at an offset based on project id
  _pickImages(id, count) {
    const start = (Number(id) || 0) % DETAIL_IMAGES.length;
    return Array.from({ length: count }, (_, i) =>
      DETAIL_IMAGES[(start + i) % DETAIL_IMAGES.length]
    );
  }
}

