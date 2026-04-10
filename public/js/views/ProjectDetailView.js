import { projectApi } from '../api/projectApi.js';
import { escHtml }    from '../utils/escHtml.js';
import { Lightbox }   from '../components/Lightbox.js';
import { getUser }    from '../services/auth.js';

const CATEGORY_HERO = {
  tech:        'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=1920&h=1080&fit=crop&q=80&auto=format',
  carpentry:   'https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?w=1920&h=1080&fit=crop&q=80&auto=format',
  remodelling: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1920&h=1080&fit=crop&q=80&auto=format',
  tools:       'https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=1920&h=1080&fit=crop&q=80&auto=format',
};

export class ProjectDetailView {
  constructor(id) {
    this.id               = id;
    this._lb              = null;
    this._media           = [];
    this._sections        = [];
    this._videos          = [];
    this._uploadTargetSec = null; // currently-selected section for new uploads (null = Ungrouped)
    this._project         = null;
    this._editMode        = false;
    this._view            = null;
    this._onAuthChange    = null;
    this._actionsAbort    = null; // aborted on each re-render to avoid stacking listeners
  }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view';

    // Re-render when auth state changes (e.g. user logs in while on this page)
    // so the Edit Project button appears/disappears without a full page reload.
    this._onAuthChange = () => {
      if (this._project && !this._editMode) this._renderContent();
    };
    window.addEventListener('authchange', this._onAuthChange);

    try {
      const [project, media, sections, videos] = await Promise.all([
        projectApi.getOne(this.id),
        projectApi.getMedia(this.id).catch(() => []),
        projectApi.getSections(this.id).catch(() => []),
        projectApi.getVideos(this.id).catch(() => []),
      ]);
      if (!project) throw new Error('Not found');

      this._project  = project;
      this._media    = media    || [];
      this._sections = sections || [];
      this._videos   = videos   || [];
      this._renderContent();
    } catch {
      this._view.innerHTML = `
        <div class="pd-error">
          <p>Project not found.</p>
          <a href="#/projects" class="pd-back-btn">← Back to Projects</a>
        </div>`;
    }

    return this._view;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  _renderContent() {
    if (this._lb) { this._lb.destroy(); this._lb = null; }

    // Abort previous view-level listeners before re-rendering to prevent stacking
    if (this._actionsAbort) this._actionsAbort.abort();
    this._actionsAbort = new AbortController();

    const user      = getUser();
    const canEdit   = !!(user && (user.role === 'admin' || user.role === 'moderator'));
    const canDelete = !!(user && user.role === 'admin');

    this._view.innerHTML = this._editMode
      ? this._buildEditPage(this._project, canDelete)
      : this._buildPage(this._project, canEdit);

    if (!this._editMode) {
      this._attachGallery(this._view);
    }
    this._attachEventHandlers(this._view, canEdit, canDelete, this._actionsAbort.signal);
  }

  // Group _media by section_id. Returns an array of buckets in render order:
  // Ungrouped (null) first, then sections in their sort_order. Each bucket is
  // { section, items }. Section === null is the Ungrouped bucket.
  _groupBySection() {
    const buckets = new Map(); // section_id|null → { section, items }
    buckets.set(null, { section: null, items: [] });
    for (const s of this._sections) {
      buckets.set(s.id, { section: s, items: [] });
    }
    for (const m of this._media) {
      const key = m.section_id ?? null;
      const bucket = buckets.get(key) || buckets.get(null);
      bucket.items.push(m);
    }
    return [...buckets.values()];
  }

  // Flatten buckets back into a single array in section-then-sort order so
  // `data-gallery-index` lines up with Lightbox indices.
  _flatInGroupOrder() {
    const groups = this._groupBySection();
    const flat = [];
    for (const g of groups) flat.push(...g.items);
    return flat;
  }

