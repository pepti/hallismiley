// AdminHandbookView (/admin/handbok and /admin/handbok/:slug) — Handbók
// sölufólks, the internal sales-staff handbook. Library mode groups published
// guides under the four fixed sections (grunnur / sala / þjónusta / vara);
// read mode renders one guide's rich body through the shared allowlist
// sanitizer. Read access = admin view 'handbok' (the `solufolk` role);
// the editor (admin/moderator) arrives in chunk 3 of the program.
//
// Structural model: AdminBinsView (admin shell + class shape). Theme rule:
// tokens only — this view must survive all five themes (invariant 15).
import { isAuthenticated, canSeeView } from '../services/auth.js';
import { getGuides, getGuide } from '../services/salesGuides.js';
import { escHtml } from '../utils/escHtml.js';
import { sanitizeBodyHtml } from '../utils/sanitizeHtml.js';
import { t, href, getLocale } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';

// Render order of the fixed sections (mirrors the DB CHECK constraint).
const SECTIONS = ['grunnur', 'sala', 'thjonusta', 'vara'];

export class AdminHandbookView {
  constructor(slug = null) {
    this._slug = slug || null;
    this._el = null;
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
      const data = await getGuides();
      const bySection = new Map(SECTIONS.map(s => [s, []]));
      for (const g of data.guides) {
        (bySection.get(g.section) || bySection.get('grunnur')).push(g);
      }

      const sectionsHtml = SECTIONS.map((key, i) => {
        const guides = bySection.get(key);
        const cards = guides.length
          ? guides.map(g => this._card(g)).join('')
          : `<p class="admin-handbok__empty">${t('handbok.sectionEmpty')}</p>`;
        return `
          <section class="admin-handbok__section" aria-labelledby="handbok-s-${key}">
            <h2 class="admin-handbok__section-title" id="handbok-s-${key}">
              <span class="admin-handbok__section-no">${i + 1}</span>
              ${t('handbok.section.' + key)}
            </h2>
            <div class="admin-handbok__cards">${cards}</div>
          </section>`;
      }).join('');

      this._el.innerHTML = `
        <div class="admin-handbok__head">
          <div>
            <h1 class="admin-title">${t('handbok.title')}</h1>
            <p class="admin-shop__hint">${t('handbok.subtitle')}</p>
          </div>
        </div>
        ${data.guides.length ? sectionsHtml : `
          <div class="empty-state">
            <div class="empty-state__icon">📖</div>
            <p>${t('handbok.empty')}</p>
          </div>`}
      `;
    } catch (err) {
      this._el.innerHTML = `<p class="admin-error">${escHtml(err.message || t('handbok.loadError'))}</p>`;
    }
  }

  _card(g) {
    const summary = g.summary ? `<p class="admin-handbok__card-summary">${escHtml(g.summary)}</p>` : '';
    return `
      <a class="admin-handbok__card" href="${href('/admin/handbok/' + g.slug)}" data-route="/admin/handbok/${escHtml(g.slug)}">
        <h3 class="admin-handbok__card-title">${escHtml(g.title)}</h3>
        ${summary}
      </a>`;
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
