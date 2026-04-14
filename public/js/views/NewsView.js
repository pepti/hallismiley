// NewsView — Full news listing page
// Route: #/news
// Shows all published articles in a grid with pagination and category filter.

import { getUser }        from '../services/auth.js';
import { getCsrfHeaders } from '../utils/api.js';
import { getCSRFToken }   from '../services/auth.js';

const PAGE_SIZE = 9;

// Known categories — expanded dynamically from API results
const CATEGORY_LABELS = {
  news:         'News',
  announcement: 'Announcement',
  carpentry:    'Carpentry',
  tech:         'Tech',
};

function _esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function _catClass(cat) {
  return ['carpentry', 'tech', 'announcement'].includes(cat) ? cat : 'news';
}

export class NewsView {
  constructor() {
    this._articles  = [];
    this._total     = 0;
    this._offset    = 0;
    this._category  = '';
    this._loading   = false;
    this._view      = null;
    this._categories = [];
  }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view news-page';

    this._view.innerHTML = `
      <div class="news-page__inner">
        <header class="news-page__header">
          <p class="news-page__eyebrow">Latest from</p>
          <h1 class="news-page__title">Halli's Workshop</h1>
          <p class="news-page__sub">Write-ups on carpentry projects, tech builds, and whatever else is on the bench.</p>
        </header>

        <div class="news-page__controls">
          <div class="news-page__filters" id="news-filters" role="group" aria-label="Filter by category">
            <button class="news-filter-btn active" data-cat="" aria-pressed="true">All</button>
          </div>
          ${this._adminNewBtn()}
        </div>

        <div class="news-page__grid" id="news-grid" aria-live="polite">
          <div class="news-page__loading">Loading articles…</div>
        </div>

        <div class="news-page__pagination" id="news-pagination"></div>
      </div>
    `;