  _buildPage(p, canEdit) {
    const heroImg  = p.image_url || CATEGORY_HERO[p.category] || CATEGORY_HERO.tech;
    const hasMedia = this._media.length > 0;

    // Keep _media in the same order the Lightbox will walk through, so that
    // data-gallery-index values match the array indices passed to the Lightbox.
    this._media = this._flatInGroupOrder();

    // Non-empty buckets only. If the only bucket is Ungrouped AND there are no
    // named sections at all, skip the heading entirely so legacy projects look
    // exactly like they did before sections existed.
    const buckets = this._groupBySection().filter(g => g.items.length);
    const legacyFlat = buckets.length === 1 && buckets[0].section === null && this._sections.length === 0;
    let globalIndex = 0;

    // Video block — rendered on either side of the gallery, but only when
    // there is at least one video (view mode hides empty blocks entirely).
    const hasVideos     = this._videos.length > 0;
    const videoPosition = p.video_section_position || 'above_gallery';
    const videoBlock    = hasVideos ? this._buildVideoBlockView() : '';

    return `
      <div class="pd-hero">
        <div class="pd-hero__bg" style="background-image:url('${escHtml(heroImg)}')"></div>
        <div class="pd-hero__overlay"></div>
        <div class="pd-hero__content">
          <a href="#/projects" class="pd-back-link">&#x2190; All Projects</a>
          <div class="pd-hero__meta">
            <span class="badge badge--${escHtml(p.category)}">${escHtml(p.category)}</span>
            <span class="pd-hero__year">${p.year}</span>
            ${p.featured ? '<span class="pd-hero__featured">&#x2605; Featured</span>' : ''}
          </div>
          <h1 class="pd-hero__title">${escHtml(p.title)}</h1>
        </div>
        ${canEdit ? `
        <div class="pd-edit-toggle-wrap">
          <button class="pd-edit-toggle" type="button" aria-label="Enter edit mode" data-testid="edit-project-btn">
            &#x270E; Edit Project
          </button>
        </div>` : ''}
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

          ${videoPosition === 'above_gallery' ? videoBlock : ''}

          ${hasMedia ? `
          <section class="pd-section pd-gallery-section" aria-label="Project gallery">
            <h2 class="pd-section__heading">Project Gallery</h2>
            ${legacyFlat ? `
            <div class="gallery-grid" role="list">
              ${buckets[0].items.map(item => this._buildGridItem(item, globalIndex++)).join('')}
            </div>
            ` : buckets.map(g => {
              const desc = g.section && g.section.description && g.section.description.trim();
              return `
              <section class="pd-gallery-group" data-section-id="${g.section ? g.section.id : ''}">
                <h3 class="pd-gallery-group__heading">${escHtml(g.section ? g.section.name : 'Ungrouped')}</h3>
                ${desc ? `<p class="pd-gallery-group__description">${escHtml(desc)}</p>` : ''}
                <div class="gallery-grid" role="list">
                  ${g.items.map(item => this._buildGridItem(item, globalIndex++)).join('')}
                </div>
              </section>
              `;
            }).join('')}
          </section>` : ''}

          ${videoPosition === 'below_gallery' ? videoBlock : ''}

          <div class="pd-back-wrap">
            <a href="#/projects" class="pd-back-btn">&#x2190; Back to All Projects</a>
          </div>

        </div>
      </div>
    `;
  }

  _buildEditPage(p, canDelete) {
    const heroImg = p.image_url || CATEGORY_HERO[p.category] || CATEGORY_HERO.tech;

    // Keep _media ordered the same way buckets iterate so index math is stable
    this._media = this._flatInGroupOrder();
    const buckets = this._groupBySection(); // includes empty Ungrouped bucket
    let globalIndex = 0;

    // Video block is always rendered in edit mode so the admin can add to an
    // empty section. Position is stored per-project on `video_section_position`.
    const videoPosition = p.video_section_position || 'above_gallery';
    const videoEditBlock = this._buildVideoBlockEdit(canDelete);

    // Target section dropdown for new uploads (default: Ungrouped)
    const uploadTargetOptions = `
      <option value="">Ungrouped</option>
      ${this._sections.map(s =>
        `<option value="${s.id}" ${this._uploadTargetSec === s.id ? 'selected' : ''}>${escHtml(s.name)}</option>`
      ).join('')}`;

    return `
      <div class="pd-edit-banner">
        <span class="pd-edit-banner__label">&#x270E; Edit Mode</span>
        <div class="pd-edit-banner__actions">
          <button class="btn--edit-save" type="button" id="pd-save-btn">Save Changes</button>
          <button class="btn--edit-cancel" type="button" id="pd-cancel-btn">Cancel</button>
        </div>
      </div>

      <div class="pd-hero">
        <div class="pd-hero__bg" style="background-image:url('${escHtml(heroImg)}')"></div>
        <div class="pd-hero__overlay"></div>
        <div class="pd-hero__content">
          <a href="#/projects" class="pd-back-link">&#x2190; All Projects</a>
          <div class="pd-hero__meta" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <select class="pd-edit-select" id="pd-edit-category" name="category">
              <option value="carpentry" ${p.category === 'carpentry' ? 'selected' : ''}>Carpentry</option>
              <option value="tech"      ${p.category === 'tech'      ? 'selected' : ''}>Tech</option>
            </select>
            <input class="pd-edit-year" id="pd-edit-year" name="year"
              type="number" min="1900" max="2100" value="${p.year}">
            <label class="pd-edit-featured">
              <input type="checkbox" id="pd-edit-featured" name="featured"
                ${p.featured ? 'checked' : ''}>
              Featured
            </label>
          </div>
          <input class="pd-edit-field pd-edit-title" id="pd-edit-title"
            name="title" type="text" maxlength="200"
            value="${escHtml(p.title)}">
        </div>
      </div>

      <div class="pd-body">
        <div class="pd-body__inner">

          <section class="pd-section">
            <h2 class="pd-section__heading">Description</h2>
            <textarea class="pd-edit-field pd-edit-description"
              id="pd-edit-description" name="description"
              maxlength="2000">${escHtml(p.description)}</textarea>
          </section>

          <section class="pd-section">
            <h2 class="pd-section__heading">Tools &amp; Technologies</h2>
            <input class="pd-edit-field pd-edit-tools" id="pd-edit-tools"
              name="tools_used" type="text"
              placeholder="Comma-separated, e.g. Node.js, PostgreSQL"
              value="${escHtml((p.tools_used || []).join(', '))}">
            <p style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">
              Separate tools with commas.
            </p>
          </section>

          ${videoPosition === 'above_gallery' ? videoEditBlock : ''}

          <section class="pd-section pd-gallery-section" aria-label="Project gallery">
            <h2 class="pd-section__heading">Project Gallery</h2>

            <div class="pd-section-toolbar">
              <div class="pd-section-toolbar__chips">
                ${this._sections.map((s, i) => `
                  <div class="pd-section-chip" data-section-chip="${s.id}">
                    <button class="pd-section-chip__move" type="button"
                      data-action="section-up" data-section-id="${s.id}"
                      ${i === 0 ? 'disabled' : ''} aria-label="Move section up">&#x25C0;</button>
                    <span class="pd-section-chip__name">${escHtml(s.name)}</span>
                    <button class="pd-section-chip__move" type="button"
                      data-action="section-down" data-section-id="${s.id}"
                      ${i === this._sections.length - 1 ? 'disabled' : ''} aria-label="Move section down">&#x25B6;</button>
                    <button class="pd-section-chip__action" type="button"
                      data-action="section-rename" data-section-id="${s.id}"
                      aria-label="Rename section">&#x270E;</button>
                    ${canDelete ? `
                    <button class="pd-section-chip__action pd-section-chip__action--danger" type="button"
                      data-action="section-delete" data-section-id="${s.id}"
                      aria-label="Delete section">&times;</button>` : ''}
                  </div>
                `).join('')}
              </div>
              <button class="pd-section-add-btn" type="button" id="pd-add-section-btn">
                + Add Section
              </button>
            </div>

            ${buckets.map(g => {
              const secId   = g.section ? g.section.id : '';
              const isEmpty = g.items.length === 0;
              const descVal = g.section && g.section.description ? g.section.description : '';
              return `
              <section class="pd-gallery-group pd-gallery-group--edit" data-section-id="${secId}">
                <h3 class="pd-gallery-group__heading">${escHtml(g.section ? g.section.name : 'Ungrouped')}</h3>
                ${g.section ? `
                <textarea
                  class="pd-edit-field pd-gallery-group__description-edit"
                  data-section-desc-id="${g.section.id}"
                  rows="2"
                  maxlength="2000"
                  placeholder="Add a description for this section (optional)…"
                >${escHtml(descVal)}</textarea>` : ''}
                <div class="gallery-grid gallery-grid--edit${isEmpty ? ' gallery-grid--empty' : ''}"
                     data-section-id="${secId}" role="list">
                  ${g.items.map(item => this._buildEditGridItem(item, globalIndex++, canDelete)).join('')}
                  ${isEmpty ? '<div class="gallery-grid__drop-hint">Drag images here</div>' : ''}
                </div>
              </section>`;
            }).join('')}

            <div class="pd-add-media-wrap">
              <label class="pd-upload-target-label">
                Upload into:
                <select class="pd-edit-select" id="pd-upload-target">
                  ${uploadTargetOptions}
                </select>
              </label>
              <button class="pd-add-media-btn" type="button" id="pd-add-media-btn">
                + Add Image / Video
              </button>
              <input type="file" id="pd-media-file-input"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                style="display:none">
            </div>
            <p class="pd-upload-status" id="pd-upload-status"></p>
          </section>

          ${videoPosition === 'below_gallery' ? videoEditBlock : ''}

          <div class="pd-back-wrap">
            <a href="#/projects" class="pd-back-btn">&#x2190; Back to All Projects</a>
          </div>

        </div>
      </div>
    `;
  }

