// AdminCollectionsView (/admin/shop/collections) — list + create/edit product
// collections (named groups, distinct from the free-text category). Membership
// is still assigned per-product in the product editor; this view manages the
// collections themselves. Mirrors AdminDiscountsView (modal CRUD + admin shell).
import { isAuthenticated, isAdmin } from '../services/auth.js';
import { listCollections, createCollection, updateCollection } from '../services/adminCollections.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';

// Lowercase, hyphenated, alphanumeric — matches the server's validateSlug regex.
function slugify(s) {
  return String(s || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export class AdminCollectionsView {
  constructor() { this._el = null; this._collections = []; }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page disc-page';
    this._el.innerHTML = `
      <div class="disc-head">
        <h1 class="admin-title">${t('adminCollections.title')}</h1>
        <button type="button" class="btn btn--primary" id="coll-new">${t('adminCollections.new')}</button>
      </div>
      <p class="admin-shop__hint">${t('adminCollections.hint')}</p>
      <div id="coll-body"><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el.querySelector('#coll-new').addEventListener('click', () => this._openForm());
    await this._load();
    return renderAdminShell({ activePath: '/admin/shop/collections', content: this._el });
  }

  async _load() {
    const body = this._el.querySelector('#coll-body');
    try {
      this._collections = await listCollections();
      this._paint();
    } catch (err) {
      body.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }

  _paint() {
    const body = this._el.querySelector('#coll-body');
    if (!this._collections.length) { body.innerHTML = `<p>${t('adminCollections.empty')}</p>`; return; }
    body.innerHTML = `
      <table class="admin-table disc-table">
        <thead><tr>
          <th>${t('adminCollections.name')}</th>
          <th>${t('adminCollections.slug')}</th>
          <th>${t('adminCollections.status')}</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${this._collections.map(c => `
            <tr data-id="${escHtml(c.id)}">
              <td>${escHtml(c.title)}${c.description ? `<div class="disc-title">${escHtml(c.description)}</div>` : ''}</td>
              <td><code>${escHtml(c.slug)}</code></td>
              <td>${c.active
                ? `<span class="disc-badge disc-badge--active">${t('adminCollections.active')}</span>`
                : `<span class="disc-badge disc-badge--off">${t('adminCollections.disabled')}</span>`}</td>
              <td><button type="button" class="btn btn--sm btn--ghost" data-edit="${escHtml(c.id)}">${t('admin.edit')}</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      const c = this._collections.find(x => x.id === b.dataset.edit);
      if (c) this._openForm(c);
    }));
  }

  _openForm(existing = null) {
    const isEdit = !!existing;
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card">
        <header>
          <h2>${isEdit ? t('adminCollections.edit') : t('adminCollections.new')}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
        </header>
        <form class="admin-shop__form" id="coll-form">
          <label>${t('adminCollections.name')}
            <input type="text" name="title" required maxlength="200" value="${escHtml(existing?.title || '')}"/>
          </label>
          <label>${t('adminCollections.slug')}
            <input type="text" name="slug" maxlength="80" value="${escHtml(existing?.slug || '')}"
                   placeholder="${t('adminCollections.slugPlaceholder')}"/>
          </label>
          <label>${t('adminCollections.description')}
            <textarea name="description" rows="2" maxlength="500">${escHtml(existing?.description || '')}</textarea>
          </label>
          <label class="admin-shop__checkbox">
            <input type="checkbox" name="active" ${existing?.active === false ? '' : 'checked'}/>
            ${t('adminCollections.activeLabel')}
          </label>
          <p class="admin-shop__error" id="coll-error" role="alert"></p>
          <div class="admin-shop__form-actions">
            <button type="submit" class="btn btn--primary">${isEdit ? t('form.save') : t('form.create')}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    const errorEl = modal.querySelector('#coll-error');

    modal.querySelector('#coll-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const fd = new FormData(e.target);
      const title = String(fd.get('title') || '').trim();
      // Slug defaults to a slugified title when left blank (creation convenience).
      const slug = String(fd.get('slug') || '').trim() || slugify(title);
      const body = {
        title,
        slug,
        description: String(fd.get('description') || '').trim() || null,
        active:      fd.get('active') === 'on',
      };
      try {
        if (isEdit) await updateCollection(existing.id, body);
        else        await createCollection(body);
        close();
        showToast(t('form.saved'), 'success');
        await this._load();
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  }

  destroy() {}
}
