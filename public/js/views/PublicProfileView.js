import { getPublicProfile } from '../services/auth.js';
import { escHtml }          from '../utils/escHtml.js';
import { avatarPathByName } from '../utils/avatar.js';

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

export class PublicProfileView {
  constructor(username) {
    this._username = username;
  }

  async render() {
    const el = document.createElement('div');
    el.className = 'main public-profile-page';
    el.innerHTML = `
      <div class="public-profile-container">
        <div class="profile-loading">Loading…</div>
      </div>`;
    this._load(el);
    return el;
  }

  async _load(el) {
    const wrap = el.querySelector('.public-profile-container');
    try {
      const user = await getPublicProfile(this._username);
      wrap.innerHTML = this._buildHTML(user);
    } catch (err) {
      wrap.innerHTML = `
        <div class="not-found">
          <h1 class="not-found__title">User not found</h1>
          <p class="not-found__msg">${escHtml(err.message)}</p>
          <a class="btn btn--outline" href="#/">Go home</a>
        </div>`;
    }
  }

  _buildHTML(user) {
    const avatarName = user.avatar || 'avatar-01.svg';
    const roleBadge  = user.role === 'admin'
      ? `<span class="badge badge--admin">Admin</span>`
      : `<span class="badge badge--user">User</span>`;

    const githubLink = user.github_username
      ? `<a class="connected-link" href="https://github.com/${escHtml(user.github_username)}"
            target="_blank" rel="noopener noreferrer">
           <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
             <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
           </svg>
           ${escHtml(user.github_username)} ↗
         </a>`
      : '';

    const linkedinLink = user.linkedin_username
      ? `<a class="connected-link" href="https://linkedin.com/in/${escHtml(user.linkedin_username)}"
            target="_blank" rel="noopener noreferrer">
           <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
             <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
           </svg>
           ${escHtml(user.linkedin_username)} ↗
         </a>`
      : '';

    const favProjects = (user.favorite_projects || []);
    const favHtml = favProjects.length > 0
      ? favProjects.map(p => `
          <a class="pub-fav-card" href="#/projects/${p.id}">
            ${p.image_url ? `<img class="pub-fav-card__img" src="${escHtml(p.image_url)}" alt="${escHtml(p.title)}" loading="lazy">` : ''}
            <div class="pub-fav-card__body">
              <h4 class="pub-fav-card__title">${escHtml(p.title)}</h4>
              <span class="pub-fav-card__category">${escHtml(p.category)}</span>
            </div>
          </a>`).join('')
      : '<p class="empty-state">No favorite projects yet.</p>';

    return `
      <div class="public-profile-header">
        <img class="public-profile-header__avatar"
             src="${avatarPathByName(avatarName)}"
             alt="${escHtml(user.username)}'s avatar"/>
        <div class="public-profile-header__info">
          <div class="public-profile-header__name-row">
            <h1 class="public-profile-header__username">${escHtml(user.username)}</h1>
            ${roleBadge}
          </div>
          ${user.display_name ? `<p class="public-profile-header__displayname">${escHtml(user.display_name)}</p>` : ''}
          ${user.bio ? `<p class="public-profile-header__bio">${escHtml(user.bio)}</p>` : ''}
          <p class="public-profile-header__joined">Member since ${formatDate(user.created_at)}</p>
          ${(githubLink || linkedinLink) ? `
            <div class="connected-links">
              ${githubLink}
              ${linkedinLink}
            </div>` : ''}
        </div>
      </div>

      <section class="profile-section">
        <h2 class="profile-section__title">Favorite Projects</h2>
        <div class="pub-fav-grid">${favHtml}</div>
      </section>
    `;
  }

  destroy() {}
}
