import { t } from '../i18n/i18n.js';

export class FilterBar {
  constructor(onChange) {
    this.onChange = onChange;
    this.active = 'all';
  }

  render() {
    const bar = document.createElement('div');
    bar.className = 'filter-bar';

    const filters = [
      { key: 'all',       label: t('projects.all') },
      { key: 'carpentry', label: t('projects.carpentry') },
      { key: 'tech',      label: t('projects.tech') },
    ];

    filters.forEach(({ key, label }) => {
      const btn = document.createElement('button');
      btn.className = `filter-btn${this.active === key ? ' active' : ''}`;
      btn.dataset.category = key;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        this.active = key;
        bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.onChange(key);
      });
      bar.appendChild(btn);
    });

    return bar;
  }
}