  // ── Video block rendering ────────────────────────────────────────────────

  _buildVideoItemPlayer(v) {
    if (v.kind === 'youtube') {
      const src = `https://www.youtube-nocookie.com/embed/${escHtml(v.youtube_id)}`;
      return `
        <div class="pd-video-item__player">
          <iframe
            src="${src}"
            title="${escHtml(v.title || 'YouTube video')}"
            loading="lazy"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen></iframe>
        </div>`;
    }
    // File
    return `
      <div class="pd-video-item__player">
        <video
          src="${escHtml(v.file_path)}"
          controls
          preload="metadata"
          playsinline></video>
      </div>`;
  }

  _buildVideoBlockView() {
    // View mode: simple grid of players, optional titles
    return `
      <section class="pd-section pd-video-section" aria-label="Project videos">
        <h2 class="pd-section__heading">Videos</h2>
        <div class="pd-video-grid">
          ${this._videos.map(v => `
            <article class="pd-video-item" data-video-id="${v.id}">
              ${this._buildVideoItemPlayer(v)}
              ${v.title ? `<p class="pd-video-item__title">${escHtml(v.title)}</p>` : ''}
            </article>
          `).join('')}
        </div>
      </section>`;
  }

  _buildVideoBlockEdit(canDelete) {
    const pos = this._project?.video_section_position || 'above_gallery';
    const isAbove = pos === 'above_gallery';
    const count   = this._videos.length;

    return `
      <section class="pd-section pd-video-section pd-video-section--edit" aria-label="Project videos">
        <h2 class="pd-section__heading">Videos</h2>

        <div class="pd-video-toolbar">
          <div class="pd-video-toolbar__position">
            <span class="pd-video-toolbar__label">Section position:</span>
            <button class="gallery-btn gallery-btn--order" type="button"
              data-action="video-section-up"
              ${isAbove ? 'disabled' : ''} aria-label="Move section up (above gallery)">&#x25B2;</button>
            <span class="pd-video-toolbar__value">${isAbove ? 'Above gallery' : 'Below gallery'}</span>
            <button class="gallery-btn gallery-btn--order" type="button"
              data-action="video-section-down"
              ${!isAbove ? 'disabled' : ''} aria-label="Move section down (below gallery)">&#x25BC;</button>
          </div>
          ${canDelete && count > 0 ? `
          <button class="gallery-btn gallery-btn--delete" type="button"
            data-action="video-section-delete">
            Delete Video Section
          </button>` : ''}
        </div>

        <div class="pd-video-grid pd-video-grid--edit${count === 0 ? ' pd-video-grid--empty' : ''}">
          ${count === 0 ? '<div class="pd-video-grid__empty-hint">No videos yet — add one below.</div>' : ''}
          ${this._videos.map((v, i) => `
            <article class="pd-video-item pd-video-item--edit" data-video-id="${v.id}">
              ${this._buildVideoItemPlayer(v)}

              <div class="pd-video-item__controls">
                <div class="pd-video-item__reorder">
                  <button class="gallery-btn gallery-btn--order" type="button"
                    data-action="video-move-up" data-video-id="${v.id}"
                    ${i === 0 ? 'disabled' : ''} aria-label="Move up">&#x25B2;</button>
                  <button class="gallery-btn gallery-btn--order" type="button"
                    data-action="video-move-down" data-video-id="${v.id}"
                    ${i === count - 1 ? 'disabled' : ''} aria-label="Move down">&#x25BC;</button>
                </div>
                <button class="gallery-btn gallery-btn--delete" type="button"
                  data-action="video-delete" data-video-id="${v.id}">
                  Delete
                </button>
              </div>

              <input
                type="text"
                class="pd-edit-field pd-video-item__title-edit"
                data-video-title-id="${v.id}"
                maxlength="200"
                placeholder="Video title (optional)…"
                value="${escHtml(v.title || '')}">
            </article>
          `).join('')}
        </div>

        <div class="pd-video-add-wrap">
          <button class="pd-add-media-btn" type="button" id="pd-add-video-file-btn">
            + Add Video File
          </button>
          <input type="file" id="pd-video-file-input"
            accept="video/mp4,video/webm"
            style="display:none">
          <button class="pd-add-media-btn" type="button" id="pd-add-video-youtube-btn">
            + Add YouTube URL
          </button>
        </div>
        <p class="pd-upload-status" id="pd-video-upload-status"></p>
      </section>`;
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

  _buildEditGridItem(item, index, canDelete) {
    const isVideo = item.media_type === 'video';

    // Position within its section bucket (move-up/down is section-relative)
    const sameSection = this._media.filter(m => (m.section_id ?? null) === (item.section_id ?? null));
    const idxInSection  = sameSection.findIndex(m => m.id === item.id);
    const lastInSection = sameSection.length - 1;

    const thumb = isVideo
      ? `<div class="gallery-grid__video-thumb" aria-hidden="true">
           <svg class="gallery-grid__play" viewBox="0 0 80 80">
             <circle cx="40" cy="40" r="38" fill="rgba(1,10,19,0.7)" stroke="rgba(200,170,110,0.5)" stroke-width="1.5"/>
             <polygon points="32,24 60,40 32,56" fill="#C8AA6E"/>
           </svg>
           <span class="gallery-grid__video-label">Video</span>
         </div>`
      : `<img class="gallery-grid__img"
           src="${escHtml(item.file_path)}"
           alt="${item.caption ? escHtml(item.caption) : `Photo ${index + 1}`}"
           loading="lazy">`;

    return `
      <div
        class="gallery-grid__item${isVideo ? ' gallery-grid__item--video' : ''}"
        role="listitem"
        data-media-id="${item.id}"
        data-media-index="${index}"
        data-section-id="${item.section_id ?? ''}"
        draggable="true"
        tabindex="0"
      >
        ${thumb}

        <div class="gallery-grid__reorder">
          <button class="gallery-btn gallery-btn--order" type="button"
            data-action="move-up" data-media-id="${item.id}"
            ${idxInSection === 0 ? 'disabled' : ''} aria-label="Move up">&#x25B2;</button>
          <button class="gallery-btn gallery-btn--order" type="button"
            data-action="move-down" data-media-id="${item.id}"
            ${idxInSection === lastInSection ? 'disabled' : ''} aria-label="Move down">&#x25BC;</button>
        </div>

        <div class="gallery-grid__edit-controls">
          <button class="gallery-btn gallery-btn--cover" type="button"
            data-action="set-cover" data-media-id="${item.id}">
            Set Cover
          </button>
          ${canDelete ? `
          <button class="gallery-btn gallery-btn--delete" type="button"
            data-action="delete-media" data-media-id="${item.id}">
            Delete
          </button>` : ''}
        </div>

        ${item.caption ? `<figcaption class="gallery-grid__caption">${escHtml(item.caption)}</figcaption>` : ''}
      </div>`;
  }

  // ── Event wiring ───────────────────────────────────────────────────────────

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

  _attachEventHandlers(view, canEdit, canDelete, signal) {
    // Read-only mode: toggle into edit
    const toggleBtn = view.querySelector('.pd-edit-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this._editMode = true;
        this._renderContent();
      });
    }

