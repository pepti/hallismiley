import { projectApi } from '../api/projectApi.js';
import { showToast }  from './Toast.js';
import { escHtml } from '../utils/escHtml.js';

export class ProjectForm {
  constructor(onSaved) {
    this._overlay = null;
    this._project = null; // null = create mode, object = edit mode
    this._onSaved = onSaved;
  }

  mount() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pform-title');
    overlay.innerHTML = `
      <div class="modal project-form-modal">
        <button class="modal__close" aria-label="Close">&times;</button>
        <h2 class="modal__title" id="pform-title">Add Project</h2>
        <form class="project-form" novalidate>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="pf-title">Title <span class="req">*</span></label>
              <input class="form-input" id="pf-title" name="title" type="text" required maxlength="200" />
            </div>
            <div class="form-group">
              <label class="form-label" for="pf-year">Year <span class="req">*</span></label>
              <input class="form-input" id="pf-year" name="year" type="number"
                min="1900" max="2100" required />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="pf-desc">Description <span class="req">*</span></label>
            <textarea class="form-input form-textarea" id="pf-desc" name="description"
              required maxlength="2000" rows="4"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="pf-category">Category <span class="req">*</span></label>
              <select class="form-input form-select" id="pf-category" name="category" required>
                <option value="">Select…</option>
                <option value="carpentry">Carpentry</option>
                <option value="tech">Tech</option>
              </select>
            </div>
            <div class="form-group form-group--check">
              <label class="form-check">
                <input type="checkbox" name="featured" id="pf-featured" />
                <span>Featured project</span>
              </label>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="pf-tools">Tools used <span class="form-hint">(comma-separated)</span></label>
            <input class="form-input" id="pf-tools" name="tools_used" type="text"
              placeholder="e.g. Node.js, Express, PostgreSQL" />
          </div>
          <div class="form-group">
            <label class="form-label" for="pf-image">Image URL</label>
            <input class="form-input" id="pf-image" name="image_url" type="url" />
          </div>
          <p class="form-error" aria-live="polite"></p>
          <div class="form-actions">
            <button class="btn btn--ghost" type="button" data-action="cancel">Cancel</button>
            <button class="btn btn--primary" type="submit">Save project</button>
          </div>
        </form>
      </div>
    `;

    overlay.querySelector('.modal__close').addEventListener('click',        () => this.close());
    overlay.querySelector('[data-action=cancel]').addEventListener('click', () => this.close());
    overlay.addEventListener('click', e => { if (e.target === overlay) this.close(); });
    overlay.querySelector('.project-form').addEventListener('submit', e => this._onSubmit(e));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });

    document.body.appendChild(overlay);
    this._overlay = overlay;
  }

  open(project = null) {
    if (!this._overlay) this.mount();
    this._project = project;
    const isEdit = !!project;

    this._overlay.querySelector('#pform-title').textContent = isEdit ? 'Edit Project' : 'Add Project';
    this._overlay.querySelector('[type=submit]').textContent = isEdit ? 'Save changes' : 'Save project';

    const form = this._overlay.querySelector('.project-form');
    form.reset();
    this._overlay.querySelector('.form-error').textContent = '';

    if (isEdit) {
      form.title.value       = project.title;
      form.description.value = project.description;
      form.category.value    = project.category;
      form.year.value        = project.year;
      form.featured.checked  = project.featured;
      form.tools_used.value  = (project.tools_used || []).join(', ');
      form.image_url.value   = project.image_url || '';
    }

    requestAnimationFrame(() => this._overlay.classList.add('open'));
    this._overlay.querySelector('#pf-title').focus();
  }

  close() {
    this._overlay?.classList.remove('open');
  }

  async _onSubmit(e) {
    e.preventDefault();
    const form  = e.currentTarget;
    const errEl = this._overlay.querySelector('.form-error');
    const btn   = form.querySelector('[type=submit]');

    errEl.textContent = '';
    btn.disabled = true;

    const data = {
      title:       form.title.value.trim(),
      description: form.description.value.trim(),
      category:    form.category.value,
      year:        Number(form.year.value),
      featured:    form.featured.checked,
      tools_used:  form.tools_used.value.split(',').map(t => t.trim()).filter(Boolean),
      image_url:   form.image_url.value.trim() || null,
    };

    try {
      if (this._project) {
        await projectApi.update(this._project.id, data);
        showToast('Project updated', 'success');
      } else {
        await projectApi.create(data);
        showToast('Project created', 'success');
      }
      this.close();
      this._onSaved?.();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }
}
