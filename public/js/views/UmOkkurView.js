import { t, href } from '../i18n/i18n.js';
import { mountSceneHeader } from '../scenes/sceneHeader.js';
import { initReveal } from '../utils/reveal.js';

// Company story page — solo founder + AI-agent operation, company facts.
// The kennitala line stays a placeholder until registration completes
// (umOkkur.factKennitala).
export class UmOkkurView {
  async render() {
    const view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = `
      <main class="main um-okkur-page" id="main-content">

        <section class="um-okkur-story">
          <p>${t('umOkkur.story1')}</p>
          <p>${t('umOkkur.story2')}</p>
          <p>${t('umOkkur.story3')}</p>
        </section>

        <aside class="um-okkur-facts" aria-label="${t('umOkkur.factsTitle')}">
          <h2>${t('umOkkur.factsTitle')}</h2>
          <ul>
            <li>${t('umOkkur.factName')}</li>
            <li>${t('umOkkur.factKennitala')}</li>
            <li>${t('umOkkur.factLocation')}</li>
            <li><a href="mailto:${t('umOkkur.factEmail')}">${t('umOkkur.factEmail')}</a></li>
          </ul>
        </aside>

        <footer class="um-okkur-cta">
          <a href="${href('/hafa-samband')}" class="btn btn--primary">${t('thjonusta.cta')}</a>
        </footer>
      </main>
    `;
    // Svínafellsjökull at blue hour — patient, quiet craft.
    this._scene = mountSceneHeader(view.querySelector('.main'), 'umOkkur', `
        <header class="um-okkur-header">
          <p class="admin-eyebrow">${t('umOkkur.eyebrow')}</p>
          <h1 class="um-okkur-title">${t('umOkkur.title')}</h1>
          <p class="um-okkur-lead">${t('umOkkur.lead')}</p>
        </header>`);
    ['.um-okkur-story', '.um-okkur-facts', '.um-okkur-cta'].forEach((sel, i) => {
      view.querySelector(sel)?.classList.add('ice-reveal', 'ice-reveal--d' + Math.min(i + 1, 3));
    });
    this._reveal = initReveal(view);
    return view;
  }

  destroy() {
    this._scene?.destroy();
    this._reveal?.destroy();
  }
}
