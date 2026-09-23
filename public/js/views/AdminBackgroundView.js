// AdminBackgroundView (/admin/background) — the standalone admin page for the
// home-hero background and the background library. Both editors live in
// components (LandingBackgroundAdmin, BackgroundLibraryAdmin), which ProfileView
// also mounts as admin-only sections; this page is the sidebar-shell wrapper
// around them, so the two surfaces can never drift apart.
import { isAuthenticated, isAdmin } from '../services/auth.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { LandingBackgroundAdmin } from '../components/LandingBackgroundAdmin.js';
import { BackgroundLibraryAdmin } from '../components/BackgroundLibraryAdmin.js';

export class AdminBackgroundView {
  constructor() { this._el = null; this._editor = null; this._library = null; }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page bg-page';
    this._el.innerHTML = `
      <h1 class="admin-title">${t('adminBg.title')}</h1>
      <p class="bg-sub">${t('adminBg.subtitle')}</p>`;

    this._editor = new LandingBackgroundAdmin();
    this._el.appendChild(this._editor.render());

    this._el.insertAdjacentHTML('beforeend',
      `<h2 class="bg-lib-heading">${t('bgLib.title')}</h2>
       <p class="bg-sub">${t('bgLib.hint')}</p>`);
    this._library = new BackgroundLibraryAdmin();
    this._el.appendChild(this._library.render());

    return renderAdminShell({ activePath: '/admin/background', content: this._el });
  }

  destroy() {}
}
