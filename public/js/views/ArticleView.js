// ArticleView — Single news article page
// Route: #/news/:slug
// Renders full article with cover image, author byline, rich body HTML,
// share button, media gallery, and admin edit/delete controls.

import { getUser } from '../services/auth.js';
import { getCsrfHeaders }           from '../utils/api.js';
import { getCSRFToken }             from '../services/auth.js';
import { avatarPathByName }         from '../utils/avatar.js';
import { t, href }                  from '../i18n/i18n.js';
import { navigate }                 from '../navigate.js';

// Tags allowed in article body (whitelist for DOMParser sanitisation)
const ALLOWED_TAGS = new Set([
  'P', 'H2', 'H3', 'H4', 'STRONG', 'EM', 'B', 'I', 'A',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'BR', 'HR',
  'SPAN', 'DIV', 'FIGURE', 'FIGCAPTION',
]);

const ALLOWED_ATTRS = {
  A: new Set(['href', 'target', 'rel']),
};

/**
 * Parse body HTML through DOMParser, strip disallowed tags/attrs, return safe HTML string.
 * This is client-side sanitisation — the server never renders article body directly into
 * server-rendered HTML, so this is the only attack surface.
 */
function sanitizeBody(rawHtml) {
  const doc  = new DOMParser().parseFromString(rawHtml, 'text/html');
  const body = doc.body;

  function clean(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();

    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = node.tagName.toUpperCase();
    if (!ALLOWED_TAGS.has(tag)) {
      // Replace disallowed element with its children (unwrap)
      const frag = document.createDocumentFragment();
      for (const child of node.childNodes) {
        const cleaned = clean(child);
        if (cleaned) frag.appendChild(cleaned);
      }
      return frag;
    }

    const el = document.createElement(tag === 'DIV' ? 'DIV' : tag);

    // Copy only allowed attributes
    const allowedAttrs = ALLOWED_ATTRS[tag];
    if (allowedAttrs) {
      for (const attr of allowedAttrs) {
        if (node.hasAttribute(attr)) {
          const val = node.getAttribute(attr);
          // Reject javascript: hrefs
          if (attr === 'href' && /^\s*javascript:/i.test(val)) continue;
          el.setAttribute(attr, val);
        }
      }
    }

    // Force external links open in new tab with noopener
    if (tag === 'A' && el.href && !el.href.startsWith(window.location.origin)) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel',    'noopener noreferrer');
    }

    for (const child of node.childNodes) {
      const cleaned = clean(child);
      if (cleaned) el.appendChild(cleaned);
    }
    return el;
  }

  const frag = document.createDocumentFragment();
  for (const child of body.childNodes) {
    const cleaned = clean(child);
    if (cleaned) frag.appendChild(cleaned);
  }

  const wrapper = document.createElement('div');
  wrapper.appendChild(frag);
  return wrapper.innerHTML;
}

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
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function _catClass(cat) {
  return ['carpentry', 'tech', 'announcement'].includes(cat) ? cat : 'news';
}

export class ArticleView {
  constructor(slug) {
    this._slug    = slug;
    this._article = null;
    this._media   = [];
    this._view    = null;
  }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view article-page';

    // Show skeleton while loading
    this._view.innerHTML = `<div class="article-page__loading">${t('form.loading')}</div>`;

