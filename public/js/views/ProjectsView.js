import { projectApi } from '../api/projectApi.js';
import { ProjectCard } from '../components/ProjectCard.js';
import { FilterBar }   from '../components/FilterBar.js';
import { t, href }     from '../i18n/i18n.js';
import { navigate }    from '../navigate.js';
import { mountSceneHeader } from '../scenes/sceneHeader.js';

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
    // Give the page the skip-nav target it never had — every other business
    // page anchors #main-content on its <main>.
    main.id = 'main-content';

    this.filterBar = new FilterBar((category) => this._applyFilter(category));

    const section = document.createElement('section');
    section.className = 'section';
    section.appendChild(this.filterBar.render());

    this.grid = document.createElement('div');
    this.grid.className = 'project-grid';
    this.grid.innerHTML = skeletonCards(6);
    section.appendChild(this.grid);

    main.appendChild(section);
    view.appendChild(main);

    // Landmannalaugar — black-and-orange, the brand as landscape.
    this._scene = mountSceneHeader(main, 'verkefni', `
        <header class="thjonusta-header">
          <p class="admin-eyebrow">${t('nav.projects')}</p>
          <h1 class="thjonusta-title">${t('projects.title')}</h1>
          <p class="section__count" id="projects-count"></p>
        </header>`);

    this._loadProjects(view);
    return view;
  }

  destroy() {
    this._scene?.destroy();
  }

  async _loadProjects(view) {
    try {
      this.allProjects = await projectApi.getAll({ limit: 100 });
      // The filter row is built from the categories actually present, so it
      // never offers a filter that would return nothing.
      this.filterBar.setCategories(this.allProjects.map(pr => pr.category));
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
          navigate(href(`/verkefni/${proj.id}`));
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
