// AdminHandbookView (/admin/handbok and /admin/handbok/:slug) — Handbók
// sölufólks, the internal sales-staff handbook. Library mode groups published
// guides under the four fixed sections (grunnur / sala / þjónusta / vara);
// read mode renders one guide's rich body through the shared allowlist
// sanitizer. Read access = admin view 'handbok' (the `solufolk` role).
//
// Editors (admin/moderator, canEdit()) get the manage surface on the same
// screen: drafts with a badge, an overlay editor (IS canonical + EN sibling
// fields — the inverse of the news editor's EN + _is split), per-section
// up/down reordering, and delete (admin only — moderators unpublish).
//
// Structural model: AdminBinsView (admin shell + class shape); editor overlay
// mirrors NewsView's. Theme rule: tokens only (invariant 15).
import { isAuthenticated, canSeeView, canEdit, isAdmin } from '../services/auth.js';
import {
  getGuides, getGuide, getManageList,
  createGuide, updateGuide, deleteGuide, reorderGuides,
} from '../services/salesGuides.js';
import { escHtml } from '../utils/escHtml.js';
import { sanitizeBodyHtml } from '../utils/sanitizeHtml.js';
import { t, href, getLocale } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';

// Render order of the fixed sections (mirrors the DB CHECK constraint).
const SECTIONS = ['grunnur', 'sala', 'thjonusta', 'vara'];

export class AdminHandbookView {
  constructor(slug = null) {
    this._slug = slug || null;
    this._el = null;
    this._guides = [];
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('handbok')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-handbok';
    this._el.innerHTML = `<div class="admin-loading">${t('form.loading')}</div>`;

    if (this._slug) {
      await this._loadGuide();
    } else {
      await this._loadLibrary();
    }
    return renderAdminShell({ activePath: '/admin/handbok', content: this._el });
  }

  // ── Library mode ────────────────────────────────────────────────────────
  async _loadLibrary() {
    try {
      // Editors see everything (drafts included, raw columns); readers see
      // the published, locale-resolved list.
      const data = canEdit() ? await getManageList() : await getGuides();
      this._guides = data.guides;
      const bySection = new Map(SECTIONS.map(s => [s, []]));
      for (const g of this._guides) {
        (bySection.get(g.section) || bySection.get('grunnur')).push(g);
      }

      const sectionsHtml = SECTIONS.map((key, i) => {
        const guides = bySection.get(key);
        const cards = guides.length
          ? guides.map((g, idx) => this._card(g, idx, guides.length)).join('')
          : `<p class="admin-handbok__empty">${t('handbok.sectionEmpty')}</p>`;
        return `
          <section class="admin-handbok__section" aria-labelledby="handbok-s-${key}">
            <h2 class="admin-handbok__section-title" id="handbok-s-${key}">
              <span class="admin-handbok__section-no">${i + 1}</span>
              ${t('handbok.section.' + key)}
            </h2>
            <div class="admin-handbok__cards" data-section="${key}">${cards}</div>
          </section>`;
      }).join('');

      const newBtn = canEdit()
        ? `<button type="button" class="btn btn--primary" id="handbok-new">+ ${t('handbok.newGuide')}</button>`
        : '';

      this._el.innerHTML = `
        <div class="admin-handbok__head">
          <div>
            <h1 class="admin-title">${t('handbok.title')}</h1>
            <p class="admin-shop__hint">${t('handbok.subtitle')}</p>
          </div>
          ${newBtn}
        </div>
        ${this._guides.length ? sectionsHtml : `
          <div class="empty-state">
            <div class="empty-state__icon">📖</div>
            <p>${t('handbok.empty')}</p>
          </div>`}
      `;

      this._el.querySelector('#handbok-new')?.addEventListener('click', () => this._showEditor(null));
      this._bindCardControls();
    } catch (err) {
      this._el.innerHTML = `<p class="admin-error">${escHtml(err.message || t('handbok.loadError'))}</p>`;
    }
  }

