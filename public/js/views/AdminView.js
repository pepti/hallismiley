import { projectApi }      from '../api/projectApi.js';
import { ProjectForm }     from '../components/ProjectForm.js';
import { showToast }       from '../components/Toast.js';
import { isAuthenticated } from '../services/auth.js';
import { escHtml }         from '../utils/escHtml.js';
import { t, href }         from '../i18n/i18n.js';

export class AdminView {
  async render() {
    if (!isAuthenticated()) {
      window.location.hash = href('/');
      return document.createTextNode('');
    }

    const el = document.createElement('div');
    el.className = 'main admin-page';
    el.innerHTML = `
      <div class="admin-header">
        <div>
          <p class="admin-eyebrow">${t('admin.dashboard')}</p>
          <h1 class="admin-title">${t('admin.projects')}</h1>
        </div>
        <div class="admin-header__actions">
          <a href="${href('/admin/users')}" class="btn btn--outline" data-route="/admin/users">${t('nav.manageUsers')}</a>
          <button class="btn btn--primary" id="add-project-btn">+ ${t('admin.createProject')}</button>
        </div>
      </div>
      <div class="admin-table-wrap">
        <div class="admin-loading">${t('form.loading')}</div>
      </div>
    `;

    const form = new ProjectForm(() => this._reload(el));
    el.querySelector('#add-project-btn').addEventListener('click', () => form.open());

    await this._load(el, form);
    return el;
  }

  async _reload(el) {
    const wrap = el.querySelector('.admin-table-wrap');
    wrap.innerHTML = `<div class="admin-loading">${t('form.loading')}</div>`;
    const form = new ProjectForm(() => this._reload(el));
    await this._load(el, form);
    el.querySelector('#add-project-btn').onclick = () => form.open();
  }

  async _load(el, form) {
    const wrap = el.querySelector('.admin-table-wrap');
    try {
      const projects = await projectApi.getAll();

      if (!projects.length) {
        wrap.innerHTML = `
          <div class="empty-state">
            <div class="empty-state__icon">📂</div>
            <p>${t('admin.noProjects')}</p>
          </div>`;
        return;
      }

      wrap.innerHTML = `
        <table class="admin-table">
          <thead>
            <tr>
              <th>${t('admin.title')}</th>
              <th>${t('admin.category')}</th>
              <th>${t('admin.year')}</th>
              <th>${t('admin.featured')}</th>
              <th class="admin-table__actions-col">${t('admin.status')}</th>
            </tr>
          </thead>
          <tbody>
            ${projects.map(p => `
              <tr data-id="${p.id}">
                <td class="admin-table__title">${escHtml(p.title)}</td>
                <td><span class="badge badge--${escHtml(p.category)}">${escHtml(p.category)}</span></td>
                <td class="admin-table__year">${p.year}</td>
                <td>${p.featured ? `<span class="featured-star" title="${t('admin.featured')}">★</span>` : '—'}</td>
                <td class="admin-table__actions">
                  <button class="btn btn--sm btn--ghost" data-action="edit" data-id="${p.id}">${t('admin.edit')}</button>
                  <button class="btn btn--sm btn--danger" data-action="delete" data-id="${p.id}">${t('admin.delete')}</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      `;

      wrap.querySelectorAll('[data-action=edit]').forEach(btn => {
        btn.addEventListener('click', () => {
          const project = projects.find(p => p.id === Number(btn.dataset.id));
          form.open(project);
        });
      });

      wrap.querySelectorAll('[data-action=delete]').forEach(btn => {
        btn.addEventListener('click', () => this._confirmDelete(btn.dataset.id, el));
      });

    } catch (err) {
      wrap.innerHTML = `<p class="admin-error">${t('form.error')}: ${escHtml(err.message)}</p>`;
    }
  }

  async _confirmDelete(id, el) {
    if (!confirm(t('admin.confirmDeleteProject'))) return;
    try {
      await projectApi.remove(id);
      showToast(t('form.success'), 'success');
      await this._reload(el);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
}
