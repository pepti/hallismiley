// Category fallback images — Iceland landscapes, no people, no foreign flags
const CATEGORY_IMAGES = {
  tech:        'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=800&h=500&fit=crop&q=80&auto=format',
  carpentry:   'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800&h=500&fit=crop&q=80&auto=format',
  remodelling: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&h=500&fit=crop&q=80&auto=format',
  tools:       'https://images.unsplash.com/photo-1581783898377-1c85bf937427?w=800&h=500&fit=crop&q=80&auto=format',
};

import { escHtml } from '../utils/escHtml.js';

export class ProjectCard {
  constructor(project, onClick) {
    this.project = project;
    this.onClick  = onClick;
  }

  render() {
    const { title, description, category, year, tools_used, featured, image_url } = this.project;

    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.category = category;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `View project: ${title}`);

    const bgImg = image_url || CATEGORY_IMAGES[category] || CATEGORY_IMAGES.tech;

    card.innerHTML = `
      <div class="project-card__image">
        <img class="project-card__image-bg"
             src="${escHtml(bgImg)}" alt="${escHtml(title)}" loading="lazy">
        <div class="project-card__image-overlay"></div>
        <span class="project-card__category project-card__category--${escHtml(category)}">${escHtml(category)}</span>
        <span class="project-card__year">${year}</span>
        ${featured ? '<span class="project-card__featured-star" title="Featured">★</span>' : ''}
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

