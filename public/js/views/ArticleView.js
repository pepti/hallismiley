// ArticleView — Single news article page
// Route: #/news/:slug
// Renders full article with cover image, author byline, rich body HTML,
// share button, and admin edit/delete controls.

import { getUser } from '../services/auth.js';
import { getCsrfHeaders }           from '../utils/api.js';
import { avatarPathByName }         from '../utils/avatar.js';

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
    this._view    = null;
  }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view article-page';

    // Show skeleton while loading
    this._view.innerHTML = `<div class="article-page__loading">Loading article…</div>`;

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
      this._view.innerHTML = this._render(isEditor);
      this._bindActions();
    } catch (err) {
      console.error('[ArticleView] Failed to load article:', err);
      this._view.innerHTML = `
        <div class="article-page__inner">
          <p class="article-page__error">
            Could not load this article${err && err.message ? ` — ${_esc(err.message)}` : ''}.
            <a href="#/news">Back to News</a>
          </p>
        </div>`;
    }

    return this._view;
  }

  _notFound() {
    return `
      <div class="article-page__inner article-page__inner--narrow">
        <p class="article-page__eyebrow">404</p>
        <h1 class="article-page__404-title">Article Not Found</h1>
        <p class="article-page__404-desc">This article doesn't exist or may have been removed.</p>
        <a href="#/news" class="article-back-link">← Back to News</a>
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
      ? `<span class="article-draft-badge" aria-label="Draft — not publicly visible">DRAFT</span>`
      : '';

    const adminBtns = isEditor
      ? `<div class="article-admin-bar">
           ${draftBadge}
           <button class="article-admin-btn article-admin-btn--edit" id="article-edit-btn">
             Edit Article
           </button>
           ${(getUser()?.role === 'admin') ? `
           <button class="article-admin-btn article-admin-btn--delete" id="article-delete-btn">
             Delete
           </button>` : ''}
         </div>`
      : '';

    const safeBody = sanitizeBody(a.body || '');

    return `
      ${coverHtml}
      <div class="article-page__inner">
        <nav class="article-nav">
          <a href="#/news" class="article-back-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back to News
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

          <footer class="article-footer">
            <button class="article-share-btn" id="article-share-btn" aria-label="Copy link to clipboard">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              Share
            </button>
            <span class="article-share-confirm" id="share-confirm" aria-live="polite"></span>
          </footer>
        </article>

        <div class="article-page__back">
          <a href="#/news" class="article-back-link">← All Articles</a>
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
            confirm.textContent = 'Link copied!';
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
      <div class="news-editor" role="dialog" aria-modal="true" aria-label="Edit Article">
        <div class="news-editor__header">
          <h2 class="news-editor__title">Edit Article</h2>
          <button class="news-editor__close" aria-label="Close editor">✕</button>
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
          <label class="news-editor__label">Cover Image URL
            <input class="news-editor__input" name="cover_image" type="text"
                   value="${_esc(a.cover_image || '')}">
          </label>
          <div class="news-editor__row news-editor__row--check">
            <label class="news-editor__check">
              <input type="checkbox" name="published" ${a.published ? 'checked' : ''}>
              Published
            </label>
          </div>
          <div class="news-editor__status" id="edit-status" aria-live="polite"></div>
          <div class="news-editor__actions">
            <button type="button" class="news-editor__btn news-editor__btn--cancel" id="edit-cancel-btn">Cancel</button>
            <button type="submit" class="news-editor__btn news-editor__btn--save">Save Changes</button>
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
        cover_image: form.querySelector('[name="cover_image"]').value.trim() || null,
        published:   form.querySelector('[name="published"]').checked,
      };

      status.textContent  = '';
      saveBtn.disabled    = true;
      saveBtn.textContent = 'Saving…';

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
        saveBtn.textContent = 'Save Changes';
      }
    });

    overlay.querySelector('[name="title"]').focus();
  }

  _confirmDelete() {
    if (!confirm('Delete this article? This cannot be undone.')) return;
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
      window.location.hash = '#/news';
    } catch (err) {
      alert(`Could not delete article: ${err.message}`);
    }
  }
}
