import { t } from '../i18n/i18n.js';

// Category filter for /verkefni.
//
// The filters follow the data (2026-09-01). They used to be a fixed row —
// Öll · Trésmiðsverk · Tækni — which advertised a carpentry filter on a
// software company's references page whether or not a single carpentry
// project existed, and would have kept advertising it after the last one was
// removed. Now a category earns its button by having a project in it, so the
// row is always a true description of what is behind it and needs no edit when
// the portfolio changes.
//
// Keys are the projects.category enum (server/config/schema.js): a project
// carries one, and 'all' is the implicit default.
const CATEGORY_LABELS = {
  tech:      'projects.tech',
  carpentry: 'projects.carpentry',
};

export class FilterBar {
  constructor(onChange) {
    this.onChange = onChange;
    this.active = 'all';
    this.bar = null;
  }

  render() {
    this.bar = document.createElement('div');
    this.bar.className = 'filter-bar';
    this._paint(['all']);
    return this.bar;
  }

  // Called once the projects are in. Anything not in CATEGORY_LABELS is
  // ignored rather than rendered raw — a category added to the database
  // without a label here would otherwise print its enum key at the visitor.
  setCategories(categories) {
    const present = [...new Set(categories)].filter(c => CATEGORY_LABELS[c]);
    // A lone category filters to everything, so the row would be two buttons
    // showing the same grid. Not worth the visitor's attention.
    this._paint(present.length > 1 ? ['all', ...present] : ['all']);
  }

  _paint(keys) {
    if (!this.bar) return;
    this.bar.innerHTML = '';
    // One button is no choice — hide the row rather than show a dead control.
    this.bar.hidden = keys.length < 2;
    if (this.bar.hidden) return;
    if (!keys.includes(this.active)) this.active = 'all';

    for (const key of keys) {
      const btn = document.createElement('button');
      btn.className = `filter-btn${this.active === key ? ' active' : ''}`;
      btn.dataset.category = key;
      btn.textContent = key === 'all' ? t('projects.all') : t(CATEGORY_LABELS[key]);
      btn.addEventListener('click', () => {
        this.active = key;
        this.bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.onChange(key);
      });
      this.bar.appendChild(btn);
    }
  }
}
