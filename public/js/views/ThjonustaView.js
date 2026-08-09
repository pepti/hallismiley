import { t, href } from '../i18n/i18n.js';

// The three service tiers (Vefur / Verslun / Rekstur) with a feature matrix.
// Prices come from i18n values marked DRAFT until Halli confirms them
// (thjonusta.draft chip is rendered next to every price).
const TIERS = ['Vefur', 'Verslun', 'Rekstur'];

// Feature matrix: i18n key → which tiers include it (index into TIERS).
const FEATURES = [
  ['thjonusta.featWebsite',   [0, 1, 2]],
  ['thjonusta.featI18n',      [0, 1, 2]],
  ['thjonusta.featSeo',       [0, 1, 2]],
  ['thjonusta.featLeadForm',  [0, 1, 2]],
  ['thjonusta.featCatalog',   [1, 2]],
  ['thjonusta.featCheckout',  [1, 2]],
  ['thjonusta.featCustomers', [1, 2]],
  ['thjonusta.featBarcode',   [1, 2]],
  ['thjonusta.featInvoicing', [2]],
  ['thjonusta.featLedger',    [2]],
  ['thjonusta.featReceiving', [2]],
  ['thjonusta.featSupport',   [0, 1, 2]],
];

export class ThjonustaView {
  async render() {
    const view = document.createElement('div');
    view.className = 'view';

    const tierMeta = [
      { name: t('home.tierVefurName'),   price: t('thjonusta.vefurPrice'),   tagline: t('thjonusta.vefurTagline') },
      { name: t('home.tierVerslunName'), price: t('thjonusta.verslunPrice'), tagline: t('thjonusta.verslunTagline') },
      { name: t('home.tierReksturName'), price: t('thjonusta.reksturPrice'), tagline: t('thjonusta.reksturTagline') },
    ];

    const cards = tierMeta.map((tier, i) => `
      <article class="tier-card${i === 1 ? ' tier-card--featured' : ''}">
        <h2 class="tier-card__name">${tier.name}</h2>
        <p class="tier-card__price">
          <span class="tier-card__amount">${tier.price}</span>
          <span class="tier-card__unit">${t('thjonusta.perMonth')}</span>
        </p>
        <span class="tier-card__draft">${t('thjonusta.draft')}</span>
        <p class="tier-card__tagline">${tier.tagline}</p>
        <a href="${href('/hafa-samband')}" class="btn btn--primary tier-card__cta">${t('thjonusta.cta')}</a>
      </article>`).join('');

    const matrixRows = FEATURES.map(([key, tiers]) => `
      <tr>
        <th scope="row">${t(key)}</th>
        ${TIERS.map((_, i) => `
          <td class="${tiers.includes(i) ? 'tier-matrix__yes' : 'tier-matrix__no'}">
            <span aria-hidden="true">${tiers.includes(i) ? '✓' : '—'}</span>
            <span class="sr-only">${tiers.includes(i) ? t('thjonusta.included') : t('thjonusta.notIncluded')}</span>
          </td>`).join('')}
      </tr>`).join('');

    view.innerHTML = `
      <main class="main thjonusta-page" id="main-content">
        <header class="thjonusta-header">
          <p class="admin-eyebrow">${t('thjonusta.eyebrow')}</p>
          <h1 class="thjonusta-title">${t('thjonusta.title')}</h1>
          <p class="thjonusta-intro">${t('thjonusta.intro')}</p>
        </header>

        <div class="tier-cards">${cards}</div>

        <div class="tier-matrix-wrap">
          <table class="tier-matrix">
            <thead>
              <tr>
                <th scope="col">${t('thjonusta.matrixFeature')}</th>
                ${tierMeta.map(tier => `<th scope="col">${tier.name}</th>`).join('')}
              </tr>
            </thead>
            <tbody>${matrixRows}</tbody>
          </table>
        </div>

        <p class="thjonusta-setup-note">${t('thjonusta.setupNote')}</p>
      </main>
    `;
    return view;
  }
}