    try {
      const user = getUser();
      const isEditor = user && ['admin', 'moderator'].includes(user.role);

      const publicUrl  = `/api/v1/news/${encodeURIComponent(this._slug)}`;
      const previewUrl = `${publicUrl}/preview`;

      // Strategy: always try the PUBLIC endpoint first. Every published article
      // lives there and it needs no auth, so the common case is one unconditional
      // fetch that can't return 401/403. Only if the public endpoint returns 404
      // AND the viewer is an editor do we fall back to /preview — that's the
      // draft-preview path. This avoids the old failure mode where a stale
      // client-side session (or an expired cookie) caused /preview to 401 and
      // killed the page for signed-in editors looking at already-published posts.
      let res = await fetch(publicUrl, { credentials: 'include' });

      if (res.status === 404 && isEditor) {
        // Maybe it's a draft — try the auth-gated preview endpoint.
        const previewRes = await fetch(previewUrl, { credentials: 'include' });
        if (previewRes.ok) {
          res = previewRes;
        } else if (previewRes.status === 404) {
          this._view.innerHTML = this._notFound();
          return this._view;
        }
        // If preview returned 401/403 the session is stale — fall through
        // and show 404 (below) since the article isn't publicly visible.
      }

      if (res.status === 404) {
        this._view.innerHTML = this._notFound();
        return this._view;
      }
      if (!res.ok) throw new Error(`Failed to load article (HTTP ${res.status})`);

      this._article = await res.json();

      // Load media
      await this._loadMedia();

      this._view.innerHTML = this._render(isEditor);
      this._bindActions();
    } catch (err) {
      console.error('[ArticleView] Failed to load article:', err);
      this._view.innerHTML = `
        <div class="article-page__inner">
          <p class="article-page__error">
            Could not load this article${err && err.message ? ` — ${_esc(err.message)}` : ''}.
            <a href="${href('/news')}">${t('news.backToNews')}</a>
          </p>
        </div>`;
    }

