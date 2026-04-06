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
    this.id             = id;
    this._lb            = null;
    this._media         = [];
    this._project       = null;
    this._editMode      = false;
    this._view          = null;
    this._onAuthChange  = null;
    this._actionsAbort  = null; // aborted on each re-render to avoid stacking listeners
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
      const [project, media] = await Promise.all([
        projectApi.getOne(this.id),
        projectApi.getMedia(this.id).catch(() => []),
      ]);
      if (!project) throw new Error('Not found');

      this._project = project;
      this._media   = media || [];
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

  _buildPage(p, canEdit) {
    const heroImg  = p.image_url || CATEGORY_HERO[p.category] || CATEGORY_HERO.tech;
    const hasMedia = this._media.length > 0;

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

          ${hasMedia ? `
          <section class="pd-section pd-gallery-section" aria-label="Project gallery">
            <h2 class="pd-section__heading">Project Gallery</h2>
            <div class="gallery-grid" role="list">
              ${this._media.map((item, i) => this._buildGridItem(item, i)).join('')}
            </div>
          </section>` : ''}

          <div class="pd-back-wrap">
            <a href="#/projects" class="pd-back-btn">&#x2190; Back to All Projects</a>
          </div>

        </div>
      </div>
    `;
  }

  _buildEditPage(p, canDelete) {
    const heroImg = p.image_url || CATEGORY_HERO[p.category] || CATEGORY_HERO.tech;

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

          <section class="pd-section pd-gallery-section" aria-label="Project gallery">
            <h2 class="pd-section__heading">Project Gallery</h2>
            <div class="gallery-grid gallery-grid--edit" id="pd-edit-gallery" role="list">
              ${this._media.map((item, i) => this._buildEditGridItem(item, i, canDelete)).join('')}
            </div>
            <div class="pd-add-media-wrap">
              <button class="pd-add-media-btn" type="button" id="pd-add-media-btn">
                + Add Image / Video
              </button>
              <input type="file" id="pd-media-file-input"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                style="display:none">
            </div>
            <p class="pd-upload-status" id="pd-upload-status"></p>
          </section>

          <div class="pd-back-wrap">
            <a href="#/projects" class="pd-back-btn">&#x2190; Back to All Projects</a>
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

  _buildEditGridItem(item, index, canDelete) {
    const isVideo = item.media_type === 'video';
    const total   = this._media.length;

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
        draggable="true"
        tabindex="0"
      >
        ${thumb}

        <div class="gallery-grid__reorder">
          <button class="gallery-btn gallery-btn--order" type="button"
            data-action="move-up" data-media-id="${item.id}"
            ${index === 0 ? 'disabled' : ''} aria-label="Move up">&#x25B2;</button>
          <button class="gallery-btn gallery-btn--order" type="button"
            data-action="move-down" data-media-id="${item.id}"
            ${index === total - 1 ? 'disabled' : ''} aria-label="Move down">&#x25BC;</button>
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
      const action  = btn.dataset.action;
      const mediaId = Number(btn.dataset.mediaId);
      if (action === 'set-cover')    this._handleSetCover(mediaId);
      if (action === 'delete-media') this._handleDeleteMedia(mediaId, canDelete);
      if (action === 'move-up')      this._handleReorder(mediaId, -1);
      if (action === 'move-down')    this._handleReorder(mediaId, +1);
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

  /** Debounced API persist — shared by arrow buttons and drag-and-drop */
  _commitReorder() {
    clearTimeout(this._reorderTimer);
    this._reorderTimer = setTimeout(async () => {
      const order = this._media.map((item, i) => ({ id: item.id, sort_order: i }));
      try {
        const reordered = await projectApi.reorderMedia(this._project.id, order);
        this._media = reordered;
      } catch (err) {
        alert('Could not reorder media: ' + err.message);
      }
    }, 500);
  }

  _handleReorder(mediaId, direction) {
    const idx = this._media.findIndex(m => m.id === mediaId);
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= this._media.length) return;

    const arr = [...this._media];
    [arr[idx], arr[targetIdx]] = [arr[targetIdx], arr[idx]];
    this._media = arr.map((item, i) => ({ ...item, sort_order: i }));
    this._renderContent();
    this._commitReorder();
  }

  // ── Drag-and-drop reorder ─────────────────────────────────────────────────

  _attachDragReorder(view) {
    const grid = view.querySelector('.gallery-grid--edit');
    if (!grid) return;

    let dragMediaId = null;

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

      const target = e.target.closest('.gallery-grid__item');
      // Clear previous drag-over indicators
      grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      if (target && Number(target.dataset.mediaId) !== dragMediaId) {
        target.classList.add('drag-over');
      }
    });

    grid.addEventListener('dragleave', e => {
      const target = e.target.closest('.gallery-grid__item');
      if (target) target.classList.remove('drag-over');
    });

    grid.addEventListener('drop', e => {
      e.preventDefault();
      grid.querySelectorAll('.drag-over, .dragging').forEach(el =>
        el.classList.remove('drag-over', 'dragging'));

      const target = e.target.closest('.gallery-grid__item');
      if (!target) return;
      const dropMediaId = Number(target.dataset.mediaId);
      if (dropMediaId === dragMediaId) return;

      const fromIdx = this._media.findIndex(m => m.id === dragMediaId);
      const toIdx   = this._media.findIndex(m => m.id === dropMediaId);
      if (fromIdx === -1 || toIdx === -1) return;

      // Move the dragged item to the drop position
      const arr = [...this._media];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      this._media = arr.map((item, i) => ({ ...item, sort_order: i }));
      this._renderContent();
      this._commitReorder();
    });

    grid.addEventListener('dragend', () => {
      grid.querySelectorAll('.drag-over, .dragging').forEach(el =>
        el.classList.remove('drag-over', 'dragging'));
      dragMediaId = null;
    });
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
