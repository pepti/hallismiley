// Category fallback images — Iceland landscapes, no people, no foreign flags
const CATEGORY_IMAGES = {
  tech:        'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=800&h=500&fit=crop&q=80&auto=format',
  carpentry:   'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800&h=500&fit=crop&q=80&auto=format',
  remodelling: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&h=500&fit=crop&q=80&auto=format',
  tools:       'https://images.unsplash.com/photo-1581783898377-1c85bf937427?w=800&h=500&fit=crop&q=80&auto=format',
};

import { escHtml }                      from '../utils/escHtml.js';
import { isAuthenticated }              from '../services/auth.js';
import { addFavorite, removeFavorite }  from '../services/auth.js';

export class ProjectCard {
  /**
   * @param {object}   project
   * @param {Function} onClick
   * @param {boolean}  isFavorited  — whether the current user has favorited this project
   */
  constructor(project, onClick, isFavorited = false) {
    this.project     = project;
    this.onClick     = onClick;
    this.isFavorited = isFavorited;
  }

  render() {
    const { title, description, category, year, featured, image_url, id } = this.project;

    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.category = category;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `View project: ${title}`);

    const bgImg = image_url || CATEGORY_IMAGES[category] || CATEGORY_IMAGES.tech;

    const favBtn = isAuthenticated()
      ? `<button class="project-card__fav-btn${this.isFavorited ? ' project-card__fav-btn--active' : ''}"
                 data-action="favorite" data-id="${id}"
                 aria-label="${this.isFavorited ? 'Remove from favorites' : 'Add to favorites'}"
                 title="${this.isFavorited ? 'Remove from favorites' : 'Add to favorites'}">
           ${this.isFavorited ? '♥' : '♡'}
         </button>`
      : '';

    card.innerHTML = `
      <div class="project-card__image">
        <img class="project-card__image-bg"
             src="${escHtml(bgImg)}" alt="${escHtml(title)}" loading="lazy">
        <div class="project-card__image-overlay"></div>
        <span class="project-card__category project-card__category--${escHtml(category)}">${escHtml(category)}</span>
        <span class="project-card__year">${year}</span>
        ${featured ? '<span class="project-card__featured-star" title="Featured">★</span>' : ''}
        ${favBtn}
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

    // Favorite button — stop propagation so it doesn't also open the project modal
    const favBtnEl = card.querySelector('[data-action="favorite"]');
    if (favBtnEl) {
      favBtnEl.addEventListener('click', async e => {
        e.stopPropagation();
        const active = favBtnEl.classList.contains('project-card__fav-btn--active');
        try {
          if (active) {
            await removeFavorite(id);
            favBtnEl.classList.remove('project-card__fav-btn--active');
            favBtnEl.textContent = '♡';
            favBtnEl.setAttribute('aria-label', 'Add to favorites');
            favBtnEl.title = 'Add to favorites';
          } else {
            await addFavorite(id);
            favBtnEl.classList.add('project-card__fav-btn--active');
            favBtnEl.textContent = '♥';
            favBtnEl.setAttribute('aria-label', 'Remove from favorites');
            favBtnEl.title = 'Remove from favorites';
          }
        } catch { /* silent fail — user may not be logged in */ }
      });
    }

    return card;
  }
}
