import { t, href, getLocale } from '../i18n/i18n.js';
import { mountSceneHeader } from '../scenes/sceneHeader.js';
import { initReveal } from '../utils/reveal.js';
import { productSiteUrl } from '../utils/productSite.js';

// The company's services page (2026-09-13). Halli: Orange Smiley sells any
// software a small or medium business needs, not only Rekstrarkerfið — so the
// page leads with what the company builds, then how it works, and then says
// in a few lines what Rekstrarkerfið is.
//
// No product pricing on the company site (Halli, 2026-09-13): the tiers,
// prices and feature matrix live on the product site. A visitor who wants to
// know more is sent there in a new tab.
//
// All copy is DRAFT until Halli approves it.

// What the company builds. The first entry is the core offering and renders
// wide; the rest are numbered so the row never reads as identical cards.
const SERVICES = ['custom', 'web', 'integrations', 'automation', 'migration', 'operations'];

const STEPS = ['1', '2', '3'];

const pad = (n) => String(n).padStart(2, '0');

export class ThjonustaView {
  async render() {
    const view = document.createElement('div');
    view.className = 'view';

    const services = SERVICES.map((id, i) => `
      <li class="service-item${i === 0 ? ' service-item--lead' : ''}">
        <span class="service-item__num" aria-hidden="true">${pad(i + 1)}</span>
        <h3 class="service-item__name">${t(`thjonusta.service.${id}.name`)}</h3>
        <p class="service-item__desc">${t(`thjonusta.service.${id}.desc`)}</p>
      </li>`).join('');

    const steps = STEPS.map(n => `
      <li class="thjonusta-steps__item">
        <span class="thjonusta-steps__num" aria-hidden="true">${n}</span>
        <h3 class="thjonusta-steps__title">${t(`thjonusta.step${n}Title`)}</h3>
        <p class="thjonusta-steps__desc">${t(`thjonusta.step${n}Desc`)}</p>
      </li>`).join('');

    const productUrl = productSiteUrl(getLocale());

    view.innerHTML = `
      <main class="main thjonusta-page" id="main-content">
        <section class="thjonusta-section thjonusta-services" aria-labelledby="thjonusta-services-title">
          <div class="thjonusta-section__header">
            <h2 class="thjonusta-section__title" id="thjonusta-services-title">${t('thjonusta.servicesTitle')}</h2>
            <p class="thjonusta-section__intro">${t('thjonusta.servicesIntro')}</p>
          </div>
          <ol class="service-list">${services}</ol>
        </section>

        <section class="thjonusta-section thjonusta-steps" aria-labelledby="thjonusta-steps-title">
          <div class="thjonusta-section__header">
            <h2 class="thjonusta-section__title" id="thjonusta-steps-title">${t('thjonusta.stepsTitle')}</h2>
          </div>
          <ol class="thjonusta-steps__list">${steps}</ol>
        </section>

        <section class="thjonusta-section thjonusta-product" aria-labelledby="thjonusta-product-title">
          <div class="thjonusta-section__header">
            <p class="thjonusta-product__eyebrow">${t('thjonusta.productEyebrow')}</p>
            <h2 class="thjonusta-section__title" id="thjonusta-product-title">${t('thjonusta.productName')}</h2>
            <p class="thjonusta-section__intro">${t('thjonusta.productIntro')}</p>
            <p class="thjonusta-section__intro">${t('thjonusta.productCore')}</p>
            <a href="${productUrl}" target="_blank" rel="noopener" class="btn btn--primary thjonusta-product__link">
              ${t('thjonusta.productLink')}<span class="sr-only"> ${t('common.opensNewTab')}</span>
              <span class="thjonusta-product__link-icon" aria-hidden="true">↗</span>
            </a>
          </div>
        </section>

        <section class="thjonusta-cta" aria-labelledby="thjonusta-cta-title">
          <h2 class="thjonusta-cta__title" id="thjonusta-cta-title">${t('thjonusta.ctaTitle')}</h2>
          <p class="thjonusta-cta__text">${t('thjonusta.ctaText')}</p>
          <a href="${href('/hafa-samband')}" class="btn btn--primary thjonusta-cta__button">${t('thjonusta.ctaButton')}</a>
        </section>
      </main>
    `;
    // Sigöldugljúfur — many falls feeding one river; the page's header rides
    // the band on a frosted panel (h1 stays inside #main-content).
    this._scene = mountSceneHeader(view.querySelector('.main'), 'thjonusta', `
        <header class="thjonusta-header">
          <p class="admin-eyebrow">${t('thjonusta.eyebrow')}</p>
          <h1 class="thjonusta-title">${t('thjonusta.title')}</h1>
          <p class="thjonusta-intro">${t('thjonusta.intro')}</p>
        </header>`);
    view.querySelectorAll('.service-item')
      .forEach((el, i) => el.classList.add('ice-reveal', 'ice-reveal--d' + Math.min((i % 3) + 1, 3)));
    this._reveal = initReveal(view);
    return view;
  }

  destroy() {
    this._scene?.destroy();
    this._reveal?.destroy();
  }
}
