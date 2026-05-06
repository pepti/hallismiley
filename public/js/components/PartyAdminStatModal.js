import { escHtml } from '../utils/escHtml.js';
import { t } from '../i18n/i18n.js';

export class PartyAdminStatModal {
  constructor() {
    this.overlay = null;
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  mount() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" tabindex="-1"></div>`;
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    document.body.appendChild(this.overlay);
  }

  open({ title, rsvps }) {
    if (!this.overlay) this.mount();
    const modal = this.overlay.querySelector('.modal');
    const list = (rsvps && rsvps.length)
      ? `<ul class="party-admin__stat-modal-list">${
          rsvps.map(r => `
            <li class="party-admin__stat-modal-row">
              <div class="party-admin__stat-modal-name">${escHtml(r.display_name || r.username || '—')}</div>
              <div class="party-admin__stat-modal-email">${escHtml(r.email || '')}</div>
            </li>`).join('')
        }</ul>`
      : `<p class="party-empty">${t('party.admin.statEmpty')}</p>`;

    const count = (rsvps && rsvps.length) || 0;
    const detailsKey = count === 1 ? 'party.admin.statDetailsOne' : 'party.admin.statDetails';
    modal.innerHTML = `
      <button class="modal__close" aria-label="${t('common.close')}">&times;</button>
      <h2 class="modal__title">${escHtml(title)}</h2>
      <p class="modal__desc">${t(detailsKey, { n: count })}</p>
      ${list}
    `;
    modal.querySelector('.modal__close').addEventListener('click', () => this.close());
    this.overlay.classList.add('open');
    document.addEventListener('keydown', this._onKeyDown);
    modal.focus();
  }

  close() {
    if (!this.overlay) return;
    this.overlay.classList.remove('open');
    document.removeEventListener('keydown', this._onKeyDown);
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') this.close();
  }
}