  _card(g, idx, count) {
    const summary = g.summary ? `<p class="admin-handbok__card-summary">${escHtml(g.summary)}</p>` : '';
    const draft = canEdit() && !g.published
      ? `<span class="admin-handbok__draft-badge">${t('handbok.draftBadge')}</span>` : '';
    const controls = canEdit() ? `
      <div class="admin-handbok__card-controls">
        <button type="button" class="admin-handbok__card-btn" data-move-up="${g.id}" ${idx === 0 ? 'disabled' : ''}
                aria-label="${t('handbok.moveUp')}" title="${t('handbok.moveUp')}">↑</button>
        <button type="button" class="admin-handbok__card-btn" data-move-down="${g.id}" ${idx === count - 1 ? 'disabled' : ''}
                aria-label="${t('handbok.moveDown')}" title="${t('handbok.moveDown')}">↓</button>
        <button type="button" class="admin-handbok__card-btn" data-edit="${g.id}"
                aria-label="${t('handbok.editGuide')}" title="${t('handbok.editGuide')}">✎</button>
      </div>` : '';
    return `
      <div class="admin-handbok__card-wrap">
        <a class="admin-handbok__card" href="${href('/admin/handbok/' + g.slug)}" data-route="/admin/handbok/${escHtml(g.slug)}">
          <h3 class="admin-handbok__card-title">${draft}${escHtml(g.title)}</h3>
          ${summary}
        </a>
        ${controls}
      </div>`;
  }