    await this._loadArticles();
    this._bindFilters();
    return this._view;
  }

  _adminNewBtn() {
    const user = getUser();
    if (!user || !['admin', 'moderator'].includes(user.role)) return '';
    return `
      <button class="news-admin-btn news-admin-btn--new" id="news-new-btn">
        + New Article
      </button>`;
  }

  async _loadArticles() {
    this._loading = true;
    this._setGridLoading(true);

    try {
      const params = new URLSearchParams({
        limit:  PAGE_SIZE,
        offset: this._offset,
      });
      if (this._category) params.set('category', this._category);

      const res = await fetch(`/api/v1/news?${params}`);
      if (!res.ok) throw new Error('Failed to load articles');
      const data = await res.json();

      this._articles = data.articles || [];
      this._total    = data.total    || 0;

      // Collect unique categories from loaded articles
      this._articles.forEach(a => {
        if (a.category && !this._categories.includes(a.category)) {
          this._categories.push(a.category);
        }
      });
      this._renderFilterBar();
      this._renderGrid();
      this._renderPagination();
    } catch (err) {
      const grid = this._view.querySelector('#news-grid');
      if (grid) grid.innerHTML = `<p class="news-page__error">Could not load articles — try refreshing.</p>`;
    } finally {
      this._loading = false;
    }
  }

  _setGridLoading(on) {
    const grid = this._view?.querySelector('#news-grid');
    if (!grid) return;
    if (on) grid.innerHTML = '<div class="news-page__loading">Loading…</div>';
  }

  _renderFilterBar() {
    const bar = this._view?.querySelector('#news-filters');
    if (!bar || this._categories.length <= 1) return;

    // Keep "All" button, add one per category
    bar.innerHTML = `
      <button class="news-filter-btn${!this._category ? ' active' : ''}" data-cat="" aria-pressed="${!this._category}">All</button>
      ${this._categories.map(cat => `
        <button class="news-filter-btn${this._category === cat ? ' active' : ''}"
                data-cat="${_esc(cat)}"
                aria-pressed="${this._category === cat}">
          ${_esc(CATEGORY_LABELS[cat] || cat)}
        </button>`).join('')}
    `;
    this._bindFilters();
  }

  _renderGrid() {
    const grid = this._view?.querySelector('#news-grid');
    if (!grid) return;

    if (this._articles.length === 0) {
      grid.innerHTML = '<p class="news-page__empty">No articles in this category yet.</p>';
      return;
    }

    grid.innerHTML = this._articles.map(a => {
      const dateStr  = _formatDate(a.published_at || a.created_at);
      const catClass = _catClass(a.category);
      const imgHtml  = a.cover_image
        ? `<img class="news-card__img" src="${_esc(a.cover_image)}" alt="${_esc(a.title)}" loading="lazy" width="800" height="450">`
        : `<div class="news-card__img news-card__img--placeholder news-card__img--${catClass}" aria-hidden="true"></div>`;

      return `
        <a href="#/news/${_esc(a.slug)}" class="news-card">
          ${imgHtml}
          <div class="news-card__body">
            <div class="news-card__meta">
              <span class="news-card__badge news-card__badge--${catClass}">${_esc(a.category.toUpperCase())}</span>
              <time class="news-card__date" datetime="${_esc(a.published_at || a.created_at)}">${dateStr}</time>
            </div>
            <h2 class="news-card__title">${_esc(a.title)}</h2>
            <p class="news-card__summary">${_esc(a.summary)}</p>
            ${a.author_display_name || a.author_username ? `
            <div class="news-card__author">
              <span class="news-card__author-name">${_esc(a.author_display_name || a.author_username)}</span>
            </div>` : ''}
          </div>
        </a>`;
    }).join('');
  }

  _renderPagination() {
    const pag = this._view?.querySelector('#news-pagination');
    if (!pag) return;

    const hasMore = this._offset + this._articles.length < this._total;
    const hasBack = this._offset > 0;

    if (!hasMore && !hasBack) {
      pag.innerHTML = '';
      return;
    }

    pag.innerHTML = `
      ${hasBack ? `<button class="news-pag-btn" id="news-prev">← Previous</button>` : ''}
      <span class="news-pag-info">${this._offset + 1}–${Math.min(this._offset + this._articles.length, this._total)} of ${this._total}</span>
      ${hasMore ? `<button class="news-pag-btn news-pag-btn--primary" id="news-next">Next →</button>` : ''}
    `;

    pag.querySelector('#news-prev')?.addEventListener('click', () => {
      this._offset = Math.max(0, this._offset - PAGE_SIZE);
      this._loadArticles();
    });
    pag.querySelector('#news-next')?.addEventListener('click', () => {
      this._offset += PAGE_SIZE;
      this._loadArticles();
    });
  }

  _bindFilters() {
    const bar = this._view?.querySelector('#news-filters');
    if (!bar) return;

    bar.querySelectorAll('.news-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._category = btn.dataset.cat;
        this._offset   = 0;
        bar.querySelectorAll('.news-filter-btn').forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        this._loadArticles();
      });
    });

    // Admin "New Article" button → show inline editor
    const newBtn = this._view?.querySelector('#news-new-btn');
    if (newBtn) {
      newBtn.addEventListener('click', () => this._showEditor(null));
    }
  }

  // ── Inline article editor (create / edit) ────────────────────────────
  _showEditor(article) {
    const existing = this._view.querySelector('#news-editor-overlay');
    if (existing) existing.remove();

    this._editorMedia   = [];
    this._editorArticle = article || null;

    const isNew    = !article;
    const overlay  = document.createElement('div');
    overlay.id     = 'news-editor-overlay';
    overlay.className = 'news-editor-overlay';
    overlay.innerHTML = `
      <div class="news-editor" role="dialog" aria-modal="true" aria-label="${isNew ? 'New Article' : 'Edit Article'}">
        <div class="news-editor__header">
          <h2 class="news-editor__title">${isNew ? 'New Article' : 'Edit Article'}</h2>
          <button class="news-editor__close" aria-label="Close editor">✕</button>
        </div>
        <form class="news-editor__form" id="news-editor-form" novalidate>
          <label class="news-editor__label">Title *
            <input class="news-editor__input" name="title" type="text" required maxlength="200"
                   value="${_esc(article?.title || '')}" placeholder="Article title">
          </label>
          <div class="news-editor__row">
            <label class="news-editor__label">Slug
              <input class="news-editor__input" name="slug" type="text" maxlength="100"
                     value="${_esc(article?.slug || '')}" placeholder="auto-generated-from-title">
            </label>
            <label class="news-editor__label">Category
              <input class="news-editor__input" name="category" type="text" maxlength="50"
                     value="${_esc(article?.category || 'news')}" placeholder="news">
            </label>
          </div>
          <label class="news-editor__label">Summary * <small>(max 300 chars)</small>
            <textarea class="news-editor__textarea news-editor__textarea--sm" name="summary"
                      required maxlength="300" rows="3"
                      placeholder="Short summary shown in cards…">${_esc(article?.summary || '')}</textarea>
          </label>
          <label class="news-editor__label">Body * <small>(HTML supported: p, h2, h3, strong, em, a, ul, ol, li, blockquote)</small>
            <textarea class="news-editor__textarea news-editor__textarea--lg" name="body"
                      required rows="16"
                      placeholder="<p>Full article content…</p>">${_esc(article?.body || '')}</textarea>
          </label>
          <label class="news-editor__label">Cover Image URL
            <input class="news-editor__input" name="cover_image" type="text"
                   value="${_esc(article?.cover_image || '')}" placeholder="https:// or /assets/…">
          </label>
          <div class="news-editor__row news-editor__row--check">
            <label class="news-editor__check">
              <input type="checkbox" name="published" ${article?.published ? 'checked' : ''}>
              Published
            </label>
          </div>

          <!-- Media Section — shown after article is created -->
          <div class="news-editor__media-section" id="editor-media-section" style="display:none">
            <h3 class="news-editor__media-heading">Media</h3>
            <div class="news-editor__media-actions">
              <label class="news-editor__media-btn">
                + Add Image
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden
                       id="media-upload-image">
              </label>
              <label class="news-editor__media-btn">
                + Add Video
                <input type="file" accept="video/mp4,video/webm" hidden
                       id="media-upload-video">
              </label>
              <button type="button" class="news-editor__media-btn" id="media-add-youtube">
                + YouTube
              </button>
            </div>
            <div class="news-editor__media-status" id="media-status" aria-live="polite"></div>
            <div class="news-editor__media-grid" id="media-grid">
              <p class="news-editor__media-empty">No media added yet.</p>
            </div>
          </div>

          <div class="news-editor__status" id="editor-status" aria-live="polite"></div>
          <div class="news-editor__actions">
            <button type="button" class="news-editor__btn news-editor__btn--cancel" id="editor-cancel-btn">Cancel</button>
            <button type="submit" class="news-editor__btn news-editor__btn--save" id="editor-save-btn">
              ${isNew ? 'Create Article' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    `;

    this._view.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const close = () => {
      overlay.remove();
      document.body.style.overflow = '';
      this._offset = 0;
      this._loadArticles();
    };

    overlay.querySelector('.news-editor__close').addEventListener('click', close);
    overlay.querySelector('#editor-cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const form = overlay.querySelector('#news-editor-form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      await this._submitEditor(form, overlay, article?.id, isNew);
    });

    overlay.querySelector('[name="title"]').focus();
  }

  async _submitEditor(form, overlay, articleId, isNew) {
    const status  = overlay.querySelector('#editor-status');
    const saveBtn = form.querySelector('#editor-save-btn');

    const title       = form.querySelector('[name="title"]').value.trim();
    const slug        = form.querySelector('[name="slug"]').value.trim();
    const category    = form.querySelector('[name="category"]').value.trim() || 'news';
    const summary     = form.querySelector('[name="summary"]').value.trim();
    const body        = form.querySelector('[name="body"]').value.trim();
    const cover_image = form.querySelector('[name="cover_image"]').value.trim() || null;
    const published   = form.querySelector('[name="published"]').checked;

    status.textContent = '';
    status.className   = 'news-editor__status';
    saveBtn.disabled   = true;
    saveBtn.textContent = 'Saving…';

    try {
      const headers = await getCsrfHeaders();
      const payload = { title, summary, body, cover_image, category, published };
      if (slug) payload.slug = slug;

      const url    = isNew ? '/api/v1/news' : `/api/v1/news/${articleId}`;
      const method = isNew ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method, credentials: 'include', headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Save failed');
      }

      const saved = await res.json();

      if (isNew) {
        // Article created — reveal media section so user can upload images/videos
        this._editorArticle = saved;
        overlay.querySelector('.news-editor__title').textContent = 'Edit Article';
        saveBtn.textContent = 'Save Changes';

        // Show media section
        const mediaSection = overlay.querySelector('#editor-media-section');
        mediaSection.style.display = '';

        // Bind media upload handlers
        this._bindMediaUploads(overlay);

        // Update status to confirm creation
        status.className   = 'news-editor__status news-editor__status--ok';
        status.textContent = 'Article created! You can now add images and videos below.';
        setTimeout(() => {
          if (status.classList.contains('news-editor__status--ok')) {
            status.textContent = '';
            status.className = 'news-editor__status';
          }
        }, 4000);
      } else {
        overlay.remove();
        document.body.style.overflow = '';
        this._offset = 0;
        await this._loadArticles();
      }
    } catch (err) {
      status.className   = 'news-editor__status news-editor__status--error';
      status.textContent = err.message;
    } finally {
      saveBtn.disabled    = false;
      if (saveBtn.textContent === 'Saving…') {
        saveBtn.textContent = isNew ? 'Create Article' : 'Save Changes';
      }
    }
  }

  // ── Media upload helpers (mirrors ArticleView pattern) ──────────────
  _bindMediaUploads(overlay) {
    const imageInput = overlay.querySelector('#media-upload-image');
    if (imageInput) {
      imageInput.addEventListener('change', () => {
        if (imageInput.files[0]) this._uploadMediaFile(overlay, imageInput.files[0]);
        imageInput.value = '';
      });
    }

    const videoInput = overlay.querySelector('#media-upload-video');
    if (videoInput) {
      videoInput.addEventListener('change', () => {
        if (videoInput.files[0]) this._uploadMediaFile(overlay, videoInput.files[0]);
        videoInput.value = '';
      });
    }

    const ytBtn = overlay.querySelector('#media-add-youtube');
    if (ytBtn) {
      ytBtn.addEventListener('click', () => this._addYouTube(overlay));
    }

    this._bindMediaItemActions(overlay);
  }

  async _uploadMediaFile(overlay, file) {
    this._showMediaStatus(overlay, 'Uploading…');
    try {
      const token = await getCSRFToken();
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch(`/api/v1/news/${this._editorArticle.id}/media`, {
        method: 'POST', credentials: 'include',
        headers: { ...(token ? { 'X-CSRF-Token': token } : {}) },
        body: fd,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Upload failed');
      }

      const item = await res.json();
      this._editorMedia.push(item);
      this._refreshMediaGrid(overlay);
      this._showMediaStatus(overlay, 'Uploaded!');
    } catch (err) {
      this._showMediaStatus(overlay, err.message, true);
    }
  }

  async _addYouTube(overlay) {
    const url = prompt('YouTube URL:');
    if (!url || !url.trim()) return;

    this._showMediaStatus(overlay, 'Adding…');
    try {
      const headers = await getCsrfHeaders();
      const res = await fetch(`/api/v1/news/${this._editorArticle.id}/media/youtube`, {
        method: 'POST', credentials: 'include', headers,
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add YouTube video');
      }

      const item = await res.json();
      this._editorMedia.push(item);
      this._refreshMediaGrid(overlay);
      this._showMediaStatus(overlay, 'Added!');
    } catch (err) {
      this._showMediaStatus(overlay, err.message, true);
    }
  }

  _showMediaStatus(overlay, msg, isError = false) {
    const el = overlay.querySelector('#media-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `news-editor__media-status${isError ? ' news-editor__media-status--error' : ' news-editor__media-status--ok'}`;
    setTimeout(() => { el.textContent = ''; el.className = 'news-editor__media-status'; }, 3000);
  }

  _renderEditorMediaGrid() {
    if (!this._editorMedia.length) {
      return '<p class="news-editor__media-empty">No media added yet.</p>';
    }

    return this._editorMedia.map(m => {
      let preview;
      if (m.kind === 'youtube') {
        preview = `<div class="news-editor__media-thumb news-editor__media-thumb--yt">
          <img src="https://img.youtube.com/vi/${_esc(m.youtube_id)}/mqdefault.jpg"
               alt="YouTube" loading="lazy">
          <span class="news-editor__media-yt-badge">YT</span>
        </div>`;
      } else if (m.kind === 'video_file') {
        preview = `<div class="news-editor__media-thumb news-editor__media-thumb--vid">
          <video src="${_esc(m.file_path)}" preload="metadata" muted></video>
          <span class="news-editor__media-vid-badge">VID</span>
        </div>`;
      } else {
        preview = `<div class="news-editor__media-thumb">
          <img src="${_esc(m.file_path)}" alt="${_esc(m.caption || '')}" loading="lazy">
        </div>`;
      }

      return `
        <div class="news-editor__media-item" data-media-id="${m.id}">
          ${preview}
          <div class="news-editor__media-item-controls">
            <input type="text" class="news-editor__media-caption" placeholder="Caption…"
                   value="${_esc(m.caption || '')}" data-media-id="${m.id}">
            <button type="button" class="news-editor__media-delete" data-media-id="${m.id}"
                    aria-label="Delete media">✕</button>
          </div>
        </div>`;
    }).join('');
  }

  _refreshMediaGrid(overlay) {
    const grid = overlay.querySelector('#media-grid');
    if (grid) {
      grid.innerHTML = this._renderEditorMediaGrid();
      this._bindMediaItemActions(overlay);
    }
  }

  _bindMediaItemActions(overlay) {
    overlay.querySelectorAll('.news-editor__media-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mediaId = btn.dataset.mediaId;
        if (!confirm('Delete this media item?')) return;
        try {
          const token = await getCSRFToken();
          const res = await fetch(`/api/v1/news/${this._editorArticle.id}/media/${mediaId}`, {
            method: 'DELETE', credentials: 'include',
            headers: { ...(token ? { 'X-CSRF-Token': token } : {}) },
          });
          if (!res.ok) throw new Error('Delete failed');
          this._editorMedia = this._editorMedia.filter(m => m.id !== Number(mediaId));
          this._refreshMediaGrid(overlay);
        } catch (err) {
          this._showMediaStatus(overlay, err.message, true);
        }
      });
    });

    overlay.querySelectorAll('.news-editor__media-caption').forEach(input => {
      input.addEventListener('change', async () => {
        const mediaId = input.dataset.mediaId;
        const caption = input.value.trim();
        try {
          const headers = await getCsrfHeaders();
          await fetch(`/api/v1/news/${this._editorArticle.id}/media/${mediaId}`, {
            method: 'PATCH', credentials: 'include', headers,
            body: JSON.stringify({ caption }),
          });
          const m = this._editorMedia.find(m => m.id === Number(mediaId));
          if (m) m.caption = caption;
        } catch { /* silent */ }
      });
    });
  }
}
