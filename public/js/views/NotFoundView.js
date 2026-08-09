import { t, href } from '../i18n/i18n.js';

export class NotFoundView {
  async render() {
    const view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = `
      <main class="main not-found" id="main-content">
        <div class="not-found__inner">
          <p class="not-found__code">404</p>
          <h1 class="not-found__title">${t('notFound.title')}</h1>
          <p class="not-found__desc">${t('notFound.message')}</p>
          <a href="${href('/')}" class="btn btn--primary">${t('notFound.goHome')}</a>
        </div>
      </main>
    `;
    return view;
  }
}