    if (!this._editMode) return;

    // Edit mode: Save
    view.querySelector('#pd-save-btn').addEventListener('click', () => this._saveChanges(view));

    // Edit mode: Cancel — discard unsaved text edits, reload from server
    view.querySelector('#pd-cancel-btn').addEventListener('click', () => {
      this._editMode = false;
      this._renderContent();
    });

    // Gallery action buttons via event delegation — signal removes this listener
    // on the next _renderContent() call so it never stacks across re-renders.
    view.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action    = btn.dataset.action;
      const mediaId   = btn.dataset.mediaId   ? Number(btn.dataset.mediaId)   : null;
      const sectionId = btn.dataset.sectionId ? Number(btn.dataset.sectionId) : null;
      const videoId = btn.dataset.videoId ? Number(btn.dataset.videoId) : null;
      if (action === 'set-cover')            this._handleSetCover(mediaId);
      if (action === 'delete-media')         this._handleDeleteMedia(mediaId, canDelete);
      if (action === 'move-up')              this._handleReorder(mediaId, -1);
      if (action === 'move-down')            this._handleReorder(mediaId, +1);
      if (action === 'section-rename')       this._handleRenameSection(sectionId);
      if (action === 'section-delete')       this._handleDeleteSection(sectionId, canDelete);
      if (action === 'section-up')           this._handleReorderSection(sectionId, -1);
      if (action === 'section-down')         this._handleReorderSection(sectionId, +1);
      if (action === 'video-move-up')        this._handleReorderVideo(videoId, -1);
      if (action === 'video-move-down')      this._handleReorderVideo(videoId, +1);
      if (action === 'video-delete')         this._handleDeleteVideo(videoId);
      if (action === 'video-section-up')     this._handleSetVideoPosition('above_gallery');
      if (action === 'video-section-down')   this._handleSetVideoPosition('below_gallery');
      if (action === 'video-section-delete') this._handleDeleteVideoSection(canDelete);
    }, { signal });

    // Drag-and-drop reorder for gallery items
    this._attachDragReorder(view);

    // Add media
    const addBtn    = view.querySelector('#pd-add-media-btn');
    const fileInput = view.querySelector('#pd-media-file-input');
    if (addBtn && fileInput) {
      addBtn.addEventListener('click',    () => fileInput.click());
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) this._handleFileUpload(fileInput.files[0], view);
      });
    }

    // Upload target selector — which section new uploads land in
    const uploadTarget = view.querySelector('#pd-upload-target');
    if (uploadTarget) {
      uploadTarget.addEventListener('change', () => {
        this._uploadTargetSec = uploadTarget.value ? Number(uploadTarget.value) : null;
      });
    }

    // Add Section button
    const addSectionBtn = view.querySelector('#pd-add-section-btn');
    if (addSectionBtn) {
      addSectionBtn.addEventListener('click', () => this._handleAddSection());
    }

    // Section description textareas — persist on blur (and update in-memory state)
    view.querySelectorAll('[data-section-desc-id]').forEach(ta => {
      ta.addEventListener('blur', () => {
        const id = Number(ta.dataset.sectionDescId);
        const current = this._sections.find(s => s.id === id);
        if (!current) return;
        const newDesc = ta.value;
        if ((current.description || '') === newDesc) return; // no change
        this._handleUpdateSectionDescription(id, newDesc);
      });
    });

    // Video section: file upload button
    const addVideoFileBtn = view.querySelector('#pd-add-video-file-btn');
    const videoFileInput  = view.querySelector('#pd-video-file-input');
    if (addVideoFileBtn && videoFileInput) {
      addVideoFileBtn.addEventListener('click', () => videoFileInput.click());
      videoFileInput.addEventListener('change', () => {
        if (videoFileInput.files.length) this._handleVideoFileUpload(videoFileInput.files[0], view);
      });
    }

    // Video section: YouTube URL button
    const addYoutubeBtn = view.querySelector('#pd-add-video-youtube-btn');
    if (addYoutubeBtn) {
      addYoutubeBtn.addEventListener('click', () => this._handleAddYouTubeVideo(view));
    }

    // Per-video title inputs — persist on blur
    view.querySelectorAll('[data-video-title-id]').forEach(input => {
      input.addEventListener('blur', () => {
        const id = Number(input.dataset.videoTitleId);
        const current = this._videos.find(v => v.id === id);
        if (!current) return;
        const newTitle = input.value;
        if ((current.title || '') === newTitle) return;
        this._handleUpdateVideoTitle(id, newTitle);
      });
    });
  }

  // ── Save text fields ───────────────────────────────────────────────────────

  async _saveChanges(view) {
    const saveBtn = view.querySelector('#pd-save-btn');
    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving\u2026';

    try {
      const title       = view.querySelector('#pd-edit-title').value.trim();
      const description = view.querySelector('#pd-edit-description').value.trim();
      const category    = view.querySelector('#pd-edit-category').value;
      const year        = parseInt(view.querySelector('#pd-edit-year').value, 10);
      const featured    = view.querySelector('#pd-edit-featured').checked;
      const toolsRaw    = view.querySelector('#pd-edit-tools').value;
      const tools_used  = toolsRaw.split(',').map(t => t.trim()).filter(Boolean);

      if (!title) {
        this._setStatus(view, 'Title is required', 'error');
        return;
      }
      if (!description) {
        this._setStatus(view, 'Description is required', 'error');
        return;
      }
      if (!year || year < 1900 || year > 2100) {
        this._setStatus(view, 'Year must be between 1900 and 2100', 'error');
        return;
      }

      const updated     = await projectApi.patch(this._project.id, {
        title, description, category, year, featured, tools_used,
      });
      this._project     = updated;
      this._editMode    = false;
      this._renderContent();
    } catch (err) {
      this._setStatus(view, err.message || 'Save failed', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Changes';
      }
    }
  }

  // ── Cover image ────────────────────────────────────────────────────────────

  async _handleSetCover(mediaId) {
    try {
      const updated  = await projectApi.setCover(this._project.id, mediaId);
      this._project  = updated;
      this._renderContent(); // stay in edit mode; hero background updates
    } catch (err) {
      alert('Could not set cover image: ' + err.message);
    }
  }

  // ── Delete media ───────────────────────────────────────────────────────────

  async _handleDeleteMedia(mediaId, canDelete) {
    if (!canDelete) return;
    if (!confirm('Delete this media item? This cannot be undone.')) return;

    try {
      await projectApi.deleteMedia(this._project.id, mediaId);
      this._media = this._media.filter(m => m.id !== mediaId);
      this._renderContent();
    } catch (err) {
      alert('Could not delete media: ' + err.message);
    }
  }

  // ── Reorder media ──────────────────────────────────────────────────────────

  /** Debounced API persist — shared by arrow buttons and drag-and-drop.
   *  Writes both sort_order AND section_id for every item so a single commit
   *  handles cross-section drops + intra-section reorders.  Sort-order values
   *  are numbered per-section starting at 0 in the bucket iteration order. */
  _commitReorder() {
    clearTimeout(this._reorderTimer);
    this._reorderTimer = setTimeout(async () => {
      // Re-number sort_order per section based on current bucket order
      const buckets = this._groupBySection();
      const order = [];
      for (const g of buckets) {
        g.items.forEach((item, i) => {
          order.push({
            id: item.id,
            sort_order: i,
            section_id: item.section_id ?? null,
          });
        });
      }
      if (order.length === 0) return;
      try {
        const reordered = await projectApi.reorderMedia(this._project.id, order);
        this._media = reordered;
      } catch (err) {
        alert('Could not reorder media: ' + err.message);
      }
    }, 500);
  }

  _handleReorder(mediaId, direction) {
    // Move within the item's own section bucket only
    const item = this._media.find(m => m.id === mediaId);
    if (!item) return;
    const secId = item.section_id ?? null;

    // Split into sameSection items and "the rest"
    const buckets = this._groupBySection();
    const bucket = buckets.find(g => (g.section ? g.section.id : null) === secId);
    if (!bucket) return;

    const idxInSection = bucket.items.findIndex(m => m.id === mediaId);
    const target = idxInSection + direction;
    if (target < 0 || target >= bucket.items.length) return;

    // Swap inside bucket
    [bucket.items[idxInSection], bucket.items[target]] =
      [bucket.items[target], bucket.items[idxInSection]];

    // Rebuild _media from buckets so Lightbox order stays in sync
    this._media = buckets.flatMap(g => g.items);
    this._renderContent();
    this._commitReorder();
  }

  // ── Drag-and-drop reorder ─────────────────────────────────────────────────

  _attachDragReorder(view) {
    const grids = view.querySelectorAll('.gallery-grid--edit');
    if (!grids.length) return;

    let dragMediaId = null;

    // Helpers scoped to view
    const clearIndicators = () => {
      view.querySelectorAll('.drag-over, .dragging, .drop-active').forEach(el =>
        el.classList.remove('drag-over', 'dragging', 'drop-active'));
    };
    const parseSecId = (raw) => {
      if (raw === undefined || raw === null || raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };

    grids.forEach(grid => {
      grid.addEventListener('dragstart', e => {
        const item = e.target.closest('.gallery-grid__item');
        if (!item) return;
        dragMediaId = Number(item.dataset.mediaId);
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Use a transparent 1x1 image so the browser's ghost doesn't obscure the grid
        const ghost = document.createElement('canvas');
        ghost.width = 1; ghost.height = 1;
        e.dataTransfer.setDragImage(ghost, 0, 0);
      });

      grid.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // Clear stale indicators across all grids then highlight this grid
        view.querySelectorAll('.drag-over, .drop-active').forEach(el =>
          el.classList.remove('drag-over', 'drop-active'));
        grid.classList.add('drop-active');

        const overItem = e.target.closest('.gallery-grid__item');
        if (overItem && Number(overItem.dataset.mediaId) !== dragMediaId) {
          overItem.classList.add('drag-over');
        }
      });

      grid.addEventListener('dragleave', e => {
        // Only clear highlights if we've actually left the grid (not between children)
        if (!grid.contains(e.relatedTarget)) {
          grid.classList.remove('drop-active');
          grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
      });

      grid.addEventListener('drop', e => {
        e.preventDefault();
        if (dragMediaId === null) return;

        const fromIdx = this._media.findIndex(m => m.id === dragMediaId);
        if (fromIdx === -1) { clearIndicators(); dragMediaId = null; return; }

        const targetSecId = parseSecId(grid.dataset.sectionId);
        const overItem    = e.target.closest('.gallery-grid__item');

        // Remove dragged item from its current position
        const arr = [...this._media];
        const [moved] = arr.splice(fromIdx, 1);
        moved.section_id = targetSecId;

        // Insertion index: before overItem if dropped on a thumbnail,
        // else append at end of target section bucket.
        let insertAt;
        if (overItem && Number(overItem.dataset.mediaId) !== dragMediaId) {
          insertAt = arr.findIndex(m => m.id === Number(overItem.dataset.mediaId));
          if (insertAt === -1) insertAt = arr.length;
        } else {
          // Find last index of target section bucket; append after it.
          let lastIdx = -1;
          for (let i = 0; i < arr.length; i++) {
            if ((arr[i].section_id ?? null) === targetSecId) lastIdx = i;
          }
          insertAt = lastIdx + 1;
          // If target section has no items yet, splice at first position
          // *after* all items of earlier sections. _flatInGroupOrder will fix
          // ordering on the next render anyway.
          if (lastIdx === -1) insertAt = arr.length;
        }

        arr.splice(insertAt, 0, moved);
        this._media = arr;
        clearIndicators();
        dragMediaId = null;
        this._renderContent();
        this._commitReorder();
      });

      grid.addEventListener('dragend', () => {
        clearIndicators();
        dragMediaId = null;
      });
    });
  }

  // ── Section CRUD ───────────────────────────────────────────────────────────

  async _handleAddSection() {
    const name = prompt('Section name (e.g. Kitchen, Living Room):');
    if (!name || !name.trim()) return;
    try {
      const created = await projectApi.createSection(this._project.id, name.trim());
      this._sections = [...this._sections, created];
      this._renderContent();
    } catch (err) {
      alert('Could not create section: ' + err.message);
    }
  }

  async _handleRenameSection(sectionId) {
    const current = this._sections.find(s => s.id === sectionId);
    if (!current) return;
    const name = prompt('Rename section:', current.name);
    if (!name || !name.trim() || name.trim() === current.name) return;
    try {
      const updated = await projectApi.updateSection(this._project.id, sectionId, { name: name.trim() });
      this._sections = this._sections.map(s => s.id === sectionId ? updated : s);
      this._renderContent();
    } catch (err) {
      alert('Could not rename section: ' + err.message);
    }
  }

  async _handleUpdateSectionDescription(sectionId, description) {
    try {
      const updated = await projectApi.updateSection(this._project.id, sectionId, { description });
      // Update state in place without a full re-render — the textarea is already in sync
      this._sections = this._sections.map(s => s.id === sectionId ? updated : s);
    } catch (err) {
      alert('Could not save section description: ' + err.message);
    }
  }

  async _handleDeleteSection(sectionId, canDelete) {
    if (!canDelete) return;
    const current = this._sections.find(s => s.id === sectionId);
    if (!current) return;
    const affected = this._media.filter(m => m.section_id === sectionId).length;
    const msg = affected === 0
      ? `Delete section "${current.name}"?`
      : `Delete section "${current.name}"? ${affected} photo(s) will move back to Ungrouped.`;
    if (!confirm(msg)) return;
    try {
      await projectApi.deleteSection(this._project.id, sectionId);
      this._sections = this._sections.filter(s => s.id !== sectionId);
      // Reflect FK ON DELETE SET NULL locally so the UI updates immediately
      this._media = this._media.map(m =>
        m.section_id === sectionId ? { ...m, section_id: null } : m
      );
      this._renderContent();
    } catch (err) {
      alert('Could not delete section: ' + err.message);
    }
  }

  async _handleReorderSection(sectionId, direction) {
    const idx = this._sections.findIndex(s => s.id === sectionId);
    if (idx === -1) return;
    const target = idx + direction;
    if (target < 0 || target >= this._sections.length) return;

    const arr = [...this._sections];
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    this._sections = arr.map((s, i) => ({ ...s, sort_order: i }));
    this._renderContent();

    try {
      const payload = this._sections.map((s, i) => ({ id: s.id, sort_order: i }));
      const updated = await projectApi.reorderSections(this._project.id, payload);
      this._sections = updated;
    } catch (err) {
      alert('Could not reorder sections: ' + err.message);
    }
  }

  // ── Video section handlers ─────────────────────────────────────────────────

  async _handleSetVideoPosition(position) {
    // Binary toggle — no-op if already in the requested position
    if ((this._project.video_section_position || 'above_gallery') === position) return;
    try {
      const updated = await projectApi.setVideoSectionPosition(this._project.id, position);
      this._project = updated;
      this._renderContent();
    } catch (err) {
      alert('Could not move video section: ' + err.message);
    }
  }

  async _handleDeleteVideoSection(canDelete) {
    if (!canDelete) return;
    if (!this._videos.length) return;
    if (!confirm(`Delete the entire Video section? ${this._videos.length} video(s) will be removed.`)) return;
    try {
      await projectApi.deleteVideoSection(this._project.id);
      this._videos = [];
      this._renderContent();
    } catch (err) {
      alert('Could not delete video section: ' + err.message);
    }
  }

  _handleReorderVideo(videoId, direction) {
    const idx = this._videos.findIndex(v => v.id === videoId);
    if (idx === -1) return;
    const target = idx + direction;
    if (target < 0 || target >= this._videos.length) return;

    const arr = [...this._videos];
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    this._videos = arr;
    this._renderContent();
    this._commitVideoReorder();
  }

  _commitVideoReorder() {
    clearTimeout(this._videoReorderTimer);
    this._videoReorderTimer = setTimeout(async () => {
      const order = this._videos.map((v, i) => ({ id: v.id, sort_order: i }));
      if (order.length === 0) return;
      try {
        const updated = await projectApi.reorderVideos(this._project.id, order);
        this._videos = updated;
      } catch (err) {
        alert('Could not reorder videos: ' + err.message);
      }
    }, 400);
  }

  async _handleDeleteVideo(videoId) {
    if (!confirm('Delete this video?')) return;
    try {
      await projectApi.deleteVideo(this._project.id, videoId);
      this._videos = this._videos.filter(v => v.id !== videoId);
      this._renderContent();
    } catch (err) {
      alert('Could not delete video: ' + err.message);
    }
  }

  async _handleUpdateVideoTitle(videoId, title) {
    try {
      const updated = await projectApi.updateVideo(this._project.id, videoId, { title });
      this._videos = this._videos.map(v => v.id === videoId ? updated : v);
    } catch (err) {
      alert('Could not save video title: ' + err.message);
    }
  }

  async _handleVideoFileUpload(file, view) {
    const ALLOWED = ['video/mp4', 'video/webm'];
    if (!ALLOWED.includes(file.type)) {
      this._setVideoStatus(view, 'Only mp4 / webm videos are allowed', 'error');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      this._setVideoStatus(view, 'File too large (max 50 MB)', 'error');
      return;
    }
    const fileInput = view.querySelector('#pd-video-file-input');
    const addBtn    = view.querySelector('#pd-add-video-file-btn');
    if (addBtn) addBtn.disabled = true;
    this._setVideoStatus(view, 'Uploading video…', '');

    const formData = new FormData();
    formData.append('file', file);
    try {
      const row = await projectApi.addVideo(this._project.id, formData);
      this._videos = [...this._videos, row];
      this._setVideoStatus(view, 'Uploaded', 'ok');
      this._renderContent();
    } catch (err) {
      this._setVideoStatus(view, err.message || 'Upload failed', 'error');
    } finally {
      if (addBtn)    addBtn.disabled = false;
      if (fileInput) fileInput.value = '';
    }
  }

  async _handleAddYouTubeVideo(view) {
    const url = prompt('Paste a YouTube URL (watch, shorts, youtu.be, or embed):');
    if (!url || !url.trim()) return;
    this._setVideoStatus(view, 'Adding YouTube video…', '');
    try {
      const row = await projectApi.addVideo(this._project.id, { url: url.trim() });
      this._videos = [...this._videos, row];
      this._setVideoStatus(view, 'Added', 'ok');
      this._renderContent();
    } catch (err) {
      this._setVideoStatus(view, err.message || 'Could not add YouTube video', 'error');
    }
  }

  _setVideoStatus(view, message, type) {
    const el = view.querySelector('#pd-video-upload-status');
    if (!el) return;
    el.textContent = message;
    el.className   = `pd-upload-status${type ? ` pd-upload-status--${type}` : ''}`;
  }

  // ── File upload ────────────────────────────────────────────────────────────

  async _handleFileUpload(file, view) {
    const addBtn    = view.querySelector('#pd-add-media-btn');
    const fileInput = view.querySelector('#pd-media-file-input');

    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];
    if (!ALLOWED.includes(file.type)) {
      this._setStatus(view, 'Only jpg/png/webp images and mp4/webm videos are allowed', 'error');
      return;
    }
    const isImage = file.type.startsWith('image/');
    const maxBytes = isImage ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
    if (file.size > maxBytes) {
      this._setStatus(view, `File too large (max ${isImage ? '10 MB' : '50 MB'})`, 'error');
      return;
    }

    if (addBtn) addBtn.disabled = true;
    this._setStatus(view, 'Uploading\u2026', '');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('sort_order', String(this._media.length));
    if (this._uploadTargetSec !== null && this._uploadTargetSec !== undefined) {
      formData.append('section_id', String(this._uploadTargetSec));
    }

    try {
      const newItem = await projectApi.addMedia(this._project.id, formData);
      this._media   = [...this._media, newItem];
      this._setStatus(view, 'Uploaded successfully', 'ok');
      this._renderContent();
    } catch (err) {
      this._setStatus(view, err.message || 'Upload failed', 'error');
    } finally {
      if (addBtn)    addBtn.disabled = false;
      if (fileInput) fileInput.value = '';
    }
  }

  _setStatus(view, message, type) {
    const el = view.querySelector('#pd-upload-status');
    if (!el) return;
    el.textContent = message;
    el.className   = `pd-upload-status${type ? ` pd-upload-status--${type}` : ''}`;
  }

  // Called by the router when navigating away, to clean up event listeners
  destroy() {
    if (this._onAuthChange) {
      window.removeEventListener('authchange', this._onAuthChange);
      this._onAuthChange = null;
    }
    if (this._actionsAbort) {
      this._actionsAbort.abort();
      this._actionsAbort = null;
    }
    if (this._lb) {
      this._lb.destroy();
      this._lb = null;
    }
  }
}
