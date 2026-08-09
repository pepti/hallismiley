import { t } from '../i18n/i18n.js';

export class AboutView {
  render() {
    const view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = `
      <main class="main">
        <section class="section about">
          <div class="section__header">
            <h2 class="section__title">${t('about.title')}</h2>
          </div>
          <p style="color:var(--text-secondary);font-size:1rem;line-height:1.8;max-width:600px">
            ${t('about.intro')}
          </p>

          <div class="about__grid">
            <div class="about__card">
              <div class="about__card-icon">🪚</div>
              <h3 class="about__card-title">${t('about.carpentry.title')}</h3>
              <p class="about__card-text">${t('about.carpentry.desc')}</p>
            </div>
            <div class="about__card">
              <div class="about__card-icon">💻</div>
              <h3 class="about__card-title">${t('about.cs.title')}</h3>
              <p class="about__card-text">${t('about.cs.desc')}</p>
            </div>
            <div class="about__card">
              <div class="about__card-icon">📐</div>
              <h3 class="about__card-title">${t('about.design.title')}</h3>
              <p class="about__card-text">${t('about.design.desc')}</p>
            </div>
            <div class="about__card">
              <div class="about__card-icon">🔧</div>
              <h3 class="about__card-title">${t('about.tools.title')}</h3>
              <p class="about__card-text">${t('about.tools.desc')}</p>
            </div>
          </div>

          <div style="margin-top:var(--sp-7);padding-top:var(--sp-5);border-top:1px solid var(--border)">
            <p style="font-size:0.8rem;font-family:var(--font-mono);color:var(--text-muted)">
              ${t('about.techNote')}
            </p>
          </div>
        </section>
      </main>
    `;
    return Promise.resolve(view);
  }
}
