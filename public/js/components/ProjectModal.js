import { escHtml } from '../utils/escHtml.js';
import { t } from '../i18n/i18n.js';

export class ProjectModal {
  constructor() {
    this.overlay = null;
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  mount() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="position:relative"></div>`;
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    document.body.appendChild(this.overlay);
  }

  open(project) {
    if (!this.overlay) this.mount();
    const { title, description, category, year, tools_used, featured } = project;
    const modal = this.overlay.querySelector('.modal');

    modal.innerHTML = `
      <button class="modal__close" aria-label="${t('common.close')}">&times;</button>
      <div class="modal__eyebrow">
        <span class="badge badge--${category}">${category}</span>
        ${featured ? `<span class="featured-star">★ ${t('projects.featured')}</span>` : ''}
      </div>
      <h2 class="modal__title">${escHtml(title)}</h2>
      <p class="modal__desc">${escHtml(description)}</p>
      <div class="modal__meta">
        <div>
          <div class="modal__meta-label">${t('projects.year')}</div>
          <div style="font-family:var(--font-mono);font-size:0.95rem">${year}</div>
        </div>
        <div>
          <div class="modal__meta-label">${t('projects.tools')}</div>
          <div class="modal__tools">
            ${tools_used.map(tool => `<span class="modal__tool-tag">${escHtml(tool)}</span>`).join('')}
          </div>
        </div>
      </div>
    `;

    modal.querySelector('.modal__close').addEventListener('click', () => this.close());
    this.overlay.classList.add('open');
    document.addEventListener('keydown', this._onKeyDown);
    modal.focus();
  }

  close() {
    if (this.overlay) {
      this.overlay.classList.remove('open');
      document.removeEventListener('keydown', this._onKeyDown);
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') this.close();
  }
}