    return this._view;
  }

  async _loadMedia() {
    try {
      const res = await fetch(`/api/v1/news/${this._article.id}/media`, { credentials: 'include' });
      if (res.ok) this._media = await res.json();
    } catch { /* ignore — media is optional */ }
  }

  _notFound() {
    return `
      <div class="article-page__inner article-page__inner--narrow">
        <p class="article-page__eyebrow">404</p>
        <h1 class="article-page__404-title">${t('article.notFound')}</h1>
        <p class="article-page__404-desc">${t('article.notFoundDesc')}</p>
        <a href="${href('/news')}" class="article-back-link">← ${t('news.backToNews')}</a>
      </div>`;
  }

  _renderMediaGallery() {
    if (!this._media.length) return '';

    const items = this._media.map(m => {
      if (m.kind === 'youtube') {
        return `
          <div class="article-media__item article-media__item--video">
            <div class="article-media__video-wrap">
              <iframe src="https://www.youtube-nocookie.com/embed/${_esc(m.youtube_id)}"
                      frameborder="0" allowfullscreen
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      loading="lazy"></iframe>
            </div>
            ${m.caption ? `<p class="article-media__caption">${_esc(m.caption)}</p>` : ''}
          </div>`;
      }
      if (m.kind === 'video_file') {
        return `
          <div class="article-media__item article-media__item--video">
            <div class="article-media__video-wrap article-media__video-wrap--file">
              <video controls preload="metadata" src="${_esc(m.file_path)}"></video>
            </div>
            ${m.caption ? `<p class="article-media__caption">${_esc(m.caption)}</p>` : ''}
          </div>`;
      }
      // image
      return `
        <div class="article-media__item">
          <img src="${_esc(m.file_path)}" alt="${_esc(m.caption || '')}" loading="lazy">
          ${m.caption ? `<p class="article-media__caption">${_esc(m.caption)}</p>` : ''}
        </div>`;
    }).join('');

    return `
      <div class="article-media-gallery">
        <div class="article-media__grid">
          ${items}
        </div>
      </div>`;
  }

  _render(isEditor) {
    const a        = this._article;
    const catClass = _catClass(a.category);
    const dateStr  = _formatDate(a.published_at || a.created_at);
    const isoDate  = a.published_at || a.created_at;

    const coverHtml = a.cover_image
      ? `<div class="article-hero">
           <img class="article-hero__img" src="${_esc(a.cover_image)}" alt="${_esc(a.title)}"
                loading="eager" width="1200" height="500">
           <div class="article-hero__overlay" aria-hidden="true"></div>
         </div>`
      : `<div class="article-hero article-hero--placeholder article-hero--${catClass}" aria-hidden="true"></div>`;

    const authorHtml = (a.author_display_name || a.author_username)
      ? `<div class="article-byline">
           <img class="article-byline__avatar"
                src="${_esc(avatarPathByName(a.author_avatar))}"
                alt="${_esc(a.author_display_name || a.author_username)}"
                width="40" height="40">
           <div>
             <div class="article-byline__name">${_esc(a.author_display_name || a.author_username)}</div>
             <time class="article-byline__date" datetime="${_esc(isoDate)}">${dateStr}</time>
           </div>
         </div>`
      : `<div class="article-byline">
           <time class="article-byline__date" datetime="${_esc(isoDate)}">${dateStr}</time>
         </div>`;

    const draftBadge = !a.published
      ? `<span class="article-draft-badge" aria-label="${t('article.draftAria')}">DRAFT</span>`
      : '';

    const adminBtns = isEditor
      ? `<div class="article-admin-bar">
           ${draftBadge}
           <button class="article-admin-btn article-admin-btn--edit" id="article-edit-btn">
             ${t('news.editArticle')}
           </button>
           <button class="article-admin-btn article-admin-btn--delete" id="article-delete-btn">
             ${t('admin.delete')}
           </button>
         </div>`
      : '';

    const safeBody = sanitizeBody(a.body || '');

    return `
      ${coverHtml}
      <div class="article-page__inner">
        <nav class="article-nav">
          <a href="${href('/news')}" class="article-back-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            ${t('news.backToNews')}
          </a>
          ${adminBtns}
        </nav>

        <article class="article-content">
          <header class="article-header">
            <span class="article-badge article-badge--${catClass}">${_esc(a.category.toUpperCase())}</span>
            <h1 class="article-title">${_esc(a.title)}</h1>
            ${authorHtml}
          </header>

          <div class="article-body" id="article-body">
            ${safeBody}
          </div>

          ${this._renderMediaGallery()}

          <footer class="article-footer">
            <button class="article-share-btn" id="article-share-btn" aria-label="${t('article.copyLinkAria')}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              ${t('article.share')}
            </button>
            <span class="article-share-confirm" id="share-confirm" aria-live="polite"></span>
          </footer>
        </article>

        <div class="article-page__back">
          <a href="${href('/news')}" class="article-back-link">← ${t('article.allArticles')}</a>
        </div>
      </div>
    `;
  }

  _bindActions() {
    // Share / copy-link
    const shareBtn = this._view.querySelector('#article-share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const url     = window.location.href;
        const confirm = this._view.querySelector('#share-confirm');
        try {
          await navigator.clipboard.writeText(url);
          if (confirm) {
            confirm.textContent = t('article.linkCopied');
            setTimeout(() => { confirm.textContent = ''; }, 2500);
          }
        } catch {
          if (confirm) confirm.textContent = url;
        }
      });
    }

    // Edit
    const editBtn = this._view.querySelector('#article-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', () => this._showEditor());
    }

    // Delete
    const deleteBtn = this._view.querySelector('#article-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => this._confirmDelete());
    }
  }

  // ── Inline editor (same pattern as NewsView) ─────────────────────────
  _showEditor() {
    const a       = this._article;
    const overlay = document.createElement('div');
    overlay.id    = 'article-editor-overlay';
    overlay.className = 'news-editor-overlay';
    overlay.innerHTML = `
      <div class="news-editor" role="dialog" aria-modal="true" aria-label="${t('news.editArticle')}">
        <div class="news-editor__header">
          <h2 class="news-editor__title">${t('news.editArticle')}</h2>
          <button class="news-editor__close" aria-label="${t('article.closeEditorAria')}">✕</button>
        </div>
        <form class="news-editor__form" id="article-edit-form" novalidate>
          <label class="news-editor__label">Title *
            <input class="news-editor__input" name="title" type="text" required maxlength="200"
                   value="${_esc(a.title)}">
          </label>
          <div class="news-editor__row">
            <label class="news-editor__label">Slug
              <input class="news-editor__input" name="slug" type="text" maxlength="100"
                     value="${_esc(a.slug)}">
            </label>
            <label class="news-editor__label">Category
              <input class="news-editor__input" name="category" type="text" maxlength="50"
                     value="${_esc(a.category)}">
            </label>
          </div>
          <label class="news-editor__label">Summary * <small>(max 300 chars)</small>
            <textarea class="news-editor__textarea news-editor__textarea--sm" name="summary"
                      required maxlength="300" rows="3">${_esc(a.summary)}</textarea>
          </label>
          <label class="news-editor__label">Body *
            <textarea class="news-editor__textarea news-editor__textarea--lg" name="body"
                      required rows="16">${_esc(a.body)}</textarea>
          </label>
          <div class="news-editor__row news-editor__row--check">
            <label class="news-editor__check">
              <input type="checkbox" name="published" ${a.published ? 'checked' : ''}>
              Published
            </label>
          </div>

          <!-- Media Section -->
          <div class="news-editor__media-section">
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
              ${this._renderEditorMediaGrid()}
            </div>
          </div>

          <div class="news-editor__status" id="edit-status" aria-live="polite"></div>
          <div class="news-editor__actions">
            <button type="button" class="news-editor__btn news-editor__btn--cancel" id="edit-cancel-btn">${t('admin.cancel')}</button>
            <button type="submit" class="news-editor__btn news-editor__btn--save">${t('form.saveChanges')}</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const close = () => {
      overlay.remove();
      document.body.style.overflow = '';
    };

    overlay.querySelector('.news-editor__close').addEventListener('click', close);
    overlay.querySelector('#edit-cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Media upload handlers
    this._bindMediaUploads(overlay);

    // Drag-and-drop reordering
    this._attachMediaDragReorder(overlay);

    const form = overlay.querySelector('#article-edit-form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const status  = overlay.querySelector('#edit-status');
      const saveBtn = form.querySelector('[type="submit"]');

      const payload = {
        title:       form.querySelector('[name="title"]').value.trim(),
        slug:        form.querySelector('[name="slug"]').value.trim() || undefined,
        category:    form.querySelector('[name="category"]').value.trim() || 'news',
        summary:     form.querySelector('[name="summary"]').value.trim(),
        body:        form.querySelector('[name="body"]').value.trim(),
        published:   form.querySelector('[name="published"]').checked,
      };

      status.textContent  = '';
      saveBtn.disabled    = true;
      saveBtn.textContent = t('form.saving');

      try {
        const headers = await getCsrfHeaders();
        const res = await fetch(`/api/v1/news/${a.id}`, {
          method: 'PATCH', credentials: 'include', headers,
          body:   JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Save failed');
        }
        this._article = await res.json();
        close();
        // Re-render in place
        this._view.innerHTML = this._render(true);
        this._bindActions();
      } catch (err) {
        status.className   = 'news-editor__status news-editor__status--error';
        status.textContent = err.message;
      } finally {
        saveBtn.disabled    = false;
        saveBtn.textContent = t('form.saveChanges');
      }
    });

    overlay.querySelector('[name="title"]').focus();
  }

  // ── Media editor grid rendering ──────────────────────────────────────
  _renderEditorMediaGrid() {
    if (!this._media.length) {
      return '<p class="news-editor__media-empty">No media added yet.</p>';
    }

    const currentCover = this._article?.cover_image || '';
    return this._media.map(m => {
      const isImage  = m.kind === 'image';
      const isCover  = isImage && m.file_path && m.file_path === currentCover;
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
        <div class="news-editor__media-item${isCover ? ' news-editor__media-item--is-cover' : ''}" data-media-id="${m.id}" draggable="true">
          ${preview}
          <div class="news-editor__media-item-controls">
            <input type="text" class="news-editor__media-caption" placeholder="${t('article.captionPlaceholder')}"
                   value="${_esc(m.caption || '')}" data-media-id="${m.id}">
            ${setCoverBtn}
            <button type="button" class="news-editor__media-delete" data-media-id="${m.id}"
                    aria-label="${t('article.deleteMediaAria')}">✕</button>
          </div>
        </div>`;
    }).join('');
  }

  _refreshMediaGrid(overlay) {
    const grid = overlay.querySelector('#media-grid');
    if (grid) {
      grid.innerHTML = this._renderEditorMediaGrid();
      this._attachMediaDragReorder(overlay);
      this._bindMediaItemActions(overlay);
    }
  }

  _bindMediaItemActions(overlay) {
    // Delete buttons
    overlay.querySelectorAll('.news-editor__media-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mediaId = btn.dataset.mediaId;
        if (!confirm(t('article.confirmDeleteMedia'))) return;
        try {
          const token = await getCSRFToken();
          const res = await fetch(`/api/v1/news/${this._article.id}/media/${mediaId}`, {
            method: 'DELETE', credentials: 'include',
            headers: { ...(token ? { 'X-CSRF-Token': token } : {}) },
          });
          if (!res.ok) throw new Error('Delete failed');
          this._media = this._media.filter(m => m.id !== Number(mediaId));
          this._refreshMediaGrid(overlay);
        } catch (err) {
          this._showMediaStatus(overlay, err.message, true);
        }
      });
    });

    // Set Cover buttons
    overlay.querySelectorAll('.news-editor__media-set-cover').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mediaId = Number(btn.dataset.mediaId);
        const m = this._media.find(x => x.id === mediaId);
        if (!m || !m.file_path) return;
        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/news/${this._article.id}`, {
            method: 'PATCH', credentials: 'include', headers,
            body: JSON.stringify({ cover_image: m.file_path }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Could not set cover');
          }
          this._article = await res.json();
          this._refreshMediaGrid(overlay);
          this._showMediaStatus(overlay, 'Cover image updated.');
        } catch (err) {
          this._showMediaStatus(overlay, err.message, true);
        }
      });
    });

    // Caption blur-save
    overlay.querySelectorAll('.news-editor__media-caption').forEach(input => {
      input.addEventListener('change', async () => {
        const mediaId = input.dataset.mediaId;
        const caption = input.value.trim();
        try {
          const headers = await getCsrfHeaders();
          await fetch(`/api/v1/news/${this._article.id}/media/${mediaId}`, {
            method: 'PATCH', credentials: 'include', headers,
            body: JSON.stringify({ caption }),
          });
          const m = this._media.find(m => m.id === Number(mediaId));
          if (m) m.caption = caption;
        } catch { /* silent */ }
      });
    });
  }

  _showMediaStatus(overlay, msg, isError = false) {
    const el = overlay.querySelector('#media-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `news-editor__media-status${isError ? ' news-editor__media-status--error' : ' news-editor__media-status--ok'}`;
    setTimeout(() => { el.textContent = ''; el.className = 'news-editor__media-status'; }, 3000);
  }

  // ── Media upload bindings ────────────────────────────────────────────
  _bindMediaUploads(overlay) {
    // Image upload (multi-select)
    const imageInput = overlay.querySelector('#media-upload-image');
    if (imageInput) {
      imageInput.addEventListener('change', () => {
        if (imageInput.files.length) this._uploadMediaFiles(overlay, Array.from(imageInput.files));
        imageInput.value = '';
      });
    }

    // Video upload (multi-select)
    const videoInput = overlay.querySelector('#media-upload-video');
    if (videoInput) {
      videoInput.addEventListener('change', () => {
        if (videoInput.files.length) this._uploadMediaFiles(overlay, Array.from(videoInput.files));
        videoInput.value = '';
      });
    }

    // YouTube
    const ytBtn = overlay.querySelector('#media-add-youtube');
    if (ytBtn) {
      ytBtn.addEventListener('click', () => this._addYouTube(overlay));
    }

    // Drag-and-drop file upload
    this._bindDropzone(overlay);

    // Bind item actions for existing items
    this._bindMediaItemActions(overlay);
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
      if (files.length) this._uploadMediaFiles(overlay, files);
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
        const res = await fetch(`/api/v1/news/${this._article.id}/media`, {
          method: 'POST', credentials: 'include',
          headers: { ...(token ? { 'X-CSRF-Token': token } : {}) },
          body: fd,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Upload failed');
        }
        const item = await res.json();
        this._media.push(item);
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

    this._showMediaStatus(overlay, 'Adding…');
    try {
      const headers = await getCsrfHeaders();
      const res = await fetch(`/api/v1/news/${this._article.id}/media/youtube`, {
        method: 'POST', credentials: 'include', headers,
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add YouTube video');
      }

      const item = await res.json();
      this._media.push(item);
      this._refreshMediaGrid(overlay);
      this._showMediaStatus(overlay, 'Added!');
    } catch (err) {
      this._showMediaStatus(overlay, err.message, true);
    }
  }

  // ── Drag-and-drop reorder ────────────────────────────────────────────
  _attachMediaDragReorder(overlay) {
    const grid = overlay.querySelector('#media-grid');
    if (!grid) return;

    let dragMediaId = null;

    const clearIndicators = () => {
      grid.querySelectorAll('.drag-over, .dragging').forEach(el =>
        el.classList.remove('drag-over', 'dragging'));
    };

    grid.addEventListener('dragstart', e => {
      const item = e.target.closest('.news-editor__media-item');
      if (!item) return;
      dragMediaId = Number(item.dataset.mediaId);
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      const ghost = document.createElement('canvas');
      ghost.width = 1; ghost.height = 1;
      e.dataTransfer.setDragImage(ghost, 0, 0);
    });

    grid.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      const overItem = e.target.closest('.news-editor__media-item');
      if (overItem && Number(overItem.dataset.mediaId) !== dragMediaId) {
        overItem.classList.add('drag-over');
      }
    });

    grid.addEventListener('dragleave', e => {
      if (!grid.contains(e.relatedTarget)) {
        grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      }
    });

    grid.addEventListener('drop', e => {
      e.preventDefault();
      if (dragMediaId === null) return;

      const fromIdx = this._media.findIndex(m => m.id === dragMediaId);
      if (fromIdx === -1) { clearIndicators(); dragMediaId = null; return; }

      const overItem = e.target.closest('.news-editor__media-item');
      const arr = [...this._media];
      const [moved] = arr.splice(fromIdx, 1);

      let insertAt;
      if (overItem && Number(overItem.dataset.mediaId) !== dragMediaId) {
        insertAt = arr.findIndex(m => m.id === Number(overItem.dataset.mediaId));
        if (insertAt === -1) insertAt = arr.length;
      } else {
        insertAt = arr.length;
      }

      arr.splice(insertAt, 0, moved);
      this._media = arr;
      clearIndicators();
      dragMediaId = null;
      this._refreshMediaGrid(overlay);
      this._commitMediaReorder();
    });

    grid.addEventListener('dragend', () => {
      clearIndicators();
      dragMediaId = null;
    });
  }

  _reorderTimer = null;
  _commitMediaReorder() {
    clearTimeout(this._reorderTimer);
    this._reorderTimer = setTimeout(async () => {
      const order = this._media.map((m, i) => ({ id: m.id, sort_order: i }));
      try {
        const token = await getCSRFToken();
        const res = await fetch(`/api/v1/news/${this._article.id}/media/reorder`, {
          method: 'PUT', credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'X-CSRF-Token': token } : {}),
          },
          body: JSON.stringify({ order }),
        });
        if (res.ok) {
          this._media = await res.json();
        }
      } catch { /* silent */ }
    }, 500);
  }

  _confirmDelete() {
    if (!confirm(t('article.confirmDelete'))) return;
    this._deleteArticle();
  }

  async _deleteArticle() {
    try {
      const headers = await getCsrfHeaders();
      const res = await fetch(`/api/v1/news/${this._article.id}`, {
        method: 'DELETE', credentials: 'include', headers,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Delete failed');
      }
      navigate(href('/news'));
    } catch (err) {
      alert(t('article.alertDeleteFailed', { message: err.message }));
    }
  }
}
