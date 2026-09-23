// Category fallback image, for a project with no image of its own. The site's
// own licensed Iceland set (credited in CREDITS.md from the footer) — these
// were four hotlinked Unsplash photos, two of them of a carpentry workshop.
const CATEGORY_IMAGES = {
  tech:      '/assets/iceland/highland-road-960.91fae09a.jpg',
  carpentry: '/assets/iceland/braided-960.25ce942d.jpg',
};
const FALLBACK_IMAGE = CATEGORY_IMAGES.tech;

// The badge printed the raw enum key at the visitor — an Icelandic reader saw
// "CARPENTRY" on a card whose every other word was Icelandic. Same labels the
// filter row uses; an unlabelled category falls back to no badge rather than
// leaking the key.
const CATEGORY_LABELS = {
  tech:      'projects.tech',
  carpentry: 'projects.carpentry',
};

import { escHtml } from '../utils/escHtml.js';
import { t } from '../i18n/i18n.js';

export class ProjectCard {
  constructor(project, onClick) {
    this.project = project;
    this.onClick  = onClick;
  }

  render() {
    const { title, description, category, year, featured, image_url } = this.project;

    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.category = category;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${t('projects.viewProject')}: ${title}`);

    const bgImg = image_url || CATEGORY_IMAGES[category] || FALLBACK_IMAGE;
    const badge = CATEGORY_LABELS[category]
      ? `<span class="project-card__category project-card__category--${escHtml(category)}">${escHtml(t(CATEGORY_LABELS[category]))}</span>`
      : '';

    card.innerHTML = `
      <div class="project-card__image">
        <img class="project-card__image-bg"
             src="${escHtml(bgImg)}" alt="${escHtml(title)}" loading="lazy">
        <div class="project-card__image-overlay"></div>
        ${badge}
        <span class="project-card__year">${year}</span>
        ${featured ? `<span class="project-card__featured-star" title="${t('projects.featured')}">★</span>` : ''}
      </div>
      <div class="project-card__body">
        <h3 class="project-card__title">${escHtml(title)}</h3>
        <p class="project-card__desc">${escHtml(description)}</p>
      </div>
    `;

    const handler = () => this.onClick(this.project);
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });

    return card;
  }
}