  _bindCardControls() {
    if (!canEdit()) return;
    this._el.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = this._guides.find(x => x.id === Number(btn.dataset.edit));
        if (g) this._showEditor(g);
      });
    });
    this._el.querySelectorAll('[data-move-up]').forEach(btn => {
      btn.addEventListener('click', () => this._move(Number(btn.dataset.moveUp), -1));
    });
    this._el.querySelectorAll('[data-move-down]').forEach(btn => {
      btn.addEventListener('click', () => this._move(Number(btn.dataset.moveDown), +1));
    });
  }

  // Swap a guide with its neighbour inside its section, then persist the
  // whole section's order (index = sort_order) in one transactional call.
  async _move(id, delta) {
    const guide = this._guides.find(g => g.id === id);
    if (!guide) return;
    const section = this._guides.filter(g => g.section === guide.section);
    const idx = section.findIndex(g => g.id === id);
    const swap = idx + delta;
    if (swap < 0 || swap >= section.length) return;
    [section[idx], section[swap]] = [section[swap], section[idx]];
    try {
      await reorderGuides(section.map((g, i) => ({ id: g.id, sort_order: i })));
      await this._loadLibrary();
    } catch (err) {
      showToast(err.message || t('handbok.saveError'), 'error');
    }
  }

  // ── Editor overlay (admin/moderator) ────────────────────────────────────
  _showEditor(guide) {
    const existing = this._el.querySelector('#handbok-editor-overlay');
    if (existing) existing.remove();

    const isNew   = !guide;
    const overlay = document.createElement('div');
    overlay.id = 'handbok-editor-overlay';
    overlay.className = 'news-editor-overlay';
    const sectionOpts = SECTIONS.map(s =>
      `<option value="${s}" ${guide?.section === s ? 'selected' : ''}>${t('handbok.section.' + s)}</option>`
    ).join('');

    overlay.innerHTML = `
      <div class="news-editor" role="dialog" aria-modal="true" aria-label="${isNew ? t('handbok.newGuide') : t('handbok.editGuide')}">
        <div class="news-editor__header">
          <h2 class="news-editor__title">${isNew ? t('handbok.newGuide') : t('handbok.editGuide')}</h2>
          <button class="news-editor__close" aria-label="${t('article.closeEditorAria')}">✕</button>
        </div>
        <form class="news-editor__form" id="handbok-editor-form" novalidate>
          <label class="news-editor__label">${t('handbok.fieldTitle')} *
            <input class="news-editor__input" name="title" type="text" required maxlength="200"
                   value="${escHtml(guide?.title || '')}">
          </label>
          <div class="news-editor__row">
            <label class="news-editor__label">${t('handbok.fieldSlug')}
              <input class="news-editor__input" name="slug" type="text" maxlength="100"
                     value="${escHtml(guide?.slug || '')}">
            </label>
            <label class="news-editor__label">${t('handbok.fieldSection')}
              <select class="news-editor__input" name="section">${sectionOpts}</select>
            </label>
          </div>
          <label class="news-editor__label">${t('handbok.fieldSummary')} <small>(max 300)</small>
            <textarea class="news-editor__textarea news-editor__textarea--sm" name="summary"
                      maxlength="300" rows="3">${escHtml(guide?.summary || '')}</textarea>
          </label>
          <label class="news-editor__label">${t('handbok.fieldBody')} * <small>${t('handbok.bodyHint')}</small>
            <textarea class="news-editor__textarea news-editor__textarea--lg" name="body"
                      required rows="16">${escHtml(guide?.body || '')}</textarea>
          </label>

          <!-- English siblings — nullable. Blank ⇒ EN readers get the
               Icelandic canonical copy (COALESCE), inverse of the news split. -->
          <fieldset class="news-editor__translations">
            <legend class="news-editor__translations-legend">${t('handbok.translationsLegend')}</legend>
            <p class="news-editor__translations-hint">${t('handbok.translationsHint')}</p>
            <label class="news-editor__label">Title (EN)
              <input class="news-editor__input" name="title_en" type="text" maxlength="200"
                     value="${escHtml(guide?.title_en || '')}">
            </label>
            <label class="news-editor__label">Summary (EN) <small>(max 300)</small>
              <textarea class="news-editor__textarea news-editor__textarea--sm" name="summary_en"
                        maxlength="300" rows="3">${escHtml(guide?.summary_en || '')}</textarea>
            </label>
            <label class="news-editor__label">Body (EN)
              <textarea class="news-editor__textarea news-editor__textarea--lg" name="body_en"
                        rows="12">${escHtml(guide?.body_en || '')}</textarea>
            </label>
          </fieldset>

          <div class="news-editor__row news-editor__row--check">
            <label class="news-editor__check">
              <input type="checkbox" name="published" ${guide?.published ? 'checked' : ''}>
              ${t('handbok.publishedLabel')}
            </label>
          </div>

          <div class="news-editor__status" id="handbok-editor-status" aria-live="polite"></div>
          <div class="news-editor__actions">
            ${!isNew && isAdmin()
              ? `<button type="button" class="btn btn--danger" id="handbok-delete-btn">${t('handbok.deleteGuide')}</button>`
              : ''}
            <button type="button" class="news-editor__btn news-editor__btn--cancel" id="handbok-cancel-btn">${t('admin.cancel')}</button>
            <button type="submit" class="news-editor__btn news-editor__btn--save">${t('handbok.save')}</button>
          </div>
        </form>
      </div>
    `;

    const close = () => overlay.remove();
    overlay.querySelector('.news-editor__close').addEventListener('click', close);
    overlay.querySelector('#handbok-cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#handbok-delete-btn')?.addEventListener('click', async () => {
      if (!window.confirm(t('handbok.deleteConfirm'))) return;
      try {
        await deleteGuide(guide.id);
        showToast(t('handbok.deleted'), 'success');
        close();
        await this._loadLibrary();
      } catch (err) {
        overlay.querySelector('#handbok-editor-status').textContent = err.message || t('handbok.saveError');
      }
    });

    overlay.querySelector('#handbok-editor-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const payload = {
        title:      f.title.value.trim(),
        summary:    f.summary.value.trim() || null,
        body:       f.body.value.trim(),
        section:    f.section.value,
        title_en:   f.title_en.value.trim() || null,
        summary_en: f.summary_en.value.trim() || null,
        body_en:    f.body_en.value.trim() || null,
        published:  f.published.checked,
      };
      if (f.slug.value.trim()) payload.slug = f.slug.value.trim();
      const status = overlay.querySelector('#handbok-editor-status');
      status.textContent = '';
      try {
        if (isNew) await createGuide(payload);
        else       await updateGuide(guide.id, payload);
        showToast(t('handbok.saved'), 'success');
        close();
        await this._loadLibrary();
      } catch (err) {
        status.textContent = err.message || t('handbok.saveError');
      }
    });

    this._el.appendChild(overlay);
    overlay.querySelector('[name=title]').focus();
  }

  // ── Read mode ───────────────────────────────────────────────────────────
  async _loadGuide() {
    try {
      const g = await getGuide(this._slug);
      const updated = g.updated_at
        ? new Date(g.updated_at).toLocaleDateString(getLocale() === 'is' ? 'is-IS' : 'en-GB',
            { day: 'numeric', month: 'long', year: 'numeric' })
        : '';

      this._el.innerHTML = `
        <nav class="admin-handbok__breadcrumb">
          <a href="${href('/admin/handbok')}" data-route="/admin/handbok">← ${t('handbok.back')}</a>
        </nav>
        <article class="admin-handbok__article">
          <p class="admin-handbok__eyebrow">${t('handbok.section.' + g.section)}</p>
          <h1 class="admin-title">${escHtml(g.title)}</h1>
          ${updated ? `<p class="admin-handbok__meta">${t('handbok.updated')} ${escHtml(updated)}</p>` : ''}
          <div class="admin-handbok__body rich-body"></div>
        </article>
      `;
      // Body is allowlist-HTML from the API; sanitize again for display.
      this._el.querySelector('.admin-handbok__body').innerHTML = sanitizeBodyHtml(g.body || '');
    } catch (err) {
      this._el.innerHTML = `
        <nav class="admin-handbok__breadcrumb">
          <a href="${href('/admin/handbok')}" data-route="/admin/handbok">← ${t('handbok.back')}</a>
        </nav>
        <p class="admin-error">${escHtml(err.message || t('handbok.notFound'))}</p>
      `;
    }
  }
}
