// NewsView — Full news listing page
// Route: #/news
// Shows all published articles in a grid with pagination and category filter.

import { getUser }        from '../services/auth.js';
import { getCsrfHeaders } from '../utils/api.js';
import { getCSRFToken }   from '../services/auth.js';
import { t, href }        from '../i18n/i18n.js';

const PAGE_SIZE = 9;

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
          <p class="news-page__eyebrow">${t('news.eyebrow')}</p>
          <h1 class="news-page__title">${t('news.headline')}</h1>
          <p class="news-page__sub">${t('news.subtitle')}</p>
        </header>

        <div class="news-page__controls">
          <div class="news-page__filters" id="news-filters" role="group" aria-label="Filter by category">
            <button class="news-filter-btn active" data-cat="" aria-pressed="true">${t('common.all')}</button>
          </div>
          ${this._adminNewBtn()}
        </div>

        <div class="news-page__grid" id="news-grid" aria-live="polite">
          <div class="news-page__loading">${t('form.loading')}</div>
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
        + ${t('news.newArticle')}
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
      // Pin the request locale — otherwise the server falls back to the
      // preferred_locale cookie which lags the URL by one navigation.
      params.set('locale', window.__locale || 'en');

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
    if (on) grid.innerHTML = `<div class="news-page__loading">${t('form.loading')}</div>`;
  }

  _renderFilterBar() {
    const bar = this._view?.querySelector('#news-filters');
    if (!bar || this._categories.length <= 1) return;

    // Keep "All" button, add one per category
    bar.innerHTML = `
      <button class="news-filter-btn${!this._category ? ' active' : ''}" data-cat="" aria-pressed="${!this._category}">${t('common.all')}</button>
      ${this._categories.map(cat => `
        <button class="news-filter-btn${this._category === cat ? ' active' : ''}"
                data-cat="${_esc(cat)}"
                aria-pressed="${this._category === cat}">
          ${_esc(t('news.category.' + cat) || cat)}
        </button>`).join('')}
    `;
    this._bindFilters();
  }

  _renderGrid() {
    const grid = this._view?.querySelector('#news-grid');
    if (!grid) return;

    if (this._articles.length === 0) {
      grid.innerHTML = `<p class="news-page__empty">${t('news.noArticlesCategory')}</p>`;
      return;
    }

    grid.innerHTML = this._articles.map(a => {
      const dateStr  = _formatDate(a.published_at || a.created_at);
      const catClass = _catClass(a.category);
      const imgHtml  = a.cover_image
        ? `<img class="news-card__img" src="${_esc(a.cover_image)}" alt="${_esc(a.title)}" loading="lazy" width="800" height="450">`
        : `<div class="news-card__img news-card__img--placeholder news-card__img--${catClass}" aria-hidden="true"></div>`;

      return `
        <a href="${href('/news/' + a.slug)}" class="news-card">
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
      ${hasBack ? `<button class="news-pag-btn" id="news-prev">← ${t('form.previous')}</button>` : ''}
      <span class="news-pag-info">${this._offset + 1}–${Math.min(this._offset + this._articles.length, this._total)} ${t('shop.of')} ${this._total}</span>
      ${hasMore ? `<button class="news-pag-btn news-pag-btn--primary" id="news-next">${t('form.next')} →</button>` : ''}
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

    this._editorMedia   = [];       // uploaded media (for existing articles)
    this._pendingMedia  = [];       // files/youtube queued before article exists
    this._editorArticle = article || null;

    const isNew    = !article;
    const overlay  = document.createElement('div');
    overlay.id     = 'news-editor-overlay';
    overlay.className = 'news-editor-overlay';
    overlay.innerHTML = `
      <div class="news-editor" role="dialog" aria-modal="true" aria-label="${isNew ? t('news.newArticle') : t('news.editArticle')}">
        <div class="news-editor__header">
          <h2 class="news-editor__title">${isNew ? t('news.newArticle') : t('news.editArticle')}</h2>
          <button class="news-editor__close" aria-label="${t('article.closeEditorAria')}">✕</button>
        </div>
        <form class="news-editor__form" id="news-editor-form" novalidate>
          <label class="news-editor__label">Title *
            <input class="news-editor__input" name="title" type="text" required maxlength="200"
                   value="${_esc(article?.title || '')}" placeholder="${t('news.titlePlaceholder')}">
          </label>
          <div class="news-editor__row">
            <label class="news-editor__label">Slug
              <input class="news-editor__input" name="slug" type="text" maxlength="100"
                     value="${_esc(article?.slug || '')}" placeholder="${t('news.slugPlaceholder')}">
            </label>
            <label class="news-editor__label">Category
              <input class="news-editor__input" name="category" type="text" maxlength="50"
                     value="${_esc(article?.category || 'news')}" placeholder="${t('news.categoryPlaceholder')}">
            </label>
          </div>
          <label class="news-editor__label">Summary * <small>(max 300 chars)</small>
            <textarea class="news-editor__textarea news-editor__textarea--sm" name="summary"
                      required maxlength="300" rows="3"
                      placeholder="${t('news.summaryPlaceholder')}">${_esc(article?.summary || '')}</textarea>
          </label>
          <label class="news-editor__label">Body * <small>(HTML supported: p, h2, h3, strong, em, a, ul, ol, li, blockquote)</small>
            <textarea class="news-editor__textarea news-editor__textarea--lg" name="body"
                      required rows="16"
                      placeholder="${t('news.bodyPlaceholder')}">${_esc(article?.body || '')}</textarea>
          </label>

          <!-- Icelandic translations — nullable siblings. Left blank ⇒ IS readers
               see the English fallback. See migration 031 and newsController. -->
          <fieldset class="news-editor__translations">
            <legend class="news-editor__translations-legend">${t('admin.translations')} — ${t('admin.icelandicField')}</legend>
            <p class="news-editor__translations-hint">${t('admin.translationsHint')}</p>
            <label class="news-editor__label">Titill
              <input class="news-editor__input" name="title_is" type="text" maxlength="200"
                     value="${_esc(article?.title_is || '')}">
            </label>
            <label class="news-editor__label">Ágrip <small>(max 300 chars)</small>
              <textarea class="news-editor__textarea news-editor__textarea--sm" name="summary_is"
                        maxlength="300" rows="3">${_esc(article?.summary_is || '')}</textarea>
            </label>
            <label class="news-editor__label">Meginmál
              <textarea class="news-editor__textarea news-editor__textarea--lg" name="body_is"
                        rows="12">${_esc(article?.body_is || '')}</textarea>
            </label>
          </fieldset>

          <div class="news-editor__row news-editor__row--check">
            <label class="news-editor__check">
              <input type="checkbox" name="published" ${isNew || article?.published ? 'checked' : ''}>
              Published
            </label>
            <!-- Auto-translate opt-in. Default on — server translates empty
                 *_is fields from their EN counterparts. Untick to save EN
                 only; IS readers fall back to EN via COALESCE. -->
            <label class="news-editor__check">
              <input type="checkbox" name="__autoTranslate" checked>
              ${t('admin.autoTranslate')}
            </label>
          </div>

          <!-- Media Section — always visible; queues for new articles, uploads directly for existing -->
          <div class="news-editor__media-section" id="editor-media-section">
            <h3 class="news-editor__media-heading">Media</h3>
            <div class="news-editor__media-actions">
              <label class="news-editor__media-btn">
                + Add Images
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden multiple
                       id="media-upload-image">
              </label>
              <label class="news-editor__media-btn">
                + Add Videos
                <input type="file" accept="video/mp4,video/webm" hidden multiple
                       id="media-upload-video">
              </label>
              <button type="button" class="news-editor__media-btn" id="media-add-youtube">
                + YouTube
              </button>
            </div>
            <div class="news-editor__media-dropzone" id="media-dropzone">
              Drop images or videos here to upload
            </div>
            <div class="news-editor__media-status" id="media-status" aria-live="polite"></div>
            <div class="news-editor__media-grid" id="media-grid">
              <p class="news-editor__media-empty">No media added yet.</p>
            </div>
          </div>

          <div class="news-editor__status" id="editor-status" aria-live="polite"></div>
          <div class="news-editor__actions">
            <button type="button" class="news-editor__btn news-editor__btn--cancel" id="editor-cancel-btn">${t('admin.cancel')}</button>
            <button type="submit" class="news-editor__btn news-editor__btn--save" id="editor-save-btn">
              ${isNew ? t('news.createArticle') : t('form.saveChanges')}
            </button>
          </div>
        </form>
      </div>
    `;

    this._view.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const close = () => {
      // Revoke pending preview URLs to avoid memory leaks
      (this._pendingMedia || []).forEach(p => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
      this._pendingMedia = [];
      overlay.remove();
      document.body.style.overflow = '';
      this._offset = 0;
      this._loadArticles();
    };

    overlay.querySelector('.news-editor__close').addEventListener('click', close);
    overlay.querySelector('#editor-cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Wire up media controls right away — queuing works even without article ID
    this._bindMediaUploads(overlay);

    const form = overlay.querySelector('#news-editor-form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const current = this._editorArticle;
      await this._submitEditor(form, overlay, current?.id, !current);
    });

    overlay.querySelector('[name="title"]').focus();

    // For existing articles, load already-uploaded media so it shows in the
    // media grid and can be picked as the cover image.
    if (article?.id) this._loadEditorMedia(overlay, article.id);
  }

  async _loadEditorMedia(overlay, articleId) {
    try {
      const res = await fetch(`/api/v1/news/${articleId}/media`, { credentials: 'include' });
      if (!res.ok) return;
      this._editorMedia = await res.json();
      this._refreshMediaGrid(overlay);
    } catch { /* silent — picker just stays empty */ }
  }

  async _submitEditor(form, overlay, articleId, isNew) {
    const status  = overlay.querySelector('#editor-status');
    const saveBtn = form.querySelector('#editor-save-btn');

    const title       = form.querySelector('[name="title"]').value.trim();
    const slug        = form.querySelector('[name="slug"]').value.trim();
    const category    = form.querySelector('[name="category"]').value.trim() || 'news';
    const summary     = form.querySelector('[name="summary"]').value.trim();
    const body        = form.querySelector('[name="body"]').value.trim();
    const published   = form.querySelector('[name="published"]').checked;
    // Icelandic siblings — empty string ⇒ null ⇒ fall back to English.
    const titleIs     = form.querySelector('[name="title_is"]')?.value.trim()   || null;
    const summaryIs   = form.querySelector('[name="summary_is"]')?.value.trim() || null;
    const bodyIs      = form.querySelector('[name="body_is"]')?.value.trim()    || null;
    // Opt-in flag for server-side EN→IS auto-translate; stripped before SQL.
    const autoTranslate = form.querySelector('[name="__autoTranslate"]')?.checked !== false;

    // Basic client-side validation so the user gets feedback on required fields
    if (!title || !summary || !body) {
      status.className   = 'news-editor__status news-editor__status--error';
      status.textContent = 'Title, summary, and body are required.';
      return;
    }

    status.textContent = '';
    status.className   = 'news-editor__status';
    saveBtn.disabled   = true;
    saveBtn.textContent = t('form.saving');

    try {
      const headers = await getCsrfHeaders();
      const payload = {
        title, summary, body, category, published,
        title_is:   titleIs,
        summary_is: summaryIs,
        body_is:    bodyIs,
        __autoTranslate: autoTranslate,
      };
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
      this._editorArticle = saved;

      // If this was a new article and we have queued media, upload it now
      if (isNew && this._pendingMedia.length) {
        saveBtn.textContent = t('form.uploading');
        await this._flushPendingMedia(overlay);
      }

      // Done — close overlay and refresh the news list
      (this._pendingMedia || []).forEach(p => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
      this._pendingMedia = [];
      overlay.remove();
      document.body.style.overflow = '';
      this._offset = 0;
      await this._loadArticles();
    } catch (err) {
      status.className   = 'news-editor__status news-editor__status--error';
      status.textContent = err.message;
    } finally {
      saveBtn.disabled    = false;
      saveBtn.textContent = isNew ? t('news.createArticle') : t('form.saveChanges');
    }
  }

  // Upload all queued media items to the just-created article
  async _flushPendingMedia(overlay) {
    const token = await getCSRFToken();
    const total = this._pendingMedia.length;
    let done = 0;

    for (const p of this._pendingMedia) {
      done++;
      this._showMediaStatus(overlay, `Uploading media ${done} of ${total}…`);
      try {
        if (p.type === 'file') {
          const fd = new FormData();
          fd.append('file', p.file);
          await fetch(`/api/v1/news/${this._editorArticle.id}/media`, {
            method: 'POST', credentials: 'include',
            headers: { ...(token ? { 'X-CSRF-Token': token } : {}) },
            body: fd,
          });
        } else if (p.type === 'youtube') {
          const headers = await getCsrfHeaders();
          await fetch(`/api/v1/news/${this._editorArticle.id}/media/youtube`, {
            method: 'POST', credentials: 'include', headers,
            body: JSON.stringify({ url: p.url }),
          });
        }
      } catch (err) {
        console.error('Pending media upload failed:', err);
      }
    }
  }

  // ── Media upload helpers (mirrors ArticleView pattern) ──────────────
  _bindMediaUploads(overlay) {
    const imageInput = overlay.querySelector('#media-upload-image');
    if (imageInput) {
      imageInput.addEventListener('change', () => {
        if (imageInput.files.length) this._handleFiles(overlay, Array.from(imageInput.files));
        imageInput.value = '';
      });
    }

    const videoInput = overlay.querySelector('#media-upload-video');
    if (videoInput) {
      videoInput.addEventListener('change', () => {
        if (videoInput.files.length) this._handleFiles(overlay, Array.from(videoInput.files));
        videoInput.value = '';
      });
    }

    const ytBtn = overlay.querySelector('#media-add-youtube');
    if (ytBtn) {
      ytBtn.addEventListener('click', () => this._addYouTube(overlay));
    }

    this._bindDropzone(overlay);
    this._bindMediaItemActions(overlay);
  }

  // Route files either to immediate upload (existing article) or queue (new article)
  _handleFiles(overlay, files) {
    if (this._editorArticle?.id) {
      this._uploadMediaFiles(overlay, files);
    } else {
      files.forEach(f => {
        const previewUrl = URL.createObjectURL(f);
        const isVideo = /^video\//.test(f.type);
        this._pendingMedia.push({
          type: 'file',
          file: f,
          isVideo,
          previewUrl,
          name: f.name,
          _id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6),
        });
      });
      this._refreshMediaGrid(overlay);
      this._showMediaStatus(overlay, `${files.length} file${files.length === 1 ? '' : 's'} queued. Will upload after article is created.`);
    }
  }

  _bindDropzone(overlay) {
    const zone = overlay.querySelector('#media-dropzone');
    if (!zone) return;

    const prevent = e => { e.preventDefault(); e.stopPropagation(); };

    ['dragenter', 'dragover'].forEach(ev => {
      zone.addEventListener(ev, e => {
        prevent(e);
        zone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      zone.addEventListener(ev, e => {
        prevent(e);
        zone.classList.remove('is-dragover');
      });
    });

    zone.addEventListener('drop', e => {
      const files = Array.from(e.dataTransfer?.files || []).filter(f =>
        /^image\/(jpeg|png|webp)$/.test(f.type) ||
        /^video\/(mp4|webm)$/.test(f.type)
      );
      if (files.length) this._handleFiles(overlay, files);
      else this._showMediaStatus(overlay, 'No supported images/videos found in drop', true);
    });
  }

  async _uploadMediaFiles(overlay, files) {
    const total = files.length;
    let done = 0;
    let failed = 0;
    const token = await getCSRFToken();

    for (const file of files) {
      done++;
      this._showMediaStatus(overlay, `Uploading ${done} of ${total}: ${file.name}…`);
      try {
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
      } catch (err) {
        failed++;
        console.error(`Upload failed for ${file.name}:`, err);
      }
    }

    if (failed === 0) {
      this._showMediaStatus(overlay, `Uploaded ${total} file${total === 1 ? '' : 's'}!`);
    } else {
      this._showMediaStatus(overlay, `Uploaded ${total - failed} of ${total}; ${failed} failed`, true);
    }
  }

  async _addYouTube(overlay) {
    const url = prompt('YouTube URL:');
    if (!url || !url.trim()) return;
    const trimmed = url.trim();

    // If no article yet, queue the URL; upload after article is created
    if (!this._editorArticle?.id) {
      // Extract video ID for thumbnail preview
      const ytMatch = trimmed.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
      const youtubeId = ytMatch ? ytMatch[1] : null;
      this._pendingMedia.push({
        type: 'youtube',
        url: trimmed,
        youtubeId,
        _id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6),
      });
      this._refreshMediaGrid(overlay);
      this._showMediaStatus(overlay, 'YouTube queued. Will be added after article is created.');
      return;
    }

    this._showMediaStatus(overlay, 'Adding…');
    try {
      const headers = await getCsrfHeaders();
      const res = await fetch(`/api/v1/news/${this._editorArticle.id}/media/youtube`, {
        method: 'POST', credentials: 'include', headers,
        body: JSON.stringify({ url: trimmed }),
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
    const uploaded = this._editorMedia || [];
    const pending  = this._pendingMedia || [];

    if (!uploaded.length && !pending.length) {
      return '<p class="news-editor__media-empty">No media added yet.</p>';
    }

    const currentCover = this._editorArticle?.cover_image || '';
    const uploadedHtml = uploaded.map(m => {
      const isImage = m.kind === 'image';
      const isCover = isImage && m.file_path && m.file_path === currentCover;
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
          ${isCover ? '<span class="news-editor__media-cover-badge">COVER</span>' : ''}
        </div>`;
      }

      const setCoverBtn = isImage
        ? `<button type="button" class="news-editor__media-set-cover${isCover ? ' is-current' : ''}"
                   data-media-id="${m.id}"
                   ${isCover ? `disabled aria-label="${t('article.currentCoverAria')}"` : `aria-label="${t('article.setCoverAria')}"`}>
             ${isCover ? '✓ Cover' : 'Set Cover'}
           </button>`
        : '';

      return `
        <div class="news-editor__media-item${isCover ? ' news-editor__media-item--is-cover' : ''}" data-media-id="${m.id}">
          ${preview}
          <div class="news-editor__media-item-controls">
            <input type="text" class="news-editor__media-caption" placeholder="${t('article.captionPlaceholder')}"
                   value="${_esc(m.caption || '')}" data-media-id="${m.id}">
            ${setCoverBtn}
            <button type="button" class="news-editor__media-delete" data-media-id="${m.id}"
                    aria-label="Delete media">✕</button>
          </div>
        </div>`;
    }).join('');

    const pendingHtml = pending.map(p => {
      let preview;
      if (p.type === 'youtube') {
        const thumb = p.youtubeId
          ? `<img src="https://img.youtube.com/vi/${_esc(p.youtubeId)}/mqdefault.jpg" alt="YouTube" loading="lazy">`
          : '';
        preview = `<div class="news-editor__media-thumb news-editor__media-thumb--yt">
          ${thumb}
          <span class="news-editor__media-yt-badge">YT</span>
        </div>`;
      } else if (p.isVideo) {
        preview = `<div class="news-editor__media-thumb news-editor__media-thumb--vid">
          <video src="${_esc(p.previewUrl)}" preload="metadata" muted></video>
          <span class="news-editor__media-vid-badge">VID</span>
        </div>`;
      } else {
        preview = `<div class="news-editor__media-thumb">
          <img src="${_esc(p.previewUrl)}" alt="${_esc(p.name || '')}" loading="lazy">
        </div>`;
      }

      return `
        <div class="news-editor__media-item news-editor__media-item--pending" data-pending-id="${p._id}">
          ${preview}
          <span class="news-editor__media-pending-badge">PENDING</span>
          <div class="news-editor__media-item-controls">
            <span class="news-editor__media-pending-name" title="${_esc(p.name || p.url || '')}">${_esc(p.name || p.url || '')}</span>
            <button type="button" class="news-editor__media-delete" data-pending-id="${p._id}"
                    aria-label="Remove from queue">✕</button>
          </div>
        </div>`;
    }).join('');

    return uploadedHtml + pendingHtml;
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
        // Pending (not yet uploaded) — just remove from queue, no confirm
        const pendingId = btn.dataset.pendingId;
        if (pendingId) {
          const idx = this._pendingMedia.findIndex(p => p._id === pendingId);
          if (idx !== -1) {
            const removed = this._pendingMedia.splice(idx, 1)[0];
            if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
          }
          this._refreshMediaGrid(overlay);
          return;
        }

        // Already-uploaded item — confirm and DELETE via API
        const mediaId = btn.dataset.mediaId;
        if (!confirm(t('article.confirmDeleteMedia'))) return;
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

    // Set Cover buttons — only appear on uploaded image items
    overlay.querySelectorAll('.news-editor__media-set-cover').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mediaId = Number(btn.dataset.mediaId);
        const m = this._editorMedia.find(x => x.id === mediaId);
        if (!m || !m.file_path) return;
        if (!this._editorArticle?.id) {
          this._showMediaStatus(overlay, 'Save the article first, then set a cover.', true);
          return;
        }
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/news/${this._editorArticle.id}`, {
            method: 'PATCH', credentials: 'include', headers,
            body: JSON.stringify({ cover_image: m.file_path }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Could not set cover');
          }
          this._editorArticle = await res.json();
          this._refreshMediaGrid(overlay);
          this._showMediaStatus(overlay, 'Cover image updated.');
        } catch (err) {
          this._showMediaStatus(overlay, err.message, true);
        }
      });
    });
  }
}
