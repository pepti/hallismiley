import { projectApi } from '../api/projectApi.js';
import { ProjectCard } from '../components/ProjectCard.js';
import { FilterBar }   from '../components/FilterBar.js';
import { t, href }     from '../i18n/i18n.js';

export class ProjectsView {
  constructor() {
    this.allProjects = [];
    this.grid = null;
  }

  async render() {
    const view = document.createElement('div');
    view.className = 'view';

    const main = document.createElement('main');
    main.className = 'main';

    const filterBar = new FilterBar((category) => this._applyFilter(category));

    const section = document.createElement('section');
    section.className = 'section';
    section.innerHTML = `
      <div class="section__header">
        <h2 class="section__title">${t('projects.title')}</h2>
        <span class="section__count" id="projects-count"></span>
      </div>
    `;
    section.insertBefore(filterBar.render(), section.querySelector('.section__header').nextSibling);

    this.grid = document.createElement('div');
    this.grid.className = 'project-grid';
    this.grid.innerHTML = skeletonCards(6);
    section.appendChild(this.grid);

    main.appendChild(section);
    view.appendChild(main);

    this._loadProjects(view);
    return view;
  }

  async _loadProjects(view) {
    try {
      this.allProjects = await projectApi.getAll({ limit: 100 });
      this._renderGrid(this.allProjects, view);
    } catch {
      this.grid.innerHTML = `<div class="empty-state"><div class="empty-state__icon">⚠️</div>${t('form.error')}</div>`;
    }
  }

  _applyFilter(category) {
    const filtered = category === 'all'
      ? this.allProjects
      : this.allProjects.filter(p => p.category === category);
    this._renderGrid(filtered);
  }

  _renderGrid(projects, view) {
    const countEl = (view || document).querySelector('#projects-count');
    if (countEl) countEl.textContent = `${projects.length}`;

    this.grid.innerHTML = '';
    if (!projects.length) {
      this.grid.innerHTML = `<div class="empty-state"><div class="empty-state__icon">📂</div>${t('projects.noProjects')}</div>`;
      return;
    }
    projects.forEach(p => {
      this.grid.appendChild(
        new ProjectCard(p, (proj) => {
          window.location.hash = href(`/projects/${proj.id}`);
        }).render()
      );
    });
  }
}

function skeletonCards(n) {
  return Array.from({ length: n }, () => `
    <div class="skeleton-card">
      <div class="skeleton skeleton-line" style="width:60%"></div>
      <div class="skeleton skeleton-line" style="width:100%"></div>
      <div class="skeleton skeleton-line" style="width:80%"></div>
    </div>
  `).join('');
}
