import { projectApi } from '../api/projectApi.js';
import { showToast }  from './Toast.js';
import { t } from '../i18n/i18n.js';

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
        <button class="modal__close" aria-label="${t('common.close')}">&times;</button>
        <h2 class="modal__title" id="pform-title">${t('admin.createProject')}</h2>
        <form class="project-form" novalidate>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="pf-title">${t('admin.title')} <span class="req">*</span></label>
              <input class="form-input" id="pf-title" name="title" type="text" required maxlength="200" />
            </div>
            <div class="form-group">
              <label class="form-label" for="pf-year">${t('admin.year')} <span class="req">*</span></label>
              <input class="form-input" id="pf-year" name="year" type="number"
                min="1900" max="2100" required />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="pf-desc">${t('admin.description')} <span class="req">*</span></label>
            <textarea class="form-input form-textarea" id="pf-desc" name="description"
              required maxlength="2000" rows="4"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="pf-category">${t('admin.category')} <span class="req">*</span></label>
              <select class="form-input form-select" id="pf-category" name="category" required>
                <option value="">${t('form.selectPlaceholder')}</option>
                <option value="carpentry">${t('projects.carpentry')}</option>
                <option value="tech">${t('projects.tech')}</option>
              </select>
            </div>
            <div class="form-group form-group--check">
              <label class="form-check">
                <input type="checkbox" name="featured" id="pf-featured" />
                <span>${t('admin.featured')}</span>
              </label>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="pf-tools">${t('admin.tools')} <span class="form-hint">(${t('projects.commaSeparated')})</span></label>
            <input class="form-input" id="pf-tools" name="tools_used" type="text"
              placeholder="${t('project.toolsUsedPlaceholder')}" />
          </div>
          <div class="form-group">
            <label class="form-label" for="pf-image">${t('admin.imageUrl')}</label>
            <input class="form-input" id="pf-image" name="image_url" type="url" />
          </div>

          <!-- Icelandic translations — nullable sibling columns (migration 033).
               Leave blank to fall back to the English copy for Icelandic visitors. -->
          <fieldset class="news-editor__translations">
            <legend class="news-editor__translations-legend">${t('admin.translations')} — ${t('admin.icelandicField')}</legend>
            <p class="news-editor__translations-hint">${t('admin.translationsHint')}</p>
            <div class="form-group">
              <label class="form-label" for="pf-title-is">Titill</label>
              <input class="form-input" id="pf-title-is" name="title_is" type="text" maxlength="200" />
            </div>
            <div class="form-group">
              <label class="form-label" for="pf-desc-is">Lýsing</label>
              <textarea class="form-input form-textarea" id="pf-desc-is" name="description_is"
                maxlength="2000" rows="4"></textarea>
            </div>
          </fieldset>

          <!-- Auto-translate opt-in. Default on; untick to save EN-only (IS
               stays null and falls back to EN on read via COALESCE). -->
          <div class="form-group form-check">
            <label class="form-check__label">
              <input type="checkbox" name="__autoTranslate" id="pf-autotranslate" checked />
              <span>${t('admin.autoTranslate')}</span>
            </label>
          </div>

          <p class="form-error" aria-live="polite"></p>
          <div class="form-actions">
            <button class="btn btn--ghost" type="button" data-action="cancel">${t('admin.cancel')}</button>
            <button class="btn btn--primary" type="submit">${t('projects.saveProject')}</button>
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

    this._overlay.querySelector('#pform-title').textContent = isEdit ? t('admin.editProject') : t('admin.createProject');
    this._overlay.querySelector('[type=submit]').textContent = isEdit ? t('form.saveChanges') : t('projects.saveProject');

    const form = this._overlay.querySelector('.project-form');
    form.reset();
    this._overlay.querySelector('.form-error').textContent = '';

    if (isEdit) {
      form.title.value          = project.title;
      form.description.value    = project.description;
      form.category.value       = project.category;
      form.year.value           = project.year;
      form.featured.checked     = project.featured;
      form.tools_used.value     = (project.tools_used || []).join(', ');
      form.image_url.value      = project.image_url || '';
      form.title_is.value       = project.title_is       || '';
      form.description_is.value = project.description_is || '';
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
      title:          form.title.value.trim(),
      description:    form.description.value.trim(),
      category:       form.category.value,
      year:           Number(form.year.value),
      featured:       form.featured.checked,
      tools_used:     form.tools_used.value.split(',').map(s => s.trim()).filter(Boolean),
      image_url:      form.image_url.value.trim() || null,
      // Icelandic siblings — empty → null → IS visitors see the EN fallback.
      title_is:       form.title_is.value.trim()       || null,
      description_is: form.description_is.value.trim() || null,
      // Opt-in flag consumed by the server's autoTranslateFields helper;
      // stripped from the payload before it reaches SQL.
      __autoTranslate: form.__autoTranslate?.checked !== false,
    };

    try {
      if (this._project) {
        await projectApi.update(this._project.id, data);
        showToast(t('projects.projectUpdated'), 'success');
      } else {
        await projectApi.create(data);
        showToast(t('projects.projectCreated'), 'success');
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
