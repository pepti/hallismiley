import { projectApi }   from '../api/projectApi.js';
import { ProjectForm }  from '../components/ProjectForm.js';
import { showToast }    from '../components/Toast.js';
import { isAuthenticated } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';

export class AdminView {
  async render() {
    if (!isAuthenticated()) {
      window.location.hash = '#/';
      return document.createTextNode('');
    }

    const el = document.createElement('div');
    el.className = 'main admin-page';
    el.innerHTML = `
      <div class="admin-header">
        <div>
          <p class="admin-eyebrow">Admin</p>
          <h1 class="admin-title">Manage Projects</h1>
        </div>
        <button class="btn btn--primary" id="add-project-btn">+ Add Project</button>
      </div>
      <div class="admin-table-wrap">
        <div class="admin-loading">Loading…</div>
      </div>
    `;

    const form = new ProjectForm(() => this._reload(el));
    el.querySelector('#add-project-btn').addEventListener('click', () => form.open());

    await this._load(el, form);
    return el;
  }

  async _reload(el) {
    const wrap = el.querySelector('.admin-table-wrap');
    wrap.innerHTML = '<div class="admin-loading">Loading…</div>';
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
            <p>No projects yet. Add your first one!</p>
          </div>`;
        return;
      }

      wrap.innerHTML = `
        <table class="admin-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Category</th>
              <th>Year</th>
              <th>Featured</th>
              <th class="admin-table__actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${projects.map(p => `
              <tr data-id="${p.id}">
                <td class="admin-table__title">${escHtml(p.title)}</td>
                <td><span class="badge badge--${escHtml(p.category)}">${escHtml(p.category)}</span></td>
                <td class="admin-table__year">${p.year}</td>
                <td>${p.featured ? '<span class="featured-star" title="Featured">★</span>' : '—'}</td>
                <td class="admin-table__actions">
                  <button class="btn btn--sm btn--ghost" data-action="edit" data-id="${p.id}">Edit</button>
                  <button class="btn btn--sm btn--danger" data-action="delete" data-id="${p.id}">Delete</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      `;

      // Wire up edit / delete buttons
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
      wrap.innerHTML = `<p class="admin-error">Failed to load projects: ${escHtml(err.message)}</p>`;
    }
  }

  async _confirmDelete(id, el) {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    try {
      await projectApi.remove(id);
      showToast('Project deleted', 'success');
      await this._reload(el);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
}
